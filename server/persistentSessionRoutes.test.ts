import test from 'node:test'
import assert from 'node:assert/strict'
import { initializeActivityRegistry } from './activities/activityRegistry.js'
import { registerPersistentSessionRoutes } from './routes/persistentSessionRoutes.js'
import {
  clearHashBySessionIdIndex,
  findHashBySessionId,
  initializePersistentStorage,
  generatePersistentHash,
  getOrCreateActivePersistentSession,
  getPersistentSession,
  startPersistentSession,
  resetPersistentSession,
  cleanupPersistentSession,
  updatePersistentSessionUrlState,
} from './core/persistentSessions.js'
import { buildPersistentLinkUrlQuery } from './core/persistentLinkUrlState.js'

interface MockRequest {
  params: Record<string, string>
  query: Record<string, unknown>
  cookies: Record<string, string>
  body: Record<string, unknown>
  ip?: string
  socket?: {
    remoteAddress?: string
  }
  protocol: string
  get(name: string): string | undefined
}

interface MockResponse {
  statusCode: number
  cookies: Map<string, { value: string; options: Record<string, unknown> }>
  jsonBody: Record<string, unknown> | null
  headers: Record<string, string>
  status(code: number): MockResponse
  set(field: string, value: string): MockResponse
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
  ip,
  remoteAddress,
  protocol = 'http',
}: {
  params?: Record<string, string>
  query?: Record<string, unknown>
  cookies?: Record<string, string>
  body?: Record<string, unknown>
  headers?: Record<string, string>
  ip?: string
  remoteAddress?: string
  protocol?: string
} = {}): MockRequest {
  return {
    params,
    query,
    cookies,
    body,
    ip,
    socket: remoteAddress ? { remoteAddress } : undefined,
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
    headers: {},
    status(code: number) {
      this.statusCode = code
      return this
    },
    set(field: string, value: string) {
      this.headers[field.toLowerCase()] = value
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

void test('persistent session create rejects solo-capable entry policies for non-solo activities', async () => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessions = { get: async () => null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/persistent-session/create')

  const req = createMockReq({
    body: {
      activityName: 'raffle',
      teacherCode: 'teacher-secret',
      entryPolicy: 'solo-only',
    },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.jsonBody, { error: 'This activity does not support solo entry links' })
})

void test('persistent session update rejects solo-capable entry policies for non-solo activities', async () => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessions = { get: async () => null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/persistent-session/update')

  const req = createMockReq({
    body: {
      activityName: 'raffle',
      hash: 'deadbeef',
      entryPolicy: 'solo-allowed',
      selectedOptions: {},
    },
  })
  const res = createMockRes()

  await handler(req, res)

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.jsonBody, { error: 'This activity does not support solo entry links' })
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
  const query = buildPersistentLinkUrlQuery({
    hash,
    entryPolicy: 'solo-only',
    selectedOptions: {},
  })

  const req = createMockReq({
    params: { hash },
    query: { activityName, entryPolicy: query.get('entryPolicy') ?? '', urlHash: query.get('urlHash') ?? '' },
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
  const query = buildPersistentLinkUrlQuery({
    hash,
    entryPolicy: 'solo-only',
    selectedOptions: {},
  })

  const req = createMockReq({
    params: { hash },
    query: { activityName, entryPolicy: query.get('entryPolicy') ?? '', urlHash: query.get('urlHash') ?? '' },
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

void test('persistent session metadata route ignores invalid remembered teacher cookies', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash')

  const activityName = 'java-string-practice'
  const { hash } = generatePersistentHash(activityName, 'actual-teacher-code')
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)

  const res = createMockRes()
  await handler(createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, 'wrong-teacher-code') },
  }), res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    activityName,
    entryPolicy: 'instructor-required',
    hasTeacherCookie: false,
    cookieCorrupted: false,
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

void test('persistent session entry route ignores invalid remembered teacher cookies for role resolution', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash/entry')

  const activityName = 'java-string-practice'
  const { hash } = generatePersistentHash(activityName, 'actual-teacher-code')
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)
  sessionMap.set('live-session', { id: 'live-session' })
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const res = createMockRes()
  await handler(createMockReq({
    params: { hash },
    query: { activityName },
    cookies: { persistent_sessions: buildCookieValue(activityName, hash, 'wrong-teacher-code') },
  }), res)

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

void test('persistent entry participant routes store and consume values by token', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const activityName = 'java-string-practice'
  const teacherCode = 'persistent-entry-participant'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  await getOrCreateActivePersistentSession(activityName, hash)

  const storeHandler = getRoute(app, 'POST', '/api/persistent-session/:hash/entry-participant')
  const storeRes = createMockRes()
  await storeHandler(createMockReq({
    params: { hash },
    query: { activityName },
    body: {
      values: {
        displayName: 'Ada',
        ignored: () => 'x',
      },
    },
  }), storeRes)

  assert.equal(storeRes.statusCode, 200)
  assert.equal(storeRes.headers['cache-control'], 'no-store')
  const token = typeof storeRes.jsonBody?.entryParticipantToken === 'string' ? storeRes.jsonBody.entryParticipantToken : null
  assert.equal(typeof token, 'string')
  assert.equal(typeof (storeRes.jsonBody?.values as Record<string, unknown> | undefined)?.participantId, 'string')

  const consumeHandler = getRoute(app, 'POST', '/api/persistent-session/:hash/entry-participant/consume')
  const consumeRes = createMockRes()
  await consumeHandler(createMockReq({
    params: { hash },
    query: { activityName },
    body: { token: String(token) },
  }), consumeRes)

  assert.equal(consumeRes.statusCode, 200)
  assert.equal(consumeRes.headers['cache-control'], 'no-store')
  assert.deepEqual(consumeRes.jsonBody, {
    values: {
      displayName: 'Ada',
      participantId: (storeRes.jsonBody?.values as Record<string, unknown>).participantId,
    },
  })

  const missingRes = createMockRes()
  await consumeHandler(createMockReq({
    params: { hash },
    query: { activityName },
    body: { token: String(token) },
  }), missingRes)

  assert.equal(missingRes.statusCode, 404)
  assert.deepEqual(missingRes.jsonBody, { error: 'entry participant not found' })
})

void test('persistent entry participant store route rejects invalid persistent sessions', async () => {
  initializePersistentStorage(null)
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const storeHandler = getRoute(app, 'POST', '/api/persistent-session/:hash/entry-participant')
  const res = createMockRes()
  await storeHandler(createMockReq({
    params: { hash: 'missing-hash' },
    query: { activityName: 'java-string-practice' },
    body: {
      values: {
        displayName: 'Ada',
      },
    },
  }), res)

  assert.equal(res.statusCode, 404)
  assert.deepEqual(res.jsonBody, { error: 'invalid persistent session' })
})

void test('persistent entry participant store route rejects oversized payloads', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const activityName = 'java-string-practice'
  const teacherCode = 'persistent-entry-participant-oversized'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  await getOrCreateActivePersistentSession(activityName, hash)

  const storeHandler = getRoute(app, 'POST', '/api/persistent-session/:hash/entry-participant')
  const res = createMockRes()
  await storeHandler(createMockReq({
    params: { hash },
    query: { activityName },
    body: {
      values: {
        displayName: 'x'.repeat(9000),
      },
    },
  }), res)

  assert.equal(res.statusCode, 413)
  assert.deepEqual(res.jsonBody, { error: 'entry participant payload too large' })
})

void test('persistent entry participant store route prunes oldest tokens when limit is exceeded', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const activityName = 'java-string-practice'
  const teacherCode = 'persistent-entry-participant-prune'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  await getOrCreateActivePersistentSession(activityName, hash)

  const storeHandler = getRoute(app, 'POST', '/api/persistent-session/:hash/entry-participant')
  const consumeHandler = getRoute(app, 'POST', '/api/persistent-session/:hash/entry-participant/consume')
  const tokens: string[] = []

  for (let index = 0; index < 101; index += 1) {
    const storeRes = createMockRes()
    await storeHandler(createMockReq({
      params: { hash },
      query: { activityName },
      body: {
        values: {
          displayName: `Student-${index}`,
        },
      },
    }), storeRes)

    assert.equal(storeRes.statusCode, 200)
    const token = storeRes.jsonBody?.entryParticipantToken
    assert.equal(typeof token, 'string')
    tokens.push(String(token))
  }

  const oldestRes = createMockRes()
  await consumeHandler(createMockReq({
    params: { hash },
    query: { activityName },
    body: { token: tokens[0] as string },
  }), oldestRes)
  assert.equal(oldestRes.statusCode, 404)
  assert.deepEqual(oldestRes.jsonBody, { error: 'entry participant not found' })

  const newestRes = createMockRes()
  await consumeHandler(createMockReq({
    params: { hash },
    query: { activityName },
    body: { token: tokens[100] as string },
  }), newestRes)
  assert.equal(newestRes.statusCode, 200)
  assert.equal(
    typeof (newestRes.jsonBody?.values as Record<string, unknown> | undefined)?.participantId,
    'string',
  )
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

void test('session id reverse lookup tracks start, reset, and restart lifecycle', async (t) => {
  initializePersistentStorage(null)

  const activityName = 'gallery-walk'
  const teacherCode = 'reverse-lookup'
  const { hash } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash)

  assert.equal(await findHashBySessionId('first-session'), null)

  await startPersistentSession(hash, 'first-session', { id: 'teacher-ws', readyState: 1, send() {} })
  assert.equal(await findHashBySessionId('first-session'), hash)

  await resetPersistentSession(hash)
  assert.equal(await findHashBySessionId('first-session'), null)

  await startPersistentSession(hash, 'second-session', { id: 'teacher-ws-2', readyState: 1, send() {} })
  assert.equal(await findHashBySessionId('second-session'), hash)
  assert.equal(await findHashBySessionId('first-session'), null)
})

void test('session id reverse lookup survives started-session metadata updates', async (t) => {
  initializePersistentStorage(null)

  const activityName = 'syncdeck'
  const teacherCode = 'metadata-refresh'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  await updatePersistentSessionUrlState(hash, {
    entryPolicy: 'solo-allowed',
    selectedOptions: { presentationUrl: 'https://slides.example/deck' },
  })

  assert.equal(await findHashBySessionId('live-session'), hash)
})

void test('session id reverse lookup backfills missing reverse index entries for existing started sessions', async (t) => {
  initializePersistentStorage(null)

  const activityName = 'syncdeck'
  const teacherCode = 'backfill-reverse-index'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'legacy-session', { id: 'teacher-ws', readyState: 1, send() {} })
  await clearHashBySessionIdIndex('legacy-session')

  assert.equal(await findHashBySessionId('legacy-session'), hash)
  assert.equal(await findHashBySessionId('legacy-session'), hash)
})

void test('authenticate persists selectedOptions from request body when cookie entry is missing', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const activityName = 'algorithm-demo'
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
        algorithm: 'merge-sort',
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
    algorithm: 'merge-sort',
  })

  const stored = await getPersistentSession(hash)
  assert.deepEqual(stored?.selectedOptions, {
    algorithm: 'merge-sort',
  })
})

