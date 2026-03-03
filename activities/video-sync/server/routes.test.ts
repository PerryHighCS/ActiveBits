import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cleanupPersistentSession,
  generatePersistentHash,
  getOrCreateActivePersistentSession,
  initializePersistentStorage,
  startPersistentSession,
} from 'activebits-server/core/persistentSessions.js'
import type { SessionRecord } from 'activebits-server/core/sessions.js'
import type { WsRouter } from '../../../types/websocket.js'
import setupVideoSyncRoutes from './routes.js'

type RouteHandler = (
  req: { params: Record<string, string>; body?: unknown; cookies?: Record<string, unknown> },
  res: MockResponse,
) => Promise<void> | void

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

function createMockSocket() {
  const sent: string[] = []
  const handlers: Record<string, Array<() => void>> = {
    close: [],
    error: [],
  }
  let closed: { code?: number; reason?: string } | null = null

  return {
    sent,
    get closed() {
      return closed
    },
    emit(event: 'close' | 'error') {
      const listeners = handlers[event]
      if (!listeners) {
        throw new Error(`Unknown mock socket event: ${event}`)
      }
      for (const listener of listeners) {
        listener()
      }
    },
    socket: {
      readyState: 1,
      sessionId: null,
      videoSyncRole: null,
      on(event: 'close' | 'error', handler: () => void) {
        const listeners = handlers[event]
        if (!listeners) {
          throw new Error(`Unknown mock socket event: ${event}`)
        }
        listeners.push(handler)
      },
      send(payload: string) {
        sent.push(payload)
      },
      close(code?: number, reason?: string) {
        closed = { code, reason }
      },
    },
  }
}

function createSocketRecorder(sessionId: string) {
  const delivered: string[] = []

  return {
    socket: {
      readyState: 1,
      sessionId,
      send(payload: string) {
        delivered.push(payload)
      },
    },
    delivered,
  }
}

function createSessionStore(initial: Record<string, SessionRecord>) {
  const store = { ...initial }
  const published: Array<{ channel: string; message: Record<string, unknown> }> = []
  const subscriptions: string[] = []

  return {
    store,
    published,
    subscriptions,
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
      subscribeToBroadcast(channel: string) {
        subscriptions.push(channel)
      },
    },
  }
}

function createVideoSyncSession(id: string, instructorPasscode = 'teacher-pass'): SessionRecord {
  return {
    id,
    type: 'video-sync',
    created: Date.now(),
    lastActivity: Date.now(),
    data: {
      instructorPasscode,
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
        sync: { unsyncedStudents: 0, lastDriftSec: null, lastCorrectionResult: 'none' },
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
  const createdBody = res.body as { id?: string; instructorPasscode?: string }
  const createdId = createdBody.id
  assert.equal(typeof createdId, 'string')
  assert.ok(createdId)
  assert.equal(typeof createdBody.instructorPasscode, 'string')
  assert.equal(createdBody.instructorPasscode?.length, 32)

  const created = storeState.store[createdId as string]
  assert.equal(created?.type, 'video-sync')
  const createdData = created?.data as Record<string, unknown>
  assert.equal(createdData.instructorPasscode, createdBody.instructorPasscode)
  const state = createdData.state as Record<string, unknown>
  assert.equal(state.provider, 'youtube')
  assert.equal(state.videoId, '')
})

void test('session get route redacts instructor-only fields from public payload', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1', 'secret-passcode') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.get['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const payload = res.body as {
    id?: string
    type?: string
    data?: Record<string, unknown>
  }
  assert.equal(payload.id, 's1')
  assert.equal(payload.type, 'video-sync')
  assert.ok(payload.data)
  assert.equal(typeof payload.data?.state, 'object')
  assert.equal(typeof payload.data?.telemetry, 'object')
  assert.equal('instructorPasscode' in (payload.data ?? {}), false)
})

void test('session get route normalizes oversized persisted telemetry.error fields', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const session = createVideoSyncSession('s1')
  ;(session.data as { telemetry: { error: { code: string; message: string } } }).telemetry.error = {
    code: `  ${'C'.repeat(90)}  `,
    message: `  ${'M'.repeat(300)}  `,
  }
  const storeState = createSessionStore({ s1: session })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.get['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const payload = res.body as {
    data?: {
      telemetry?: {
        error?: {
          code?: string | null
          message?: string | null
        }
      }
    }
  }
  assert.equal(payload.data?.telemetry?.error?.code, 'C'.repeat(64))
  assert.equal(payload.data?.telemetry?.error?.message, 'M'.repeat(256))

  const persisted = storeState.store.s1?.data as {
    telemetry?: {
      error?: {
        code?: string | null
        message?: string | null
      }
    }
  }
  assert.equal(persisted.telemetry?.error?.code, 'C'.repeat(64))
  assert.equal(persisted.telemetry?.error?.message, 'M'.repeat(256))
})

