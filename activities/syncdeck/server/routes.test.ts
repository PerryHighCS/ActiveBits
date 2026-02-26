import type { SessionRecord, SessionStore } from 'activebits-server/core/sessions.js'
import {
  generatePersistentHash,
  getOrCreateActivePersistentSession,
  initializePersistentStorage,
  resolvePersistentSessionSecret,
  startPersistentSession,
} from 'activebits-server/core/persistentSessions.js'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import type { ActiveBitsWebSocket, WsConnectionHandler, WsRouter } from '../../../types/websocket.js'
import setupSyncDeckRoutes from './routes.js'

const HMAC_SECRET = resolvePersistentSessionSecret()

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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
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
      lastInstructorPayload: null,
      lastInstructorStatePayload: null,
      chalkboard: {
        snapshot: null,
        delta: [],
      },
      drawingToolMode: 'none',
      students: [],
      embeddedActivities: [],
    },
  }
}

class MockSocket implements ActiveBitsWebSocket {
  sessionId?: string | null
  isAlive?: boolean
  clientIp?: string
  readyState = 1
  sent: string[] = []
  closeCalls: Array<{ code?: number; reason?: string }> = []
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>()

  send(data: string): void {
    this.sent.push(data)
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    const existing = this.listeners.get(event) ?? []
    existing.push(listener)
    this.listeners.set(event, existing)
  }

  once(event: string, listener: (...args: unknown[]) => void): void {
    this.on(event, listener)
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason })
  }

  terminate(): void {
    this.readyState = 3
  }

  ping(_data?: string | Buffer | ArrayBuffer | Buffer[], _mask?: boolean, cb?: (err: Error) => void): void {
    cb?.(new Error('not implemented'))
  }

  emit(event: string, ...args: unknown[]): void {
    const handlers = this.listeners.get(event) ?? []
    for (const handler of handlers) {
      handler(...args)
    }
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

void test('syncdeck websocket sends latest state snapshot to student on connect', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const state = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-pass'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-pass').data,
        lastInstructorPayload: { type: 'slidechanged', payload: { h: 2, v: 0, f: 0 } },
      },
    },
  })

  setupSyncDeckRoutes(app, state.sessions, ws)
  const handler = ws.registered['/ws/syncdeck']
  assert.equal(typeof handler, 'function')

  const studentSocket = new MockSocket()
  ws.wss.clients.add(studentSocket)

  handler?.(studentSocket, new URLSearchParams({ sessionId: 's1' }), ws.wss)
  await new Promise((resolve) => setTimeout(resolve, 0))

  const delivered = studentSocket.sent.map((entry) => JSON.parse(entry) as { type?: string; payload?: unknown })
  assert.ok(delivered.some((entry) => entry.type === 'syncdeck-state'))
  assert.ok(
    delivered.some(
      (entry) =>
        entry.type === 'syncdeck-state' &&
        asRecord(entry.payload)?.type === 'syncdeck-tool-mode' &&
        asRecord(entry.payload)?.mode === 'none',
    ),
  )
  assert.ok(
    delivered.some(
      (entry) =>
        entry.type === 'syncdeck-state' &&
        asRecord(entry.payload)?.type === 'slidechanged' &&
        JSON.stringify(asRecord(entry.payload)?.payload) === JSON.stringify({ h: 2, v: 0, f: 0 }),
    ),
  )
})

void test('syncdeck websocket sends latest state snapshot to instructor on connect', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const state = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-pass'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-pass').data,
        lastInstructorPayload: { type: 'slidechanged', payload: { h: 5, v: 1, f: 0 } },
      },
    },
  })

  setupSyncDeckRoutes(app, state.sessions, ws)
  const handler = ws.registered['/ws/syncdeck']
  assert.equal(typeof handler, 'function')

  const instructorSocket = new MockSocket()
  ws.wss.clients.add(instructorSocket)

  handler?.(
    instructorSocket,
    new URLSearchParams({
      sessionId: 's1',
      role: 'instructor',
      instructorPasscode: 'teacher-pass',
    }),
    ws.wss,
  )
  await new Promise((resolve) => setTimeout(resolve, 0))

  const delivered = instructorSocket.sent.map((entry) => JSON.parse(entry) as { type?: string; payload?: unknown })
  assert.ok(delivered.some((entry) => entry.type === 'syncdeck-state'))
  assert.ok(
    delivered.some(
      (entry) =>
        entry.type === 'syncdeck-state' &&
        asRecord(entry.payload)?.type === 'slidechanged' &&
        JSON.stringify(asRecord(entry.payload)?.payload) === JSON.stringify({ h: 5, v: 1, f: 0 }),
    ),
  )
})