void test('authenticate preserves existing selectedOptions from cookie over request body', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const activityName = 'algorithm-demo'
  const teacherCode = 'persistent-teacher-preserve'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await startPersistentSession(hash, 'syncdeck-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const handler = getRoute(app, 'POST', '/api/persistent-session/authenticate')
  const req = createMockReq({
    cookies: {
      persistent_sessions: buildCookieValue(activityName, hash, teacherCode, {
        algorithm: 'binary-search',
      }),
    },
    body: {
      activityName,
      hash,
      teacherCode,
      selectedOptions: {
        algorithm: 'merge-sort',
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
    algorithm: 'binary-search',
  })
})

void test('authenticate ignores selectedOptions from invalid remembered teacher cookies', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const activityName = 'algorithm-demo'
  const teacherCode = 'persistent-teacher-invalid-cookie'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await startPersistentSession(hash, 'syncdeck-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const handler = getRoute(app, 'POST', '/api/persistent-session/authenticate')
  const req = createMockReq({
    cookies: {
      persistent_sessions: buildCookieValue(activityName, hash, 'wrong-teacher-code', {
        algorithm: 'selection-sort',
      }),
    },
    body: {
      activityName,
      hash,
      teacherCode,
      selectedOptions: {
        algorithm: 'merge-sort',
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
    algorithm: 'merge-sort',
  })
})

void test('authenticate validates activity before canonicalizing selectedOptions', async () => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const handler = getRoute(app, 'POST', '/api/persistent-session/authenticate')
  const body: Record<string, unknown> = {
    activityName: 'not-a-real-activity',
    hash: 'deadbeefdeadbeefdead',
    teacherCode: 'teacher-code',
  }

  Object.defineProperty(body, 'selectedOptions', {
    enumerable: true,
    get() {
      throw new Error('[TEST] selectedOptions should not be canonicalized for invalid activity requests')
    },
  })

  const res = createMockRes()
  await handler(createMockReq({ body }), res)

  assert.equal(res.statusCode, 400)
  assert.equal(res.jsonBody?.error, 'Invalid activity name')
})

void test('persistent session metadata route ignores unsigned query params that are not in canonical selectedOptions', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const createHandler = getRoute(app, 'POST', '/api/persistent-session/create')
  const createReq = createMockReq({
    body: {
      activityName: 'algorithm-demo',
      teacherCode: 'canonical-query-test',
      selectedOptions: {
        algorithm: 'merge-sort',
      },
    },
  })
  const createRes = createMockRes()
  await createHandler(createReq, createRes)

  assert.equal(createRes.statusCode, 200, JSON.stringify(createRes.jsonBody))
  const hash = String(createRes.jsonBody?.hash ?? '')
  t.after(async () => cleanupPersistentSession(hash))

  const url = new URL(`https://bits.example${String(createRes.jsonBody?.url ?? '')}`)
  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash')
  const res = createMockRes()
  await handler(createMockReq({
    params: { hash },
    query: {
      activityName: 'algorithm-demo',
      algorithm: 'merge-sort',
      entryPolicy: url.searchParams.get('entryPolicy') ?? '',
      urlHash: url.searchParams.get('urlHash') ?? '',
      utm_source: 'email',
    },
  }), res)

  assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody))
  assert.deepEqual(res.jsonBody?.queryParams, {
    algorithm: 'merge-sort',
  })
})

