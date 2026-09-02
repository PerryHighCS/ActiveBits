import {
  getAllowedActivities,
  activitySupportsStandalonePermalink,
  getActivityConfig,
  isValidActivity,
} from '../activities/activityRegistry.js'
import {
  cleanupPersistentSession,
  recordTeacherCodeAttempt,
  consumePersistentSessionEntryParticipant,
  findHashBySessionIdStrict,
  findIndexedHashBySessionId,
  generatePersistentHash,
  getOrCreateActivePersistentSession,
  getPersistentSession,
  getPersistentSessionStrict,
  PersistentSessionEntryParticipantStoreError,
  recordTeacherCodeAttemptStrict,
  storePersistentSessionEntryParticipant,
  TEACHER_CODE_ATTEMPT_WINDOW_SECONDS,
  verifyTeacherCodeWithHash,
  resolvePersistentSessionEntryPolicy,
  updatePersistentSessionUrlState,
} from '../core/persistentSessions.js'
import {
  buildPersistentLinkUrlQuery,
  computePersistentLinkUrlHash,
  normalizePersistentLinkSelectedOptions,
  verifyPersistentLinkUrlHash,
  type PersistentLinkUrlState,
} from '../core/persistentLinkUrlState.js'
import {
  buildSoloOnlyPolicyRejection,
  type PersistentSessionPolicyRejectionPayload,
} from '../core/persistentSessionPolicyUtils.js'
import {
  loadPersistentSessionEntryGatewayContext,
  loadPersistentSessionEntryStatus,
} from '../core/persistentSessionEntryGateway.js'
import { buildCreateSessionBootstrapPayload } from '../core/createSessionBootstrapPayload.js'
import { boundPersistentSessionCookieEntries } from '../core/persistentSessionCookie.js'
import {
  issueActivityCapability,
  resolveActivityPrincipalFromCookies,
  writeActivityCapabilityCookie,
} from '../core/activityCapabilities.js'

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000
const MAX_TEACHER_CODE_LENGTH = 100
const DEFAULT_PERSISTENT_SESSION_ENTRY_POLICY = 'instructor-required'

interface CookieSessionEntry {
  key: string
  teacherCode: unknown
  selectedOptions?: Record<string, unknown>
  entryPolicy?: unknown
  urlHash?: unknown
}

interface CookieParseResult {
  sessions: CookieSessionEntry[]
  corrupted: boolean
  error: string | null
}

interface PersistentSessionCreateBody {
  activityName?: unknown
  teacherCode?: unknown
  selectedOptions?: unknown
  entryPolicy?: unknown
  hash?: unknown
}

interface SessionStoreLike {
  get(id: string): Promise<unknown | null>
  // Strict read: a backend failure propagates instead of mapping to `null`.
  // Optional; falls back to `get` when the store does not provide it.
  getStrict?(id: string): Promise<unknown | null>
  set?(id: string, session: unknown): Promise<void>
  updateAtomic?(id: string, mutate: (session: Record<string, unknown>) => Record<string, unknown>): Promise<unknown | null>
}

interface RequestLike {
  params: Record<string, string | undefined>
  query: Record<string, unknown>
  cookies?: Record<string, unknown>
  body?: unknown
  ip?: string
  socket?: {
    remoteAddress?: string
  }
  protocol: string
  get(name: string): string | undefined
}

interface ResponseLike {
  status(code: number): ResponseLike
  set?(field: string, value: string): ResponseLike
  json(payload: unknown): void
  cookie(name: string, value: string, options: Record<string, unknown>): void
  headersSent?: boolean
}

interface AppLike {
  get(path: string, handler: (req: RequestLike, res: ResponseLike) => void | Promise<void>): void
  post(path: string, handler: (req: RequestLike, res: ResponseLike) => void | Promise<void>): void
}

interface RegisterPersistentSessionRoutesOptions {
  app: AppLike
  sessions: SessionStoreLike
}

function setNoStore(response: ResponseLike): void {
  response.set?.('Cache-Control', 'no-store')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * A manager capability is authorized against one specific live-session
 * incarnation (the `activeSession` read when the teacher code / persistent
 * credential was checked). If that id is deleted and recreated - even as the
 * same activity type - during the store/rate-limit/cookie awaits or a CAS
 * retry, the mutation must not be applied to the replacement. Bind to the
 * authorized `type` and, when available, its `created` timestamp.
 */
function matchesSessionIncarnation(
  record: unknown,
  expectedType: string,
  expectedCreated: number | null,
): record is Record<string, unknown> {
  if (!isPlainObject(record) || record.type !== expectedType) {
    return false
  }
  return expectedCreated == null || record.created === expectedCreated
}

function readSessionCreated(record: Record<string, unknown>): number | null {
  return typeof record.created === 'number' ? record.created : null
}

/**
 * Thrown from inside an `updateAtomic` callback when the drafted record is not
 * the incarnation the request authorized. Returning the draft unchanged is
 * *not* a no-op: both store implementations still stamp a fresh
 * `mutationRevision` / `lastActivity` and reset the TTL, so a stale request
 * would prolong and bump the replacement session. Throwing abandons the CAS;
 * the caller catches this immediately around the `updateAtomic` call and maps
 * it to a 404.
 */
class SessionIncarnationMismatchError extends Error {
  constructor() {
    super('session incarnation changed during the atomic capability write')
    this.name = 'SessionIncarnationMismatchError'
  }
}

function getQueryString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string')
    return typeof first === 'string' ? first : null
  }
  return null
}

function getBodyString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key]
  return typeof value === 'string' ? value : null
}

function getRequestClientIp(req: RequestLike): string {
  if (typeof req.ip === 'string' && req.ip.trim()) {
    return req.ip.trim()
  }

  if (typeof req.socket?.remoteAddress === 'string' && req.socket.remoteAddress.trim()) {
    return req.socket.remoteAddress.trim()
  }

  return 'unknown'
}

function toSelectedOptions(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {}
}

function toSelectedOptionStrings(value: unknown): Record<string, string> {
  return normalizePersistentLinkSelectedOptions(toSelectedOptions(value))
}

