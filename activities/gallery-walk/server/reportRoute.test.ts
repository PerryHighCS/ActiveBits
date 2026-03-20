import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionRecord, SessionStore } from 'activebits-server/core/sessions.js'
import type { ActiveBitsWebSocket, WsConnectionHandler, WsRouter } from '../../../types/websocket.js'
import setupGalleryWalkRoutes from './routes.js'

interface RouteRequest {
  params: Record<string, string | undefined>
  body?: unknown
}

interface MockResponse {
  statusCode: number
  body: unknown
  headers: Record<string, string>
  status(code: number): MockResponse
  json(payload: unknown): MockResponse
  send(payload: string): MockResponse
  setHeader(name: string, value: string): void
}

type RouteHandler = (req: RouteRequest, res: MockResponse) => Promise<void> | void

function createMockResponse(): MockResponse {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
    send(payload: string) {
      this.body = payload
      return this
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value
    },
  }
}

function createMockApp() {
  const handlers: { get: Record<string, RouteHandler>; post: Record<string, RouteHandler> } = {
    get: {},
    post: {},
  }

  return {
    handlers,
    get(path: string, handler: RouteHandler) {
      handlers.get[path] = handler
    },
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

function createSessionStore(initial: Record<string, SessionRecord>): SessionStore {
  const store = { ...initial }
  return {
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
    async touch() {
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
}

function createGalleryWalkSession(id: string): SessionRecord {
  return {
    id,
    type: 'gallery-walk',
    created: Date.now(),
    lastActivity: Date.now(),
    data: {
      stage: 'review',
      config: { title: 'Critique Day' },
      reviewees: {
        studentA: { name: 'Avery', projectTitle: 'Bridge Design' },
      },
      reviewers: {
        reviewer1: { name: 'Jordan' },
      },
      feedback: [
        {
          id: 'fb-1',
          to: 'studentA',
          from: 'reviewer1',
          fromNameSnapshot: 'Jordan',
          message: 'Great use of examples.',
          createdAt: Date.now(),
          styleId: 'yellow',
        },
      ],
      stats: {
        reviewees: { studentA: 1 },
        reviewers: { reviewer1: 1 },
      },
    },
  }
}

void test('gallery-walk report route returns downloadable self-contained HTML', async () => {
  const app = createMockApp()
  setupGalleryWalkRoutes(app, createSessionStore({ gw1: createGalleryWalkSession('gw1') }), createMockWs())

  const handler = app.handlers.get['/api/gallery-walk/:sessionId/report']
  const res = createMockResponse()
  await handler?.({ params: { sessionId: 'gw1' } }, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8')
  assert.match(res.headers['Content-Disposition'] ?? '', /attachment; filename="critique-day\.html"/)
  assert.equal(typeof res.body, 'string')
  assert.match(String(res.body), /Whole Class/)
  assert.match(String(res.body), /Per Student/)
  assert.match(String(res.body), /Great use of examples\./)
})

void test('gallery-walk report-data route returns structured report section payload', async () => {
  const app = createMockApp()
  setupGalleryWalkRoutes(app, createSessionStore({
    gw1: {
      ...createGalleryWalkSession('gw1'),
      data: {
        ...createGalleryWalkSession('gw1').data,
        embeddedLaunch: {
          parentSessionId: 'parent-1',
          instanceKey: 'gallery-walk:4:0',
          selectedOptions: {},
        },
      },
    },
  }), createMockWs())

  const handler = app.handlers.get['/api/gallery-walk/:sessionId/report-data']
  const res = createMockResponse()
  await handler?.({ params: { sessionId: 'gw1' } }, res)

  assert.equal(res.statusCode, 200)
  assert.equal((res.body as { activityId?: string }).activityId, 'gallery-walk')
  assert.equal((res.body as { instanceKey?: string }).instanceKey, 'gallery-walk:4:0')
  assert.deepEqual((res.body as { supportsScopes?: string[] }).supportsScopes, [
    'activity-session',
    'student-cross-activity',
    'session-summary',
  ])
})