void test('persistent session metadata route does not expose queryParams when urlHash is missing', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const createHandler = getRoute(app, 'POST', '/api/persistent-session/create')
  const createReq = createMockReq({
    body: {
      activityName: 'algorithm-demo',
      teacherCode: 'unsigned-query-test',
      selectedOptions: {
        algorithm: 'merge-sort',
      },
    },
  })
  const createRes = createMockRes()
  await createHandler(createReq, createRes)

  assert.equal(createRes.statusCode, 200, JSON.stringify(createRes.jsonBody))
  const hash = String(createRes.jsonBody?.hash ?? '')
  t.after(async () => cleanupPersistentSession(hash))

  const handler = getRoute(app, 'GET', '/api/persistent-session/:hash')
  const res = createMockRes()
  await handler(createMockReq({
    params: { hash },
    query: {
      activityName: 'algorithm-demo',
      algorithm: 'merge-sort',
      entryPolicy: 'instructor-required',
      // Intentionally missing urlHash: query params must not be trusted.
      utm_source: 'email',
    },
  }), res)

  assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody))
  assert.deepEqual(res.jsonBody?.queryParams, {})
})

void test('update preserves canonical video-sync sourceUrl across edit and list output', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const createHandler = getRoute(app, 'POST', '/api/persistent-session/create')
  const createReq = createMockReq({
    body: {
      activityName: 'video-sync',
      teacherCode: 'video-sync-edit-code',
      selectedOptions: {
        sourceUrl: 'https://www.youtube.com/watch?v=mCq8-xTH7jA',
      },
    },
  })
  const createRes = createMockRes()

  await createHandler(createReq, createRes)

  assert.equal(createRes.statusCode, 200, JSON.stringify(createRes.jsonBody))
  const hash = String(createRes.jsonBody?.hash ?? '')
  t.after(async () => cleanupPersistentSession(hash))
  const cookie = createRes.cookies.get('persistent_sessions')
  assert.ok(cookie)

  const updateHandler = getRoute(app, 'POST', '/api/persistent-session/update')
  const updateReq = createMockReq({
    cookies: { persistent_sessions: cookie.value },
    body: {
      activityName: 'video-sync',
      hash,
      selectedOptions: {
        sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      },
    },
  })
  const updateRes = createMockRes()

  await updateHandler(updateReq, updateRes)

  assert.equal(updateRes.statusCode, 200, JSON.stringify(updateRes.jsonBody))
  assert.match(String(updateRes.jsonBody?.url ?? ''), /sourceUrl=https%3A%2F%2Fwww\.youtube\.com%2Fwatch%3Fv%3DdQw4w9WgXcQ/)

  const updatedCookie = updateRes.cookies.get('persistent_sessions')
  assert.ok(updatedCookie)

  const listHandler = getRoute(app, 'GET', '/api/persistent-session/list')
  const listReq = createMockReq({
    cookies: { persistent_sessions: updatedCookie.value },
    headers: { host: 'bits.example' },
    protocol: 'https',
  })
  const listRes = createMockRes()

  await listHandler(listReq, listRes)

  assert.equal(listRes.statusCode, 200)
  const sessionsList = Array.isArray(listRes.jsonBody?.sessions) ? listRes.jsonBody.sessions : []
  assert.equal(sessionsList.length, 1)
  assert.deepEqual((sessionsList[0] as Record<string, unknown>).selectedOptions, {
    sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  })
})