function getCanonicalPersistentLinkSelectedOptions(
  activityName: string,
  value: unknown,
): Record<string, string> {
  const normalizedSelectedOptions = toSelectedOptionStrings(value)
  const activityConfig = getActivityConfig(activityName)
  const deepLinkOptions =
    activityConfig && isPlainObject(activityConfig.deepLinkOptions)
      ? activityConfig.deepLinkOptions
      : null

  if (!deepLinkOptions) {
    return {}
  }

  const canonicalSelectedOptions: Record<string, string> = {}
  for (const optionKey of Object.keys(deepLinkOptions)) {
    const selectedValue = normalizedSelectedOptions[optionKey]
    if (typeof selectedValue === 'string' && selectedValue.length > 0) {
      canonicalSelectedOptions[optionKey] = selectedValue
    }
  }

  return canonicalSelectedOptions
}

function parsePersistentSessionsCookie(cookieValue: unknown, context = 'persistent_sessions'): CookieParseResult {
  if (cookieValue == null) {
    return { sessions: [], corrupted: false, error: null }
  }

  let parsedCookie: unknown
  try {
    parsedCookie = typeof cookieValue === 'string' ? JSON.parse(cookieValue) : cookieValue
  } catch (error) {
    console.error(`Failed to parse ${context} cookie; returning empty sessions`, {
      error,
      cookieLength: typeof cookieValue === 'string' ? cookieValue.length : null,
      cookieType: typeof cookieValue,
    })
    return { sessions: [], corrupted: true, error: 'Invalid JSON format' }
  }

  if (Array.isArray(parsedCookie)) {
    const sessions = parsedCookie
      .filter((entry): entry is Record<string, unknown> => isPlainObject(entry) && typeof entry.key === 'string')
      .map((entry) => ({
        key: String(entry.key),
        teacherCode: entry.teacherCode,
        selectedOptions: toSelectedOptions(entry.selectedOptions),
        entryPolicy: entry.entryPolicy,
        urlHash: entry.urlHash,
      }))
    return { sessions, corrupted: false, error: null }
  }

  if (isPlainObject(parsedCookie)) {
    const sessions = Object.keys(parsedCookie).map((key) => ({
      key,
      teacherCode: parsedCookie[key],
      selectedOptions: {},
    }))
    return { sessions, corrupted: false, error: null }
  }

  console.error(`Invalid cookie format for ${context}: expected array or object`, {
    cookieType: typeof parsedCookie,
  })
  return {
    sessions: [],
    corrupted: true,
    error: 'Invalid cookie format: expected array or object',
  }
}

function getValidatedPersistentSessionCookieEntry(
  sessionEntries: readonly CookieSessionEntry[],
  activityName: string,
  hash: string,
): CookieSessionEntry | null {
  const cookieKey = `${activityName}:${hash}`
  const entry = sessionEntries.find((sessionEntry) => sessionEntry.key === cookieKey)
  const teacherCode = typeof entry?.teacherCode === 'string' ? entry.teacherCode : null
  if (!entry || !teacherCode) {
    return null
  }

  return verifyTeacherCodeWithHash(activityName, hash, teacherCode).valid ? entry : null
}

/**
 * Whether the caller supplied a teacher-code *candidate* for this persistent
 * link: a `persistent_sessions` entry keyed to this activity/hash carrying a
 * non-empty string `teacherCode`. Unlike `getValidatedPersistentSessionCookieEntry`
 * this does not check the code is correct - it only tells whether a request is
 * even *attempting* credentialed recovery, so a caller who merely knows the
 * live session id (no matching cookie entry) is not charged an attempt against
 * the shared IP+hash bucket and cannot lock out the real teacher on a shared
 * NAT/school address.
 */
function hasPersistentSessionTeacherCodeCandidate(
  sessionEntries: readonly CookieSessionEntry[],
  activityName: string,
  hash: string,
): boolean {
  const cookieKey = `${activityName}:${hash}`
  return sessionEntries.some(
    (entry) => entry.key === cookieKey && typeof entry.teacherCode === 'string' && entry.teacherCode.length > 0,
  )
}

/**
 * Run a persistent-link store mutation (record upsert + URL-state persist),
 * returning `false` (after sending a controlled 500) if the backend rejects.
 *
 * `updatePersistentSessionUrlState` -> `persistPersistentSession` calls the
 * Valkey-backed `setHashBySessionId`, which now rejects rather than swallowing a
 * reverse-index write outage (so a persisted record can't silently lack its
 * recovery index). These link-management routes are not otherwise wrapped, so
 * without this an index-write outage would escape to Express's default handler
 * instead of the JSON error the client expects.
 */
async function persistPersistentLinkState(
  res: ResponseLike,
  hash: string,
  route: string,
  apply: () => Promise<void>,
): Promise<boolean> {
  try {
    await apply()
    return true
  } catch (error) {
    console.error(JSON.stringify({
      event: 'persistent-link-state-persist-failed',
      route,
      hash,
      error: error instanceof Error ? error.message : String(error),
    }))
    res.status(500).json({ error: 'Persistent link storage is temporarily unavailable' })
    return false
  }
}

function writePersistentSessionsCookie(res: ResponseLike, sessionEntries: CookieSessionEntry[]): void {
  const boundedEntries = boundPersistentSessionCookieEntries(sessionEntries)
  res.cookie('persistent_sessions', JSON.stringify(boundedEntries), {
    maxAge: ONE_YEAR_MS,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
  })
}

function getPersistentLinkSelectedOptionsFromQuery(
  activityName: string,
  query: RequestLike['query'],
): Record<string, string> {
  const rawSelectedOptions: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(query)) {
    if (key === 'activityName' || key === 'entryPolicy' || key === 'urlHash') {
      continue
    }

    const normalizedValue = getQueryString(value)?.trim()
    if (normalizedValue) {
      rawSelectedOptions[key] = normalizedValue
    }
  }

  return getCanonicalPersistentLinkSelectedOptions(activityName, rawSelectedOptions)
}