void test('syncdeck websocket sends latest position snapshot to instructor when last payload is non-position', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const state = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-pass'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-pass').data,
        lastInstructorPayload: {
          type: 'syncdeck-tool-mode',
          mode: 'chalkboard',
        },
        lastInstructorStatePayload: {
          type: 'slidechanged',
          payload: { h: 6, v: 2, f: 0 },
        },
      },
    },
  })

  setupSyncDeckRoutes(app, state.sessions, ws)
  const handler = ws.registered['/ws/syncdeck']
  assert.equal(typeof handler, 'function')

  const instructorSocket = new MockSocket()
  ws.wss.clients.add(instructorSocket)

  handler?.(
    instructorSocket,
    new URLSearchParams({
      sessionId: 's1',
      role: 'instructor',
      instructorPasscode: 'teacher-pass',
    }),
    ws.wss,
  )
  await new Promise((resolve) => setTimeout(resolve, 0))

  const delivered = instructorSocket.sent.map((entry) => JSON.parse(entry) as { type?: string; payload?: unknown })
  assert.ok(
    delivered.some(
      (entry) =>
        entry.type === 'syncdeck-state' &&
        asRecord(entry.payload)?.type === 'slidechanged' &&
        JSON.stringify(asRecord(entry.payload)?.payload) === JSON.stringify({ h: 6, v: 2, f: 0 }),
    ),
  )
})

void test('syncdeck websocket relays instructor updates to students in session', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const state = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-pass'),
  })

  setupSyncDeckRoutes(app, state.sessions, ws)
  const handler = ws.registered['/ws/syncdeck']
  assert.equal(typeof handler, 'function')

  const instructorSocket = new MockSocket()
  const studentSocket = new MockSocket()
  ws.wss.clients.add(instructorSocket)
  ws.wss.clients.add(studentSocket)

  handler?.(
    instructorSocket,
    new URLSearchParams({
      sessionId: 's1',
      role: 'instructor',
      instructorPasscode: 'teacher-pass',
    }),
    ws.wss,
  )
  handler?.(studentSocket, new URLSearchParams({ sessionId: 's1' }), ws.wss)
  await new Promise((resolve) => setTimeout(resolve, 0))

  instructorSocket.emit(
    'message',
    JSON.stringify({
      type: 'syncdeck-state-update',
      payload: { type: 'slidechanged', payload: { h: 3, v: 1, f: 0 } },
    }),
  )
  await new Promise((resolve) => setTimeout(resolve, 0))

  const delivered = studentSocket.sent.map((entry) => JSON.parse(entry) as { type?: string; payload?: unknown })
  assert.ok(delivered.some((entry) => entry.type === 'syncdeck-state'))
  const latestDelivered = delivered[delivered.length - 1]
  assert.deepEqual(
    latestDelivered?.payload,
    { type: 'slidechanged', payload: { h: 3, v: 1, f: 0 } },
  )

  const updatedSession = state.store.s1?.data as { lastInstructorPayload?: unknown; lastInstructorStatePayload?: unknown }
  assert.deepEqual(updatedSession.lastInstructorPayload, { type: 'slidechanged', payload: { h: 3, v: 1, f: 0 } })
  assert.deepEqual(updatedSession.lastInstructorStatePayload, { type: 'slidechanged', payload: { h: 3, v: 1, f: 0 } })
})

