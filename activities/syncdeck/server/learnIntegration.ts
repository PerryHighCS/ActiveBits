import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { isValidHttpUrl } from 'activebits-server/core/httpUrlUtils.js'
import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'

const INTEGRATION_PREFIX = '/api/integrations/learn/v1'
const BROWSER_PREFIX = '/integrations/learn'
const ACTIVITY_ID = 'syncdeck'
const HMAC_SIGNATURE_HEADER = 'x-learn-signature'
const HMAC_KEY_ID_HEADER = 'x-learn-key-id'
const HMAC_TIMESTAMP_HEADER = 'x-learn-timestamp'
const HMAC_NONCE_HEADER = 'x-learn-nonce'
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000
const NONCE_RETENTION_MS = 2 * MAX_CLOCK_SKEW_MS
const BROWSER_TOKEN_TTL_MS = 5 * 60 * 1000
const WAITING_TTL_MS = 10 * 60 * 1000
const START_LOCK_TTL_MS = 30_000
const START_LOCK_RENEWAL_MS = 10_000
const MAX_PROVIDER_LENGTH = 120
const MAX_RESOURCE_ID_LENGTH = 512
const claimedNonces = new Map<string, number>()
const localStartLocks = new Set<string>()
const RENEW_START_LOCK_SCRIPT = 'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("PEXPIRE", KEYS[1], ARGV[2]) end return 0'
const RELEASE_START_LOCK_SCRIPT = 'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0'

interface RouteRequest {
  params: Record<string, string | undefined>
  body?: unknown
  headers?: Record<string, unknown>
  cookies?: Record<string, unknown>
  query?: Record<string, unknown>
}

interface RouteResponse {
  status(code: number): RouteResponse
  json(payload: unknown): void
  cookie?(name: string, value: string, options: Record<string, unknown>): void
  redirect?(status: number, url: string): void
  setHeader?(name: string, value: string): void
}

interface RouteApp {
  get(path: string, handler: (req: RouteRequest, res: RouteResponse) => void | Promise<void>): void
  post(path: string, handler: (req: RouteRequest, res: RouteResponse) => void | Promise<void>): void
}

interface LearnEntryData extends Record<string, unknown> {
  learnIntegrationKind: 'entry'
  activityId: string
  provider: string
  resourceLinkId: string
  state: 'waiting' | 'active'
  startRequestId?: string
  activeSessionId: string | null
  presentationUrl: string | null
  expiresAt: number
}

interface BrowserTokenData extends Record<string, unknown> {
  learnIntegrationKind: 'browser-token'
  activityId: string
  purpose: 'student-wait' | 'instructor-launch'
  mappingId: string
  sessionId?: string
  expiresAt: number
}

export interface LearnSyncDeckRouteOptions {
  app: RouteApp
  sessions: SessionStore
  ws: WsRouter
  createInstructorSession(presentationUrl: string): Promise<{ sessionId: string; instructorRecoveryToken: string }>
  writeInstructorRecoveryCookie(req: RouteRequest, res: RouteResponse, sessionId: string, token: string): void
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null
}

function readHeader(headers: Record<string, unknown> | undefined, name: string): string | null {
  if (!headers) return null
  const direct = headers[name]
  const value = direct ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()]
  if (Array.isArray(value)) return readString(value[0], 2048)
  return readString(value, 2048)
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
  return `{${entries.join(',')}}`
}

function hashBody(body: unknown): string {
  return createHash('sha256').update(stableJson(body ?? {}), 'utf8').digest('hex')
}

export function buildLearnHmacCanonicalRequest(method: string, path: string, timestamp: string, nonce: string, provider: string, body: unknown): string {
  return [method.toUpperCase(), path, timestamp, nonce, provider, hashBody(body)].join('\n')
}

function configuredKey(): { keyId: string; secret: string } | null {
  const secret = readString(process.env.LEARN_SYNCDECK_HMAC_SECRET, 4096)
  if (!secret) return null
  return {
    keyId: readString(process.env.LEARN_SYNCDECK_HMAC_KEY_ID, 120) ?? 'learn-default',
    secret,
  }
}

function sameSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8')
  const rightBytes = Buffer.from(right, 'utf8')
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