function getVerifiedPersistentLinkUrlStateFromQuery(
  activityName: string,
  hash: string,
  query: RequestLike['query'],
): PersistentLinkUrlState | null {
  const entryPolicy = getQueryString(query.entryPolicy)
  const urlHash = getQueryString(query.urlHash)?.trim() ?? ''
  if (!entryPolicy || !urlHash) {
    return null
  }

  const state = {
    entryPolicy: resolvePersistentSessionEntryPolicy(entryPolicy),
    selectedOptions: getPersistentLinkSelectedOptionsFromQuery(activityName, query),
  } satisfies PersistentLinkUrlState

  return verifyPersistentLinkUrlHash(hash, state, urlHash) ? state : null
}

function getVerifiedPersistentLinkUrlStateFromCookieEntry(
  activityName: string,
  hash: string,
  entry: CookieSessionEntry | null,
): PersistentLinkUrlState | null {
  if (!entry) {
    return null
  }

  const entryPolicy = resolvePersistentSessionEntryPolicy(entry.entryPolicy)
  const urlHash = typeof entry.urlHash === 'string' ? entry.urlHash.trim() : ''
  if (!urlHash) {
    return null
  }

  const state = {
    entryPolicy,
    selectedOptions: getCanonicalPersistentLinkSelectedOptions(activityName, entry.selectedOptions),
  } satisfies PersistentLinkUrlState

  return verifyPersistentLinkUrlHash(hash, state, urlHash) ? state : null
}

function buildPersistentSessionRelativeUrl(
  activityName: string,
  hash: string,
  state: PersistentLinkUrlState | null,
): string {
  const baseUrl = `/activity/${activityName}/${hash}`
  if (!state) {
    return baseUrl
  }

  const params = buildPersistentLinkUrlQuery({
    hash,
    entryPolicy: state.entryPolicy,
    selectedOptions: state.selectedOptions,
  })
  return `${baseUrl}?${params.toString()}`
}

function validateEntryPolicyForActivity(activityName: string, entryPolicy: string): string | null {
  if (activitySupportsStandalonePermalink(activityName)) {
    return null
  }

  if (entryPolicy === 'solo-allowed' || entryPolicy === 'solo-only') {
    return 'This activity does not support solo entry links'
  }

  return null
}

