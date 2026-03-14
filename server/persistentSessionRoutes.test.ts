import test from 'node:test'
import assert from 'node:assert/strict'
import { initializeActivityRegistry } from './activities/activityRegistry.js'
import { registerPersistentSessionRoutes } from './routes/persistentSessionRoutes.js'
import {
  initializePersistentStorage,
  generatePersistentHash,
  getOrCreateActivePersistentSession,
  getPersistentSession,
  startPersistentSession,
  resetPersistentSession,
  cleanupPersistentSession,
} from './core/persistentSessions.js'

interface MockRequest {
  params: Record<string, string>
  query: Record<string, unknown>
  cookies: Record<string, string>
  body: Record<string, unknown>
  protocol: string
  get(name: string): string | undefined
}

interface MockResponse {
  statusCode: number
  cookies: Map<string, { value: string; options: Record<string, unknown> }>
  jsonBody: Record<string, unknown> | null
  status(code: number): MockResponse
  json(payload: Record<string, unknown>): Record<string, unknown>
  cookie(name: string, value: string, options: Record<string, unknown>): void
}

type RouteHandler = (req: MockRequest, res: MockResponse) => void | Promise<void>

function createMockApp(): {
  use: () => void
  get: (path: string, handler: RouteHandler) => void
  post: (path: string, handler: RouteHandler) => void
  routes: { get: Map<string, RouteHandler>; post: Map<string, RouteHandler> }
} {
  const routes = { get: new Map<string, RouteHandler>(), post: new Map<string, RouteHandler>() }
  return {
    use() {},
    get(path: string, handler: RouteHandler) {
      routes.get.set(path, handler)
    },
    post(path: string, handler: RouteHandler) {
      routes.post.set(path, handler)
    },
    routes,
  }
}

function createMockReq({
  params = {},
  query = {},
  cookies = {},
  body = {},
  headers = {},
  protocol = 'http',
}: {
  params?: Record<string, string>
  query?: Record<string, unknown>
  cookies?: Record<string, string>
  body?: Record<string, unknown>
  headers?: Record<string, string>
  protocol?: string
} = {}): MockRequest {
  return {
    params,
    query,
    cookies,
    body,
    protocol,
    get(name: string) {
      const key = name.toLowerCase()
      return headers[key]
    },
  }
}

function createMockRes(): MockResponse {
  return {
    statusCode: 200,
    cookies: new Map(),
    jsonBody: null,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: Record<string, unknown>) {
      this.jsonBody = payload
      return payload
    },
    cookie(name: string, value: string, options: Record<string, unknown>) {
      this.cookies.set(name, { value, options })
    },
  }
}

function buildCookieValue(
  activityName: string,
  hash: string,
  teacherCode: string,
  selectedOptions?: Record<string, unknown>,
): string {
  return JSON.stringify([{ key: `${activityName}:${hash}`, teacherCode, selectedOptions }])
}

function getRoute(app: ReturnType<typeof createMockApp>, method: 'GET' | 'POST', path: string): RouteHandler {
  const store = method === 'GET' ? app.routes.get : app.routes.post
  const handler = store.get(path)
  if (!handler) throw new Error(`Route ${method} ${path} not registered`)
  return handler
}

void test('persistent session route keeps valid backing session', async (t) => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash')

  const activityName = 'gallery-walk'
  const teacherCode = 'secret-code'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)
  sessionMap.set('live-session', { id: 'live-session' })
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const req = createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, teacherCode) },
  })
  const res = createMockRes()
  await handler(req, res)
  assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody))
  assert.equal(res.jsonBody?.entryPolicy, 'instructor-required')
  assert.equal(res.jsonBody?.isStarted, true)
  assert.equal(res.jsonBody?.sessionId, 'live-session')

  const stored = await getPersistentSession(hash)
  assert.equal(stored?.entryPolicy, 'instructor-required')
})

void test('persistent session route resets when backing session missing', async (t) => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash')

  const activityName = 'gallery-walk'
  const teacherCode = 'missing-code'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)
  await startPersistentSession(hash, 'ghost-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const req = createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, teacherCode) },
  })
  const res = createMockRes()
  await handler(req, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.jsonBody?.isStarted, false)
  assert.equal(res.jsonBody?.sessionId, null)

  const stored = await getPersistentSession(hash)
  assert.equal(stored?.sessionId, null)
})