void test('session get route clears malformed persisted video ids during normalization', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const session = createVideoSyncSession('s1')
  ;(session.data as { state: { videoId: string; startSec: number; positionSec: number } }).state.videoId = 'bad-id'
  ;(session.data as { state: { videoId: string; startSec: number; positionSec: number } }).state.startSec = 12
  ;(session.data as { state: { videoId: string; startSec: number; positionSec: number } }).state.positionSec = 18
  const storeState = createSessionStore({ s1: session })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.get['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const payload = res.body as {
    data?: {
      state?: {
        videoId?: string
      }
    }
  }
  assert.equal(payload.data?.state?.videoId, '')

  const persisted = storeState.store.s1?.data as {
    state?: {
      videoId?: string
    }
  }
  assert.equal(persisted.state?.videoId, '')
})

void test('session patch returns invalid source url for unsupported non-YouTube host', async () => {
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
      body: { sourceUrl: 'https://vimeo.com/1234', instructorPasscode: 'teacher-pass' },
    },
    res,
  )

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, {
    error: 'INVALID_SOURCE_URL',
    message: 'Only youtube.com/watch and youtu.be URLs are supported in v1.',
  })
})

void test('session patch returns invalid source url for malformed url input', async () => {
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
      body: { sourceUrl: 'not a url', instructorPasscode: 'teacher-pass' },
    },
    res,
  )

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, {
    error: 'INVALID_SOURCE_URL',
    message: 'Only youtube.com/watch and youtu.be URLs are supported in v1.',
  })
})

void test('session patch returns invalid video id for YouTube url without a usable id', async () => {
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
      body: { sourceUrl: 'https://www.youtube.com/watch?list=abc123', instructorPasscode: 'teacher-pass' },
    },
    res,
  )

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, {
    error: 'INVALID_VIDEO_ID',
    message: 'Could not determine a valid YouTube video id from sourceUrl.',
  })
})

void test('session patch accepts youtu.be urls with extra path segments by using only the first segment', async () => {
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
      body: { sourceUrl: 'https://youtu.be/dQw4w9WgXcQ/extra-segment?t=45', instructorPasscode: 'teacher-pass' },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const updated = storeState.store.s1?.data as Record<string, unknown>
  const state = updated.state as Record<string, unknown>
  assert.equal(state.videoId, 'dQw4w9WgXcQ')
  assert.equal(state.startSec, 45)
})

void test('session patch returns invalid video id for malformed youtu.be ids', async () => {
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
      body: { sourceUrl: 'https://youtu.be/dQw4w9WgX$Q', instructorPasscode: 'teacher-pass' },
    },
    res,
  )

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, {
    error: 'INVALID_VIDEO_ID',
    message: 'Could not determine a valid YouTube video id from sourceUrl.',
  })
})

void test('session patch returns invalid time range when stop time is before parsed start time', async () => {
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
      body: { sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43', stopSec: 20, instructorPasscode: 'teacher-pass' },
    },
    res,
  )

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, {
    error: 'INVALID_TIME_RANGE',
    message: 'stopSec must be greater than startSec and both must be >= 0.',
  })
})

