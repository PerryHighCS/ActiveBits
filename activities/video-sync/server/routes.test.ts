import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionRecord } from 'activebits-server/core/sessions.js'
import type { WsRouter } from '../../../types/websocket.js'
import setupVideoSyncRoutes from './routes.js'

type RouteHandler = (req: { params: Record<string, string>; body?: unknown }, res: MockResponse) => Promise<void> | void

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
  const handlers: {
    post: Record<string, RouteHandler>
    get: Record<string, RouteHandler>
    patch: Record<string, RouteHandler>
  } = {
    post: {},
    get: {},
    patch: {},
  }

  return {
    handlers,
    post(path: string, handler: RouteHandler) {
      handlers.post[path] = handler
    },
    get(path: string, handler: RouteHandler) {
      handlers.get[path] = handler
    },
    patch(path: string, handler: RouteHandler) {
      handlers.patch[path] = handler
    },
  }
}

function createMockWs() {
  const sockets = new Set<{ readyState: number; sessionId?: string | null; send(payload: string): void }>()
  const registered: Record<string, (socket: unknown, query: URLSearchParams) => void> = {}

  return {
    registered,
    wss: {
      clients: sockets,
      close(_callback?: () => void) {},
    },
    register(path: string, handler: (socket: unknown, query: URLSearchParams) => void) {
      registered[path] = handler
    },
  }
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

function createVideoSyncSession(id: string): SessionRecord {
  return {
    id,
    type: 'video-sync',
    created: Date.now(),
    lastActivity: Date.now(),
    data: {
      state: {
        provider: 'youtube',
        videoId: '',
        startSec: 0,
        stopSec: null,
        positionSec: 0,
        isPlaying: false,
        playbackRate: 1,
        updatedBy: 'system',
        serverTimestampMs: Date.now(),
      },
      telemetry: {
        connections: { activeCount: 0 },
        autoplay: { blockedCount: 0 },
        sync: { unsyncEvents: 0, lastDriftSec: null, lastCorrectionResult: 'none' },
        error: { code: null, message: null },
      },
    },
  }
}

void test('create route initializes video-sync session', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({})

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/video-sync/create']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.({ params: {} }, res)

  assert.equal(res.statusCode, 200)
  const createdId = (res.body as { id?: string }).id
  assert.equal(typeof createdId, 'string')
  assert.ok(createdId)

  const created = storeState.store[createdId as string]
  assert.equal(created?.type, 'video-sync')
  const createdData = created?.data as Record<string, unknown>
  const state = createdData.state as Record<string, unknown>
  assert.equal(state.provider, 'youtube')
  assert.equal(state.videoId, '')
})

void test('session patch rejects unsupported url', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.patch['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { sourceUrl: 'https://vimeo.com/1234' },
    },
    res,
  )

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, {
    error: 'INVALID_VIDEO_ID',
    message: 'Could not determine a valid YouTube video id from sourceUrl.',
  })
})

void test('session patch normalizes youtube source and publishes extensible envelope', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.patch['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43', stopSec: 120 },
    },
    res,
  )

  assert.equal(res.statusCode, 200)

  const updated = storeState.store.s1?.data as Record<string, unknown>
  const state = updated.state as Record<string, unknown>
  assert.equal(state.videoId, 'dQw4w9WgXcQ')
  assert.equal(state.startSec, 43)
  assert.equal(state.stopSec, 120)

  assert.equal(storeState.published.length, 1)
  assert.equal(storeState.published[0]?.channel, 'session:s1:broadcast')

  const message = storeState.published[0]?.message as Record<string, unknown>
  assert.equal(message.activity, 'video-sync')
  assert.equal(message.sessionId, 's1')
  assert.equal(message.type, 'state-update')
  assert.equal(typeof message.timestamp, 'number')
  assert.equal(message.version, '1')
  assert.equal(typeof message.payload, 'object')
})

void test('command route updates playback and emits extensible envelope', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/video-sync/:sessionId/command']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { type: 'play' },
    },
    res,
  )

  assert.equal(res.statusCode, 200)

  const updated = storeState.store.s1?.data as Record<string, unknown>
  const state = updated.state as Record<string, unknown>
  assert.equal(state.isPlaying, true)
  assert.equal(state.updatedBy, 'manager')

  assert.equal(storeState.published.length, 1)
  const message = storeState.published[0]?.message as Record<string, unknown>
  assert.equal(message.activity, 'video-sync')
  assert.equal(message.sessionId, 's1')
  assert.equal(message.type, 'state-update')
})
