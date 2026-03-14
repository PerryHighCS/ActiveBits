import test from 'node:test'
import assert from 'node:assert/strict'
import { initializeActivityRegistry } from './activities/activityRegistry.js'
import { setupSessionRoutes, type SessionRecord } from './core/sessions.js'

interface MockResponse {
  statusCode: number
  jsonBody: Record<string, unknown> | null
  status(code: number): MockResponse
  json(payload: Record<string, unknown>): void
}

type MockRequest = { params: Record<string, string>; body?: Record<string, unknown> }
type RouteHandler = (req: MockRequest, res: MockResponse) => void | Promise<void>

function createMockApp(): {
  get: (path: string, handler: RouteHandler) => void
  post: (path: string, handler: RouteHandler) => void
  delete: (path: string, handler: RouteHandler) => void
  routes: { get: Map<string, RouteHandler>; post: Map<string, RouteHandler>; delete: Map<string, RouteHandler> }
} {
  const routes = {
    get: new Map<string, RouteHandler>(),
    post: new Map<string, RouteHandler>(),
    delete: new Map<string, RouteHandler>(),
  }
  return {
    get(path: string, handler: RouteHandler) {
      routes.get.set(path, handler)
    },
    post(path: string, handler: RouteHandler) {
      routes.post.set(path, handler)
    },
    delete(path: string, handler: RouteHandler) {
      routes.delete.set(path, handler)
    },
    routes,
  }
}

function createMockResponse(): MockResponse {
  return {
    statusCode: 200,
    jsonBody: null,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: Record<string, unknown>) {
      this.jsonBody = payload
    },
  }
}

function getRoute(app: ReturnType<typeof createMockApp>, method: 'get' | 'post', path: string): RouteHandler {
  const handler = app.routes[method].get(path)
  if (!handler) {
    throw new Error(`Route ${method.toUpperCase()} ${path} not registered`)
  }
  return handler
}

function createSessionRecord(id: string, type: string): SessionRecord {
  return {
    id,
    type,
    created: Date.now(),
    lastActivity: Date.now(),
    data: {},
  }
}

void test('session entry route returns render-ui for activities with waiting-room fields', async () => {
  await initializeActivityRegistry()
  const sessions = {
    get: async (id: string) => id === 'session-1' ? createSessionRecord(id, 'java-string-practice') : null,
    set: async () => {},
    delete: async () => true,
    touch: async () => true,
    getAll: async () => [],
    getAllIds: async () => [],
    cleanup: () => {},
    close: async () => {},
  }
  const app = createMockApp()
  setupSessionRoutes(app as unknown as Parameters<typeof setupSessionRoutes>[0], sessions)

  const res = createMockResponse()
  await getRoute(app, 'get', '/api/session/:sessionId/entry')({ params: { sessionId: 'session-1' } }, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    sessionId: 'session-1',
    activityName: 'java-string-practice',
    waitingRoomFieldCount: 1,
    resolvedRole: 'student',
    entryOutcome: 'join-live',
    presentationMode: 'render-ui',
  })
})

void test('session entry route returns pass-through for activities without waiting-room fields', async () => {
  await initializeActivityRegistry()
  const sessions = {
    get: async (id: string) => id === 'session-2' ? createSessionRecord(id, 'raffle') : null,
    set: async () => {},
    delete: async () => true,
    touch: async () => true,
    getAll: async () => [],
    getAllIds: async () => [],
    cleanup: () => {},
    close: async () => {},
  }
  const app = createMockApp()
  setupSessionRoutes(app as unknown as Parameters<typeof setupSessionRoutes>[0], sessions)

  const res = createMockResponse()
  await getRoute(app, 'get', '/api/session/:sessionId/entry')({ params: { sessionId: 'session-2' } }, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    sessionId: 'session-2',
    activityName: 'raffle',
    waitingRoomFieldCount: 0,
    resolvedRole: 'student',
    entryOutcome: 'join-live',
    presentationMode: 'pass-through',
  })
})

void test('session entry route returns 404 for missing sessions', async () => {
  await initializeActivityRegistry()
  const sessions = {
    get: async () => null,
    set: async () => {},
    delete: async () => true,
    touch: async () => true,
    getAll: async () => [],
    getAllIds: async () => [],
    cleanup: () => {},
    close: async () => {},
  }
  const app = createMockApp()
  setupSessionRoutes(app as unknown as Parameters<typeof setupSessionRoutes>[0], sessions)

  const res = createMockResponse()
  await getRoute(app, 'get', '/api/session/:sessionId/entry')({ params: { sessionId: 'missing' } }, res)

  assert.equal(res.statusCode, 404)
  assert.deepEqual(res.jsonBody, { error: 'invalid session' })
})

void test('session entry participant routes store and consume waiting-room values by token', async () => {
  await initializeActivityRegistry()
  const session = createSessionRecord('session-3', 'java-string-practice')
  const sessionMap = new Map<string, SessionRecord>([['session-3', session]])
  const sessions = {
    get: async (id: string) => sessionMap.get(id) ?? null,
    set: async (id: string, nextSession: SessionRecord) => {
      sessionMap.set(id, nextSession)
    },
    delete: async () => true,
    touch: async () => true,
    getAll: async () => [],
    getAllIds: async () => [],
    cleanup: () => {},
    close: async () => {},
  }
  const app = createMockApp()
  setupSessionRoutes(app as unknown as Parameters<typeof setupSessionRoutes>[0], sessions)

  const storeRes = createMockResponse()
  await getRoute(app, 'post', '/api/session/:sessionId/entry-participant')({
    params: { sessionId: 'session-3' },
    body: {
      values: {
        displayName: 'Ada',
        ignored: () => 'x',
      },
    },
  }, storeRes)

  assert.equal(storeRes.statusCode, 200)
  const token = typeof storeRes.jsonBody?.entryParticipantToken === 'string' ? storeRes.jsonBody.entryParticipantToken : null
  assert.equal(typeof token, 'string')
  assert.deepEqual(storeRes.jsonBody?.values, { displayName: 'Ada' })

  const consumeRes = createMockResponse()
  await getRoute(app, 'get', '/api/session/:sessionId/entry-participant/:token')({
    params: { sessionId: 'session-3', token: token as string },
  }, consumeRes)

  assert.equal(consumeRes.statusCode, 200)
  assert.deepEqual(consumeRes.jsonBody, { values: { displayName: 'Ada' } })

  const missingRes = createMockResponse()
  await getRoute(app, 'get', '/api/session/:sessionId/entry-participant/:token')({
    params: { sessionId: 'session-3', token: token as string },
  }, missingRes)

  assert.equal(missingRes.statusCode, 404)
  assert.deepEqual(missingRes.jsonBody, { error: 'entry participant not found' })
})
