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
  assert.equal(res.jsonBody?.isStarted, true)
  assert.equal(res.jsonBody?.sessionId, 'live-session')
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