void test('syncdeck websocket replays buffered chalkboard snapshot and delta to student on connect', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const state = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-pass'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-pass').data,
        lastInstructorPayload: {
          type: 'reveal-sync',
          action: 'state',
          payload: {
            indices: { h: 4, v: 0, f: 1 },
          },
        },
        chalkboard: {
          snapshot: '[{"width":960,"height":700,"data":[]}]',
          delta: [
            { mode: 1, event: { type: 'draw', x1: 1, y1: 1, x2: 2, y2: 2, board: 0, color: 0, time: 1 } },
            { mode: 1, event: { type: 'erase', x: 2, y: 2, board: 0, time: 2 } },
          ],
        },
      },
    },
  })

  setupSyncDeckRoutes(app, state.sessions, ws)
  const handler = ws.registered['/ws/syncdeck']
  assert.equal(typeof handler, 'function')

  const studentSocket = new MockSocket()
  ws.wss.clients.add(studentSocket)

  handler?.(studentSocket, new URLSearchParams({ sessionId: 's1' }), ws.wss)
  await new Promise((resolve) => setTimeout(resolve, 0))

  const delivered = studentSocket.sent.map((entry) => JSON.parse(entry) as { type?: string; payload?: unknown })
  assert.ok(
    delivered.some((entry) => {
      const payload = asRecord(entry.payload)
      return entry.type === 'syncdeck-state' && payload?.action === 'state'
    }),
  )

  const chalkboardStateMessage = delivered.find(
    (entry) => {
      if (entry.type !== 'syncdeck-state') {
        return false
      }

      const payload = asRecord(entry.payload)
      const commandPayload = asRecord(payload?.payload)
      return commandPayload?.name === 'chalkboardState'
    },
  )
  assert.ok(chalkboardStateMessage)

  const chalkboardStatePayload = asRecord(chalkboardStateMessage?.payload)
  const chalkboardStateCommandPayload = asRecord(chalkboardStatePayload?.payload)
  const chalkboardStateStoragePayload = asRecord(chalkboardStateCommandPayload?.payload)
  assert.equal(chalkboardStateStoragePayload?.storage, '[{"width":960,"height":700,"data":[]}]')

  const chalkboardStrokeMessages = delivered.filter(
    (entry) => {
      if (entry.type !== 'syncdeck-state') {
        return false
      }

      const payload = asRecord(entry.payload)
      const commandPayload = asRecord(payload?.payload)
      return commandPayload?.name === 'chalkboardStroke'
    },
  )
  assert.equal(chalkboardStrokeMessages.length, 2)
})

void test('syncdeck websocket replays buffered chalkboard snapshot and delta to instructor on connect', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const state = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-pass'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-pass').data,
        chalkboard: {
          snapshot: '[{"width":960,"height":700,"data":[{"foo":"bar"}]}]',
          delta: [
            { mode: 1, event: { type: 'draw', x1: 3, y1: 4, x2: 5, y2: 6, board: 0, color: 0, time: 11 } },
          ],
        },
      },
    },
  })

  setupSyncDeckRoutes(app, state.sessions, ws)
  const handler = ws.registered['/ws/syncdeck']
  assert.equal(typeof handler, 'function')

  const instructorSocket = new MockSocket()
  ws.wss.clients.add(instructorSocket)

  handler?.(
    instructorSocket,
    new URLSearchParams({
      sessionId: 's1',
      role: 'instructor',
      instructorPasscode: 'teacher-pass',
    }),
    ws.wss,
  )
  await new Promise((resolve) => setTimeout(resolve, 0))

  const delivered = instructorSocket.sent.map((entry) => JSON.parse(entry) as { type?: string; payload?: unknown })
  const chalkboardStateMessage = delivered.find(
    (entry) => {
      if (entry.type !== 'syncdeck-state') {
        return false
      }

      const payload = asRecord(entry.payload)
      const commandPayload = asRecord(payload?.payload)
      return commandPayload?.name === 'chalkboardState'
    },
  )
  assert.ok(chalkboardStateMessage)

  const chalkboardStatePayload = asRecord(chalkboardStateMessage?.payload)
  const chalkboardStateCommandPayload = asRecord(chalkboardStatePayload?.payload)
  const chalkboardStateStoragePayload = asRecord(chalkboardStateCommandPayload?.payload)
  assert.equal(chalkboardStateStoragePayload?.storage, '[{"width":960,"height":700,"data":[{"foo":"bar"}]}]')

  const chalkboardStrokeMessages = delivered.filter(
    (entry) => {
      if (entry.type !== 'syncdeck-state') {
        return false
      }

      const payload = asRecord(entry.payload)
      const commandPayload = asRecord(payload?.payload)
      return commandPayload?.name === 'chalkboardStroke'
    },
  )
  assert.equal(chalkboardStrokeMessages.length, 1)
})

