import test from 'node:test'
import assert from 'node:assert/strict'
import type { Request, Response } from 'express'
import type { SessionRecord } from 'activebits-server/core/sessions.js'
import setupAlgorithmDemoRoutes from './routes'

type RouteHandler = (req: Request, res: Response) => Promise<void>
type MockSocket = { readyState: number; sessionId?: string | null; send: (payload: string) => void }

interface MockResponse {
  statusCode: number
  body: unknown
  status(code: number): MockResponse
  json(payload: unknown): MockResponse
}

function createResponse(): MockResponse {
  return {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
  }
}

function createMockApp() {
  const handlers: { post: Record<string, RouteHandler>; get: Record<string, RouteHandler> } = {
    post: {},
    get: {},
  }

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

function createMockWs() {
  const sockets = new Set<MockSocket>()
  const registered: Record<string, (socket: MockSocket, qp: URLSearchParams) => void> = {}

  return {
    registered,
    wss: { clients: sockets },
    register(path: string, handler: (socket: MockSocket, qp: URLSearchParams) => void) {
      registered[path] = handler
    },
  }
}

function createRequest(params: Record<string, string>, body: unknown): Request {
  return { params, body } as unknown as Request
}

function createSessionStore(initial: Record<string, SessionRecord>) {
  const store = { ...initial }
  const published: Array<{ channel: string; message: Record<string, unknown> }> = []

  return {
    store,
    published,
    sessions: {
      async get(id: string) {
        return store[id] ?? null
      },
      async set(id: string, session: SessionRecord) {
        store[id] = session
      },
      async publishBroadcast(channel: string, message: Record<string, unknown>) {
        published.push({ channel, message })
      },
      subscribeToBroadcast() {},
    },
  }
}

function createAlgorithmDemoSession(id: string): SessionRecord {
  return {
    id,
    type: 'algorithm-demo',
    created: Date.now(),
    lastActivity: Date.now(),
    data: {
      algorithmId: null,
      algorithmState: {},
      history: [],
    },
  }
}

void test('setupAlgorithmDemoRoutes registers algorithm-demo websocket namespace', () => {
  const app = createMockApp()
  const ws = createMockWs()
  const { sessions } = createSessionStore({})

  setupAlgorithmDemoRoutes(app, sessions, ws)

  assert.equal(typeof ws.registered['/ws/algorithm-demo'], 'function')
})

void test('create route initializes algorithm-demo session state', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({})
  setupAlgorithmDemoRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/algorithm-demo/create']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(createRequest({}, {}), res as unknown as Response)

  assert.equal(res.statusCode, 200)
  const createdId = (res.body as { id?: string }).id
  assert.equal(typeof createdId, 'string')
  assert.ok(createdId)
  const created = storeState.store[createdId as string]
  assert.equal(created?.type, 'algorithm-demo')
  const data = (created?.data ?? {}) as Record<string, unknown>
  assert.equal(data.algorithmId, null)
  assert.deepEqual(data.algorithmState, {})
  assert.deepEqual(data.history, [])
})

void test('select route updates session and publishes broadcast payload', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createAlgorithmDemoSession('s1'),
  })
  setupAlgorithmDemoRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/algorithm-demo/:sessionId/select']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest({ sessionId: 's1' }, {
      algorithmId: 'linear-search',
      algorithmState: { step: 1 },
    }),
    res as unknown as Response,
  )

  assert.equal(res.statusCode, 200)
  const updatedData = storeState.store.s1?.data as Record<string, unknown>
  assert.equal(updatedData.algorithmId, 'linear-search')
  assert.deepEqual(updatedData.algorithmState, { step: 1 })
  const history = (updatedData.history ?? []) as Array<Record<string, unknown>>
  assert.equal(history.length, 1)
  assert.equal(history[0]?.action, 'algorithm-selected')
  assert.equal(storeState.published.length, 1)
  assert.equal(storeState.published[0]?.channel, 'session:s1:broadcast')
  assert.equal(storeState.published[0]?.message.type, 'algorithm-selected')
})

void test('select route returns 404 for missing session', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({})
  setupAlgorithmDemoRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/algorithm-demo/:sessionId/select']
  const res = createResponse()

  await handler?.(
    createRequest({ sessionId: 'missing' }, {
      algorithmId: 'linear-search',
      algorithmState: { step: 1 },
    }),
    res as unknown as Response,
  )

  assert.equal(res.statusCode, 404)
  assert.deepEqual(res.body, { error: 'Session not found' })
})

void test('select route normalizes array algorithmState payload to object', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createAlgorithmDemoSession('s1'),
  })
  setupAlgorithmDemoRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/algorithm-demo/:sessionId/select']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest({ sessionId: 's1' }, {
      algorithmId: 'linear-search',
      algorithmState: [1, 2, 3],
    }),
    res as unknown as Response,
  )

  assert.equal(res.statusCode, 200)
  const updatedData = storeState.store.s1?.data as Record<string, unknown>
  assert.deepEqual(updatedData.algorithmState, {})
  assert.equal(storeState.published.length, 1)
  assert.deepEqual(storeState.published[0]?.message.payload, {})
})

void test('select route remains successful when publishBroadcast throws', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createAlgorithmDemoSession('s1'),
  })
  storeState.sessions.publishBroadcast = async () => {
    throw new Error('pubsub down')
  }
  setupAlgorithmDemoRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/algorithm-demo/:sessionId/select']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest({ sessionId: 's1' }, {
      algorithmId: 'binary-search',
      algorithmState: { step: 2 },
    }),
    res as unknown as Response,
  )

  assert.equal(res.statusCode, 200)
  const updatedData = storeState.store.s1?.data as Record<string, unknown>
  assert.equal(updatedData.algorithmId, 'binary-search')
  assert.deepEqual(updatedData.algorithmState, { step: 2 })
})
