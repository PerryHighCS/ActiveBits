import test from 'node:test'
import assert from 'node:assert/strict'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'
import type {
  JsonResponse,
  RouteRequest,
  TravelingSalesmanRouteApp,
  TravelingSalesmanSessionStore,
} from '../travelingSalesmanTypes.js'
import type { SessionRecord } from 'activebits-server/core/sessions.js'
import setupTravelingSalesmanRoutes from './routes'
import { isCitiesArray, isDistanceMatrix, isRouteArray } from './validation'

type RouteHandler = (req: RouteRequest, res: JsonResponse) => Promise<void> | void

interface MockApp extends TravelingSalesmanRouteApp {
  handlers: {
    post: Record<string, RouteHandler>
    get: Record<string, RouteHandler>
  }
}

interface MockResponse extends JsonResponse {
  statusCode: number
  body: unknown
}

interface MockSocket extends ActiveBitsWebSocket {
  studentId?: string | null
  ignoreDisconnect?: boolean
}

function createMockApp(): MockApp {
  const handlers: MockApp['handlers'] = { post: {}, get: {} }

  return {
    handlers,
    post(path: string, handler: RouteHandler) {
      handlers.post[path] = handler
    },
    get(path: string, handler: RouteHandler) {
      handlers.get[path] = handler
    },
  }
}

function createMockSessions(store: Record<string, SessionRecord>): TravelingSalesmanSessionStore {
  return {
    async get(id: string) {
      return store[id] ?? null
    },
    async set(id: string, session: SessionRecord) {
      store[id] = session
    },
  }
}

function createMockWs(): WsRouter {
  const sockets = new Set<MockSocket>()

  return {
    wss: {
      clients: sockets,
      close() {},
    },
    register() {},
  }
}

function createRes(): MockResponse {
  return {
    statusCode: 200,
    body: null,
    status(code: number): MockResponse {
      this.statusCode = code
      return this
    },
    json(payload: unknown): MockResponse {
      this.body = payload
      return this
    },
  }
}

function setup() {
  const store: Record<string, SessionRecord> = {
    s1: {
      id: 's1',
      type: 'traveling-salesman',
      created: Date.now(),
      lastActivity: Date.now(),
      data: {
        problem: { numCities: 2 },
        students: [],
        algorithms: { bruteForce: {}, heuristic: {} },
        instructor: null,
        broadcasts: [],
      },
    },
  }
  const app = createMockApp()
  const sessions = createMockSessions(store)
  const ws = createMockWs()
  setupTravelingSalesmanRoutes(app, sessions, ws)
  return { app, sessions, store }
}

void test('set-problem rejects invalid cities payload', async () => {
  const { app } = setup()
  const handler = app.handlers.post['/api/traveling-salesman/:sessionId/set-problem']
  if (!handler) throw new Error('missing set-problem handler')

  const req: RouteRequest = {
    params: { sessionId: 's1' },
    body: { cities: 'bad', distanceMatrix: [], seed: 123 },
  }
  const res = createRes()
  await handler(req, res)
  assert.equal(res.statusCode, 400)
})

void test('submit-route rejects missing student', async () => {
  const { app } = setup()
  const handler = app.handlers.post['/api/traveling-salesman/:sessionId/submit-route']
  if (!handler) throw new Error('missing submit-route handler')

  const req: RouteRequest = {
    params: { sessionId: 's1' },
    body: { studentId: 'missing', route: ['city-0'], distance: 0, timeToComplete: 0 },
  }
  const res = createRes()
  await handler(req, res)
  assert.equal(res.statusCode, 404)
})

void test('submit-route accepts timeToComplete=0', async () => {
  const { app, store } = setup()
  ;((store.s1?.data as Record<string, unknown>).problem as { numCities: number }).numCities = 1
  ;((store.s1?.data as Record<string, unknown>).students as Array<Record<string, unknown>>).push({
    id: 'student-1',
    name: 'Tester',
    currentRoute: [],
    routeDistance: 0,
    complete: false,
  })
  const handler = app.handlers.post['/api/traveling-salesman/:sessionId/submit-route']
  if (!handler) throw new Error('missing submit-route handler')

  const req: RouteRequest = {
    params: { sessionId: 's1' },
    body: { studentId: 'student-1', route: ['city-0'], distance: 0, timeToComplete: 0 },
  }
  const res = createRes()
  await handler(req, res)
  assert.equal(res.statusCode, 200)
  const students = (store.s1?.data as Record<string, unknown>).students as Array<Record<string, unknown>>
  assert.equal(students[0]?.timeToComplete, 0)
})

void test('update-instructor-route rejects invalid timeToComplete', async () => {
  const { app } = setup()
  const handler = app.handlers.post['/api/traveling-salesman/:sessionId/update-instructor-route']
  if (!handler) throw new Error('missing update-instructor-route handler')

  const req: RouteRequest = {
    params: { sessionId: 's1' },
    body: { route: ['city-0'], distance: 1, complete: true, timeToComplete: 'nope' },
  }
  const res = createRes()
  await handler(req, res)
  assert.equal(res.statusCode, 400)
})

void test('validation helpers accept valid inputs', () => {
  assert.equal(isRouteArray(['city-0', 'city-1']), true)
  assert.equal(isCitiesArray([{ id: 'city-0', name: 'A', x: 1, y: 2 }]), true)
  assert.equal(isDistanceMatrix(
    [
      [0, 1],
      [1, 0],
    ],
    2,
  ), true)
})

void test('validation helpers reject invalid inputs', () => {
  assert.equal(isRouteArray(['city-0', 2]), false)
  assert.equal(isCitiesArray([{ id: 'city-0', name: 'A', x: 'bad', y: 2 }]), false)
  assert.equal(isDistanceMatrix([[0, 1]], 2), false)
})