void test('session patch returns invalid stopSec when stopSec is not numeric', async () => {
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
      body: { sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43', stopSec: '120', instructorPasscode: 'teacher-pass' },
    },
    res,
  )

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, {
    error: 'INVALID_STOP_SEC',
    message: 'stopSec must be a finite number of seconds or omitted.',
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
      body: { sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43', stopSec: 120, instructorPasscode: 'teacher-pass' },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const patchResponse = res.body as { success?: boolean; data?: Record<string, unknown> }
  assert.equal(patchResponse.success, true)
  assert.equal('instructorPasscode' in (patchResponse.data ?? {}), false)

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

void test('session patch ignores partially numeric timestamp query values', async () => {
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
      body: { sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=83abc', instructorPasscode: 'teacher-pass' },
    },
    res,
  )

  assert.equal(res.statusCode, 200)

  const updated = storeState.store.s1?.data as Record<string, unknown>
  const state = updated.state as Record<string, unknown>
  assert.equal(state.startSec, 0)
  assert.equal(state.positionSec, 0)
})

void test('session patch falls back to valid t param when start param is malformed', async () => {
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
      body: { sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?start=oops&t=1m23s', instructorPasscode: 'teacher-pass' },
    },
    res,
  )

  assert.equal(res.statusCode, 200)

  const updated = storeState.store.s1?.data as Record<string, unknown>
  const state = updated.state as Record<string, unknown>
  assert.equal(state.startSec, 83)
  assert.equal(state.positionSec, 83)
})

void test('session patch rejects reconfiguration after a video is already set', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const session = createVideoSyncSession('s1')
  ;(session.data as { state: { videoId: string; startSec: number; stopSec: number | null } }).state.videoId = 'existing123'
  ;(session.data as { state: { videoId: string; startSec: number; stopSec: number | null } }).state.startSec = 15
  ;(session.data as { state: { videoId: string; startSec: number; stopSec: number | null } }).state.stopSec = 45
  const storeState = createSessionStore({ s1: session })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.patch['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43', stopSec: 120, instructorPasscode: 'teacher-pass' },
    },
    res,
  )

  assert.equal(res.statusCode, 409)
  assert.deepEqual(res.body, {
    error: 'CONFIG_LOCKED',
    message: 'Video source is already configured for this session.',
  })
})

void test('session patch publishes through broadcast channel without direct local websocket send when pubsub is available', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })
  const recorder = createSocketRecorder('s1')
  ws.wss.clients.add(recorder.socket)

  setupVideoSyncRoutes(app, storeState.sessions, ws as unknown as WsRouter)

  const handler = app.handlers.patch['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43', stopSec: 120, instructorPasscode: 'teacher-pass' },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.equal(storeState.published.length, 1)
  assert.deepEqual(recorder.delivered, [])
})

void test('session patch falls back to direct local websocket send when pubsub publish is unavailable', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })
  const recorder = createSocketRecorder('s1')
  ws.wss.clients.add(recorder.socket)

  const sessionsWithoutPublish = {
    get: storeState.sessions.get,
    set: storeState.sessions.set,
    subscribeToBroadcast: storeState.sessions.subscribeToBroadcast,
  }

  setupVideoSyncRoutes(app, sessionsWithoutPublish, ws as unknown as WsRouter)

  const handler = app.handlers.patch['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43', stopSec: 120, instructorPasscode: 'teacher-pass' },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.equal(storeState.published.length, 0)
  assert.equal(recorder.delivered.length, 1)
  const payload = JSON.parse(recorder.delivered[0] ?? '{}') as { type?: unknown; sessionId?: unknown }
  assert.equal(payload.type, 'state-update')
  assert.equal(payload.sessionId, 's1')
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
      body: { type: 'play', instructorPasscode: 'teacher-pass' },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const commandResponse = res.body as { success?: boolean; data?: Record<string, unknown> }
  assert.equal(commandResponse.success, true)
  assert.equal('instructorPasscode' in (commandResponse.data ?? {}), false)

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

void test('session patch rejects requests without a valid instructor passcode', async () => {
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
      body: { sourceUrl: 'https://youtu.be/dQw4w9WgXcQ' },
    },
    res,
  )

  assert.equal(res.statusCode, 403)
  assert.deepEqual(res.body, {
    error: 'FORBIDDEN',
    message: 'Valid instructorPasscode is required',
  })
})

void test('command route rejects requests without a valid instructor passcode', async () => {
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

  assert.equal(res.statusCode, 403)
  assert.deepEqual(res.body, {
    error: 'FORBIDDEN',
    message: 'Valid instructorPasscode is required',
  })
})

void test('instructor-passcode route returns passcode for persistent teacher cookie', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1', 'teacher-passcode-1') })
  const teacherCode = 'persistent-teacher-code'
  const { hash, hashedTeacherCode } = generatePersistentHash('video-sync', teacherCode)
  await getOrCreateActivePersistentSession('video-sync', hash, hashedTeacherCode)
  await startPersistentSession(hash, 's1', {
    id: 'teacher-ws',
    readyState: 1,
    send() {},
  })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.get['/api/video-sync/:sessionId/instructor-passcode']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      cookies: {
        persistent_sessions: JSON.stringify([
          {
            key: `video-sync:${hash}`,
            teacherCode,
          },
        ]),
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { instructorPasscode: 'teacher-passcode-1' })
  await cleanupPersistentSession(hash)
})