void test('syncdeck websocket caps replayed chalkboard delta from oversized persisted buffer', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const oversizedDelta = Array.from({ length: 250 }, (_, index) => ({
    mode: 1,
    event: { type: 'draw', seq: index },
  }))
  const state = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-pass'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-pass').data,
        chalkboard: {
          snapshot: null,
          delta: oversizedDelta,
        },
      },
    },
  })

  setupSyncDeckRoutes(app, state.sessions, ws)
  const handler = ws.registered['/ws/syncdeck']
  assert.equal(typeof handler, 'function')

  const studentSocket = new MockSocket()
  ws.wss.clients.add(studentSocket)

  handler?.(studentSocket, new URLSearchParams({ sessionId: 's1' }), ws.wss)
  await new Promise((resolve) => setTimeout(resolve, 0))

  const delivered = studentSocket.sent.map((entry) => JSON.parse(entry) as { type?: string; payload?: unknown })
  const chalkboardStrokeMessages = delivered.filter((entry) => {
    if (entry.type !== 'syncdeck-state') {
      return false
    }

    const payload = asRecord(entry.payload)
    const commandPayload = asRecord(payload?.payload)
    return commandPayload?.name === 'chalkboardStroke'
  })

  assert.equal(chalkboardStrokeMessages.length, 200)

  const firstStrokePayload = asRecord(asRecord(asRecord(chalkboardStrokeMessages[0]?.payload)?.payload)?.payload)
  const lastStrokePayload = asRecord(asRecord(asRecord(chalkboardStrokeMessages[199]?.payload)?.payload)?.payload)
  assert.equal(asRecord(firstStrokePayload?.event)?.seq, 50)
  assert.equal(asRecord(lastStrokePayload?.event)?.seq, 249)
})

void test('syncdeck websocket updates and clears chalkboard buffer from instructor commands', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const state = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-pass'),
  })

  setupSyncDeckRoutes(app, state.sessions, ws)
  const handler = ws.registered['/ws/syncdeck']
  assert.equal(typeof handler, 'function')

  const instructorSocket = new MockSocket()
  ws.wss.clients.add(instructorSocket)

  handler?.(
    instructorSocket,
    new URLSearchParams({
      sessionId: 's1',
      role: 'instructor',
      instructorPasscode: 'teacher-pass',
    }),
    ws.wss,
  )
  await new Promise((resolve) => setTimeout(resolve, 0))

  instructorSocket.emit(
    'message',
    JSON.stringify({
      type: 'syncdeck-state-update',
      payload: {
        type: 'reveal-sync',
        action: 'command',
        payload: {
          name: 'chalkboardState',
          payload: {
            storage: 'snapshot-1',
          },
        },
      },
    }),
  )

  instructorSocket.emit(
    'message',
    JSON.stringify({
      type: 'syncdeck-state-update',
      payload: {
        type: 'reveal-sync',
        action: 'command',
        payload: {
          name: 'chalkboardStroke',
          payload: {
            mode: 1,
            event: { type: 'draw', x1: 1, y1: 1, x2: 2, y2: 2, board: 0, color: 0, time: 10 },
          },
        },
      },
    }),
  )

  await new Promise((resolve) => setTimeout(resolve, 0))

  const beforeReset = state.store.s1?.data as {
    chalkboard?: {
      snapshot: string | null
      delta: unknown[]
    }
  }
  assert.equal(beforeReset.chalkboard?.snapshot, 'snapshot-1')
  assert.equal(beforeReset.chalkboard?.delta.length, 1)

  for (let index = 0; index < 250; index += 1) {
    instructorSocket.emit(
      'message',
      JSON.stringify({
        type: 'syncdeck-state-update',
        payload: {
          type: 'reveal-sync',
          action: 'command',
          payload: {
            name: 'chalkboardStroke',
            payload: {
              mode: 1,
              event: { type: 'draw', seq: index },
            },
          },
        },
      }),
    )
  }

  await new Promise((resolve) => setTimeout(resolve, 0))

  const cappedBuffer = state.store.s1?.data as {
    chalkboard?: {
      snapshot: string | null
      delta: Array<Record<string, unknown>>
    }
  }
  assert.equal(cappedBuffer.chalkboard?.delta.length, 200)
  const firstCappedStroke = asRecord(cappedBuffer.chalkboard?.delta[0])
  const lastCappedStroke = asRecord(cappedBuffer.chalkboard?.delta[199])
  assert.equal(asRecord(firstCappedStroke?.event)?.seq, 50)
  assert.equal(asRecord(lastCappedStroke?.event)?.seq, 249)

  instructorSocket.emit(
    'message',
    JSON.stringify({
      type: 'syncdeck-state-update',
      payload: {
        type: 'reveal-sync',
        action: 'command',
        payload: {
          name: 'resetChalkboard',
          payload: {},
        },
      },
    }),
  )
  await new Promise((resolve) => setTimeout(resolve, 0))

  const afterReset = state.store.s1?.data as {
    chalkboard?: {
      snapshot: string | null
      delta: unknown[]
    }
  }
  assert.equal(afterReset.chalkboard?.snapshot, null)
  assert.deepEqual(afterReset.chalkboard?.delta, [])
})