void test('persistent session route allows recreation after reset', async (t) => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash')

  const activityName = 'gallery-walk'
  const teacherCode = 'restart-code'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)
  await startPersistentSession(hash, 'expired-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const cookieValue = buildCookieValue(activityName, hash, teacherCode)
  const firstReq = createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: cookieValue },
  })
  const firstRes = createMockRes()
  await handler(firstReq, firstRes)
  assert.equal(firstRes.jsonBody?.isStarted, false)

  sessionMap.set('new-session', { id: 'new-session' })
  await startPersistentSession(hash, 'new-session', { id: 'teacher-ws-2', readyState: 1, send() {} })

  const secondReq = createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: cookieValue },
  })
  const secondRes = createMockRes()
  await handler(secondReq, secondRes)
  assert.equal(secondRes.jsonBody?.isStarted, true)
  assert.equal(secondRes.jsonBody?.sessionId, 'new-session')
})

void test('persistent session entry route returns shared entry status for started live sessions', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/entry')

  const activityName = 'java-string-practice'
  const teacherCode = 'entry-status-code'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)
  sessionMap.set('live-session', { id: 'live-session' })
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const req = createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, teacherCode) },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    activityName,
    hash,
    entryPolicy: 'instructor-required',
    hasTeacherCookie: true,
    isStarted: true,
    sessionId: 'live-session',
    waitingRoomFieldCount: 1,
    resolvedRole: 'teacher',
    entryOutcome: 'join-live',
    presentationMode: 'render-ui',
  })
})

void test('persistent session entry route keeps started live student entry in student role without a teacher cookie', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/entry')

  const activityName = 'java-string-practice'
  const teacherCode = 'student-live-entry'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)
  sessionMap.set('live-session', { id: 'live-session' })
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const req = createMockReq({
    params: { hash },
    query: { activityName },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    activityName,
    hash,
    entryPolicy: 'instructor-required',
    hasTeacherCookie: false,
    isStarted: true,
    sessionId: 'live-session',
    waitingRoomFieldCount: 1,
    resolvedRole: 'student',
    entryOutcome: 'join-live',
    presentationMode: 'render-ui',
  })
})

void test('persistent session entry route returns wait status for instructor-required student entry before startup', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/entry')

  const activityName = 'java-string-practice'
  const teacherCode = 'student-wait-status'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)

  const req = createMockReq({
    params: { hash },
    query: { activityName },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    activityName,
    hash,
    entryPolicy: 'instructor-required',
    hasTeacherCookie: false,
    isStarted: false,
    sessionId: null,
    waitingRoomFieldCount: 1,
    resolvedRole: 'student',
    entryOutcome: 'wait',
    presentationMode: 'render-ui',
  })
})

void test('persistent session entry route passes straight through for started live activities without waiting-room fields', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/entry')

  const activityName = 'raffle'
  const teacherCode = 'live-pass-through'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)
  sessionMap.set('live-session', { id: 'live-session' })
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const req = createMockReq({
    params: { hash },
    query: { activityName },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    activityName,
    hash,
    entryPolicy: 'instructor-required',
    hasTeacherCookie: false,
    isStarted: true,
    sessionId: 'live-session',
    waitingRoomFieldCount: 0,
    resolvedRole: 'student',
    entryOutcome: 'join-live',
    presentationMode: 'pass-through',
  })
})

void test('persistent session entry route resets stale backing sessions before resolving entry status', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/entry')

  const activityName = 'java-string-practice'
  const teacherCode = 'stale-entry-status'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)
  await startPersistentSession(hash, 'ghost-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const req = createMockReq({
    params: { hash },
    query: { activityName },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    activityName,
    hash,
    entryPolicy: 'instructor-required',
    hasTeacherCookie: false,
    isStarted: false,
    sessionId: null,
    waitingRoomFieldCount: 1,
    resolvedRole: 'student',
    entryOutcome: 'wait',
    presentationMode: 'render-ui',
  })

  const stored = await getPersistentSession(hash)
  assert.equal(stored?.sessionId, null)
})