void test('manager websocket rejects connections without a valid instructor passcode', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws as unknown as WsRouter)

  const handler = ws.registered['/ws/video-sync']
  assert.equal(typeof handler, 'function')

  const recorder = createMockSocket()
  handler?.(recorder.socket, new URLSearchParams({
    sessionId: 's1',
    role: 'manager',
  }))

  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(recorder.closed, { code: 1008, reason: 'Forbidden' })
  assert.deepEqual(recorder.sent, [])
})

void test('manager websocket accepts connections with a valid instructor passcode', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1', 'teacher-pass') })

  setupVideoSyncRoutes(app, storeState.sessions, ws as unknown as WsRouter)

  const handler = ws.registered['/ws/video-sync']
  assert.equal(typeof handler, 'function')

  const recorder = createMockSocket()
  handler?.(recorder.socket, new URLSearchParams({
    sessionId: 's1',
    role: 'manager',
    instructorPasscode: 'teacher-pass',
  }))

  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(recorder.closed, null)
  assert.equal(recorder.sent.length, 1)
  const payload = JSON.parse(recorder.sent[0] ?? '{}') as { type?: string; payload?: { role?: string } }
  assert.equal(payload.type, 'state-snapshot')
  assert.equal(payload.payload?.role, 'manager')
  recorder.emit('close')
  await new Promise((resolve) => setTimeout(resolve, 0))
})

void test('websocket cleanup runs only once when error is followed by close', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws as unknown as WsRouter)

  const handler = ws.registered['/ws/video-sync']
  assert.equal(typeof handler, 'function')

  const recorder = createMockSocket()
  handler?.(recorder.socket, new URLSearchParams({
    sessionId: 's1',
    role: 'student',
  }))

  await new Promise((resolve) => setTimeout(resolve, 0))

  const initialPublishedCount = storeState.published.length
  const initialSetData = storeState.store.s1?.data as {
    telemetry: {
      connections: { activeCount: number }
    }
  }
  assert.equal(initialSetData.telemetry.connections.activeCount, 1)

  recorder.emit('error')
  recorder.emit('close')
  await new Promise((resolve) => setTimeout(resolve, 0))

  const finalData = storeState.store.s1?.data as {
    telemetry: {
      connections: { activeCount: number }
    }
  }
  assert.equal(finalData.telemetry.connections.activeCount, 0)
  assert.equal(storeState.published.length, initialPublishedCount + 1)

  const disconnectEnvelope = storeState.published.at(-1)?.message as {
    type?: string
    payload?: {
      reason?: string
      telemetry?: {
        connections?: { activeCount?: number }
      }
    }
  }
  assert.equal(disconnectEnvelope.type, 'telemetry-update')
  assert.equal(disconnectEnvelope.payload?.reason, 'connection-change')
  assert.equal(disconnectEnvelope.payload?.telemetry?.connections?.activeCount, 0)
})

void test('invalid websocket session is rejected before subscription side effects are created', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({})

  setupVideoSyncRoutes(app, storeState.sessions, ws as unknown as WsRouter)

  const handler = ws.registered['/ws/video-sync']
  assert.equal(typeof handler, 'function')

  const recorder = createMockSocket()
  handler?.(recorder.socket, new URLSearchParams({
    sessionId: 'missing-session',
    role: 'student',
  }))

  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(storeState.subscriptions, [])
  assert.equal(storeState.published.length, 0)
  assert.equal(recorder.sent.length, 1)
  const payload = JSON.parse(recorder.sent[0] ?? '{}') as { type?: string; payload?: { code?: string } }
  assert.equal(payload.type, 'error')
  assert.equal(payload.payload?.code, 'NOT_FOUND')
  assert.deepEqual(recorder.closed, { code: 1008, reason: 'Session not found' })
})

void test('invalid websocket session still closes when sending the not-found envelope throws', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({})

  setupVideoSyncRoutes(app, storeState.sessions, ws as unknown as WsRouter)

  const handler = ws.registered['/ws/video-sync']
  assert.equal(typeof handler, 'function')

  const recorder = createMockSocket()
  recorder.socket.send = () => {
    throw new Error('[TEST] simulated socket send failure')
  }

  handler?.(recorder.socket, new URLSearchParams({
    sessionId: 'missing-session',
    role: 'student',
  }))

  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(recorder.closed, { code: 1008, reason: 'Session not found' })
})