void test('syncdeck websocket persists drawing tool mode updates from instructor', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const state = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-pass'),
  })

  setupSyncDeckRoutes(app, state.sessions, ws)
  const handler = ws.registered['/ws/syncdeck']
  assert.equal(typeof handler, 'function')

  const instructorSocket = new MockSocket()
  ws.wss.clients.add(instructorSocket)

  handler?.(
    instructorSocket,
    new URLSearchParams({
      sessionId: 's1',
      role: 'instructor',
      instructorPasscode: 'teacher-pass',
    }),
    ws.wss,
  )
  await new Promise((resolve) => setTimeout(resolve, 0))

  instructorSocket.emit(
    'message',
    JSON.stringify({
      type: 'syncdeck-state-update',
      payload: {
        type: 'syncdeck-tool-mode',
        mode: 'pen',
      },
    }),
  )
  await new Promise((resolve) => setTimeout(resolve, 0))

  const updatedSession = state.store.s1?.data as { drawingToolMode?: unknown }
  assert.equal(updatedSession.drawingToolMode, 'pen')
})

void test('syncdeck websocket broadcasts student presence count to instructor', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const state = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-pass'),
  })

  setupSyncDeckRoutes(app, state.sessions, ws)
  const handler = ws.registered['/ws/syncdeck']
  assert.equal(typeof handler, 'function')

  const instructorSocket = new MockSocket()
  const studentSocket = new MockSocket()
  ws.wss.clients.add(instructorSocket)
  ws.wss.clients.add(studentSocket)

  handler?.(
    instructorSocket,
    new URLSearchParams({
      sessionId: 's1',
      role: 'instructor',
      instructorPasscode: 'teacher-pass',
    }),
    ws.wss,
  )

  handler?.(
    studentSocket,
    new URLSearchParams({
      sessionId: 's1',
      studentId: 'student-1',
      studentName: 'Student',
    }),
    ws.wss,
  )
  await new Promise((resolve) => setTimeout(resolve, 0))

  const delivered = instructorSocket.sent.map((entry) => JSON.parse(entry) as { type?: string; payload?: { connectedCount?: unknown } })
  const studentsMessage = delivered.find((entry) => entry.type === 'syncdeck-students')
  assert.ok(studentsMessage)
  assert.equal(studentsMessage?.payload?.connectedCount, 1)
})