void test('update preserves canonical algorithm-demo option across edit and list output', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const createHandler = getRoute(app, 'POST', '/api/persistent-session/create')
  const createReq = createMockReq({
    body: {
      activityName: 'algorithm-demo',
      teacherCode: 'algorithm-edit-code',
      selectedOptions: {
        algorithm: 'merge-sort',
      },
    },
  })
  const createRes = createMockRes()

  await createHandler(createReq, createRes)

  assert.equal(createRes.statusCode, 200, JSON.stringify(createRes.jsonBody))
  const hash = String(createRes.jsonBody?.hash ?? '')
  t.after(async () => cleanupPersistentSession(hash))
  const cookie = createRes.cookies.get('persistent_sessions')
  assert.ok(cookie)

  const updateHandler = getRoute(app, 'POST', '/api/persistent-session/update')
  const updateReq = createMockReq({
    cookies: { persistent_sessions: cookie.value },
    body: {
      activityName: 'algorithm-demo',
      hash,
      selectedOptions: {
        algorithm: 'binary-search',
      },
    },
  })
  const updateRes = createMockRes()

  await updateHandler(updateReq, updateRes)

  assert.equal(updateRes.statusCode, 200, JSON.stringify(updateRes.jsonBody))
  assert.match(String(updateRes.jsonBody?.url ?? ''), /algorithm=binary-search/)

  const updatedCookie = updateRes.cookies.get('persistent_sessions')
  assert.ok(updatedCookie)

  const listHandler = getRoute(app, 'GET', '/api/persistent-session/list')
  const listReq = createMockReq({
    cookies: { persistent_sessions: updatedCookie.value },
    headers: { host: 'bits.example' },
    protocol: 'https',
  })
  const listRes = createMockRes()

  await listHandler(listReq, listRes)

  assert.equal(listRes.statusCode, 200)
  const sessionsList = Array.isArray(listRes.jsonBody?.sessions) ? listRes.jsonBody.sessions : []
  assert.equal(sessionsList.length, 1)
  assert.deepEqual((sessionsList[0] as Record<string, unknown>).selectedOptions, {
    algorithm: 'binary-search',
  })

  const stored = await getPersistentSession(hash)
  assert.deepEqual(stored?.selectedOptions, {
    algorithm: 'binary-search',
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
      activityName: 'java-string-practice',
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
  const activityName = 'java-string-practice'
  const hash = String(createRes.jsonBody?.hash ?? '')
  const url = String(createRes.jsonBody?.url ?? '')
  t.after(async () => cleanupPersistentSession(hash))

  const stored = await getPersistentSession(hash)
  assert.equal(stored?.entryPolicy, 'solo-allowed')
  assert.match(url, new RegExp(`^/activity/${activityName}/${hash}\\?.*entryPolicy=solo-allowed.*urlHash=[a-f0-9]{16}`))

  const cookie = createRes.cookies.get('persistent_sessions')
  assert.ok(cookie)

  await cleanupPersistentSession(hash)

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
  assert.match(String((sessionsList[0] as Record<string, unknown>).fullUrl ?? ''), /entryPolicy=solo-allowed/)
  assert.match(String((sessionsList[0] as Record<string, unknown>).fullUrl ?? ''), /urlHash=[a-f0-9]{16}/)
})

void test('persistent session entry route honors signed query entryPolicy after persistent metadata is missing', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const createHandler = getRoute(app, 'POST', '/api/persistent-session/create')
  const createReq = createMockReq({
    body: {
      activityName: 'java-string-practice',
      teacherCode: 'signed-solo-link',
      entryPolicy: 'solo-allowed',
    },
  })
  const createRes = createMockRes()

  await createHandler(createReq, createRes)

  assert.equal(createRes.statusCode, 200, JSON.stringify(createRes.jsonBody))
  const hash = String(createRes.jsonBody?.hash ?? '')
  const url = new URL(`https://bits.example${String(createRes.jsonBody?.url ?? '')}`)
  t.after(async () => cleanupPersistentSession(hash))

  await cleanupPersistentSession(hash)

  const entryHandler = getRoute(app, 'GET', '/api/persistent-session/:hash/entry')
  const entryReq = createMockReq({
    params: { hash },
    query: {
      activityName: 'java-string-practice',
      entryPolicy: url.searchParams.get('entryPolicy') ?? '',
      urlHash: url.searchParams.get('urlHash') ?? '',
    },
  })
  const entryRes = createMockRes()

  await entryHandler(entryReq, entryRes)

  assert.equal(entryRes.statusCode, 200, JSON.stringify(entryRes.jsonBody))
  assert.equal(entryRes.jsonBody?.entryPolicy, 'solo-allowed')
  assert.equal(entryRes.jsonBody?.entryOutcome, 'continue-solo')
})