void test('persistent session entry route keeps solo-only links in solo status even with teacher cookie', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/entry')

  const activityName = 'java-format-practice'
  const teacherCode = 'solo-only-entry'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-only')

  const req = createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, teacherCode) },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    activityName,
    hash,
    entryPolicy: 'solo-only',
    hasTeacherCookie: true,
    isStarted: false,
    sessionId: null,
    waitingRoomFieldCount: 1,
    resolvedRole: 'student',
    entryOutcome: 'continue-solo',
    presentationMode: 'render-ui',
  })
})

void test('persistent session entry route returns solo-unavailable for non-solo activities on solo-only links', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/entry')

  const activityName = 'raffle'
  const teacherCode = 'solo-unavailable-entry'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-only')

  const req = createMockReq({
    params: { hash },
    query: { activityName },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    activityName,
    hash,
    entryPolicy: 'solo-only',
    hasTeacherCookie: false,
    isStarted: false,
    sessionId: null,
    waitingRoomFieldCount: 0,
    resolvedRole: 'student',
    entryOutcome: 'solo-unavailable',
    presentationMode: 'pass-through',
  })
})

void test('persistent session entry route rejects requests missing activityName', async () => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/entry')

  const res = createMockRes()
  await handler(createMockReq({ params: { hash: 'abc123' } }), res)

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.jsonBody, { error: 'Missing activityName parameter' })
})

void test('persistent session metadata route reports corrupted cookies while preserving student entry state', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash')

  const activityName = 'java-string-practice'
  const teacherCode = 'corrupted-cookie'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)

  console.log('[TEST] Expected corrupted-cookie parse error output follows for persistent session metadata route coverage.')

  const res = createMockRes()
  await handler(createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: '{bad-json' },
  }), res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    activityName,
    entryPolicy: 'instructor-required',
    hasTeacherCookie: false,
    cookieCorrupted: true,
    isStarted: false,
    sessionId: null,
    queryParams: {},
  })
})

void test('teacher-code route rejects requests missing activityName', async () => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/teacher-code')

  const res = createMockRes()
  await handler(createMockReq({ params: { hash: 'abc123' } }), res)

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.jsonBody, { error: 'Missing activityName parameter' })
})

void test('teacher-code route returns 404 when the permalink has no remembered teacher code', async () => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/teacher-code')

  const res = createMockRes()
  await handler(createMockReq({
    params: { hash: 'hash-1' },
    query: { activityName: 'java-string-practice' },
  }), res)

  assert.equal(res.statusCode, 404)
  assert.deepEqual(res.jsonBody, { error: 'No teacher code found' })
})

void test('teacher-code route rejects remembered codes that do not validate for the permalink hash', async () => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/teacher-code')

  const activityName = 'java-string-practice'
  const { hash } = generatePersistentHash(activityName, 'actual-teacher-code')
  const res = createMockRes()
  await handler(createMockReq({
    params: { hash },
    query: { activityName },
    cookies: {
      persistent_sessions: buildCookieValue(activityName, hash, 'wrong-teacher-code'),
    },
  }), res)

  assert.equal(res.statusCode, 403)
  assert.deepEqual(res.jsonBody, { error: 'forbidden' })
})

void test('teacher-code route returns the remembered code when it still validates for the permalink hash', async () => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/teacher-code')

  const activityName = 'java-string-practice'
  const teacherCode = 'valid-teacher-code'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  const res = createMockRes()
  await handler(createMockReq({
    params: { hash },
    query: { activityName },
    cookies: {
      persistent_sessions: buildCookieValue(activityName, hash, teacherCode),
    },
  }), res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, { teacherCode })
})

void test('teacher lifecycle clears session on explicit end', async (t) => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = {
    get: async (id: string) => sessionMap.get(id) ?? null,
    delete: async (id: string) => {
      sessionMap.delete(id)
    },
  }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const activityName = 'gallery-walk'
  const teacherCode = 'teacher-end'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  const cookieValue = buildCookieValue(activityName, hash, teacherCode)
  await getOrCreateActivePersistentSession(activityName, hash)
  sessionMap.set('lifecycle-session', { id: 'lifecycle-session' })
  await startPersistentSession(hash, 'lifecycle-session', { id: 'teacher-ws', readyState: 1, send() {} })

  await resetPersistentSession(hash)
  await sessions.delete('lifecycle-session')
  const stored = await getPersistentSession(hash)
  assert.equal(stored?.sessionId, null)

  const req = createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: cookieValue },
  })
  const res = createMockRes()
  await getRoute(app, 'GET', '/api/persistent-session/:hash')(req, res)
  assert.equal(res.jsonBody?.isStarted, false)
})