void test('syncdeck session normalization filters malformed persisted students and embedded activities', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const state = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-pass'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-pass').data,
        students: [
          null,
          'bad-student-entry',
          { studentId: '   ' },
          {
            studentId: 'student-1',
            name: '',
            joinedAt: 100,
            lastSeenAt: 120,
            lastIndices: { h: 1, v: 2, f: 3 },
            lastStudentStateAt: 'invalid',
          },
        ],
        embeddedActivities: [
          null,
          123,
          { embeddedId: '' },
          {
            embeddedId: 'embed-1',
            activityType: 'quiz',
            sessionId: 123,
            slideIndex: { h: 2, v: 3 },
            displayName: '',
            createdAt: 321,
            status: 'active',
            startedAt: 'invalid',
            endedAt: null,
          },
        ],
        chalkboard: {
          snapshot: 999,
          delta: [null, 'bad', { mode: 1, event: { type: 'draw' } }],
        },
      },
    },
  })

  setupSyncDeckRoutes(app, state.sessions, ws)
  const handler = ws.registered['/ws/syncdeck']
  assert.equal(typeof handler, 'function')

  const instructorSocket = new MockSocket()
  ws.wss.clients.add(instructorSocket)

  handler?.(
    instructorSocket,
    new URLSearchParams({
      sessionId: 's1',
      role: 'instructor',
      instructorPasscode: 'teacher-pass',
    }),
    ws.wss,
  )
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(instructorSocket.closeCalls.length, 0)

  const normalizedSessionData = state.store.s1?.data as {
    students: Array<{
      studentId: string
      name: string
      joinedAt: number
      lastSeenAt: number
      lastIndices: { h: number; v: number; f: number } | null
      lastStudentStateAt: number | null
    }>
    embeddedActivities: Array<{
      embeddedId: string
      activityType: string
      sessionId: string | null
      slideIndex: { h: number; v: number } | null
      displayName: string
      createdAt: number
      status: string
      startedAt: number | null
      endedAt: number | null
    }>
    chalkboard: {
      snapshot: string | null
      delta: Array<Record<string, unknown>>
    }
    drawingToolMode: 'none' | 'chalkboard' | 'pen'
  }

  assert.equal(normalizedSessionData.students.length, 1)
  assert.deepEqual(normalizedSessionData.students[0], {
    studentId: 'student-1',
    name: 'Student',
    joinedAt: 100,
    lastSeenAt: 120,
    lastIndices: { h: 1, v: 2, f: 3 },
    lastStudentStateAt: null,
  })

  assert.equal(normalizedSessionData.embeddedActivities.length, 1)
  assert.deepEqual(normalizedSessionData.embeddedActivities[0], {
    embeddedId: 'embed-1',
    activityType: 'quiz',
    sessionId: null,
    slideIndex: { h: 2, v: 3 },
    displayName: 'quiz',
    createdAt: 321,
    status: 'active',
    startedAt: null,
    endedAt: null,
  })

  assert.equal(normalizedSessionData.chalkboard.snapshot, null)
  assert.deepEqual(normalizedSessionData.chalkboard.delta, [{ mode: 1, event: { type: 'draw' } }])
  assert.equal(normalizedSessionData.drawingToolMode, 'none')
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
  const generatedUrl = new URL(payload.url ?? '', 'https://bits.example')
  const urlHash = generatedUrl.searchParams.get('urlHash')
  assert.equal(typeof urlHash, 'string')
  assert.match(urlHash ?? '', /^[a-f0-9]{16}$/)

  assert.equal(res.cookies.length, 1)
  assert.equal(res.cookies[0]?.name, 'persistent_sessions')
  const cookiePayload = JSON.parse(res.cookies[0]?.value || '[]') as Array<Record<string, unknown>>
  assert.equal(cookiePayload.length, 1)
  assert.match(String(cookiePayload[0]?.key ?? ''), /^syncdeck:[a-f0-9]{20}$/)
  assert.deepEqual(cookiePayload[0]?.selectedOptions, {
    presentationUrl: 'https://slides.example.com/deck',
    urlHash,
  })
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

  const teacherCode = 'persistent-teacher-code'
  const presentationUrl = 'https://slides.example/deck'
  const { hash, hashedTeacherCode } = generatePersistentHash('syncdeck', teacherCode)
  const urlHash = computeUrlHash(hash, presentationUrl)
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
            teacherCode,
            selectedOptions: {
              presentationUrl,
              urlHash,
            },
          },
        ]),
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, {
    instructorPasscode: 'teacher-passcode-1',
    persistentPresentationUrl: presentationUrl,
    persistentUrlHash: urlHash,
  })
})

void test('instructor-passcode route decodes encoded cookie presentationUrl and backfills missing urlHash', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-passcode-1'),
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const teacherCode = 'persistent-teacher-code'
  const presentationUrl = 'https://perryhighcs.github.io/Presentations/CSA/2d-arrays.html'
  const { hash, hashedTeacherCode } = generatePersistentHash('syncdeck', teacherCode)
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
            teacherCode,
            selectedOptions: {
              presentationUrl: encodeURIComponent(presentationUrl),
            },
          },
        ]),
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, {
    instructorPasscode: 'teacher-passcode-1',
    persistentPresentationUrl: presentationUrl,
    persistentUrlHash: computeUrlHash(hash, presentationUrl),
  })
})

void test('instructor-passcode route decodes double-encoded cookie presentationUrl and backfills missing urlHash', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-passcode-1'),
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const teacherCode = 'persistent-teacher-code'
  const presentationUrl = 'https://perryhighcs.github.io/Presentations/CSA/2d-arrays.html'
  const { hash, hashedTeacherCode } = generatePersistentHash('syncdeck', teacherCode)
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
            teacherCode,
            selectedOptions: {
              presentationUrl: encodeURIComponent(encodeURIComponent(presentationUrl)),
            },
          },
        ]),
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, {
    instructorPasscode: 'teacher-passcode-1',
    persistentPresentationUrl: presentationUrl,
    persistentUrlHash: computeUrlHash(hash, presentationUrl),
  })
})