type NonceClaimResult = 'claimed' | 'duplicate' | 'unavailable'
type StartLockResult =
  | { state: 'acquired'; release: () => Promise<void> }
  | { state: 'locked' | 'unavailable' }

async function claimNonce(sessions: SessionStore, keyId: string, nonce: string): Promise<NonceClaimResult> {
  const digest = createHash('sha256').update(`${keyId}\n${nonce}`, 'utf8').digest('hex')
  const valkeyClient = sessions.valkeyStore?.client
  if (valkeyClient) {
    try {
      const result = await (valkeyClient as unknown as {
        set(...args: unknown[]): Promise<unknown>
      }).set(`learn-syncdeck-nonce:${digest}`, '1', 'PX', NONCE_RETENTION_MS, 'NX')
      return result === 'OK' ? 'claimed' : 'duplicate'
    } catch (error) {
      console.error(JSON.stringify({ activity: 'syncdeck', event: 'learn-nonce-claim-failed', error: error instanceof Error ? error.message : String(error) }))
      return 'unavailable'
    }
  }

  const now = Date.now()
  for (const [knownNonce, expiresAt] of claimedNonces) {
    if (expiresAt <= now) claimedNonces.delete(knownNonce)
  }
  if (claimedNonces.has(digest)) return 'duplicate'
  claimedNonces.set(digest, now + NONCE_RETENTION_MS)
  return 'claimed'
}

async function claimStartLock(sessions: SessionStore, mapping: string): Promise<StartLockResult> {
  const digest = createHash('sha256').update(mapping, 'utf8').digest('hex')
  const valkeyClient = sessions.valkeyStore?.client
  if (valkeyClient) {
    try {
      const lockKey = `learn-syncdeck-start:${digest}`
      const lockToken = randomBytes(16).toString('hex')
      const result = await (valkeyClient as unknown as {
        set(...args: unknown[]): Promise<unknown>
      }).set(lockKey, lockToken, 'PX', START_LOCK_TTL_MS, 'NX')
      if (result !== 'OK') return { state: 'locked' }
      const renewLease = async (): Promise<void> => {
        try {
          const renewed = await valkeyClient.eval(RENEW_START_LOCK_SCRIPT, 1, lockKey, lockToken, START_LOCK_TTL_MS)
          if (renewed !== 1) {
            console.error(JSON.stringify({ activity: 'syncdeck', event: 'learn-start-lock-renewal-failed', reason: 'lock-not-owned' }))
          }
        } catch (error) {
          console.error(JSON.stringify({ activity: 'syncdeck', event: 'learn-start-lock-renewal-failed', reason: 'valkey-unavailable', error: error instanceof Error ? error.message : String(error) }))
        }
      }
      const renewalTimer = setInterval(() => { void renewLease() }, START_LOCK_RENEWAL_MS)
      renewalTimer.unref?.()
      return { state: 'acquired', release: async () => {
        clearInterval(renewalTimer)
        try {
          await valkeyClient.eval(RELEASE_START_LOCK_SCRIPT, 1, lockKey, lockToken)
        } catch (error) {
          console.error(JSON.stringify({ activity: 'syncdeck', event: 'learn-start-lock-release-failed', error: error instanceof Error ? error.message : String(error) }))
        }
      } }
    } catch (error) {
      console.error(JSON.stringify({ activity: 'syncdeck', event: 'learn-start-lock-claim-failed', error: error instanceof Error ? error.message : String(error) }))
      return { state: 'unavailable' }
    }
  }
  if (localStartLocks.has(mapping)) return { state: 'locked' }
  localStartLocks.add(mapping)
  return { state: 'acquired', release: async () => { localStartLocks.delete(mapping) } }
}

function authenticationFailureReason(status: number, error: string): 'authentication-failed' | 'integration-not-configured' | 'nonce-storage-unavailable' {
  if (status !== 503) return 'authentication-failed'
  return error === 'Learn integration is not configured' ? 'integration-not-configured' : 'nonce-storage-unavailable'
}