void test('heartbeat stops and closes subscribers when the backing session disappears', async () => {
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  const heartbeatState: { callback: (() => void) | null } = { callback: null }
  const clearedTimers: unknown[] = []
  const timerToken = { id: 'heartbeat-token' }

  globalThis.setInterval = (((callback: TimerHandler) => {
    heartbeatState.callback = callback as () => void
    return timerToken as unknown as ReturnType<typeof setInterval>
  }) as unknown) as typeof setInterval
  globalThis.clearInterval = (((timer: ReturnType<typeof setInterval> | undefined) => {
    clearedTimers.push(timer)
  }) as unknown) as typeof clearInterval

  try {
    const app = createMockApp()
    const ws = createMockWs()
    const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

    setupVideoSyncRoutes(app, storeState.sessions, ws as unknown as WsRouter)

    const handler = ws.registered['/ws/video-sync']
    assert.equal(typeof handler, 'function')

    const recorder = createMockSocket()
    handler?.(recorder.socket, new URLSearchParams({
      sessionId: 's1',
      role: 'student',
    }))

    await new Promise((resolve) => setTimeout(resolve, 0))
    const runHeartbeat = heartbeatState.callback
    assert.equal(typeof runHeartbeat, 'function')
    assert.equal(recorder.closed, null)

    delete storeState.store.s1
    if (runHeartbeat == null) {
      throw new Error('Expected heartbeat callback to be registered')
    }
    runHeartbeat()
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.deepEqual(recorder.closed, { code: 1008, reason: 'Session not found' })
    assert.deepEqual(clearedTimers, [timerToken])
  } finally {
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
  }
})

void test('heartbeat skips overlapping ticks while a previous tick is still in flight', async () => {
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  const heartbeatState: { callback: (() => void) | null } = { callback: null }
  const timerToken = { id: 'heartbeat-token-overlap' }

  globalThis.setInterval = (((callback: TimerHandler) => {
    heartbeatState.callback = callback as () => void
    return timerToken as unknown as ReturnType<typeof setInterval>
  }) as unknown) as typeof setInterval
  globalThis.clearInterval = (((_timer: ReturnType<typeof setInterval> | undefined) => {
    // no-op for this test
  }) as unknown) as typeof clearInterval

  try {
    const app = createMockApp()
    const ws = createMockWs()
    const session = createVideoSyncSession('s1')
    const storeState = createSessionStore({ s1: session })

    const slowSetState: { resolve: (() => void) | null } = { resolve: null }
    let setCalls = 0
    const initialPublishedCount = () => storeState.published.length
    const sessionsWithSlowSet = {
      ...storeState.sessions,
      async set(id: string, updatedSession: SessionRecord) {
        setCalls += 1
        if (setCalls === 1) {
          return storeState.sessions.set(id, updatedSession)
        }
        await new Promise<void>((resolve) => {
          slowSetState.resolve = resolve
        })
        return storeState.sessions.set(id, updatedSession)
      },
    }

    setupVideoSyncRoutes(app, sessionsWithSlowSet, ws as unknown as WsRouter)

    const handler = ws.registered['/ws/video-sync']
    assert.equal(typeof handler, 'function')

    const recorder = createMockSocket()
    handler?.(recorder.socket, new URLSearchParams({
      sessionId: 's1',
      role: 'student',
    }))

    await new Promise((resolve) => setTimeout(resolve, 0))
    const runHeartbeat = heartbeatState.callback
    assert.equal(typeof runHeartbeat, 'function')
    if (runHeartbeat == null) {
      throw new Error('Expected heartbeat callback to be registered')
    }

    const publishedBeforeHeartbeat = initialPublishedCount()
    runHeartbeat()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(setCalls, 2)

    runHeartbeat()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(setCalls, 2)

    const releaseHeartbeatSet = slowSetState.resolve
    if (releaseHeartbeatSet == null) {
      throw new Error('Expected stalled heartbeat set() to register a resolver')
    }
    releaseHeartbeatSet()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(storeState.published.length, publishedBeforeHeartbeat + 1)
  } finally {
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
  }
})

