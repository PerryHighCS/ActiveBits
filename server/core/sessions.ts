import { randomBytes } from 'crypto'
import {
  EMBEDDED_CHILD_SESSION_PREFIX,
  type Session as SharedSession,
  type SessionStore as SharedSessionStore,
} from '../../types/session.js'
import type { SessionEntryStatus } from '../../types/waitingRoom.js'
import { findHashBySessionId, resetPersistentSession } from './persistentSessions.js'
import { ValkeySessionStore } from './valkeyStore.js'
import type { SessionLike } from './valkeyStore.js'
import { SessionCache } from './sessionCache.js'
import { normalizeSessionData } from './sessionNormalization.js'
import { getActivityWaitingRoomFieldCount } from '../activities/activityRegistry.js'
import {
  consumeSessionEntryParticipant,
  SessionEntryParticipantStoreError,
  storeSessionEntryParticipant,
} from './sessionEntryParticipants.js'
import { buildSessionEntryStatus } from './entryStatus.js'
import {
  acceptEntryParticipant,
  getSessionParticipantCookieName,
  issueAcceptedEntryParticipantToken,
  resolveAcceptedEntryParticipantToken,
} from './acceptedEntryParticipants.js'
import { consumeSessionDataToken } from './sessionTokenUtils.js'

export interface SessionRecord extends SharedSession<Record<string, unknown>> {
  [key: string]: unknown
}

