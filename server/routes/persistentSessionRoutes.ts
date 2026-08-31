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
  storePersistentSessionEntryParticipant,
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
    await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, entryPolicy)
    await updatePersistentSessionUrlState(hash, {
      entryPolicy,
      selectedOptions,
    })

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
    writePersistentSessionsCookie(res, sessionEntries)
    await updatePersistentSessionUrlState(hash, {
      entryPolicy: finalEntryPolicy,
      selectedOptions: finalSelectedOptions,
    })

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
    try {
      // Strict reverse-index lookup: a genuine miss still falls back to the
      // legacy scan, but a backend read failure rejects here instead of
      // returning `null` -> the terminal 404 below (the live session was
      // already read successfully, so the failure is transient and retryable).
      hash = await findHashBySessionIdStrict(sessionId)
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

    const persistentSession = await getPersistentSession(hash)
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
    writePersistentSessionsCookie(res, sessionEntries)
    await updatePersistentSessionUrlState(hash, finalUrlState)

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
      const freshSession = await getSessionStrict(sessionId)
      if (!isPlainObject(freshSession) || freshSession.type !== activityName) {
        res.status(404).json({ error: 'Teacher join is unavailable for this session' })
        return
      }
      const capability = issueActivityCapability(freshSession as { data: unknown }, 'manager')
      await sessions.set(sessionId, freshSession)
      writeActivityCapabilityCookie(res, sessionId, 'manager', capability.token)
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
      if (!isPlainObject(freshSession)) {
        res.status(404).json({ error: 'Active session not found' })
        return
      }
      // The persistent authorization was established for `activeSession.type`.
      // If the session ended and its id was reused for a different activity
      // during the awaits above, do not issue a manager capability into the
      // replacement.
      if (freshSession.type !== activeSession.type) {
        res.status(404).json({ error: 'Active session not found' })
        return
      }
      const capability = issueActivityCapability(freshSession as { data: unknown }, 'manager')
      await sessions.set(sessionId, freshSession)
      writeActivityCapabilityCookie(res, sessionId, 'manager', capability.token)
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