export function registerPersistentSessionRoutes({ app, sessions }: RegisterPersistentSessionRoutesOptions): void {
  // Strict live-session read for the capability-recovery routes: a backend
  // outage rejects (-> the route's outer catch -> retryable 500) instead of
  // mapping to `null`, which the Java manager treats as a definitive "no such
  // session" and stops retrying.
  const getSessionStrict = (sessionId: string): Promise<unknown | null> => (
    typeof sessions.getStrict === 'function'
      ? sessions.getStrict(sessionId)
      : sessions.get(sessionId)
  )

  app.get('/api/persistent-session/list', async (req, res) => {
    try {
      const { sessions: sessionEntries } = parsePersistentSessionsCookie(
        req.cookies?.persistent_sessions,
        'persistent_sessions (/api/persistent-session/list)',
      )

      const sessionList = (await Promise.all(sessionEntries.map(async (entry) => {
          const parts = entry.key.split(':')
          if (parts.length !== 2 || !parts[0] || !parts[1]) {
            console.warn(`Invalid session key format: "${entry.key}"`)
            return null
          }

          const [activityName, hash] = parts
          const host = req.get('x-forwarded-host') ?? req.get('host')
          const protocol = req.get('x-forwarded-proto') ?? req.protocol
          const validatedEntry = getValidatedPersistentSessionCookieEntry([entry], activityName, hash)
          const cookieUrlState = getVerifiedPersistentLinkUrlStateFromCookieEntry(activityName, hash, validatedEntry)
          const relativeUrl = buildPersistentSessionRelativeUrl(activityName, hash, cookieUrlState)
          return {
            activityName,
            hash,
            teacherCode: validatedEntry?.teacherCode,
            entryPolicy: cookieUrlState?.entryPolicy ?? DEFAULT_PERSISTENT_SESSION_ENTRY_POLICY,
            selectedOptions: cookieUrlState?.selectedOptions
              ?? getCanonicalPersistentLinkSelectedOptions(activityName, entry.selectedOptions),
            url: relativeUrl,
            fullUrl: host ? `${protocol}://${host}${relativeUrl}` : null,
          }
        }))).filter(Boolean)

      res.json({ sessions: sessionList })
    } catch (err) {
      console.error('Error in /api/persistent-session/list:', err)
      res.status(500).json({ error: 'Internal server error', sessions: [] })
    }
  })

  app.post('/api/persistent-session/create', async (req, res) => {
    const body = isPlainObject(req.body) ? (req.body as PersistentSessionCreateBody & Record<string, unknown>) : {}
    const activityName = getBodyString(body, 'activityName')
    const teacherCode = getBodyString(body, 'teacherCode')
    const entryPolicy = resolvePersistentSessionEntryPolicy(body.entryPolicy)

    if (!activityName || !teacherCode) {
      res.status(400).json({ error: 'Missing activityName or teacherCode' })
      return
    }
    if (!isValidActivity(activityName)) {
      res.status(400).json({
        error: 'Invalid activity name',
        allowedActivities: getAllowedActivities(),
      })
      return
    }
    if (teacherCode.length < 6) {
      res.status(400).json({ error: 'Teacher code must be at least 6 characters' })
      return
    }
    if (teacherCode.length > MAX_TEACHER_CODE_LENGTH) {
      res.status(400).json({ error: `Teacher code must be at most ${MAX_TEACHER_CODE_LENGTH} characters` })
      return
    }
    const entryPolicyError = validateEntryPolicyForActivity(activityName, entryPolicy)
    if (entryPolicyError) {
      res.status(400).json({ error: entryPolicyError })
      return
    }

    const selectedOptions = getCanonicalPersistentLinkSelectedOptions(activityName, body.selectedOptions)

    const cookieName = 'persistent_sessions'
    const { sessions: sessionEntries } = parsePersistentSessionsCookie(
      req.cookies?.[cookieName],
      'persistent_sessions (/api/persistent-session/create)',
    )

    const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
    const cookieKey = `${activityName}:${hash}`
    const query = buildPersistentLinkUrlQuery({
      hash,
      entryPolicy,
      selectedOptions,
    })

    const existingIndex = sessionEntries.findIndex((entry) => entry.key === cookieKey)
    if (existingIndex !== -1) {
      sessionEntries.splice(existingIndex, 1)
    }
    sessionEntries.push({
      key: cookieKey,
      teacherCode,
      selectedOptions,
      entryPolicy,
      urlHash: query.get('urlHash') ?? undefined,
    })
    const persisted = await persistPersistentLinkState(res, hash, '/api/persistent-session/create', async () => {
      await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, entryPolicy)
      await updatePersistentSessionUrlState(hash, {
        entryPolicy,
        selectedOptions,
      })
    })
    if (!persisted) return

    writePersistentSessionsCookie(res, sessionEntries)

    res.json({ url: `/activity/${activityName}/${hash}?${query.toString()}`, hash })
  })

  app.post('/api/persistent-session/update', async (req, res) => {
    const body = isPlainObject(req.body) ? (req.body as PersistentSessionCreateBody & Record<string, unknown>) : {}
    const activityName = getBodyString(body, 'activityName')
    const hash = getBodyString(body, 'hash')
    const entryPolicy = resolvePersistentSessionEntryPolicy(body.entryPolicy)

    if (!activityName || !hash) {
      res.status(400).json({ error: 'Missing activityName or hash' })
      return
    }
    if (!isValidActivity(activityName)) {
      res.status(400).json({
        error: 'Invalid activity name',
        allowedActivities: getAllowedActivities(),
      })
      return
    }
    const entryPolicyError = validateEntryPolicyForActivity(activityName, entryPolicy)
    if (entryPolicyError) {
      res.status(400).json({ error: entryPolicyError })
      return
    }

    const cookieName = 'persistent_sessions'
    let { sessions: sessionEntries } = parsePersistentSessionsCookie(
      req.cookies?.[cookieName],
      'persistent_sessions (/api/persistent-session/update)',
    )
    const existingEntry = getValidatedPersistentSessionCookieEntry(sessionEntries, activityName, hash)
    if (!existingEntry || typeof existingEntry.teacherCode !== 'string') {
      res.status(404).json({ error: 'Persistent link not found' })
      return
    }
    const existingUrlState = getVerifiedPersistentLinkUrlStateFromCookieEntry(activityName, hash, existingEntry)
    const selectedOptions = Object.prototype.hasOwnProperty.call(body, 'selectedOptions')
      ? getCanonicalPersistentLinkSelectedOptions(activityName, body.selectedOptions)
      : (existingUrlState?.selectedOptions ?? getCanonicalPersistentLinkSelectedOptions(activityName, existingEntry.selectedOptions))

    const query = buildPersistentLinkUrlQuery({
      hash,
      entryPolicy,
      selectedOptions,
    })
    const cookieKey = `${activityName}:${hash}`
    sessionEntries = sessionEntries.filter((entry) => entry.key !== cookieKey)
    sessionEntries.push({
      key: cookieKey,
      teacherCode: existingEntry.teacherCode,
      selectedOptions,
      entryPolicy,
      urlHash: query.get('urlHash') ?? undefined,
    })

    const persisted = await persistPersistentLinkState(res, hash, '/api/persistent-session/update', async () => {
      await getOrCreateActivePersistentSession(
        activityName,
        hash,
        null,
        entryPolicy,
      )
      await updatePersistentSessionUrlState(hash, {
        entryPolicy,
        selectedOptions,
      })
    })
    if (!persisted) return

    writePersistentSessionsCookie(res, sessionEntries)
    res.json({
      url: `/activity/${activityName}/${hash}?${query.toString()}`,
      hash,
    })
  })

  app.post('/api/persistent-session/remove', async (req, res) => {
    const body = isPlainObject(req.body) ? (req.body as PersistentSessionCreateBody & Record<string, unknown>) : {}
    const activityName = getBodyString(body, 'activityName')
    const hash = getBodyString(body, 'hash')

    if (!activityName || !hash) {
      res.status(400).json({ error: 'Missing activityName or hash' })
      return
    }
    if (!isValidActivity(activityName)) {
      res.status(400).json({
        error: 'Invalid activity name',
        allowedActivities: getAllowedActivities(),
      })
      return
    }

    const cookieName = 'persistent_sessions'
    let { sessions: sessionEntries } = parsePersistentSessionsCookie(
      req.cookies?.[cookieName],
      'persistent_sessions (/api/persistent-session/remove)',
    )
    const cookieKey = `${activityName}:${hash}`
    const existingEntry = getValidatedPersistentSessionCookieEntry(sessionEntries, activityName, hash)
    if (!existingEntry) {
      res.status(404).json({ error: 'Persistent link not found' })
      return
    }

    sessionEntries = sessionEntries.filter((entry) => entry.key !== cookieKey)
    writePersistentSessionsCookie(res, sessionEntries)
    await cleanupPersistentSession(hash)
    res.json({ success: true })
  })

  app.post('/api/persistent-session/authenticate', async (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {}
    const activityName = getBodyString(body, 'activityName')
    const hash = getBodyString(body, 'hash')
    const teacherCode = getBodyString(body, 'teacherCode')
    const bodyEntryPolicy = resolvePersistentSessionEntryPolicy(body.entryPolicy)
    const bodyUrlHash = getBodyString(body, 'urlHash')?.trim() ?? ''

    if (!activityName || !hash || !teacherCode) {
      res.status(400).json({ error: 'Missing activityName, hash, or teacherCode' })
      return
    }
    if (!isValidActivity(activityName)) {
      res.status(400).json({
        error: 'Invalid activity name',
        allowedActivities: getAllowedActivities(),
      })
      return
    }
    if (teacherCode.length < 6) {
      res.status(400).json({ error: 'Teacher code must be at least 6 characters' })
      return
    }
    if (teacherCode.length > MAX_TEACHER_CODE_LENGTH) {
      res.status(400).json({ error: `Teacher code must be at most ${MAX_TEACHER_CODE_LENGTH} characters` })
      return
    }

    const bodySelectedOptions = getCanonicalPersistentLinkSelectedOptions(activityName, body.selectedOptions)

    const validation = verifyTeacherCodeWithHash(activityName, hash, teacherCode)
    if (!validation.valid) {
      res.status(401).json({ error: validation.error || 'Invalid teacher code' })
      return
    }

    const verifiedBodyUrlState =
      bodyUrlHash
        ? ({
          entryPolicy: bodyEntryPolicy,
          selectedOptions: bodySelectedOptions,
        } satisfies PersistentLinkUrlState)
        : null
    const hasValidBodyUrlState = verifiedBodyUrlState != null && verifyPersistentLinkUrlHash(hash, verifiedBodyUrlState, bodyUrlHash)
    const normalizedEntryPolicy = hasValidBodyUrlState
      ? verifiedBodyUrlState.entryPolicy
      : DEFAULT_PERSISTENT_SESSION_ENTRY_POLICY
    if (normalizedEntryPolicy === 'solo-only') {
      res.status(409).json(buildSoloOnlyPolicyRejection() satisfies PersistentSessionPolicyRejectionPayload)
      return
    }
    const persistentSession = await getPersistentSession(hash)

    const cookieName = 'persistent_sessions'
    const { sessions: sessionEntries } = parsePersistentSessionsCookie(
      req.cookies?.[cookieName],
      'persistent_sessions (/api/persistent-session/authenticate)',
    )
    const cookieKey = `${activityName}:${hash}`
    const existingIndex = sessionEntries.findIndex((entry) => entry.key === cookieKey)
    const existingEntry = getValidatedPersistentSessionCookieEntry(sessionEntries, activityName, hash)
    const existingSelectedOptions = getCanonicalPersistentLinkSelectedOptions(activityName, existingEntry?.selectedOptions)
    const existingUrlState = getVerifiedPersistentLinkUrlStateFromCookieEntry(activityName, hash, existingEntry)

    if (existingIndex !== -1) {
      sessionEntries.splice(existingIndex, 1)
    }
    const finalSelectedOptions =
      Object.keys(existingSelectedOptions).length > 0
        ? existingSelectedOptions
        : bodySelectedOptions
    const finalEntryPolicy = existingUrlState?.entryPolicy ?? (hasValidBodyUrlState ? verifiedBodyUrlState.entryPolicy : normalizedEntryPolicy)
    const finalUrlState = {
      entryPolicy: finalEntryPolicy,
      selectedOptions: finalSelectedOptions,
    } satisfies PersistentLinkUrlState
    const finalUrlHash = computePersistentLinkUrlHash(hash, finalUrlState)
    sessionEntries.push({
      key: cookieKey,
      teacherCode,
      // Preserve existing cookie options when available; otherwise bootstrap from the permalink URL
      // params submitted during teacher authentication on a new device.
      selectedOptions: finalSelectedOptions,
      entryPolicy: finalEntryPolicy,
      urlHash: finalUrlHash,
    })
    const persisted = await persistPersistentLinkState(res, hash, '/api/persistent-session/authenticate', async () => {
      await updatePersistentSessionUrlState(hash, {
        entryPolicy: finalEntryPolicy,
        selectedOptions: finalSelectedOptions,
      })
    })
    if (!persisted) return

    writePersistentSessionsCookie(res, sessionEntries)
    res.json({
      success: true,
      isStarted: Boolean(persistentSession?.sessionId),
      sessionId: persistentSession?.sessionId || null,
    })
  })

  app.post('/api/session/:sessionId/teacher-authenticate', async (req, res) => {
    setNoStore(res)
    const sessionId = req.params.sessionId
    const body = isPlainObject(req.body) ? req.body : {}
    const teacherCode = getBodyString(body, 'teacherCode')

    if (!sessionId || !teacherCode) {
      res.status(400).json({ error: 'Missing sessionId or teacherCode' })
      return
    }
    if (teacherCode.length < 6) {
      res.status(400).json({ error: 'Teacher code must be at least 6 characters' })
      return
    }
    if (teacherCode.length > MAX_TEACHER_CODE_LENGTH) {
      res.status(400).json({ error: `Teacher code must be at most ${MAX_TEACHER_CODE_LENGTH} characters` })
      return
    }

    let activeSession: unknown
    try {
      // Strict read: a transient store outage must reject into a retryable 500
      // here, not be mapped to `null` -> a terminal 404 the recovering client
      // treats as "session gone" and stops retrying.
      activeSession = await getSessionStrict(sessionId)
    } catch (error) {
      console.error(JSON.stringify({
        event: 'teacher-authenticate-live-session-lookup-failed',
        sessionId,
        errorName: error instanceof Error ? error.name : 'unknown',
      }))
      res.status(500).json({ error: 'Teacher authentication is temporarily unavailable' })
      return
    }
    if (activeSession == null) {
      res.status(404).json({ error: 'Active session not found' })
      return
    }

    let hash: string | null
    let persistentSession: Awaited<ReturnType<typeof getPersistentSessionStrict>>
    try {
      // Strict throughout: a genuine miss still falls back to the legacy scan,
      // but a backend read failure - in the reverse-index lookup or the
      // persistent-record read below - rejects here instead of returning
      // `null` -> the terminal 404 (the live session was already read
      // successfully, so the failure is transient and retryable).
      hash = await findHashBySessionIdStrict(sessionId)
      persistentSession = hash ? await getPersistentSessionStrict(hash) : null
    } catch (error) {
      console.error(JSON.stringify({
        event: 'teacher-authenticate-hash-lookup-failed',
        sessionId,
        errorName: error instanceof Error ? error.name : 'unknown',
      }))
      res.status(500).json({ error: 'Teacher authentication is temporarily unavailable' })
      return
    }
    if (!hash) {
      res.status(404).json({ error: 'Teacher join is unavailable for this session' })
      return
    }

    if (!persistentSession || persistentSession.sessionId !== sessionId) {
      res.status(404).json({ error: 'Teacher join is unavailable for this session' })
      return
    }

    const activityName = typeof persistentSession.activityName === 'string' ? persistentSession.activityName : null
    if (!activityName || !isValidActivity(activityName)) {
      res.status(404).json({ error: 'Teacher join is unavailable for this session' })
      return
    }

    const activeSessionType = isPlainObject(activeSession) && typeof activeSession.type === 'string'
      ? activeSession.type
      : null
    if (activeSessionType !== activityName) {
      res.status(404).json({ error: 'Teacher join is unavailable for this session' })
      return
    }

    const clientIp = getRequestClientIp(req)
    const rateLimitKey = `${clientIp}:${hash}`
    const attemptResult = await recordTeacherCodeAttempt(rateLimitKey)
    if (!attemptResult.allowed) {
      res.status(429).json({ error: 'Too many attempts. Please wait a minute.' })
      return
    }

    const validation = verifyTeacherCodeWithHash(activityName, hash, teacherCode)
    if (!validation.valid) {
      res.status(401).json({ error: validation.error || 'Invalid teacher code' })
      return
    }

    const finalEntryPolicy = resolvePersistentSessionEntryPolicy(persistentSession.entryPolicy)
    if (finalEntryPolicy === 'solo-only') {
      res.status(409).json(buildSoloOnlyPolicyRejection() satisfies PersistentSessionPolicyRejectionPayload)
      return
    }

    const finalSelectedOptions = getCanonicalPersistentLinkSelectedOptions(activityName, persistentSession.selectedOptions)
    const finalUrlState = {
      entryPolicy: finalEntryPolicy,
      selectedOptions: finalSelectedOptions,
    } satisfies PersistentLinkUrlState
    const finalUrlHash = computePersistentLinkUrlHash(hash, finalUrlState)

    const cookieName = 'persistent_sessions'
    let { sessions: sessionEntries } = parsePersistentSessionsCookie(
      req.cookies?.[cookieName],
      'persistent_sessions (/api/session/:sessionId/teacher-authenticate)',
    )
    const cookieKey = `${activityName}:${hash}`
    sessionEntries = sessionEntries.filter((entry) => entry.key !== cookieKey)
    sessionEntries.push({
      key: cookieKey,
      teacherCode,
      selectedOptions: finalSelectedOptions,
      entryPolicy: finalEntryPolicy,
      urlHash: finalUrlHash,
    })
    const urlStatePersisted = await persistPersistentLinkState(
      res,
      hash,
      '/api/session/:sessionId/teacher-authenticate',
      () => updatePersistentSessionUrlState(hash, finalUrlState),
    )
    if (!urlStatePersisted) return
    writePersistentSessionsCookie(res, sessionEntries)

    const activeSessionData = isPlainObject(activeSession) && isPlainObject(activeSession.data)
      ? activeSession.data
      : {}
    const createSessionPayload = buildCreateSessionBootstrapPayload(activityName, activeSessionData)

    // The teacher-auth response is what establishes manager authority, so a
    // store that cannot persist the capability must fail closed - matching the
    // persistent-manager-capability recovery endpoint - not return success
    // without a usable manager cookie.
    if (typeof sessions.set !== 'function' || !isPlainObject(activeSession)) {
      console.error(JSON.stringify({
        event: 'persistent-manager-capability-store-unavailable',
        sessionId,
      }))
      res.status(500).json({ error: 'manager capability unavailable' })
      return
    }

    try {
      // Re-read: `activeSession` was fetched before the rate-limit and
      // persistent-store awaits above. Issue the capability onto the latest
      // record so a participant/socket mutation in that window is not lost.
      // If the session ended in that window, fail rather than resurrect the
      // stale snapshot and grant a manager cookie for a dead session. Use the
      // strict read so a transient store outage rejects into the retryable 500
      // below instead of `sessions.get()` mapping it to `null` -> a terminal
      // 404 the client would stop retrying.
      // The teacher code was verified while `activeSession` was live; bind the
      // capability to that same incarnation so a delete+recreate of this id
      // (even as the same activity) in the awaits above cannot inherit it.
      const expectedCreated = readSessionCreated(activeSession)
      const freshSession = await getSessionStrict(sessionId)
      if (!matchesSessionIncarnation(freshSession, activityName, expectedCreated)) {
        res.status(404).json({ error: 'Teacher join is unavailable for this session' })
        return
      }
      let capabilityToken: string | null = null
      if (sessions.updateAtomic) {
        let updated: unknown = null
        try {
          updated = await sessions.updateAtomic(sessionId, (draft) => {
            // Reset per invocation: updateAtomic re-runs this on a CAS retry.
            capabilityToken = null
            if (!matchesSessionIncarnation(draft, activityName, expectedCreated)) {
              // Abort the CAS instead of returning the draft: a returned draft
              // still commits (revision bump + TTL reset) against the wrong
              // incarnation.
              throw new SessionIncarnationMismatchError()
            }
            capabilityToken = issueActivityCapability(draft as { data: unknown }, 'manager').token
            return draft
          })
        } catch (mutationError) {
          if (!(mutationError instanceof SessionIncarnationMismatchError)) throw mutationError
          updated = null
        }
        if (updated == null || capabilityToken == null
          || !matchesSessionIncarnation(updated, activityName, expectedCreated)) {
          res.status(404).json({ error: 'Teacher join is unavailable for this session' })
          return
        }
      } else {
        capabilityToken = issueActivityCapability(freshSession as { data: unknown }, 'manager').token
        await sessions.set(sessionId, freshSession)
      }
      writeActivityCapabilityCookie(res, sessionId, 'manager', capabilityToken)
    } catch (error) {
      console.error(JSON.stringify({
        event: 'persistent-manager-capability-persistence-failed',
        sessionId,
        errorName: error instanceof Error ? error.name : 'unknown',
      }))
      res.status(500).json({ error: 'manager capability unavailable' })
      return
    }

    res.json({
      success: true,
      activityName,
      sessionId,
      ...(createSessionPayload ? { createSessionPayload } : {}),
    })
  })

  app.post('/api/session/:sessionId/persistent-manager-capability', async (req, res) => {
    setNoStore(res)
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId' })
      return
    }

    try {
      const activeSession = await getSessionStrict(sessionId)
      if (!isPlainObject(activeSession) || typeof activeSession.type !== 'string') {
        res.status(404).json({ error: 'Active session not found' })
        return
      }

      // Does the caller already hold a valid manager capability? For such a
      // caller the persistent recovery context below is advisory only (whether
      // a later capability loss is reload-recoverable), so a transient
      // persistent-store failure must not fail their request. For a caller
      // whose authorization *depends* on the persistent lookup, a store failure
      // has to propagate (-> outer catch -> retryable 500) and only a genuine
      // miss may yield 404/403.
      const alreadyAuthorized = Boolean(
        resolveActivityPrincipalFromCookies(activeSession as { data: unknown }, sessionId, 'manager', req.cookies),
      )

      // Resolve the persistent recovery context.
      //
      // Index-only lookup: this runs before the persistent teacher cookie is
      // checked, so an uncredentialed caller must not be able to drive the
      // O(n) `getAllHashes()` scan. Both the index read and the strict record
      // read reject on a backend failure rather than returning `null`.
      let hash: string | null = null
      let persistentSession: Awaited<ReturnType<typeof getPersistentSessionStrict>> = null
      try {
        hash = await findIndexedHashBySessionId(sessionId)
        persistentSession = hash ? await getPersistentSessionStrict(hash) : null
      } catch (recoveryLookupError) {
        if (!alreadyAuthorized) {
          throw recoveryLookupError
        }
        // Already-authorized: degrade to "recovery not known" instead of
        // failing an otherwise-valid live session on a store blip.
        console.error(JSON.stringify({
          event: 'persistent-manager-capability-recovery-lookup-degraded',
          sessionId,
          error: recoveryLookupError instanceof Error ? recoveryLookupError.message : String(recoveryLookupError),
        }))
      }

      const isPersistentSession = Boolean(
        hash
        && persistentSession
        && persistentSession.sessionId === sessionId
        && persistentSession.activityName === activeSession.type,
      )

      const { sessions: sessionEntries } = parsePersistentSessionsCookie(
        req.cookies?.persistent_sessions,
        'persistent_sessions (/api/session/:sessionId/persistent-manager-capability)',
      )

      // Rate-limit the teacher-code validation below. `persistent_sessions` is a
      // client-supplied cookie a direct HTTP client can forge, so without this
      // an attacker who knows a persistent hash could brute-force its teacher
      // code here - bypassing the same IP+hash cap already enforced by
      // `teacher-authenticate` and the video-sync recovery route. Only a request
      // that actually carries a teacher-code candidate for this link is charged:
      // a caller who merely knows the live session id falls through to the 403
      // below without consuming another client's shared bucket. The
      // already-authorized fast path is unaffected (checked below before any
      // credential comparison that matters).
      if (
        !alreadyAuthorized
        && isPersistentSession
        && hash
        && hasPersistentSessionTeacherCodeCandidate(sessionEntries, persistentSession!.activityName, hash)
      ) {
        // Strict: a limiter-backend outage rejects here (-> the route's outer
        // catch -> retryable 500) rather than failing open and reporting every
        // guess as "allowed" for the duration of the outage.
        const attempt = await recordTeacherCodeAttemptStrict(`${getRequestClientIp(req)}:${hash}`)
        if (!attempt.allowed) {
          // "Wait and retry" - the bucket clears after this window. The Java
          // Format manager treats 429 as transient and honors this header
          // rather than falling into its 1s/2s/3s backoff (which would expire
          // entirely inside the window and force a give-up).
          res.set?.('Retry-After', String(TEACHER_CODE_ATTEMPT_WINDOW_SECONDS))
          res.status(429).json({ error: 'Too many attempts. Please wait a minute.' })
          return
        }
      }
      const persistentRecoveryAvailable = isPersistentSession
        && getValidatedPersistentSessionCookieEntry(sessionEntries, persistentSession!.activityName, hash!) != null

      // Fast path: the caller already holds a valid manager capability. Nothing
      // to re-issue; still report whether recovery is persistently backed.
      if (alreadyAuthorized) {
        res.json({ success: true, alreadyAuthorized: true, persistentRecoveryAvailable })
        return
      }

      if (!isPersistentSession) {
        res.status(404).json({ error: 'Persistent manager recovery is unavailable for this session' })
        return
      }
      if (!persistentRecoveryAvailable) {
        res.status(403).json({ error: 'Persistent teacher authentication is required' })
        return
      }

      if (!sessions.set) {
        res.status(500).json({ error: 'Manager capability is temporarily unavailable' })
        return
      }

      // Re-read: `activeSession` was fetched before the persistent-store and
      // cookie-validation awaits above. Issue the capability onto the latest
      // record so a concurrent activity update in that window is not lost when
      // the whole-session snapshot is written back.
      const freshSession = await getSessionStrict(sessionId)
      // The persistent authorization was established against this `activeSession`
      // incarnation. If the session ended and its id was reused during the
      // awaits above - for a different activity, or even the same activity - do
      // not issue a manager capability into the replacement. Bind to the
      // authorized `type` and its `created` timestamp.
      const expectedType = activeSession.type
      const expectedCreated = readSessionCreated(activeSession)
      if (!matchesSessionIncarnation(freshSession, expectedType, expectedCreated)) {
        res.status(404).json({ error: 'Active session not found' })
        return
      }
      let capabilityToken: string | null = null
      if (sessions.updateAtomic) {
        let updated: unknown = null
        try {
          updated = await sessions.updateAtomic(sessionId, (draft) => {
            // Reset per invocation: updateAtomic re-runs this on a CAS retry.
            capabilityToken = null
            if (!matchesSessionIncarnation(draft, expectedType, expectedCreated)) {
              // Abort the CAS instead of returning the draft: a returned draft
              // still commits (revision bump + TTL reset) against the wrong
              // incarnation.
              throw new SessionIncarnationMismatchError()
            }
            capabilityToken = issueActivityCapability(draft as { data: unknown }, 'manager').token
            return draft
          })
        } catch (mutationError) {
          if (!(mutationError instanceof SessionIncarnationMismatchError)) throw mutationError
          updated = null
        }
        if (updated == null || capabilityToken == null
          || !matchesSessionIncarnation(updated, expectedType, expectedCreated)) {
          res.status(404).json({ error: 'Active session not found' })
          return
        }
      } else {
        capabilityToken = issueActivityCapability(freshSession as { data: unknown }, 'manager').token
        await sessions.set(sessionId, freshSession)
      }
      writeActivityCapabilityCookie(res, sessionId, 'manager', capabilityToken)
      res.json({ success: true, persistentRecoveryAvailable: true })
    } catch (error) {
      console.error(JSON.stringify({
        event: 'persistent-manager-capability-failed',
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      }))
      if (!res.headersSent) {
        res.status(500).json({ error: 'Manager capability is temporarily unavailable' })
      }
    }
  })

  app.get('/api/persistent-session/:hash', async (req, res) => {
    const hash = req.params.hash
    const activityName = getQueryString(req.query.activityName)

    if (!hash) {
      res.status(400).json({ error: 'Missing hash parameter' })
      return
    }

    if (!activityName) {
      res.status(400).json({ error: 'Missing activityName parameter' })
      return
    }

    const { sessions: sessionEntries, corrupted: cookieCorrupted } = parsePersistentSessionsCookie(
      req.cookies?.persistent_sessions,
      'persistent_sessions (/api/persistent-session/:hash)',
    )
    const hasTeacherCookie = getValidatedPersistentSessionCookieEntry(sessionEntries, activityName, hash) != null
    const verifiedUrlState = getVerifiedPersistentLinkUrlStateFromQuery(activityName, hash, req.query)
    const entryContext = await loadPersistentSessionEntryGatewayContext({
      activityName,
      hash,
      hasTeacherCookie,
      entryPolicyOverride: verifiedUrlState?.entryPolicy,
      sessions,
    })

    const queryParams = verifiedUrlState?.selectedOptions ?? {}

    res.json({
      activityName: entryContext.activityName,
      entryPolicy: entryContext.entryPolicy,
      hasTeacherCookie: entryContext.hasTeacherCookie,
      cookieCorrupted,
      isStarted: entryContext.isStarted,
      sessionId: entryContext.sessionId,
      queryParams,
    })
  })

  app.get('/api/persistent-session/:hash/entry', async (req, res) => {
    const hash = req.params.hash
    const activityName = getQueryString(req.query.activityName)

    if (!hash) {
      res.status(400).json({ error: 'Missing hash parameter' })
      return
    }

    if (!activityName) {
      res.status(400).json({ error: 'Missing activityName parameter' })
      return
    }

    const { sessions: sessionEntries } = parsePersistentSessionsCookie(
      req.cookies?.persistent_sessions,
      'persistent_sessions (/api/persistent-session/:hash/entry)',
    )
    const hasTeacherCookie = getValidatedPersistentSessionCookieEntry(sessionEntries, activityName, hash) != null
    const verifiedUrlState = getVerifiedPersistentLinkUrlStateFromQuery(activityName, hash, req.query)

    res.json(await loadPersistentSessionEntryStatus({
      activityName,
      hash,
      hasTeacherCookie,
      entryPolicyOverride: verifiedUrlState?.entryPolicy,
      sessions,
    }))
  })

  app.get('/api/persistent-session/:hash/teacher-code', (req, res) => {
    const hash = req.params.hash
    const activityName = getQueryString(req.query.activityName)

    if (!hash) {
      res.status(400).json({ error: 'Missing hash parameter' })
      return
    }
    if (!activityName) {
      res.status(400).json({ error: 'Missing activityName parameter' })
      return
    }

    const { sessions: sessionEntries } = parsePersistentSessionsCookie(
      req.cookies?.persistent_sessions,
      'persistent_sessions (/api/persistent-session/:hash/teacher-code)',
    )
    const entry = getValidatedPersistentSessionCookieEntry(sessionEntries, activityName, hash)
    const teacherCode = typeof entry?.teacherCode === 'string' ? entry.teacherCode : null

    if (teacherCode) {
      res.json({ teacherCode })
      return
    }
    const hasMatchingCookieKey = sessionEntries.some((sessionEntry) => sessionEntry.key === `${activityName}:${hash}`)
    if (hasMatchingCookieKey) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    res.status(404).json({ error: 'No teacher code found' })
  })

  app.post('/api/persistent-session/:hash/entry-participant', async (req, res) => {
    setNoStore(res)
    const hash = req.params.hash
    const activityName = getQueryString(req.query.activityName)

    if (!hash) {
      res.status(400).json({ error: 'Missing hash parameter' })
      return
    }
    if (!activityName) {
      res.status(400).json({ error: 'Missing activityName parameter' })
      return
    }

    const persistentSession = await getPersistentSession(hash)
    if (!persistentSession || persistentSession.activityName !== activityName) {
      res.status(404).json({ error: 'invalid persistent session' })
      return
    }

    try {
      const body = isPlainObject(req.body) ? req.body : {}
      const { token, values } = await storePersistentSessionEntryParticipant(activityName, hash, body.values)
      res.json({ entryParticipantToken: token, values })
    } catch (error) {
      if (error instanceof PersistentSessionEntryParticipantStoreError) {
        res.status(error.statusCode).json({ error: error.message })
        return
      }
      console.error('Error storing persistent session entry participant:', { activityName, hash, error })
      res.status(500).json({ error: 'internal server error' })
    }
  })

  app.post('/api/persistent-session/:hash/entry-participant/consume', async (req, res) => {
    setNoStore(res)
    const hash = req.params.hash
    const activityName = getQueryString(req.query.activityName)

    if (!hash) {
      res.status(400).json({ error: 'Missing hash parameter' })
      return
    }
    if (!activityName) {
      res.status(400).json({ error: 'Missing activityName parameter' })
      return
    }

    const persistentSession = await getPersistentSession(hash)
    if (!persistentSession || persistentSession.activityName !== activityName) {
      res.status(404).json({ error: 'invalid persistent session' })
      return
    }

    try {
      const body = isPlainObject(req.body) ? req.body : {}
      const token = getBodyString(body, 'token')
      if (!token) {
        res.status(404).json({ error: 'entry participant not found' })
        return
      }

      const values = await consumePersistentSessionEntryParticipant(hash, token)
      if (!values) {
        res.status(404).json({ error: 'entry participant not found' })
        return
      }

      res.json({ values })
    } catch (error) {
      console.error('Error consuming persistent session entry participant:', { activityName, hash, error })
      res.status(500).json({ error: 'internal server error' })
    }
  })
}

export { parsePersistentSessionsCookie }