function ensurePlainObject(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function getEmbeddedParentSessionId(session: SessionRecord | SessionLike | null | undefined): string | null {
  const data = ensurePlainObject(session?.data)
  const parentSessionId = typeof data.embeddedParentSessionId === 'string'
    ? data.embeddedParentSessionId.trim()
    : ''
  return parentSessionId.length > 0 ? parentSessionId : null
}

// Generic cross-record keepalive: any session may declare `data.linkedSessionId` to have its own
// touch()es refresh another store record (e.g. a Learn integration entry mapping keyed off this
// live session, so the mapping stays alive for as long as anyone is actually connected to it,
// independent of whatever external polling cadence would otherwise refresh it).
function getLinkedSessionId(session: SessionRecord | SessionLike | null | undefined): string | null {
  const data = ensurePlainObject(session?.data)
  const linkedSessionId = typeof data.linkedSessionId === 'string' ? data.linkedSessionId.trim() : ''
  return linkedSessionId.length > 0 ? linkedSessionId : null
}

function toSessionRecord(session: SessionLike): SessionRecord {
  return {
    ...session,
    id: String(session.id),
    type: typeof session.type === 'string' ? session.type : undefined,
    created: typeof session.created === 'number' ? session.created : Date.now(),
    lastActivity: typeof session.lastActivity === 'number' ? session.lastActivity : undefined,
    data: ensurePlainObject(session.data),
  }
}

export interface SessionStore extends SharedSessionStore<Record<string, unknown>> {
  get(id: string): Promise<SessionRecord | null>
  // Like get, but a backend read failure propagates instead of being mapped to
  // `null` (indistinguishable from "no such session"). Optional: only the
  // Valkey-backed store can fail a read.
  getStrict?(id: string): Promise<SessionRecord | null>
  set(id: string, session: SessionRecord, ttl?: number | null): Promise<void>
  // Optimistic cross-instance concurrency. `set()` does NOT bump
  // `mutationRevision`, so once a session type routes any of its writes through
  // `updateAtomic`/`compareAndSet`, every writer for that type must do the same:
  // a plain `set()` that lands between an `updateAtomic` read and its
  // compare-and-set carries the same revision the CAS expects and is therefore
  // silently overwritten. `compareAndSet` commits only when the stored
  // `mutationRevision` still equals `expectedMutationRevision`, then stamps
  // `expectedMutationRevision + 1`; `updateAtomic` re-reads strictly and retries
  // a bounded number of times on a revision conflict.
  compareAndSet?(id: string, expectedMutationRevision: number, session: SessionRecord, ttl?: number | null): Promise<SessionRecord | null>
  updateAtomic?(id: string, mutate: (session: SessionRecord) => SessionRecord, ttl?: number | null): Promise<SessionRecord | null>
  consumeSessionDataToken?(id: string, field: string, token: string): Promise<SessionRecord | null>
  // Like consumeSessionDataToken, but a backend failure propagates instead of
  // mapping to `null` (indistinguishable from "already consumed / invalid").
  consumeSessionDataTokenStrict?(id: string, field: string, token: string): Promise<SessionRecord | null>
  delete(id: string): Promise<boolean>
  touch(id: string): Promise<boolean>
  refreshSessionExpiry?(id: string, expectedExpiresAt: number, nextExpiresAt: number, ttlMs: number): Promise<SessionRecord | null>
  getAll(): Promise<SessionRecord[]>
  getAllIds(): Promise<string[]>
  cleanup(): void
  close(): Promise<void>
  subscribeToBroadcast?(channel: string, handler: (message: unknown) => void): void
  initializePubSub?(): void
  publishBroadcast?(channel: string, message: Record<string, unknown>): Promise<void>
  valkeyStore?: ValkeySessionStore
  cache?: SessionCache<SessionRecord>
  flushCache?(): Promise<void>
  ttlMs?: number
}

interface WsClient {
  sessionId?: string | null
  readyState: number
  send(payload: string): void
}

interface WsServerLike {
  clients: Iterable<WsClient>
}

export { EMBEDDED_CHILD_SESSION_PREFIX }

class InMemorySessionStore implements SessionStore {
  public readonly ttlMs: number
  private readonly store: Record<string, SessionRecord>
  private readonly cleanupInterval: NodeJS.Timeout

  constructor(ttlMs = 60 * 60 * 1000) {
    this.ttlMs = ttlMs
    this.store = Object.create(null) as Record<string, SessionRecord>

    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000)
    this.cleanupInterval.unref?.()
  }

  async get(id: string): Promise<SessionRecord | null> {
    const session = this.store[id]
    if (!session) {
      return null
    }

    normalizeSessionData(session)
    session.lastActivity = Date.now()
    const embeddedParentSessionId = getEmbeddedParentSessionId(session)
    if (embeddedParentSessionId && embeddedParentSessionId !== id) {
      await this.touch(embeddedParentSessionId)
    }
    return session
  }

  async set(id: string, session: SessionRecord): Promise<void> {
    this.store[id] = normalizeSessionData(session)
  }

  async compareAndSet(
    id: string,
    expectedMutationRevision: number,
    session: SessionRecord,
  ): Promise<SessionRecord | null> {
    const current = this.store[id]
    if (!current || (current.mutationRevision ?? 0) !== expectedMutationRevision) {
      return null
    }
    const replacement = normalizeSessionData({
      ...session,
      mutationRevision: expectedMutationRevision + 1,
      lastActivity: Date.now(),
    })
    this.store[id] = replacement
    return replacement
  }

  async updateAtomic(
    id: string,
    mutate: (session: SessionRecord) => SessionRecord,
  ): Promise<SessionRecord | null> {
    const current = this.store[id]
    if (!current) return null
    const expectedRevision = current.mutationRevision ?? 0
    const draft = structuredClone(current)
    return await this.compareAndSet(id, expectedRevision, mutate(draft))
  }

  async consumeSessionDataToken(id: string, field: string, token: string): Promise<SessionRecord | null> {
    const session = consumeSessionDataToken(this.store[id], field, token)
    if (!session) {
      return null
    }

    session.lastActivity = Date.now()
    session.mutationRevision = (session.mutationRevision ?? 0) + 1
    const embeddedParentSessionId = getEmbeddedParentSessionId(session)
    if (embeddedParentSessionId && embeddedParentSessionId !== id) {
      await this.touch(embeddedParentSessionId)
    }
    return normalizeSessionData(session)
  }

  async delete(id: string): Promise<boolean> {
    const existed = Boolean(this.store[id])
    delete this.store[id]
    return existed
  }

  async touch(id: string): Promise<boolean> {
    const session = this.store[id]
    if (!session) {
      return false
    }

    session.lastActivity = Date.now()
    const linkedSessionId = getLinkedSessionId(session)
    if (linkedSessionId && linkedSessionId !== id) {
      this.touchDirect(linkedSessionId)
    }
    return true
  }

  private touchDirect(id: string): boolean {
    const session = this.store[id]
    if (!session) {
      return false
    }

    session.lastActivity = Date.now()
    return true
  }

  async refreshSessionExpiry(id: string, expectedExpiresAt: number, nextExpiresAt: number, _ttlMs: number): Promise<SessionRecord | null> {
    const session = this.store[id]
    if (!session || session.data.expiresAt !== expectedExpiresAt) return null
    session.data = { ...session.data, expiresAt: nextExpiresAt }
    session.mutationRevision = (session.mutationRevision ?? 0) + 1
    session.lastActivity = Date.now()
    const refreshed = normalizeSessionData(session)
    const embeddedParentSessionId = getEmbeddedParentSessionId(refreshed)
    if (embeddedParentSessionId && embeddedParentSessionId !== id) {
      await this.touch(embeddedParentSessionId)
    }
    return refreshed
  }

  async getAll(): Promise<SessionRecord[]> {
    return Object.values(this.store).map((session) => normalizeSessionData(session))
  }

  async getAllIds(): Promise<string[]> {
    return Object.keys(this.store)
  }

  cleanup(): void {
    const now = Date.now()
    for (const id in this.store) {
      if (now - (this.store[id]?.lastActivity ?? 0) > this.ttlMs) {
        delete this.store[id]
      }
    }
  }

  async close(): Promise<void> {
    clearInterval(this.cleanupInterval)
  }

  subscribeToBroadcast(): void {}
  initializePubSub(): void {}
  async publishBroadcast(): Promise<void> {}
}