void test('authenticate persists selectedOptions from request body when cookie entry is missing', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const activityName = 'gallery-walk'
  const teacherCode = 'persistent-teacher'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await startPersistentSession(hash, 'syncdeck-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const handler = getRoute(app, 'POST', '/api/persistent-session/authenticate')
  const req = createMockReq({
    body: {
      activityName,
      hash,
      teacherCode,
      selectedOptions: {
        mode: 'review',
        prompt: 'exit ticket',
      },
    },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  const cookie = res.cookies.get('persistent_sessions')
  assert.ok(cookie)
  const parsed = JSON.parse(cookie.value) as Array<{ key?: string; selectedOptions?: Record<string, unknown> }>
  const entry = parsed.find((candidate) => candidate.key === `${activityName}:${hash}`)
  assert.deepEqual(entry?.selectedOptions, {
    mode: 'review',
    prompt: 'exit ticket',
  })
})

void test('authenticate preserves existing selectedOptions from cookie over request body', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const activityName = 'gallery-walk'
  const teacherCode = 'persistent-teacher-preserve'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await startPersistentSession(hash, 'syncdeck-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const handler = getRoute(app, 'POST', '/api/persistent-session/authenticate')
  const req = createMockReq({
    cookies: {
      persistent_sessions: buildCookieValue(activityName, hash, teacherCode, {
        mode: 'presentation',
        prompt: 'warmup',
      }),
    },
    body: {
      activityName,
      hash,
      teacherCode,
      selectedOptions: {
        mode: 'review',
        prompt: 'exit ticket',
      },
    },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 200)
  const cookie = res.cookies.get('persistent_sessions')
  assert.ok(cookie)
  const parsed = JSON.parse(cookie.value) as Array<{ key?: string; selectedOptions?: Record<string, unknown> }>
  const entry = parsed.find((candidate) => candidate.key === `${activityName}:${hash}`)
  assert.deepEqual(entry?.selectedOptions, {
    mode: 'presentation',
    prompt: 'warmup',
  })
})

void test('create persists non-default entry policy in metadata and list exposes it', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const createHandler = getRoute(app, 'POST', '/api/persistent-session/create')
  const createReq = createMockReq({
    body: {
      activityName: 'gallery-walk',
      teacherCode: 'solo-allowed-code',
      entryPolicy: 'solo-allowed',
    },
    headers: {
      host: 'bits.example',
    },
    protocol: 'https',
  })
  const createRes = createMockRes()

  await createHandler(createReq, createRes)

  assert.equal(createRes.statusCode, 200, JSON.stringify(createRes.jsonBody))
  const hash = String(createRes.jsonBody?.hash ?? '')
  t.after(async () => cleanupPersistentSession(hash))

  const stored = await getPersistentSession(hash)
  assert.equal(stored?.entryPolicy, 'solo-allowed')

  const cookie = createRes.cookies.get('persistent_sessions')
  assert.ok(cookie)

  const listHandler = getRoute(app, 'GET', '/api/persistent-session/list')
  const listReq = createMockReq({
    cookies: {
      persistent_sessions: cookie.value,
    },
    headers: {
      host: 'bits.example',
    },
    protocol: 'https',
  })
  const listRes = createMockRes()

  await listHandler(listReq, listRes)

  assert.equal(listRes.statusCode, 200)
  const sessionsList = Array.isArray(listRes.jsonBody?.sessions) ? listRes.jsonBody.sessions : []
  assert.equal(sessionsList.length, 1)
  assert.equal((sessionsList[0] as Record<string, unknown>).entryPolicy, 'solo-allowed')
})

void test('authenticate rejects teacher auth for solo-only permalinks without mutating cookies', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const activityName = 'gallery-walk'
  const teacherCode = 'solo-only-teacher'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-only')

  const handler = getRoute(app, 'POST', '/api/persistent-session/authenticate')
  const req = createMockReq({
    body: {
      activityName,
      hash,
      teacherCode,
    },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 409)
  assert.deepEqual(res.jsonBody, {
    error: 'This permanent link is configured for solo use only.',
    code: 'entry-policy-rejected',
    entryPolicy: 'solo-only',
  })
  assert.equal(res.cookies.has('persistent_sessions'), false)
})
