import type { SessionRecord, SessionStore } from 'activebits-server/core/sessions.js'
import {
  generatePersistentHash,
  getOrCreateActivePersistentSession,
  initializePersistentStorage,
  startPersistentSession,
} from 'activebits-server/core/persistentSessions.js'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import type { ActiveBitsWebSocket, WsConnectionHandler, WsRouter } from '../../../types/websocket.js'
import setupSyncDeckRoutes from './routes.js'

const HMAC_SECRET = process.env.PERSISTENT_SESSION_SECRET || 'default-secret-change-in-production'

interface RouteRequest {
  params: Record<string, string | undefined>
  body?: unknown
  cookies?: Record<string, unknown>
}

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): void
}

type RouteHandler = (req: RouteRequest, res: JsonResponse) => Promise<void> | void

interface MockResponse {
  statusCode: number
  body: unknown
  cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>
  status(code: number): MockResponse
  json(payload: unknown): MockResponse
  cookie(name: string, value: string, options: Record<string, unknown>): MockResponse
}

function createResponse(): MockResponse {
  return {
    statusCode: 200,
    body: null,
    cookies: [],
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
    cookie(name: string, value: string, options: Record<string, unknown>) {
      this.cookies.push({ name, value, options })
      return this
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

function createRequest(
  params: Record<string, string>,
  body: unknown,
  cookies: Record<string, unknown> = {},
): RouteRequest {
  return { params, body, cookies }
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

function computeUrlHash(persistentHash: string, presentationUrl: string): string {
  return createHmac('sha256', HMAC_SECRET).update(`${persistentHash}|${presentationUrl}`).digest('hex').substring(0, 16)
}

void test('setupSyncDeckRoutes registers syncdeck websocket namespace', () => {
  const app = createMockApp()
  const ws = createMockWs()
  const { sessions } = createSessionStore({})

  setupSyncDeckRoutes(app, sessions, ws)

  assert.equal(typeof ws.registered['/ws/syncdeck'], 'function')
})

void test('generate-url returns signed syncdeck persistent link and sets cookie', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({})
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/generate-url']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest({}, {
      activityName: 'syncdeck',
      teacherCode: 'teacher-123',
      selectedOptions: {
        presentationUrl: 'https://slides.example.com/deck',
      },
    }),
    res,
  )

  assert.equal(res.statusCode, 200)
  const payload = res.body as { hash?: string; url?: string }
  assert.equal(typeof payload.hash, 'string')
  assert.equal(typeof payload.url, 'string')
  assert.match(payload.url ?? '', /^\/activity\/syncdeck\/[a-f0-9]{20}\?presentationUrl=.*&urlHash=[a-f0-9]{16}$/)

  assert.equal(res.cookies.length, 1)
  assert.equal(res.cookies[0]?.name, 'persistent_sessions')
  const cookiePayload = JSON.parse(res.cookies[0]?.value || '[]') as Array<Record<string, unknown>>
  assert.equal(cookiePayload.length, 1)
  assert.match(String(cookiePayload[0]?.key ?? ''), /^syncdeck:[a-f0-9]{20}$/)
})

void test('generate-url rejects invalid presentationUrl', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({})
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/generate-url']
  const res = createResponse()

  await handler?.(
    createRequest({}, {
      activityName: 'syncdeck',
      teacherCode: 'teacher-123',
      selectedOptions: {
        presentationUrl: 'javascript:alert(1)',
      },
    }),
    res,
  )

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, { error: 'presentationUrl must be a valid http(s) URL' })
})

void test('instructor-passcode route returns passcode when teacher cookie matches persistent mapping', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-passcode-1'),
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const { hash, hashedTeacherCode } = generatePersistentHash('syncdeck', 'persistent-teacher-code')
  await getOrCreateActivePersistentSession('syncdeck', hash, hashedTeacherCode)
  await startPersistentSession(hash, 's1', {
    id: 'teacher-ws',
    readyState: 1,
    send() {},
  })

  const handler = app.handlers.get['/api/syncdeck/:sessionId/instructor-passcode']
  const res = createResponse()

  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {},
      {
        persistent_sessions: JSON.stringify([
          {
            key: `syncdeck:${hash}`,
            teacherCode: 'persistent-teacher-code',
          },
        ]),
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { instructorPasscode: 'teacher-passcode-1' })
})

void test('instructor-passcode route rejects request without matching teacher cookie', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-passcode-1'),
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const { hash, hashedTeacherCode } = generatePersistentHash('syncdeck', 'persistent-teacher-code')
  await getOrCreateActivePersistentSession('syncdeck', hash, hashedTeacherCode)
  await startPersistentSession(hash, 's1', {
    id: 'teacher-ws',
    readyState: 1,
    send() {},
  })

  const handler = app.handlers.get['/api/syncdeck/:sessionId/instructor-passcode']
  const res = createResponse()

  await handler?.(createRequest({ sessionId: 's1' }, {}, {}), res)

  assert.equal(res.statusCode, 403)
  assert.deepEqual(res.body, { error: 'forbidden' })
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

void test('configure route accepts urlHash when session has persistent mapping', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-pass'),
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const { hash, hashedTeacherCode } = generatePersistentHash('syncdeck', 'persistent-teacher-code')
  await getOrCreateActivePersistentSession('syncdeck', hash, hashedTeacherCode)
  await startPersistentSession(hash, 's1', {
    id: 'teacher-ws',
    readyState: 1,
    send() {},
  })

  const presentationUrl = 'https://slides.example.com/deck'
  const urlHash = computeUrlHash(hash, presentationUrl)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/configure']
  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {
        presentationUrl,
        instructorPasscode: 'teacher-pass',
        urlHash,
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { ok: true })
})

void test('configure route rejects urlHash when no persistent mapping exists', async () => {
  initializePersistentStorage(null)

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
      {
        presentationUrl: 'https://slides.example.com/deck',
        instructorPasscode: 'teacher-pass',
        urlHash: 'aaaaaaaaaaaaaaaa',
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, { error: 'invalid payload' })
})

void test('configure route rejects tampered urlHash', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-pass'),
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const { hash, hashedTeacherCode } = generatePersistentHash('syncdeck', 'persistent-teacher-code')
  await getOrCreateActivePersistentSession('syncdeck', hash, hashedTeacherCode)
  await startPersistentSession(hash, 's1', {
    id: 'teacher-ws',
    readyState: 1,
    send() {},
  })

  const handler = app.handlers.post['/api/syncdeck/:sessionId/configure']
  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {
        presentationUrl: 'https://slides.example.com/deck',
        instructorPasscode: 'teacher-pass',
        urlHash: 'deadbeefdeadbeef',
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, { error: 'invalid payload' })
})

void test('configure route rejects client-provided persistentHash', async () => {
  initializePersistentStorage(null)

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
      {
        presentationUrl: 'https://slides.example.com/deck',
        instructorPasscode: 'teacher-pass',
        persistentHash: 'abcd1234abcd1234abcd',
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, { error: 'persistentHash must not be provided by client' })
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

void test('configure route rejects invalid presentationUrl', async () => {
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
      { presentationUrl: 'javascript:alert(1)', instructorPasscode: 'teacher-pass' },
    ),
    res,
  )

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, { error: 'invalid payload' })
})