void test('update rewrites permalink settings for the same hash and preserves teacher code', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const createHandler = getRoute(app, 'POST', '/api/persistent-session/create')
  const createReq = createMockReq({
    body: {
      activityName: 'java-string-practice',
      teacherCode: 'update-link-code',
      entryPolicy: 'instructor-required',
    },
  })
  const createRes = createMockRes()

  await createHandler(createReq, createRes)

  assert.equal(createRes.statusCode, 200, JSON.stringify(createRes.jsonBody))
  const hash = String(createRes.jsonBody?.hash ?? '')
  t.after(async () => cleanupPersistentSession(hash))
  const cookie = createRes.cookies.get('persistent_sessions')
  assert.ok(cookie)

  const updateHandler = getRoute(app, 'POST', '/api/persistent-session/update')
  const updateReq = createMockReq({
    cookies: { persistent_sessions: cookie.value },
    body: {
      activityName: 'java-string-practice',
      hash,
      entryPolicy: 'solo-allowed',
    },
  })
  const updateRes = createMockRes()

  await updateHandler(updateReq, updateRes)

  assert.equal(updateRes.statusCode, 200, JSON.stringify(updateRes.jsonBody))
  assert.equal(updateRes.jsonBody?.hash, hash)
  assert.match(String(updateRes.jsonBody?.url ?? ''), /entryPolicy=solo-allowed/)
  assert.match(String(updateRes.jsonBody?.url ?? ''), /urlHash=[a-f0-9]{16}/)

  const updatedCookie = updateRes.cookies.get('persistent_sessions')
  assert.ok(updatedCookie)

  const listHandler = getRoute(app, 'GET', '/api/persistent-session/list')
  const listReq = createMockReq({
    cookies: { persistent_sessions: updatedCookie.value },
    headers: { host: 'bits.example' },
    protocol: 'https',
  })
  const listRes = createMockRes()
  await listHandler(listReq, listRes)

  assert.equal(listRes.statusCode, 200)
  const sessionsList = Array.isArray(listRes.jsonBody?.sessions) ? listRes.jsonBody.sessions : []
  assert.equal(sessionsList.length, 1)
  assert.equal((sessionsList[0] as Record<string, unknown>).entryPolicy, 'solo-allowed')
  assert.equal((sessionsList[0] as Record<string, unknown>).teacherCode, 'update-link-code')
})