export function createSessionStore(valkeyUrl: string | null = null, ttlMs = 60 * 60 * 1000, providedValkeyStore: ValkeySessionStore | null = null): SessionStore {
  if (!valkeyUrl && !providedValkeyStore) {
    console.info(JSON.stringify({
      component: 'session-store',
      event: 'store-selected',
      store: 'in-memory',
      reason: 'valkey-url-not-configured',
    }))
    return new InMemorySessionStore(ttlMs)
  }

  console.info(JSON.stringify({
    component: 'session-store',
    event: 'store-selected',
    store: 'valkey',
    cacheEnabled: true,
  }))
  const valkeyStore = providedValkeyStore ?? new ValkeySessionStore(valkeyUrl!, { ttlMs })
  const linkedSessionRevalidatedAt = new Map<string, number>()
  const LINKED_SESSION_REVALIDATION_MS = 5_000
  const MAX_LINKED_SESSION_REVALIDATIONS = 1_000
  const recordLinkedSessionRevalidation = (id: string, timestamp: number): void => {
    linkedSessionRevalidatedAt.delete(id)
    linkedSessionRevalidatedAt.set(id, timestamp)
    while (linkedSessionRevalidatedAt.size > MAX_LINKED_SESSION_REVALIDATIONS) {
      const oldestId = linkedSessionRevalidatedAt.keys().next().value
      if (oldestId === undefined) break
      linkedSessionRevalidatedAt.delete(oldestId)
    }
  }
  const pruneLinkedSessionRevalidations = (): void => {
    for (const id of linkedSessionRevalidatedAt.keys()) {
      if (!cache.has(id)) linkedSessionRevalidatedAt.delete(id)
    }
  }
  const cache = new SessionCache<SessionRecord>({
    ttlMs: 30_000,
    maxSize: 1000,
    touchFn: async (id) => {
      await valkeyStore.touch(id)
    },
  })

  const get = async (id: string): Promise<SessionRecord | null> => {
    const session = await cache.get(id, async (sessionId: string) => {
      const loaded = await valkeyStore.get(sessionId)
      return loaded ? toSessionRecord(loaded) : null
    })
    const normalizedSession = normalizeSessionData(session)
    const embeddedParentSessionId = getEmbeddedParentSessionId(normalizedSession)
    if (embeddedParentSessionId && embeddedParentSessionId !== id) {
      await touch(embeddedParentSessionId)
    }
    return normalizedSession
  }

  const loadSessionRecord = async (id: string): Promise<SessionRecord | null> => {
    const loaded = await valkeyStore.get(id)
    return loaded ? normalizeSessionData(toSessionRecord(loaded)) : null
  }

  const getStrict = async (id: string): Promise<SessionRecord | null> => {
    // Bypass the cache-miss loader (whose valkey read swallows failures) and
    // read strictly: a backend outage rejects here so recovery routes can keep
    // it retryable instead of treating a cold-cache blip as "no such session".
    const loaded = await valkeyStore.getStrict(id)
    const normalizedSession = loaded ? normalizeSessionData(toSessionRecord(loaded)) : null
    if (normalizedSession) {
      cache.set(id, normalizedSession, false)
      const embeddedParentSessionId = getEmbeddedParentSessionId(normalizedSession)
      if (embeddedParentSessionId && embeddedParentSessionId !== id) {
        await touch(embeddedParentSessionId)
      }
    } else {
      // Strict miss: the record is genuinely gone (a backend failure would have
      // rejected above). Drop any cached copy so a later ordinary get() cannot
      // resurrect the deleted session from stale cache.
      cache.invalidate(id)
    }
    return normalizedSession
  }

  const set = async (id: string, session: SessionRecord, ttl: number | null = null): Promise<void> => {
    const normalized = normalizeSessionData(session)
    await valkeyStore.set(id, normalized, ttl)
    cache.set(id, normalized, false)
  }

  const compareAndSet = async (
    id: string,
    expectedMutationRevision: number,
    session: SessionRecord,
    ttl: number | null = null,
  ): Promise<SessionRecord | null> => {
    cache.invalidate(id)
    // Shape the candidate through the same normalizer as set() before it is
    // persisted; the Valkey CAS script cannot run it.
    const normalizedInput = normalizeSessionData(session)
    const updated = await valkeyStore.compareAndSet(id, expectedMutationRevision, normalizedInput, ttl)
    if (!updated) return null
    const normalized = normalizeSessionData(toSessionRecord(updated))
    cache.set(id, normalized, false)
    return normalized
  }

  const updateAtomic = async (
    id: string,
    mutate: (session: SessionRecord) => SessionRecord,
    ttl: number | null = null,
  ): Promise<SessionRecord | null> => {
    const maxAttempts = 12
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const current = await getStrict(id)
      if (!current) return null
      const expectedRevision = current.mutationRevision ?? 0
      const draft = structuredClone(current)
      const updated = await compareAndSet(id, expectedRevision, mutate(draft), ttl)
      if (updated) return updated
    }
    throw new Error(`Atomic session update exhausted retry budget for ${id}`)
  }

  const finalizeConsumedToken = async (id: string, consumed: SessionLike | null): Promise<SessionRecord | null> => {
    if (!consumed) {
      return null
    }
    const session = normalizeSessionData(toSessionRecord(consumed))
    cache.set(id, session, false)
    const embeddedParentSessionId = getEmbeddedParentSessionId(session)
    if (embeddedParentSessionId && embeddedParentSessionId !== id) {
      await touch(embeddedParentSessionId)
    }
    return session
  }

  const consumeSessionDataToken = async (id: string, field: string, token: string): Promise<SessionRecord | null> => {
    cache.invalidate(id)
    return finalizeConsumedToken(id, await valkeyStore.consumeSessionDataToken(id, field, token))
  }

  const consumeSessionDataTokenStrict = async (id: string, field: string, token: string): Promise<SessionRecord | null> => {
    // A backend failure rejects here (-> the route's outer catch -> retryable
    // 500) instead of mapping to `null`, which a route treats as a definitive
    // "token invalid / already consumed" 403.
    cache.invalidate(id)
    return finalizeConsumedToken(id, await valkeyStore.consumeSessionDataTokenStrict(id, field, token))
  }

  const del = async (id: string): Promise<boolean> => {
    cache.invalidate(id)
    linkedSessionRevalidatedAt.delete(id)
    return await valkeyStore.delete(id)
  }

  const touchDirect = async (id: string): Promise<{ touched: boolean; session: SessionRecord | null; fromCache: boolean }> => {
    const cached = cache.getFresh(id)
    if (cached) {
      cache.touch(id)
      return { touched: true, session: cached, fromCache: true }
    }

    const touched = await valkeyStore.touch(id)
    if (!touched) {
      return { touched: false, session: null, fromCache: false }
    }

    const session = await loadSessionRecord(id)
    if (session) {
      cache.set(id, session, false)
    }

    return { touched: true, session, fromCache: false }
  }

  const touch = async (id: string): Promise<boolean> => {
    const { touched, session, fromCache } = await touchDirect(id)
    if (!touched) return false

    // A stop handled by another process may have removed linkedSessionId after this
    // process cached the live session. Revalidate source data on a bounded cadence,
    // separate from high-frequency keepalive touches, before following the link.
    const now = Date.now()
    const shouldRevalidate = fromCache && (now - (linkedSessionRevalidatedAt.get(id) ?? 0) >= LINKED_SESSION_REVALIDATION_MS)
    const authoritativeSession = shouldRevalidate ? await loadSessionRecord(id) : session
    if (shouldRevalidate) recordLinkedSessionRevalidation(id, now)
    if (shouldRevalidate && !authoritativeSession) {
      cache.invalidate(id)
      linkedSessionRevalidatedAt.delete(id)
      return false
    }
    if (shouldRevalidate && authoritativeSession) {
      cache.set(id, authoritativeSession, false)
    }
    const linkedSessionId = getLinkedSessionId(authoritativeSession)
    if (linkedSessionId && linkedSessionId !== id) {
      await touchDirect(linkedSessionId)
    }

    return true
  }

  const refreshSessionExpiry = async (id: string, expectedExpiresAt: number, nextExpiresAt: number, ttl: number): Promise<SessionRecord | null> => {
    cache.invalidate(id)
    const refreshed = await valkeyStore.refreshSessionExpiry(id, expectedExpiresAt, nextExpiresAt, ttl)
    if (!refreshed) return null
    const session = normalizeSessionData(toSessionRecord(refreshed))
    cache.set(id, session, false)
    const embeddedParentSessionId = getEmbeddedParentSessionId(session)
    if (embeddedParentSessionId && embeddedParentSessionId !== id) {
      await touch(embeddedParentSessionId)
    }
    return session
  }

  const getAll = async (): Promise<SessionRecord[]> => {
    const all = await valkeyStore.getAll()
    return all.map((session) => normalizeSessionData(toSessionRecord(session)))
  }

  const getAllIds = async (): Promise<string[]> => {
    return await valkeyStore.getAllIds()
  }

  const cleanup = (): void => {
    cache.cleanup()
    pruneLinkedSessionRevalidations()
  }

  const flushCache = async (): Promise<void> => {
    await cache.flushTouches(async (id) => {
      await valkeyStore.touch(id)
    })
  }

  const close = async (): Promise<void> => {
    await cache.shutdown(async (id) => {
      await valkeyStore.touch(id)
    })
    await valkeyStore.close()
    linkedSessionRevalidatedAt.clear()
  }

  const subscribeToBroadcast = (channel: string, handler: (message: unknown) => void): void => {
    valkeyStore.subscribeToBroadcast(channel, (message) => {
      handler(message)
    })
  }

  const initializePubSub = (): void => {
    valkeyStore.initializePubSub()
  }

  const publishBroadcast = async (channel: string, message: Record<string, unknown>): Promise<void> => {
    await valkeyStore.publishBroadcast(channel, message)
  }

  return {
    valkeyStore,
    cache,
    get,
    getStrict,
    set,
    compareAndSet,
    updateAtomic,
    consumeSessionDataToken,
    consumeSessionDataTokenStrict,
    delete: del,
    touch,
    refreshSessionExpiry,
    getAll,
    getAllIds,
    cleanup,
    flushCache,
    close,
    subscribeToBroadcast,
    initializePubSub,
    publishBroadcast,
  }
}