async function verifyHmac(req: RouteRequest, method: string, path: string, sessions: SessionStore): Promise<{ ok: true; key: { keyId: string; secret: string }; provider: string } | { ok: false; status: number; error: string }> {
  const key = configuredKey()
  if (!key) return { ok: false, status: 503, error: 'Learn integration is not configured' }

  const keyId = readHeader(req.headers, HMAC_KEY_ID_HEADER)
  const timestamp = readHeader(req.headers, HMAC_TIMESTAMP_HEADER)
  const nonce = readHeader(req.headers, HMAC_NONCE_HEADER)
  const signature = readHeader(req.headers, HMAC_SIGNATURE_HEADER)
  const provider = readHeader(req.headers, 'x-learn-provider')
  if (!keyId || !timestamp || !nonce || !signature || !provider || keyId !== key.keyId || nonce.length > 256 || provider.length > MAX_PROVIDER_LENGTH) {
    return { ok: false, status: 401, error: 'Invalid Learn authentication headers' }
  }

  const timestampMs = Number(timestamp)
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS) {
    return { ok: false, status: 401, error: 'Expired Learn authentication request' }
  }

  const expected = createHmac('sha256', key.secret)
    .update(buildLearnHmacCanonicalRequest(method, path, timestamp, nonce, provider, req.body), 'utf8')
    .digest('hex')
  if (!/^[a-f0-9]{64}$/i.test(signature) || !sameSecret(expected, signature.toLowerCase())) {
    return { ok: false, status: 401, error: 'Invalid Learn authentication signature' }
  }
  const nonceClaim = await claimNonce(sessions, keyId, nonce)
  if (nonceClaim === 'unavailable') {
    return { ok: false, status: 503, error: 'Learn nonce storage is unavailable' }
  }
  if (nonceClaim === 'duplicate') {
    return { ok: false, status: 401, error: 'Replayed Learn authentication request' }
  }

  return { ok: true, key, provider }
}

function mappingId(secret: string, activityId: string, provider: string, resourceLinkId: string): string {
  const digest = createHmac('sha256', secret).update(`${activityId}\n${provider}\n${resourceLinkId}`, 'utf8').digest('hex')
  return `learn-syncdeck-entry-${digest.slice(0, 40)}`
}

function cookieValue(secret: string, mapping: string): string {
  const signature = createHmac('sha256', secret).update(mapping, 'utf8').digest('base64url')
  return `${mapping}.${signature}`
}

function readCookieMapping(value: unknown, secret: string): string | null {
  if (typeof value !== 'string') return null
  const separator = value.lastIndexOf('.')
  if (separator <= 0) return null
  const mapping = value.slice(0, separator)
  return sameSecret(cookieValue(secret, mapping), value) ? mapping : null
}

function getEntryData(session: SessionRecord | null): LearnEntryData | null {
  if (!session || !isPlainObject(session.data) || session.data.learnIntegrationKind !== 'entry') return null
  const data = session.data
  const activityId = readString(data.activityId, 120)
  const provider = readString(data.provider, MAX_PROVIDER_LENGTH)
  const resourceLinkId = readString(data.resourceLinkId, MAX_RESOURCE_ID_LENGTH)
  const state = data.state === 'waiting' || data.state === 'active' ? data.state : null
  const expiresAt = typeof data.expiresAt === 'number' && Number.isFinite(data.expiresAt) ? data.expiresAt : 0
  if (!activityId || !provider || !resourceLinkId || !state || expiresAt <= Date.now()) return null
  return {
    learnIntegrationKind: 'entry',
    activityId,
    provider,
    resourceLinkId,
    state,
    ...(typeof data.startRequestId === 'string' ? { startRequestId: data.startRequestId } : {}),
    activeSessionId: typeof data.activeSessionId === 'string' ? data.activeSessionId : null,
    presentationUrl: typeof data.presentationUrl === 'string' ? data.presentationUrl : null,
    expiresAt,
  }
}

function getBrowserTokenData(session: SessionRecord | null): BrowserTokenData | null {
  if (!session || !isPlainObject(session.data) || session.data.learnIntegrationKind !== 'browser-token') return null
  const data = session.data
  if ((data.purpose !== 'student-wait' && data.purpose !== 'instructor-launch') || typeof data.mappingId !== 'string') return null
  if (typeof data.expiresAt !== 'number' || data.expiresAt <= Date.now()) return null
  return {
    learnIntegrationKind: 'browser-token',
    activityId: typeof data.activityId === 'string' ? data.activityId : '',
    purpose: data.purpose,
    mappingId: data.mappingId,
    ...(typeof data.sessionId === 'string' ? { sessionId: data.sessionId } : {}),
    expiresAt: data.expiresAt,
  }
}