void test('update preserves existing selectedOptions when request omits selectedOptions', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const createHandler = getRoute(app, 'POST', '/api/persistent-session/create')
  const createReq = createMockReq({
    body: {
      activityName: 'algorithm-demo',
      teacherCode: 'preserve-options-code',
      entryPolicy: 'instructor-required',
      selectedOptions: {
        algorithm: 'merge-sort',
      },
    },
  })
  const createRes = createMockRes()

  await createHandler(createReq, createRes)

  assert.equal(createRes.statusCode, 200, JSON.stringify(createRes.jsonBody))
  const hash = String(createRes.jsonBody?.hash ?? '')
  t.after(async () => cleanupPersistentSession(hash))
  const cookie = createRes.cookies.get('persistent_sessions')
  assert.ok(cookie)

  const updateHandler = getRoute(app, 'POST', '/api/persistent-session/update')
  const updateReq = createMockReq({
    cookies: { persistent_sessions: cookie.value },
    body: {
      activityName: 'algorithm-demo',
      hash,
      entryPolicy: 'solo-allowed',
    },
  })
  const updateRes = createMockRes()

  await updateHandler(updateReq, updateRes)

  assert.equal(updateRes.statusCode, 200, JSON.stringify(updateRes.jsonBody))
  assert.match(String(updateRes.jsonBody?.url ?? ''), /algorithm=merge-sort/)
  assert.match(String(updateRes.jsonBody?.url ?? ''), /entryPolicy=solo-allowed/)

  const updatedCookie = updateRes.cookies.get('persistent_sessions')
  assert.ok(updatedCookie)
  const parsedCookie = JSON.parse(updatedCookie.value) as Array<{ key?: string; selectedOptions?: Record<string, unknown> }>
  const entry = parsedCookie.find((candidate) => candidate.key === `algorithm-demo:${hash}`)
  assert.deepEqual(entry?.selectedOptions, {
    algorithm: 'merge-sort',
  })
})

