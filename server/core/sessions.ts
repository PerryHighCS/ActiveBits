import { randomBytes } from 'crypto'
import type { Session as SharedSession, SessionStore as SharedSessionStore } from '../../types/session.js'
import { findHashBySessionId, resetPersistentSession } from './persistentSessions.js'
import { ValkeySessionStore } from './valkeyStore.js'
import type { SessionLike } from './valkeyStore.js'
import { SessionCache } from './sessionCache.js'
import { normalizeSessionData } from './sessionNormalization.js'

export interface SessionRecord extends SharedSession<Record<string, unknown>> {
  [key: string]: unknown
}

function ensurePlainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
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
  set(id: string, session: SessionRecord, ttl?: number | null): Promise<void>
  delete(id: string): Promise<boolean>
  touch(id: string): Promise<boolean>
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
    return session
  }

  async set(id: string, session: SessionRecord): Promise<void> {
    this.store[id] = normalizeSessionData(session)
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
    return true
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

export function createSessionStore(valkeyUrl: string | null = null, ttlMs = 60 * 60 * 1000): SessionStore {
  if (!valkeyUrl) {
    console.log('Using in-memory session store (no VALKEY_URL configured)')
    return new InMemorySessionStore(ttlMs)
  }

  console.log('Using Valkey session store with caching')
  const valkeyStore = new ValkeySessionStore(valkeyUrl, { ttlMs })
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
    return normalizeSessionData(session)
  }

  const set = async (id: string, session: SessionRecord, ttl: number | null = null): Promise<void> => {
    const normalized = normalizeSessionData(session)
    await valkeyStore.set(id, normalized, ttl)
    cache.set(id, normalized, false)
  }

  const del = async (id: string): Promise<boolean> => {
    cache.invalidate(id)
    return await valkeyStore.delete(id)
  }

  const touch = async (id: string): Promise<boolean> => {
    const wasCached = cache.has(id)
    const cached = await get(id)
    if (!cached) {
      return false
    }

    cache.touch(id)

    if (!wasCached) {
      await valkeyStore.touch(id)
    }

    return true
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
    set,
    delete: del,
    touch,
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

export function setupSessionRoutes(app: {
  get(path: string, handler: (req: { params: { sessionId: string } }, res: ResponseLike) => void | Promise<void>): void
  delete(path: string, handler: (req: { params: { sessionId: string } }, res: ResponseLike) => void | Promise<void>): void
}, sessions: SessionStore, wss: WsServerLike | null = null): void {
  app.get('/api/session/:sessionId', async (req, res) => {
    const { sessionId } = req.params
    const session = await sessions.get(sessionId)
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }
    res.json({ session })
  })

  app.delete('/api/session/:sessionId', async (req, res) => {
    const { sessionId } = req.params
    const session = await sessions.get(sessionId)
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
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
  json(payload: Record<string, unknown>): void
}