async function createBrowserToken(sessions: SessionStore, data: BrowserTokenData): Promise<{ id: string; value: string }> {
  const token = await createSession(sessions, { data: { ...data, browserToken: { value: randomBytes(32).toString('hex'), expiresAt: data.expiresAt } } })
  token.type = 'syncdeck-learn-browser-token'
  await sessions.set(token.id, token, BROWSER_TOKEN_TTL_MS)
  const value = (token.data.browserToken as { value?: unknown } | undefined)?.value
  if (typeof value !== 'string') throw new Error('Unable to create Learn browser token')
  return { id: token.id, value }
}

async function consumeBrowserToken(sessions: SessionStore, tokenId: string, value: string): Promise<BrowserTokenData | null> {
  if (!sessions.consumeSessionDataToken || tokenId.length > 256 || value.length > 256) return null
  const consumed = await sessions.consumeSessionDataToken(tokenId, 'browserToken', value)
  if (!consumed) return null
  await sessions.delete(tokenId)
  return getBrowserTokenData(consumed)
}

function countConnections(ws: WsRouter, sessionId: string): { participants: number; instructors: number } {
  const participantIds = new Set<string>()
  let instructors = 0
  for (const socket of ws.wss.clients as Set<ActiveBitsWebSocket & { isInstructor?: boolean; studentId?: string | null }>) {
    if (socket.readyState !== 1 || socket.sessionId !== sessionId) continue
    if (socket.isInstructor) instructors += 1
    else participantIds.add(socket.studentId ?? `socket:${participantIds.size}`)
  }
  return { participants: participantIds.size, instructors }
}

function setNoStore(res: RouteResponse): void {
  res.setHeader?.('Cache-Control', 'no-store')
}

function logLearnRequestFailure(route: string, reason: string, context: Record<string, unknown> = {}): void {
  console.info(JSON.stringify({ activity: ACTIVITY_ID, event: 'learn-integration-request-failed', route, reason, ...context }))
}

function integrationPath(activityId: string, resourceLinkId: string, suffix: string): string {
  return `${INTEGRATION_PREFIX}/activities/${encodeURIComponent(activityId)}/resources/${encodeURIComponent(resourceLinkId)}${suffix}`
}

function requireSyncDeckActivity(activityId: string | undefined, res: RouteResponse): boolean {
  if (activityId === ACTIVITY_ID) return true
  logLearnRequestFailure('activity', 'unsupported-activity', { requestedActivityId: activityId ?? null, status: 404 })
  res.status(404).json({ error: 'Unsupported Learn integration activity' })
  return false
}

