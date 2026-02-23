import type { SessionRecord, SessionStore } from 'activebits-server/core/sessions.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import type { ActiveBitsWebSocket, WsConnectionHandler, WsRouter } from '../../../types/websocket.js'
import setupSyncDeckRoutes from './routes.js'

interface RouteRequest {
  params: Record<string, string | undefined>
  body?: unknown
}

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): void
}

type RouteHandler = (req: RouteRequest, res: JsonResponse) => Promise<void> | void

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
  const handlers: { post: Record<string, RouteHandler> } = {
    post: {},
  }

  return {
    handlers,
    post(path: string, handler: RouteHandler) {
      handlers.post[path] = handler
    },
  }
}

function createMockWs() {
  const registered: Record<string, WsConnectionHandler> = {}

  const ws: WsRouter & { registered: Record<string, WsConnectionHandler> } = {
    registered,
    wss: {
      clients: new Set<ActiveBitsWebSocket>(),
      close() {},
    },
    register(path: string, handler: WsConnectionHandler) {
      registered[path] = handler
    },
  }

  return ws
}

function createRequest(params: Record<string, string>, body: unknown): RouteRequest {
  return { params, body }
}

function createSessionStore(initial: Record<string, SessionRecord>) {
  const store = { ...initial }
  const sessions: SessionStore = {
    async get(id: string) {
      return store[id] ?? null
    },
    async set(id: string, session: SessionRecord) {
      store[id] = session
    },
    async delete(id: string) {
      const existed = Boolean(store[id])
      delete store[id]
      return existed
    },
    async touch(id: string) {
      const existing = store[id]
      if (!existing) return false
      existing.lastActivity = Date.now()
      return true
    },
    async getAll() {
      return Object.values(store)
    },
    async getAllIds() {
      return Object.keys(store)
    },
    cleanup() {},
    async close() {},
    subscribeToBroadcast() {},
  }

  return {
    store,
    sessions,
  }
}

function createSyncDeckSession(id: string, instructorPasscode = 'passcode-1'): SessionRecord {
  return {
    id,
    type: 'syncdeck',
    created: Date.now(),
    lastActivity: Date.now(),
    data: {
      presentationUrl: null,
      instructorPasscode,
      instructorState: null,
      students: [],
      embeddedActivities: [],
    },
  }
}

void test('setupSyncDeckRoutes registers syncdeck websocket namespace', () => {
  const app = createMockApp()
  const ws = createMockWs()
  const { sessions } = createSessionStore({})

  setupSyncDeckRoutes(app, sessions, ws)

  assert.equal(typeof ws.registered['/ws/syncdeck'], 'function')
})

void test('create route initializes syncdeck session state', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({})
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/create']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(createRequest({}, {}), res)

  assert.equal(res.statusCode, 200)
  const body = res.body as { id?: string; instructorPasscode?: string }
  assert.equal(typeof body.id, 'string')
  assert.equal(typeof body.instructorPasscode, 'string')
  assert.equal(body.instructorPasscode?.length, 32)
})

void test('configure route sets presentation url for valid passcode', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-pass'),
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/configure']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      { presentationUrl: 'https://example.com/deck', instructorPasscode: 'teacher-pass' },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { ok: true })
  const updated = storeState.store.s1?.data as Record<string, unknown>
  assert.equal(updated.presentationUrl, 'https://example.com/deck')
})

void test('configure route rejects invalid passcode', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-pass'),
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/configure']
  const res = createResponse()

  await handler?.(
    createRequest(
      { sessionId: 's1' },
      { presentationUrl: 'https://example.com/deck', instructorPasscode: 'wrong-pass' },
    ),
    res,
  )

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, { error: 'invalid payload' })
})