void test('instructor-passcode route repairs stale cookie urlHash that does not match normalized presentationUrl', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-passcode-1'),
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const teacherCode = 'persistent-teacher-code'
  const presentationUrl = 'https://perryhighcs.github.io/Presentations/CSA/2d-arrays.html'
  const encodedPresentationUrl = encodeURIComponent(presentationUrl)
  const { hash, hashedTeacherCode } = generatePersistentHash('syncdeck', teacherCode)
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
            teacherCode,
            selectedOptions: {
              presentationUrl: encodedPresentationUrl,
              // Stale hash computed against the encoded URL should not be trusted.
              urlHash: computeUrlHash(hash, encodedPresentationUrl),
            },
          },
        ]),
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, {
    instructorPasscode: 'teacher-passcode-1',
    persistentPresentationUrl: presentationUrl,
    persistentUrlHash: computeUrlHash(hash, presentationUrl),
  })
})

void test('instructor-passcode route ignores invalid cookie presentationUrl edge cases', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-passcode-1'),
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const teacherCode = 'persistent-teacher-code'
  const { hash, hashedTeacherCode } = generatePersistentHash('syncdeck', teacherCode)
  await getOrCreateActivePersistentSession('syncdeck', hash, hashedTeacherCode)
  await startPersistentSession(hash, 's1', {
    id: 'teacher-ws',
    readyState: 1,
    send() {},
  })

  const handler = app.handlers.get['/api/syncdeck/:sessionId/instructor-passcode']
  const invalidValues: unknown[] = [undefined, null, 42, '', '   ', '%E0%A4%A']

  for (const presentationUrl of invalidValues) {
    const res = createResponse()
    await handler?.(
      createRequest(
        { sessionId: 's1' },
        {},
        {
          persistent_sessions: [
            {
              key: `syncdeck:${hash}`,
              teacherCode,
              selectedOptions: { presentationUrl },
            },
          ],
        },
      ),
      res,
    )

    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body, {
      instructorPasscode: 'teacher-passcode-1',
    })
  }
})

void test('instructor-passcode route preserves already-valid cookie presentationUrl values and backfills urlHash', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-passcode-1'),
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const teacherCode = 'persistent-teacher-code'
  const { hash, hashedTeacherCode } = generatePersistentHash('syncdeck', teacherCode)
  await getOrCreateActivePersistentSession('syncdeck', hash, hashedTeacherCode)
  await startPersistentSession(hash, 's1', {
    id: 'teacher-ws',
    readyState: 1,
    send() {},
  })

  const handler = app.handlers.get['/api/syncdeck/:sessionId/instructor-passcode']
  const validUrls = [
    'https://slides.example/deck',
    'https://slides.example/deck?topic=2d-arrays&mode=review#slide-3',
  ]

  for (const presentationUrl of validUrls) {
    const res = createResponse()
    await handler?.(
      createRequest(
        { sessionId: 's1' },
        {},
        {
          persistent_sessions: [
            {
              key: `syncdeck:${hash}`,
              teacherCode,
              selectedOptions: { presentationUrl },
            },
          ],
        },
      ),
      res,
    )

    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body, {
      instructorPasscode: 'teacher-passcode-1',
      persistentPresentationUrl: presentationUrl,
      persistentUrlHash: computeUrlHash(hash, presentationUrl),
    })
  }
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

void test('instructor-passcode route rejects forged cookie key with wrong teacher code', async () => {
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
            teacherCode: 'wrong-teacher-code',
          },
        ]),
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 403)
  assert.deepEqual(res.body, { error: 'forbidden' })
})

void test('register-student route creates a student record for valid syncdeck session', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-passcode-1'),
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/register-student']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {
        name: 'Ada Lovelace',
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  const payload = res.body as { studentId?: unknown; name?: unknown }
  assert.equal(typeof payload.studentId, 'string')
  assert.ok((payload.studentId as string).length > 0)
  assert.equal(payload.name, 'Ada Lovelace')

  const students = (storeState.store.s1?.data as { students?: Array<{ name?: string }> }).students ?? []
  assert.equal(students.length, 1)
  assert.equal(students[0]?.name, 'Ada Lovelace')
})

void test('register-student route returns 404 for invalid session', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({})
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/register-student']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 'missing' },
      {
        name: 'Student',
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 404)
  assert.deepEqual(res.body, { error: 'invalid session' })
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