export function registerLearnSyncDeckRoutes(options: LearnSyncDeckRouteOptions): void {
  const { app, sessions, ws } = options

  const loadEntry = async (id: string): Promise<{ session: SessionRecord; data: LearnEntryData } | null> => {
    const session = await sessions.get(id)
    const data = getEntryData(session)
    if (!session || !data) {
      if (session) await sessions.delete(id)
      return null
    }
    if (data.state === 'active' && data.activeSessionId && !await sessions.get(data.activeSessionId)) {
      await sessions.delete(id)
      return null
    }
    if (!await sessions.touch(id)) return null
    return {
      session,
      data: {
        ...data,
        expiresAt: Date.now() + (data.state === 'waiting' ? WAITING_TTL_MS : (sessions.ttlMs ?? WAITING_TTL_MS)),
      },
    }
  }

  app.get(`${INTEGRATION_PREFIX}/activities/:activityId/resources/:resourceLinkId/status`, async (req, res) => {
    setNoStore(res)
    if (!requireSyncDeckActivity(req.params.activityId, res)) return
    const resourceLinkId = readString(req.params.resourceLinkId, MAX_RESOURCE_ID_LENGTH)
    const auth = await verifyHmac(req, 'GET', integrationPath(ACTIVITY_ID, req.params.resourceLinkId ?? '', '/status'), sessions)
    if (!auth.ok) {
      logLearnRequestFailure('status', authenticationFailureReason(auth.status, auth.error), { status: auth.status })
      return void res.status(auth.status).json({ error: auth.error })
    }
    if (!resourceLinkId) {
      logLearnRequestFailure('status', 'invalid-resource-link-id', { status: 400 })
      return void res.status(400).json({ error: 'Invalid resourceLinkId' })
    }
    const provider = auth.provider
    const entry = await loadEntry(mappingId(auth.key.secret, ACTIVITY_ID, provider, resourceLinkId))
    if (!entry) return void res.json({ resourceLinkId, state: 'inactive', activeSessionId: null, studentLaunchUrl: null, connectedParticipantCount: 0, connectedInstructorCount: 0 })
    if (entry.data.state === 'waiting' || !entry.data.activeSessionId) {
      return void res.json({ resourceLinkId, state: 'waiting', activeSessionId: null, studentLaunchUrl: null, connectedParticipantCount: 0, connectedInstructorCount: 0 })
    }
    const counts = countConnections(ws, entry.data.activeSessionId)
    res.json({ resourceLinkId, state: 'active', activeSessionId: entry.data.activeSessionId, studentLaunchUrl: `/${encodeURIComponent(entry.data.activeSessionId)}`, connectedParticipantCount: counts.participants, connectedInstructorCount: counts.instructors })
  })

  app.post(`${INTEGRATION_PREFIX}/activities/:activityId/resources/:resourceLinkId/student-entry`, async (req, res) => {
    setNoStore(res)
    if (!requireSyncDeckActivity(req.params.activityId, res)) return
    const resourceLinkId = readString(req.params.resourceLinkId, MAX_RESOURCE_ID_LENGTH)
    const auth = await verifyHmac(req, 'POST', integrationPath(ACTIVITY_ID, req.params.resourceLinkId ?? '', '/student-entry'), sessions)
    if (!auth.ok) {
      logLearnRequestFailure('student-entry', authenticationFailureReason(auth.status, auth.error), { status: auth.status })
      return void res.status(auth.status).json({ error: auth.error })
    }
    if (!resourceLinkId) {
      logLearnRequestFailure('student-entry', 'invalid-resource-link-id', { status: 400 })
      return void res.status(400).json({ error: 'Invalid resourceLinkId' })
    }
    const provider = auth.provider
    if (!provider) {
      logLearnRequestFailure('student-entry', 'missing-provider', { resourceLinkId, status: 400 })
      return void res.status(400).json({ error: 'Missing Learn provider' })
    }
    const id = mappingId(auth.key.secret, ACTIVITY_ID, provider, resourceLinkId)
    let entry = await loadEntry(id)
    if (!entry) {
      const startLock = await claimStartLock(sessions, id)
      if (startLock.state !== 'acquired') {
        if (startLock.state === 'unavailable') {
          logLearnRequestFailure('student-entry', 'start-lock-unavailable', { resourceLinkId, status: 503 })
          return void res.status(503).json({ error: 'Learn session coordination is unavailable' })
        }
        logLearnRequestFailure('student-entry', 'session-transition-in-progress', { resourceLinkId, status: 409 })
        return void res.status(409).json({ error: 'A Learn session transition is already in progress; retry shortly' })
      }
      const releaseStartLock = startLock.release
      try {
        entry = await loadEntry(id)
        if (!entry) {
          const created = await createSession(sessions, { data: { learnIntegrationKind: 'entry', activityId: ACTIVITY_ID, provider, resourceLinkId, state: 'waiting', activeSessionId: null, presentationUrl: null, expiresAt: Date.now() + WAITING_TTL_MS } })
          const generatedId = created.id
          created.id = id
          created.type = 'syncdeck-learn-entry'
          await sessions.delete(generatedId)
          await sessions.set(id, created, WAITING_TTL_MS)
          entry = { session: created, data: getEntryData(created)! }
        }
      } finally {
        await releaseStartLock()
      }
    }
    const token = await createBrowserToken(sessions, { learnIntegrationKind: 'browser-token', activityId: ACTIVITY_ID, purpose: 'student-wait', mappingId: id, expiresAt: Date.now() + BROWSER_TOKEN_TTL_MS })
    res.json({ waitingLaunchUrl: `${BROWSER_PREFIX}/${ACTIVITY_ID}/wait/${encodeURIComponent(token.id)}?token=${encodeURIComponent(token.value)}`, state: entry.data.state })
  })

  app.post(`${INTEGRATION_PREFIX}/activities/:activityId/resources/:resourceLinkId/start`, async (req, res) => {
    setNoStore(res)
    if (!requireSyncDeckActivity(req.params.activityId, res)) return
    const resourceLinkId = readString(req.params.resourceLinkId, MAX_RESOURCE_ID_LENGTH)
    const auth = await verifyHmac(req, 'POST', integrationPath(ACTIVITY_ID, req.params.resourceLinkId ?? '', '/start'), sessions)
    if (!auth.ok) {
      logLearnRequestFailure('start', authenticationFailureReason(auth.status, auth.error), { status: auth.status })
      return void res.status(auth.status).json({ error: auth.error })
    }
    if (!resourceLinkId) {
      logLearnRequestFailure('start', 'invalid-resource-link-id', { status: 400 })
      return void res.status(400).json({ error: 'Invalid resourceLinkId' })
    }
    const provider = auth.provider
    const body = isPlainObject(req.body) ? req.body : {}
    const presentationUrl = readString(body.presentationUrl, 4096)
    const requestId = readString(body.requestId, 256)
    if (!presentationUrl || !requestId || !isValidHttpUrl(presentationUrl)) {
      logLearnRequestFailure('start', 'invalid-start-payload', { resourceLinkId, status: 400 })
      return void res.status(400).json({ error: 'Missing or invalid Learn start payload' })
    }

    const id = mappingId(auth.key.secret, ACTIVITY_ID, provider, resourceLinkId)
    let entry: { session: SessionRecord; data: LearnEntryData } | null
    const startLock = await claimStartLock(sessions, id)
    if (startLock.state !== 'acquired') {
      if (startLock.state === 'unavailable') {
        logLearnRequestFailure('start', 'start-lock-unavailable', { resourceLinkId, requestId, status: 503 })
        return void res.status(503).json({ error: 'Learn session coordination is unavailable' })
      }
      const pendingEntry = await loadEntry(id)
      if (pendingEntry?.data.startRequestId === requestId) {
        console.info(JSON.stringify({ activity: ACTIVITY_ID, event: 'learn-instructor-session-start-pending', resourceLinkId, requestId }))
        return void res.status(202).json({ state: 'starting', activeSessionId: null, reused: false })
      }
      logLearnRequestFailure('start', 'instructor-start-in-progress', { resourceLinkId, requestId, status: 409 })
      return void res.status(409).json({ error: 'A Learn instructor start is already in progress; retry shortly' })
    }
    const releaseStartLock = startLock.release
    try {
      entry = await loadEntry(id)
      let sessionId: string
      let reused = false
      if (entry?.data.state === 'active' && entry.data.activeSessionId) {
        if (entry.data.presentationUrl !== presentationUrl) {
          logLearnRequestFailure('start', 'presentation-url-change-while-active', { resourceLinkId, requestId, sessionId: entry.data.activeSessionId, status: 409 })
          return void res.status(409).json({ error: 'Presentation URL cannot change while the instructor session is active' })
        }
        const activeSession = await sessions.get(entry.data.activeSessionId)
        if (!activeSession) {
          await sessions.delete(id)
          entry = null
        } else {
          sessionId = entry.data.activeSessionId
          const token = typeof activeSession.data.instructorRecoveryToken === 'string' ? activeSession.data.instructorRecoveryToken : null
          if (!token) {
            logLearnRequestFailure('start', 'active-instructor-recovery-unavailable', { resourceLinkId, requestId, sessionId, status: 500 })
            return void res.status(500).json({ error: 'Active instructor recovery is unavailable' })
          }
          reused = true
        }
      }

      if (!reused) {
        const previousData = entry?.data
        try {
          if (entry) {
            entry.session.data = { ...entry.data, startRequestId: requestId }
            await sessions.set(id, entry.session)
          } else {
            const createdEntry = await createSession(sessions, { data: { learnIntegrationKind: 'entry', activityId: ACTIVITY_ID, provider, resourceLinkId, state: 'waiting', startRequestId: requestId, activeSessionId: null, presentationUrl: null, expiresAt: Date.now() + WAITING_TTL_MS } })
            const generatedId = createdEntry.id
            createdEntry.id = id
            createdEntry.type = 'syncdeck-learn-entry'
            await sessions.delete(generatedId)
            await sessions.set(id, createdEntry, WAITING_TTL_MS)
            entry = { session: createdEntry, data: getEntryData(createdEntry)! }
          }
          const created = await options.createInstructorSession(presentationUrl)
          sessionId = created.sessionId
          const nextData: LearnEntryData = {
            learnIntegrationKind: 'entry',
            activityId: ACTIVITY_ID,
            provider,
            resourceLinkId,
            state: 'active',
            startRequestId: requestId,
            activeSessionId: sessionId,
            presentationUrl,
            expiresAt: Date.now() + (sessions.ttlMs ?? WAITING_TTL_MS),
          }
          entry.session.data = nextData
          await sessions.set(id, entry.session)
          console.info(JSON.stringify({ activity: 'syncdeck', event: 'learn-instructor-session-started', resourceLinkId, requestId, sessionId, reused: false }))
        } catch (error) {
          try {
            if (previousData && entry) {
              entry.session.data = previousData
              await sessions.set(id, entry.session)
            } else {
              await sessions.delete(id)
            }
          } catch (cleanupError) {
            console.error(JSON.stringify({ activity: ACTIVITY_ID, event: 'learn-instructor-session-start-cleanup-failed', resourceLinkId, requestId, error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) }))
          }
          console.error(JSON.stringify({ activity: ACTIVITY_ID, event: 'learn-instructor-session-start-failed', resourceLinkId, requestId, error: error instanceof Error ? error.message : String(error) }))
          return void res.status(500).json({ error: 'Unable to start the Learn instructor session' })
        }
      }

      const browserToken = await createBrowserToken(sessions, {
        learnIntegrationKind: 'browser-token',
        activityId: ACTIVITY_ID,
        purpose: 'instructor-launch',
        mappingId: id,
        sessionId: sessionId!,
        expiresAt: Date.now() + BROWSER_TOKEN_TTL_MS,
      })
      res.json({
        state: 'active',
        activeSessionId: sessionId!,
        reused,
        instructorLaunchUrl: `${BROWSER_PREFIX}/${ACTIVITY_ID}/instructor/${encodeURIComponent(browserToken.id)}?token=${encodeURIComponent(browserToken.value)}`,
        studentLaunchUrl: `/${encodeURIComponent(sessionId!)}`,
      })
    } finally {
      await releaseStartLock()
    }
  })

  app.post(`${INTEGRATION_PREFIX}/activities/:activityId/resources/:resourceLinkId/stop`, async (req, res) => {
    setNoStore(res)
    if (!requireSyncDeckActivity(req.params.activityId, res)) return
    const resourceLinkId = readString(req.params.resourceLinkId, MAX_RESOURCE_ID_LENGTH)
    const auth = await verifyHmac(req, 'POST', integrationPath(ACTIVITY_ID, req.params.resourceLinkId ?? '', '/stop'), sessions)
    if (!auth.ok) {
      logLearnRequestFailure('stop', authenticationFailureReason(auth.status, auth.error), { status: auth.status })
      return void res.status(auth.status).json({ error: auth.error })
    }
    if (!resourceLinkId) {
      logLearnRequestFailure('stop', 'invalid-resource-link-id', { status: 400 })
      return void res.status(400).json({ error: 'Invalid resourceLinkId' })
    }
    const provider = auth.provider
    const id = mappingId(auth.key.secret, ACTIVITY_ID, provider, resourceLinkId)
    const entry = await loadEntry(id)
    if (!entry?.data.activeSessionId) {
      console.info(JSON.stringify({ activity: ACTIVITY_ID, event: 'learn-integration-stop-noop', route: 'stop', reason: 'already-inactive', resourceLinkId, status: 200 }))
      return void res.json({ state: 'inactive', alreadyInactive: true })
    }
    const sessionId = entry.data.activeSessionId
    const activeSession = await sessions.get(sessionId)
    if (activeSession) {
      activeSession.data.learnIntegrationStoppedAt = Date.now()
      await sessions.set(sessionId, activeSession)
      await sessions.publishBroadcast?.('session-ended', { sessionId })
    }
    await sessions.delete(id)
    console.info(JSON.stringify({ activity: 'syncdeck', event: 'learn-instructor-session-stopped', resourceLinkId, sessionId }))
    res.json({ state: 'inactive', alreadyInactive: false })
  })

  app.get(`${BROWSER_PREFIX}/:activityId/wait/:tokenId`, async (req, res) => {
    setNoStore(res)
    res.setHeader?.('Referrer-Policy', 'no-referrer')
    if (!requireSyncDeckActivity(req.params.activityId, res)) return
    const tokenId = readString(req.params.tokenId, 256)
    const tokenValue = readString(req.query?.token, 256)
    const key = configuredKey()
    if (!key) {
      logLearnRequestFailure('waiting-room-launch', 'integration-not-configured', { status: 403 })
      return void res.status(403).json({ error: 'Invalid or expired waiting-room launch' })
    }
    const token = tokenId && tokenValue ? await consumeBrowserToken(sessions, tokenId, tokenValue) : null
    if (!token || token.activityId !== ACTIVITY_ID || token.purpose !== 'student-wait') {
      logLearnRequestFailure('waiting-room-launch', 'invalid-or-expired-browser-launch', { status: 403 })
      return void res.status(403).json({ error: 'Invalid or expired waiting-room launch' })
    }
    res.cookie?.('learn_syncdeck_wait', cookieValue(key.secret, token.mappingId), { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' })
    if (typeof res.redirect === 'function') return void res.redirect(302, `${BROWSER_PREFIX}/${ACTIVITY_ID}/wait`)
    res.status(302).json({ redirectTo: `${BROWSER_PREFIX}/${ACTIVITY_ID}/wait` })
  })

  app.get(`${INTEGRATION_PREFIX}/activities/:activityId/wait/status`, async (req, res) => {
    setNoStore(res)
    if (!requireSyncDeckActivity(req.params.activityId, res)) return
    const key = configuredKey()
    const id = key ? readCookieMapping(req.cookies?.learn_syncdeck_wait, key.secret) : null
    const entry = id ? await loadEntry(id) : null
    if (!entry) {
      logLearnRequestFailure('waiting-room-status', 'waiting-room-entry-unavailable', { status: 404 })
      return void res.status(404).json({ error: 'Waiting-room entry is unavailable' })
    }
    if (entry.data.state !== 'active' || !entry.data.activeSessionId) return void res.json({ state: 'waiting' })
    res.json({ state: 'active', studentLaunchUrl: `/${encodeURIComponent(entry.data.activeSessionId)}` })
  })

  app.get(`${BROWSER_PREFIX}/:activityId/instructor/:tokenId`, async (req, res) => {
    setNoStore(res)
    res.setHeader?.('Referrer-Policy', 'no-referrer')
    if (!requireSyncDeckActivity(req.params.activityId, res)) return
    const tokenId = readString(req.params.tokenId, 256)
    const tokenValue = readString(req.query?.token, 256)
    const token = tokenId && tokenValue ? await consumeBrowserToken(sessions, tokenId, tokenValue) : null
    if (!token || token.activityId !== ACTIVITY_ID || token.purpose !== 'instructor-launch' || !token.sessionId) {
      logLearnRequestFailure('instructor-launch', 'invalid-or-expired-browser-launch', { status: 403 })
      return void res.status(403).json({ error: 'Invalid or expired instructor launch' })
    }
    const session = await sessions.get(token.sessionId)
    const recovery = session && typeof session.data.instructorRecoveryToken === 'string' ? session.data.instructorRecoveryToken : null
    if (!recovery) {
      logLearnRequestFailure('instructor-launch', 'instructor-session-unavailable', { sessionId: token.sessionId, status: 404 })
      return void res.status(404).json({ error: 'Instructor session is unavailable' })
    }
    options.writeInstructorRecoveryCookie(req, res, token.sessionId, recovery)
    const destination = `/manage/syncdeck/${encodeURIComponent(token.sessionId)}`
    if (typeof res.redirect === 'function') return void res.redirect(302, destination)
    res.status(302).json({ redirectTo: destination })
  })
}