void test('remove drops a saved permalink from the teacher cookie list', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })

  const createHandler = getRoute(app, 'POST', '/api/persistent-session/create')
  const createReq = createMockReq({
    body: {
      activityName: 'java-string-practice',
      teacherCode: 'remove-link-code',
      entryPolicy: 'solo-allowed',
    },
  })
  const createRes = createMockRes()

  await createHandler(createReq, createRes)

  assert.equal(createRes.statusCode, 200, JSON.stringify(createRes.jsonBody))
  const hash = String(createRes.jsonBody?.hash ?? '')
  t.after(async () => cleanupPersistentSession(hash))
  const cookie = createRes.cookies.get('persistent_sessions')
  assert.ok(cookie)

  const removeHandler = getRoute(app, 'POST', '/api/persistent-session/remove')
  const removeReq = createMockReq({
    cookies: { persistent_sessions: cookie.value },
    body: {
      activityName: 'java-string-practice',
      hash,
    },
  })
  const removeRes = createMockRes()

  await removeHandler(removeReq, removeRes)

  assert.equal(removeRes.statusCode, 200, JSON.stringify(removeRes.jsonBody))
  assert.deepEqual(removeRes.jsonBody, { success: true })

  const updatedCookie = removeRes.cookies.get('persistent_sessions')
  assert.ok(updatedCookie)

  const listHandler = getRoute(app, 'GET', '/api/persistent-session/list')
  const listReq = createMockReq({
    cookies: { persistent_sessions: updatedCookie.value },
    headers: { host: 'bits.example' },
    protocol: 'https',
  })
  const listRes = createMockRes()
  await listHandler(listReq, listRes)

  assert.equal(listRes.statusCode, 200)
  assert.deepEqual(listRes.jsonBody, { sessions: [] })
})

void test('getOrCreateActivePersistentSession updates stored entry policy when an existing permalink is reused', async (t) => {
  initializePersistentStorage(null)

  const activityName = 'gallery-walk'
  const teacherCode = 'reused-policy-code'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'instructor-required')
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')

  const stored = await getPersistentSession(hash)
  assert.equal(stored?.entryPolicy, 'solo-allowed')
})

void test('persistent session list omits remembered teacherCode when the cookie entry no longer validates', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const listHandler = getRoute(app, 'GET', '/api/persistent-session/list')

  const activityName = 'gallery-walk'
  const teacherCode = 'actual-list-code'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)

  const listRes = createMockRes()
  await listHandler(createMockReq({
    cookies: {
      persistent_sessions: buildCookieValue(activityName, hash, 'wrong-list-code'),
    },
    headers: {
      host: 'bits.example',
    },
    protocol: 'https',
  }), listRes)

  assert.equal(listRes.statusCode, 200)
  const sessionsList = Array.isArray(listRes.jsonBody?.sessions) ? listRes.jsonBody.sessions : []
  assert.equal(sessionsList.length, 1)
  assert.equal((sessionsList[0] as Record<string, unknown>).teacherCode, undefined)
  assert.equal((sessionsList[0] as Record<string, unknown>).entryPolicy, 'instructor-required')
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
  const query = buildPersistentLinkUrlQuery({
    hash,
    entryPolicy: 'solo-only',
    selectedOptions: {},
  })

  const handler = getRoute(app, 'POST', '/api/persistent-session/authenticate')
  const req = createMockReq({
    body: {
      activityName,
      hash,
      teacherCode,
      entryPolicy: query.get('entryPolicy') ?? '',
      urlHash: query.get('urlHash') ?? '',
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

void test('session teacher authenticate restores teacher cookie from active session id', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  sessionMap.set('live-session', { id: 'live-session', type: activityName })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await updatePersistentSessionUrlState(hash, {
    entryPolicy: 'solo-allowed',
    selectedOptions: { presentationUrl: 'https://slides.example/deck' },
  })
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const req = createMockReq({
    params: { sessionId: 'live-session' },
    body: { teacherCode },
  })
  const res = createMockRes()
  await handler(req, res)

  assert.equal(res.statusCode, 200, JSON.stringify(res.jsonBody))
  assert.deepEqual(res.jsonBody, {
    success: true,
    activityName,
    sessionId: 'live-session',
  })
  assert.equal(res.headers['cache-control'], 'no-store')

  const cookie = res.cookies.get('persistent_sessions')
  assert.ok(cookie)
  const parsed = JSON.parse(cookie?.value ?? '[]') as Array<Record<string, unknown>>
  const teacherJoinEntry = parsed.find((entry) => entry.key === `${activityName}:${hash}`)
  assert.deepEqual(teacherJoinEntry, {
    key: `${activityName}:${hash}`,
    teacherCode,
    selectedOptions: { presentationUrl: 'https://slides.example/deck' },
    entryPolicy: 'solo-allowed',
    urlHash: buildPersistentLinkUrlQuery({
      hash,
      entryPolicy: 'solo-allowed',
      selectedOptions: { presentationUrl: 'https://slides.example/deck' },
    }).get('urlHash'),
  })
})

void test('session teacher authenticate rejects invalid teacher code', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  sessionMap.set('live-session', { id: 'live-session', type: activityName })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'instructor-required')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const req = createMockReq({
    params: { sessionId: 'live-session' },
    body: { teacherCode: 'wrong-code' },
  })
  const res = createMockRes()
  await handler(req, res)

  assert.equal(res.statusCode, 401)
  assert.deepEqual(res.jsonBody, { error: 'Invalid teacher code' })
  assert.equal(res.cookies.has('persistent_sessions'), false)
})

