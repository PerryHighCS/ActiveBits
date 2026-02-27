import { getAllowedActivities, isValidActivity } from '../activities/activityRegistry.js'
import {
  generatePersistentHash,
  getOrCreateActivePersistentSession,
  getPersistentSession,
  verifyTeacherCodeWithHash,
  resetPersistentSession,
} from '../core/persistentSessions.js'

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000
const MAX_SESSIONS_PER_COOKIE = 20
const MAX_TEACHER_CODE_LENGTH = 100

interface CookieSessionEntry {
  key: string
  teacherCode: unknown
  selectedOptions?: Record<string, unknown>
}

interface CookieParseResult {
  sessions: CookieSessionEntry[]
  corrupted: boolean
  error: string | null
}

interface SessionStoreLike {
  get(id: string): Promise<unknown | null>
}

interface RequestLike {
  params: Record<string, string | undefined>
  query: Record<string, unknown>
  cookies?: Record<string, unknown>
  body?: unknown
  protocol: string
  get(name: string): string | undefined
}

interface ResponseLike {
  status(code: number): ResponseLike
  json(payload: unknown): void
  cookie(name: string, value: string, options: Record<string, unknown>): void
}

interface AppLike {
  get(path: string, handler: (req: RequestLike, res: ResponseLike) => void | Promise<void>): void
  post(path: string, handler: (req: RequestLike, res: ResponseLike) => void | Promise<void>): void
}

