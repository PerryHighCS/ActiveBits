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

type RouteHandler = (req: { params: { sessionId: string } }, res: MockResponse) => void | Promise<void>

function createMockApp(): {
  get: (path: string, handler: RouteHandler) => void
  delete: (path: string, handler: RouteHandler) => void
  routes: { get: Map<string, RouteHandler>; delete: Map<string, RouteHandler> }
} {
  const routes = { get: new Map<string, RouteHandler>(), delete: new Map<string, RouteHandler>() }
  return {
    get(path: string, handler: RouteHandler) {
      routes.get.set(path, handler)
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

function getRoute(app: ReturnType<typeof createMockApp>, path: string): RouteHandler {
  const handler = app.routes.get.get(path)
  if (!handler) {
    throw new Error(`Route GET ${path} not registered`)
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
  setupSessionRoutes(app, sessions)

  const res = createMockResponse()
  await getRoute(app, '/api/session/:sessionId/entry')({ params: { sessionId: 'session-1' } }, res)

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
  setupSessionRoutes(app, sessions)

  const res = createMockResponse()
  await getRoute(app, '/api/session/:sessionId/entry')({ params: { sessionId: 'session-2' } }, res)

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
  setupSessionRoutes(app, sessions)

  const res = createMockResponse()
  await getRoute(app, '/api/session/:sessionId/entry')({ params: { sessionId: 'missing' } }, res)

  assert.equal(res.statusCode, 404)
  assert.deepEqual(res.jsonBody, { error: 'invalid session' })
})