export async function generateHexId(store: Pick<SessionStore, 'get'>, length = 5): Promise<string> {
  let attempts = 0
  let len = length

  while (true) {
    const bytes = randomBytes(Math.ceil(len / 2))
    const id = bytes.toString('hex').slice(0, len)

    const existing = await store.get(id)
    if (!existing) {
      return id
    }

    attempts += 1
    if (attempts > 5) {
      len += 1
    }
  }
}

export async function createSession(
  store: Pick<SessionStore, 'get' | 'set'>,
  { data = {} }: { data?: Record<string, unknown> } = {},
): Promise<SessionRecord> {
  const id = await generateHexId(store)
  const now = Date.now()
  const session = normalizeSessionData({ id, created: now, lastActivity: now, data })
  await store.set(id, session)
  return session
}

function setNoStore(response: ResponseLike): void {
  response.set?.('Cache-Control', 'no-store')
}

export function setupSessionRoutes(app: {
  get(path: string, handler: (req: { params: { sessionId: string }; cookies?: Record<string, unknown> }, res: ResponseLike) => void | Promise<void>): void
  post(path: string, handler: (req: { params: { sessionId: string }; body?: unknown }, res: ResponseLike) => void | Promise<void>): void
  delete(path: string, handler: (req: { params: { sessionId: string } }, res: ResponseLike) => void | Promise<void>): void
}, sessions: SessionStore, wss: WsServerLike | null = null): void {
  app.get('/api/session/:sessionId/entry', async (req, res) => {
    setNoStore(res)
    const { sessionId } = req.params
    const session = await sessions.get(sessionId)
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const activityName = typeof session.type === 'string' ? session.type : ''
    const waitingRoomFieldCount = activityName ? getActivityWaitingRoomFieldCount(activityName) : 0
    const participantAuthenticated = Boolean(resolveAcceptedEntryParticipantToken(
      session,
      req.cookies?.[getSessionParticipantCookieName(sessionId)],
    ))
    const payload = {
      ...buildSessionEntryStatus({
        sessionId,
        activityName,
        waitingRoomFieldCount,
        resolvedRole: 'student',
        entryOutcome: 'join-live',
      }),
      ...(participantAuthenticated ? { participantAuthenticated: true } : {}),
    } satisfies SessionEntryStatus & Record<string, unknown>
    res.json(payload)
  })

  app.get('/api/session/:sessionId', async (req, res) => {
    const { sessionId } = req.params
    const session = await sessions.get(sessionId)
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }
    res.json({ session })
  })

  app.get('/api/session/:sessionId/embedded-launch', async (req, res) => {
    setNoStore(res)
    const { sessionId } = req.params
    if (!sessionId.startsWith(EMBEDDED_CHILD_SESSION_PREFIX)) {
      res.status(403).json({ error: 'embedded launch is only available for embedded child sessions' })
      return
    }

    const session = await sessions.get(sessionId)
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const sessionData = ensurePlainObject(session.data)
    const embeddedLaunch = sessionData?.embeddedLaunch
    const embeddedLaunchRecord = embeddedLaunch != null && typeof embeddedLaunch === 'object' && !Array.isArray(embeddedLaunch)
      ? embeddedLaunch as Record<string, unknown>
      : null
    const selectedOptions = embeddedLaunchRecord?.selectedOptions
    const selectedOptionsRecord = selectedOptions != null && typeof selectedOptions === 'object' && !Array.isArray(selectedOptions)
      ? selectedOptions as Record<string, unknown>
      : null

    res.json({
      embeddedLaunch: {
        selectedOptions: selectedOptionsRecord,
      },
    })
  })

  app.post('/api/session/:sessionId/entry-participant', async (req, res) => {
    setNoStore(res)
    const { sessionId } = req.params
    const session = await sessions.get(sessionId)
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    try {
      const body = req.body != null && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
      const { token, values } = storeSessionEntryParticipant(session, body.values)
      await sessions.set(sessionId, session)
      res.json({ entryParticipantToken: token, values })
    } catch (error) {
      if (error instanceof SessionEntryParticipantStoreError) {
        res.status(error.statusCode).json({ error: error.message })
        return
      }
      console.error('Error storing session entry participant:', { sessionId, error })
      res.status(500).json({ error: 'internal server error' })
    }
  })

  app.post('/api/session/:sessionId/entry-participant/consume', async (req, res) => {
    setNoStore(res)
    const { sessionId } = req.params as { sessionId: string }
    const session = await sessions.get(sessionId)
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    try {
      const body = req.body != null && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
      const token = typeof body.token === 'string' ? body.token : ''
      const values = consumeSessionEntryParticipant(session, token)
      if (!values) {
        res.status(404).json({ error: 'entry participant not found' })
        return
      }

      const acceptedParticipant = acceptEntryParticipant(session, values)
      const participantToken = acceptedParticipant
        ? issueAcceptedEntryParticipantToken(session, acceptedParticipant.participantId)
        : null
      await sessions.set(sessionId, session)
      if (participantToken) {
        res.cookie?.(getSessionParticipantCookieName(sessionId), participantToken, {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
        })
      }
      res.json({ values })
    } catch (error) {
      console.error('Error consuming session entry participant:', { sessionId, error })
      res.status(500).json({ error: 'internal server error' })
    }
  })

  app.delete('/api/session/:sessionId', async (req, res) => {
    const { sessionId } = req.params
    const session = await sessions.get(sessionId)
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    if (sessionId.startsWith(EMBEDDED_CHILD_SESSION_PREFIX)) {
      res.status(403).json({ error: 'embedded child sessions must be ended by the parent session' })
      return
    }

    if (sessions.publishBroadcast) {
      await sessions.publishBroadcast('session-ended', { sessionId })
    } else if (wss) {
      for (const client of wss.clients) {
        if (typeof client.sessionId !== 'undefined' && client.sessionId === sessionId && client.readyState === 1) {
          client.send(JSON.stringify({ type: 'session-ended' }))
        }
      }
    }

    const hash = await findHashBySessionId(sessionId)
    if (hash) {
      await resetPersistentSession(hash)
    }

    await sessions.delete(sessionId)
    res.json({ success: true, deleted: sessionId })
  })
}

interface ResponseLike {
  status(code: number): ResponseLike
  set?(field: string, value: string): ResponseLike
  cookie?(name: string, value: string, options: Record<string, unknown>): ResponseLike
  json(payload: Record<string, unknown>): void
}