interface RegisterPersistentSessionRoutesOptions {
  app: AppLike
  sessions: SessionStoreLike
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

function toSelectedOptions(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {}
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

export function registerPersistentSessionRoutes({ app, sessions }: RegisterPersistentSessionRoutesOptions): void {
  app.get('/api/persistent-session/list', (req, res) => {
    try {
      const { sessions: sessionEntries } = parsePersistentSessionsCookie(
        req.cookies?.persistent_sessions,
        'persistent_sessions (/api/persistent-session/list)',
      )

      const sessionList = sessionEntries
        .map((entry) => {
          const parts = entry.key.split(':')
          if (parts.length !== 2 || !parts[0] || !parts[1]) {
            console.warn(`Invalid session key format: "${entry.key}"`)
            return null
          }

          const [activityName, hash] = parts
          const host = req.get('x-forwarded-host') ?? req.get('host')
          const protocol = req.get('x-forwarded-proto') ?? req.protocol
          return {
            activityName,
            hash,
            teacherCode: entry.teacherCode,
            selectedOptions: entry.selectedOptions || {},
            url: `/activity/${activityName}/${hash}`,
            fullUrl: host ? `${protocol}://${host}/activity/${activityName}/${hash}` : null,
          }
        })
        .filter(Boolean)

      res.json({ sessions: sessionList })
    } catch (err) {
      console.error('Error in /api/persistent-session/list:', err)
      res.status(500).json({ error: 'Internal server error', sessions: [] })
    }
  })

  app.post('/api/persistent-session/create', (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {}
    const activityName = getBodyString(body, 'activityName')
    const teacherCode = getBodyString(body, 'teacherCode')
    const selectedOptions = toSelectedOptions(body.selectedOptions)

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

    const cookieName = 'persistent_sessions'
    let { sessions: sessionEntries } = parsePersistentSessionsCookie(
      req.cookies?.[cookieName],
      'persistent_sessions (/api/persistent-session/create)',
    )

    const { hash } = generatePersistentHash(activityName, teacherCode)
    const cookieKey = `${activityName}:${hash}`

    const existingIndex = sessionEntries.findIndex((entry) => entry.key === cookieKey)
    if (existingIndex !== -1) {
      sessionEntries.splice(existingIndex, 1)
    }
    sessionEntries.push({ key: cookieKey, teacherCode, selectedOptions })
    if (sessionEntries.length > MAX_SESSIONS_PER_COOKIE) {
      sessionEntries = sessionEntries.slice(-MAX_SESSIONS_PER_COOKIE)
    }

    res.cookie(cookieName, JSON.stringify(sessionEntries), {
      maxAge: ONE_YEAR_MS,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
    })

    res.json({ url: `/activity/${activityName}/${hash}`, hash })
  })

  app.post('/api/persistent-session/authenticate', async (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {}
    const activityName = getBodyString(body, 'activityName')
    const hash = getBodyString(body, 'hash')
    const teacherCode = getBodyString(body, 'teacherCode')
    const bodySelectedOptions = toSelectedOptions(body.selectedOptions)

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

    const validation = verifyTeacherCodeWithHash(activityName, hash, teacherCode)
    if (!validation.valid) {
      res.status(401).json({ error: validation.error || 'Invalid teacher code' })
      return
    }

    const cookieName = 'persistent_sessions'
    let { sessions: sessionEntries } = parsePersistentSessionsCookie(
      req.cookies?.[cookieName],
      'persistent_sessions (/api/persistent-session/authenticate)',
    )
    const cookieKey = `${activityName}:${hash}`
    const existingIndex = sessionEntries.findIndex((entry) => entry.key === cookieKey)
    const existingEntry = existingIndex >= 0 ? sessionEntries[existingIndex] : undefined
    const existingSelectedOptions = toSelectedOptions(existingEntry?.selectedOptions)

    // [SYNCDECK-DEBUG] Remove after diagnosing URL-encoding bug
    console.log('[SYNCDECK-DEBUG] authenticate: activityName =', activityName, '| bodySelectedOptions =', JSON.stringify(bodySelectedOptions), '| existingSelectedOptions =', JSON.stringify(existingSelectedOptions), '| will use:', Object.keys(existingSelectedOptions).length > 0 ? 'existing' : 'body')

    if (existingIndex !== -1) {
      sessionEntries.splice(existingIndex, 1)
    }
    const finalSelectedOptions =
      Object.keys(existingSelectedOptions).length > 0
        ? existingSelectedOptions
        : bodySelectedOptions
    sessionEntries.push({
      key: cookieKey,
      teacherCode,
      // Preserve existing cookie options when available; otherwise bootstrap from the permalink URL
      // params submitted during teacher authentication on a new device.
      selectedOptions: finalSelectedOptions,
    })
    // [SYNCDECK-DEBUG] Remove after diagnosing URL-encoding bug
    console.log(
      '[SYNCDECK-DEBUG] authenticate: cookieKey =',
      cookieKey,
      '| existingIndex =',
      existingIndex,
      '| finalSelectedOptions =',
      JSON.stringify(finalSelectedOptions),
    )
    if (sessionEntries.length > MAX_SESSIONS_PER_COOKIE) {
      sessionEntries = sessionEntries.slice(-MAX_SESSIONS_PER_COOKIE)
    }

    res.cookie(cookieName, JSON.stringify(sessionEntries), {
      maxAge: ONE_YEAR_MS,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
    })

    const persistentSession = await getPersistentSession(hash)
    res.json({
      success: true,
      isStarted: Boolean(persistentSession?.sessionId),
      sessionId: persistentSession?.sessionId || null,
    })
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

    let session = await getOrCreateActivePersistentSession(activityName, hash)

    if (session.sessionId) {
      const backingSession = await sessions.get(session.sessionId)
      if (backingSession == null) {
        await resetPersistentSession(hash)
        session = await getOrCreateActivePersistentSession(activityName, hash)
      }
    }

    const { sessions: sessionEntries, corrupted: cookieCorrupted } = parsePersistentSessionsCookie(
      req.cookies?.persistent_sessions,
      'persistent_sessions (/api/persistent-session/:hash)',
    )
    const cookieKey = `${activityName}:${hash}`
    const hasTeacherCookie = sessionEntries.some((entry) => entry.key === cookieKey)

    const queryParams = Object.fromEntries(Object.entries(req.query).filter(([key]) => key !== 'activityName'))

    res.json({
      activityName: session.activityName,
      hasTeacherCookie,
      cookieCorrupted,
      isStarted: Boolean(session.sessionId),
      sessionId: session.sessionId,
      queryParams,
    })
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
    const cookieKey = `${activityName}:${hash}`
    const entry = sessionEntries.find((sessionEntry) => sessionEntry.key === cookieKey)
    const teacherCode = typeof entry?.teacherCode === 'string' ? entry.teacherCode : null

    if (teacherCode) {
      res.json({ teacherCode })
      return
    }
    res.status(404).json({ error: 'No teacher code found' })
  })
}

export { parsePersistentSessionsCookie }