void test('event route tracks current unsynced student count', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/video-sync/:sessionId/event']
  assert.equal(typeof handler, 'function')

  const unsyncResponse = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { type: 'unsync', studentId: 'student-a', driftSec: 1.2 },
    },
    unsyncResponse,
  )

  assert.equal(unsyncResponse.statusCode, 200)
  const unsyncTelemetry = (unsyncResponse.body as { telemetry: { sync: { unsyncedStudents: number } } }).telemetry
  assert.equal(unsyncTelemetry.sync.unsyncedStudents, 1)

  const correctionResponse = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { type: 'sync-correction', studentId: 'student-a', correctionResult: 'success' },
    },
    correctionResponse,
  )

  assert.equal(correctionResponse.statusCode, 200)
  const correctionTelemetry = (correctionResponse.body as { telemetry: { sync: { unsyncedStudents: number } } }).telemetry
  assert.equal(correctionTelemetry.sync.unsyncedStudents, 0)
})

void test('event route prunes stale unsynced students without a follow-up heartbeat or session read', async () => {
  const originalDateNow = Date.now
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const timerState: { callback: (() => void) | null } = { callback: null }
  const timerToken = { id: 'unsync-prune-token' }
  let nowMs = 1_000

  Date.now = () => nowMs
  globalThis.setTimeout = (((callback: TimerHandler) => {
    timerState.callback = callback as () => void
    return timerToken as unknown as ReturnType<typeof setTimeout>
  }) as unknown) as typeof setTimeout
  globalThis.clearTimeout = (((_timer: ReturnType<typeof setTimeout> | undefined) => {
    // no-op for this test
  }) as unknown) as typeof clearTimeout

  try {
    const app = createMockApp()
    const ws = createMockWs() as unknown as WsRouter
    const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

    setupVideoSyncRoutes(app, storeState.sessions, ws)

    const handler = app.handlers.post['/api/video-sync/:sessionId/event']
    assert.equal(typeof handler, 'function')

    const unsyncResponse = createResponse()
    await handler?.(
      {
        params: { sessionId: 's1' },
        body: { type: 'unsync', studentId: 'student-a', driftSec: 1.2 },
      },
      unsyncResponse,
    )

    assert.equal(unsyncResponse.statusCode, 200)
    assert.equal((unsyncResponse.body as { telemetry: { sync: { unsyncedStudents: number } } }).telemetry.sync.unsyncedStudents, 1)
    assert.equal(typeof timerState.callback, 'function')

    nowMs += 20_001
    timerState.callback?.()
    await new Promise((resolve) => originalSetTimeout(resolve, 0))

    const persisted = storeState.store.s1?.data as {
      telemetry?: {
        sync?: {
          unsyncedStudents?: number
        }
      }
    }
    assert.equal(persisted.telemetry?.sync?.unsyncedStudents, 0)
  } finally {
    Date.now = originalDateNow
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
  }
})

void test('event route caps distinct unsynced student ids per session', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/video-sync/:sessionId/event']
  assert.equal(typeof handler, 'function')

  let lastResponse = createResponse()
  for (let index = 0; index < 205; index += 1) {
    lastResponse = createResponse()
    await handler?.(
      {
        params: { sessionId: 's1' },
        body: { type: 'unsync', studentId: `student-${index}`, driftSec: 0.5 },
      },
      lastResponse,
    )
    assert.equal(lastResponse.statusCode, 200)
  }

  const telemetry = (lastResponse.body as { telemetry: { sync: { unsyncedStudents: number } } }).telemetry
  assert.equal(telemetry.sync.unsyncedStudents, 200)
})

void test('event route ignores telemetry.error writes outside load-failure events', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/video-sync/:sessionId/event']
  assert.equal(typeof handler, 'function')

  const response = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: {
        type: 'unsync',
        studentId: 'student-a',
        errorCode: 'PLAYER_BROKEN',
        errorMessage: 'student should not be able to overwrite persisted error state',
      },
    },
    response,
  )

  assert.equal(response.statusCode, 200)
  const telemetry = (response.body as { telemetry: { error: { code: string | null; message: string | null } } }).telemetry
  assert.deepEqual(telemetry.error, { code: null, message: null })
})

void test('event route clamps load-failure telemetry.error fields before persisting', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/video-sync/:sessionId/event']
  assert.equal(typeof handler, 'function')

  const longCode = `  ${'C'.repeat(80)}  `
  const longMessage = `  ${'M'.repeat(300)}  `

  const response = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: {
        type: 'load-failure',
        errorCode: longCode,
        errorMessage: longMessage,
      },
    },
    response,
  )

  assert.equal(response.statusCode, 200)
  const telemetry = (response.body as { telemetry: { error: { code: string | null; message: string | null } } }).telemetry
  assert.equal(telemetry.error.code, 'C'.repeat(64))
  assert.equal(telemetry.error.message, 'M'.repeat(256))
})