void test('session teacher authenticate rejects active session activity mismatch', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  sessionMap.set('live-session', { id: 'live-session', type: 'gallery-walk' })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  const req = createMockReq({
    params: { sessionId: 'live-session' },
    body: { teacherCode },
  })
  const res = createMockRes()
  await handler(req, res)

  assert.equal(res.statusCode, 404)
  assert.deepEqual(res.jsonBody, { error: 'Teacher join is unavailable for this session' })
  assert.equal(res.cookies.has('persistent_sessions'), false)
})

void test('session teacher authenticate rate limits repeated invalid attempts per client and session', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  sessionMap.set('live-session', { id: 'live-session', type: activityName })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const req = createMockReq({
      params: { sessionId: 'live-session' },
      body: { teacherCode: 'wrong-code' },
      ip: '203.0.113.9',
    })
    const res = createMockRes()
    await handler(req, res)

    assert.equal(res.statusCode, 401)
    assert.deepEqual(res.jsonBody, { error: 'Invalid teacher code' })
  }

  const blockedReq = createMockReq({
    params: { sessionId: 'live-session' },
    body: { teacherCode: 'wrong-code' },
    ip: '203.0.113.9',
  })
  const blockedRes = createMockRes()
  await handler(blockedReq, blockedRes)

  assert.equal(blockedRes.statusCode, 429)
  assert.deepEqual(blockedRes.jsonBody, { error: 'Too many attempts. Please wait a minute.' })
  assert.equal(blockedRes.cookies.has('persistent_sessions'), false)
})

void test('session teacher authenticate rate limiting ignores spoofed forwarded headers when req.ip is present', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  sessionMap.set('live-session', { id: 'live-session', type: activityName })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const req = createMockReq({
      params: { sessionId: 'live-session' },
      body: { teacherCode: 'wrong-code' },
      ip: '203.0.113.9',
      headers: { 'x-forwarded-for': `198.51.100.${attempt}` },
    })
    const res = createMockRes()
    await handler(req, res)
    assert.equal(res.statusCode, 401)
  }

  const blockedReq = createMockReq({
    params: { sessionId: 'live-session' },
    body: { teacherCode: 'wrong-code' },
    ip: '203.0.113.9',
    headers: { 'x-forwarded-for': '198.51.100.200' },
  })
  const blockedRes = createMockRes()
  await handler(blockedReq, blockedRes)

  assert.equal(blockedRes.statusCode, 429)
  assert.deepEqual(blockedRes.jsonBody, { error: 'Too many attempts. Please wait a minute.' })
})

void test('session teacher authenticate rate limits by socket remote address when req.ip is unavailable', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()
  const sessionMap = new Map<string, unknown>()
  const sessions = { get: async (id: string) => sessionMap.get(id) ?? null }
  const app = createMockApp()
  registerPersistentSessionRoutes({ app, sessions })
  const handler = getRoute(app, 'POST', '/api/session/:sessionId/teacher-authenticate')

  const activityName = 'syncdeck'
  const teacherCode = 'teacher-secret'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  sessionMap.set('live-session', { id: 'live-session', type: activityName })
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'solo-allowed')
  await startPersistentSession(hash, 'live-session', { id: 'teacher-ws', readyState: 1, send() {} })

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const req = createMockReq({
      params: { sessionId: 'live-session' },
      body: { teacherCode: 'wrong-code' },
      remoteAddress: '203.0.113.10',
    })
    const res = createMockRes()
    await handler(req, res)
    assert.equal(res.statusCode, 401)
  }

  const blockedReq = createMockReq({
    params: { sessionId: 'live-session' },
    body: { teacherCode: 'wrong-code' },
    remoteAddress: '203.0.113.10',
  })
  const blockedRes = createMockRes()
  await handler(blockedReq, blockedRes)

  assert.equal(blockedRes.statusCode, 429)
  assert.deepEqual(blockedRes.jsonBody, { error: 'Too many attempts. Please wait a minute.' })
})
