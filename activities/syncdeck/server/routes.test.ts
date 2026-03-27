import type { SessionRecord, SessionStore } from 'activebits-server/core/sessions.js'
import { acceptEntryParticipant } from 'activebits-server/core/acceptedEntryParticipants.js'
import {
  computePersistentLinkUrlHash,
  type PersistentLinkUrlState,
} from 'activebits-server/core/persistentLinkUrlState.js'
import {
  generatePersistentHash,
  getOrCreateActivePersistentSession,
  initializePersistentStorage,
  startPersistentSession,
} from 'activebits-server/core/persistentSessions.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import type { ActiveBitsWebSocket, WsConnectionHandler, WsRouter } from '../../../types/websocket.js'
import { initializeActivityRegistry } from '../../../server/activities/activityRegistry.js'
import setupSyncDeckRoutes, { waitForInstructorAuthMessage } from './routes.js'
import '../../gallery-walk/server/routes.js'
import '../../resonance/server/routes.js'
import '../../video-sync/server/routes.js'

const DEFAULT_SYNCDECK_ENTRY_POLICY = 'instructor-required'

interface RouteRequest {
  params: Record<string, string | undefined>
  body?: unknown
  cookies?: Record<string, unknown>
  headers?: Record<string, unknown>
}

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): void
  send?(payload: unknown): void
  setHeader?(name: string, value: string): void
}

type RouteHandler = (req: RouteRequest, res: JsonResponse) => Promise<void> | void

interface MockResponse {
  statusCode: number
  body: unknown
  cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>
  headers: Record<string, string>
  status(code: number): MockResponse
  json(payload: unknown): MockResponse
  cookie(name: string, value: string, options: Record<string, unknown>): MockResponse
  setHeader(name: string, value: string): void
  send(payload: unknown): MockResponse
}

function createResponse(): MockResponse {
  return {
    statusCode: 200,
    body: null,
    cookies: [],
    headers: {},
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
    send(payload: unknown) {
      this.body = payload
      return this
    },
    cookie(name: string, value: string, options: Record<string, unknown>) {
      this.cookies.push({ name, value, options })
      return this
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value
    },
  }
}

function createMockApp() {
  const handlers: { get: Record<string, RouteHandler>; post: Record<string, RouteHandler>; delete: Record<string, RouteHandler> } = {
    get: {},
    post: {},
    delete: {},
  }

  return {
    handlers,
    get(path: string, handler: RouteHandler) {
      handlers.get[path] = handler
    },
    post(path: string, handler: RouteHandler) {
      handlers.post[path] = handler
    },
    delete(path: string, handler: RouteHandler) {
      handlers.delete[path] = handler
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
  headers: Record<string, unknown> = {},
): RouteRequest {
  return { params, body, cookies, headers }
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
      embeddedActivities: {},
    },
  }
}

class MockSocket implements ActiveBitsWebSocket {
  sessionId?: string | null
  studentId?: string | null
  ignoreDisconnect?: boolean
  isAlive?: boolean
  clientIp?: string
  readyState = 1
  sent: string[] = []
  closeCalls: Array<{ code?: number; reason?: string }> = []
  private listeners = new Map<string, Array<{ listener: (...args: unknown[]) => void; once: boolean }>>()

  send(data: string): void {
    this.sent.push(data)
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    const existing = this.listeners.get(event) ?? []
    existing.push({ listener, once: false })
    this.listeners.set(event, existing)
  }

  once(event: string, listener: (...args: unknown[]) => void): void {
    const existing = this.listeners.get(event) ?? []
    existing.push({ listener, once: true })
    this.listeners.set(event, existing)
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason })
    this.readyState = 3
  }

  terminate(): void {
    this.readyState = 3
  }

  ping(_data?: string | Buffer | ArrayBuffer | Buffer[], _mask?: boolean, cb?: (err: Error) => void): void {
    cb?.(new Error('not implemented'))
  }

  emit(event: string, ...args: unknown[]): void {
    const handlers = this.listeners.get(event) ?? []
    this.listeners.set(event, handlers.filter((entry) => !entry.once))
    for (const handler of handlers) {
      handler.listener(...args)
    }
  }
}

function emitInstructorAuth(socket: MockSocket, instructorPasscode: string): void {
  socket.emit(
    'message',
    JSON.stringify({
      type: 'authenticate',
      instructorPasscode,
    }),
  )
}

function computeUrlHash(
  persistentHash: string,
  presentationUrl: string,
  entryPolicy: PersistentLinkUrlState['entryPolicy'] = DEFAULT_SYNCDECK_ENTRY_POLICY,
): string {
  const state: PersistentLinkUrlState = {
    entryPolicy,
    selectedOptions: {
      presentationUrl,
    },
  }
  return computePersistentLinkUrlHash(persistentHash, state)
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs: number,
  pollIntervalMs = 5,
): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`[TEST] Timed out waiting for condition after ${timeoutMs}ms`)
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
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
        students: [{
          studentId: 'student-1',
          name: 'Ada Lovelace',
          joinedAt: 100,
          lastSeenAt: 110,
          lastIndices: null,
          lastStudentStateAt: null,
        }],
        lastInstructorPayload: { type: 'slidechanged', payload: { h: 2, v: 0, f: 0 } },
      },
    },
  })

  setupSyncDeckRoutes(app, state.sessions, ws)
  const handler = ws.registered['/ws/syncdeck']
  assert.equal(typeof handler, 'function')

  const studentSocket = new MockSocket()
  ws.wss.clients.add(studentSocket)

  handler?.(
    studentSocket,
    new URLSearchParams({ sessionId: 's1', studentId: 'student-1', studentName: 'Ada Lovelace' }),
    ws.wss,
  )
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

void test('syncdeck websocket closes duplicate student sockets for the same session participant', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const state = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-pass'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-pass').data,
        students: [{
          studentId: 'student-1',
          name: 'Ada Lovelace',
          joinedAt: 100,
          lastSeenAt: 110,
          lastIndices: null,
          lastStudentStateAt: null,
        }],
      },
    },
  })

  setupSyncDeckRoutes(app, state.sessions, ws)
  const handler = ws.registered['/ws/syncdeck']
  assert.equal(typeof handler, 'function')

  const existingSocket = new MockSocket()
  existingSocket.sessionId = 's1'
  existingSocket.studentId = 'student-1'
  const replacementSocket = new MockSocket()
  ws.wss.clients.add(existingSocket)
  ws.wss.clients.add(replacementSocket)

  handler?.(
    replacementSocket,
    new URLSearchParams({
      sessionId: 's1',
      studentId: 'student-1',
      studentName: 'Ada Lovelace',
    }),
    ws.wss,
  )
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(existingSocket.ignoreDisconnect, true)
  assert.deepEqual(existingSocket.closeCalls, [{ code: 4000, reason: 'Replaced by new connection' }])
})

void test('syncdeck websocket rejects student connect without a registered studentId', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const state = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-pass'),
  })

  setupSyncDeckRoutes(app, state.sessions, ws)
  const handler = ws.registered['/ws/syncdeck']
  assert.equal(typeof handler, 'function')

  const studentSocket = new MockSocket()
  ws.wss.clients.add(studentSocket)

  handler?.(
    studentSocket,
    new URLSearchParams({
      sessionId: 's1',
      studentId: 'missing-student',
      studentName: 'Ada Lovelace',
    }),
    ws.wss,
  )
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(studentSocket.closeCalls, [{ code: 1008, reason: 'unregistered student' }])
})

void test('syncdeck websocket updates an existing student record on reconnect', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const state = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-pass'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-pass').data,
        students: [{
          studentId: 'student-1',
          name: 'Old Name',
          joinedAt: 100,
          lastSeenAt: 110,
          lastIndices: null,
          lastStudentStateAt: null,
        }],
      },
    },
  })

  setupSyncDeckRoutes(app, state.sessions, ws)
  const handler = ws.registered['/ws/syncdeck']
  assert.equal(typeof handler, 'function')

  const studentSocket = new MockSocket()
  ws.wss.clients.add(studentSocket)

  handler?.(
    studentSocket,
    new URLSearchParams({
      sessionId: 's1',
      studentId: 'student-1',
      studentName: 'Ada Lovelace',
    }),
    ws.wss,
  )
  await new Promise((resolve) => setTimeout(resolve, 0))

  const students = (state.store.s1?.data as {
    students?: Array<{ studentId: string; name: string; joinedAt: number; lastSeenAt: number }>
  }).students ?? []
  assert.equal(students.length, 1)
  assert.equal(students[0]?.studentId, 'student-1')
  assert.equal(students[0]?.name, 'Old Name')
  assert.equal(students[0]?.joinedAt, 100)
  assert.ok((students[0]?.lastSeenAt ?? 0) >= 110)
})

void test('syncdeck websocket creates a student from accepted entry when no prior registration exists', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const session = createSyncDeckSession('s1', 'teacher-pass')
  acceptEntryParticipant(session, {
    participantId: 'participant-1',
    displayName: 'Ada Lovelace',
  }, 100)
  const state = createSessionStore({
    s1: session,
  })

  setupSyncDeckRoutes(app, state.sessions, ws)
  const handler = ws.registered['/ws/syncdeck']
  assert.equal(typeof handler, 'function')

  const studentSocket = new MockSocket()
  ws.wss.clients.add(studentSocket)

  handler?.(
    studentSocket,
    new URLSearchParams({
      sessionId: 's1',
      studentId: 'participant-1',
    }),
    ws.wss,
  )
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(studentSocket.closeCalls, [])
  const students = (state.store.s1?.data as {
    students?: Array<{ studentId: string; name: string }>
  }).students ?? []
  assert.equal(students.length, 1)
  assert.equal(students[0]?.studentId, 'participant-1')
  assert.equal(students[0]?.name, 'Ada Lovelace')
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
    }),
    ws.wss,
  )
  emitInstructorAuth(instructorSocket, 'teacher-pass')
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

void test('waitForInstructorAuthMessage closes when auth does not arrive in time', async () => {
  const instructorSocket = new MockSocket()
  const authPromise = waitForInstructorAuthMessage(instructorSocket, 75)

  await waitForCondition(() => instructorSocket.closeCalls.length === 1, 1000)
  const authMessage = await authPromise

  assert.equal(authMessage, null)
  assert.deepEqual(instructorSocket.closeCalls, [{ code: 1008, reason: 'auth timeout' }])
})

void test('syncdeck websocket does not issue forbidden close after auth wait resolves on closed socket', async () => {
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
    }),
    ws.wss,
  )

  instructorSocket.readyState = 3
  instructorSocket.emit('close')
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(instructorSocket.closeCalls, [])
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
    }),
    ws.wss,
  )
  emitInstructorAuth(instructorSocket, 'teacher-pass')
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
    s1: {
      ...createSyncDeckSession('s1', 'teacher-pass'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-pass').data,
        students: [{
          studentId: 'student-1',
          name: 'Ada Lovelace',
          joinedAt: 100,
          lastSeenAt: 110,
          lastIndices: null,
          lastStudentStateAt: null,
        }],
      },
    },
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
    }),
    ws.wss,
  )
  emitInstructorAuth(instructorSocket, 'teacher-pass')
  handler?.(
    studentSocket,
    new URLSearchParams({
      sessionId: 's1',
      studentId: 'student-1',
      studentName: 'Ada Lovelace',
    }),
    ws.wss,
  )
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

void test('syncdeck websocket relays instructor updates to other instructors in session', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const state = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-pass'),
  })

  setupSyncDeckRoutes(app, state.sessions, ws)
  const handler = ws.registered['/ws/syncdeck']
  assert.equal(typeof handler, 'function')

  const primaryInstructorSocket = new MockSocket()
  const peerInstructorSocket = new MockSocket()
  ws.wss.clients.add(primaryInstructorSocket)
  ws.wss.clients.add(peerInstructorSocket)

  handler?.(
    primaryInstructorSocket,
    new URLSearchParams({
      sessionId: 's1',
      role: 'instructor',
    }),
    ws.wss,
  )
  emitInstructorAuth(primaryInstructorSocket, 'teacher-pass')
  handler?.(
    peerInstructorSocket,
    new URLSearchParams({
      sessionId: 's1',
      role: 'instructor',
    }),
    ws.wss,
  )
  emitInstructorAuth(peerInstructorSocket, 'teacher-pass')
  await new Promise((resolve) => setTimeout(resolve, 0))

  const initialPrimaryMessageCount = primaryInstructorSocket.sent.length
  const initialPeerMessageCount = peerInstructorSocket.sent.length

  primaryInstructorSocket.emit(
    'message',
    JSON.stringify({
      type: 'syncdeck-state-update',
      payload: { type: 'slidechanged', payload: { h: 4, v: 0, f: 0 } },
    }),
  )
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(primaryInstructorSocket.sent.length, initialPrimaryMessageCount)
  assert.ok(peerInstructorSocket.sent.length > initialPeerMessageCount)

  const deliveredToPeer = peerInstructorSocket.sent.map((entry) => JSON.parse(entry) as { type?: string; payload?: unknown })
  const latestDelivered = deliveredToPeer[deliveredToPeer.length - 1]
  assert.deepEqual(
    latestDelivered?.payload,
    { type: 'slidechanged', payload: { h: 4, v: 0, f: 0 } },
  )
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
        students: [{
          studentId: 'student-1',
          name: 'Ada Lovelace',
          joinedAt: 100,
          lastSeenAt: 110,
          lastIndices: null,
          lastStudentStateAt: null,
        }],
      },
    },
  })

  setupSyncDeckRoutes(app, state.sessions, ws)
  const handler = ws.registered['/ws/syncdeck']
  assert.equal(typeof handler, 'function')

  const studentSocket = new MockSocket()
  ws.wss.clients.add(studentSocket)

  handler?.(
    studentSocket,
    new URLSearchParams({ sessionId: 's1', studentId: 'student-1', studentName: 'Ada Lovelace' }),
    ws.wss,
  )
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
    }),
    ws.wss,
  )
  emitInstructorAuth(instructorSocket, 'teacher-pass')
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
        students: [{
          studentId: 'student-2',
          name: 'Grace Hopper',
          joinedAt: 100,
          lastSeenAt: 110,
          lastIndices: null,
          lastStudentStateAt: null,
        }],
      },
    },
  })

  setupSyncDeckRoutes(app, state.sessions, ws)
  const handler = ws.registered['/ws/syncdeck']
  assert.equal(typeof handler, 'function')

  const studentSocket = new MockSocket()
  ws.wss.clients.add(studentSocket)

  handler?.(
    studentSocket,
    new URLSearchParams({ sessionId: 's1', studentId: 'student-2', studentName: 'Grace Hopper' }),
    ws.wss,
  )
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
    }),
    ws.wss,
  )
  emitInstructorAuth(instructorSocket, 'teacher-pass')
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
    }),
    ws.wss,
  )
  emitInstructorAuth(instructorSocket, 'teacher-pass')
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
    s1: {
      ...createSyncDeckSession('s1', 'teacher-pass'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-pass').data,
        students: [{
          studentId: 'student-1',
          name: 'Student',
          joinedAt: 100,
          lastSeenAt: 100,
          lastIndices: null,
          lastStudentStateAt: null,
        }],
      },
    },
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
    }),
    ws.wss,
  )
  emitInstructorAuth(instructorSocket, 'teacher-pass')

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
        embeddedActivities: {
          '': null,
          broken: 123,
          'quiz:2:3': {
            childSessionId: 'CHILD:s1:abc12:quiz',
            activityId: 'quiz',
            startedAt: 321,
            owner: '',
          },
        },
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
    }),
    ws.wss,
  )
  emitInstructorAuth(instructorSocket, 'teacher-pass')
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
    embeddedActivities: Record<string, {
      childSessionId: string
      activityId: string
      startedAt: number
      owner: string
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

  assert.deepEqual(normalizedSessionData.embeddedActivities, {
    'quiz:2:3': {
      childSessionId: 'CHILD:s1:abc12:quiz',
      activityId: 'quiz',
      startedAt: 321,
      owner: 'syncdeck-instructor',
    },
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
  assert.match(
    payload.url ?? '',
    /^\/activity\/syncdeck\/[a-f0-9]{20}\?presentationUrl=.*&entryPolicy=instructor-required&urlHash=[a-f0-9]{16}$/,
  )
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
  })
  assert.equal(cookiePayload[0]?.entryPolicy, 'instructor-required')
  assert.equal(cookiePayload[0]?.urlHash, urlHash)
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
            },
            entryPolicy: 'instructor-required',
            urlHash,
          },
        ]),
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, {
    instructorPasscode: 'teacher-passcode-1',
    persistentEntryPolicy: 'instructor-required',
    persistentPresentationUrl: presentationUrl,
    persistentUrlHash: urlHash,
  })
})

void test('instructor-passcode route returns recovered persistent entryPolicy for syncdeck links', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-passcode-1'),
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const teacherCode = 'persistent-teacher-code'
  const presentationUrl = 'https://slides.example/deck'
  const entryPolicy: PersistentLinkUrlState['entryPolicy'] = 'solo-allowed'
  const { hash, hashedTeacherCode } = generatePersistentHash('syncdeck', teacherCode)
  const urlHash = computeUrlHash(hash, presentationUrl, entryPolicy)
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
            entryPolicy,
            selectedOptions: {
              presentationUrl,
            },
            urlHash,
          },
        ]),
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, {
    instructorPasscode: 'teacher-passcode-1',
    persistentEntryPolicy: 'solo-allowed',
    persistentPresentationUrl: presentationUrl,
    persistentUrlHash: urlHash,
  })
})

void test('instructor-passcode route decodes encoded cookie presentationUrl without backfilling missing urlHash', async () => {
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
    persistentEntryPolicy: 'instructor-required',
    persistentPresentationUrl: presentationUrl,
  })
})

void test('instructor-passcode route decodes double-encoded cookie presentationUrl without backfilling missing urlHash', async () => {
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
    persistentEntryPolicy: 'instructor-required',
    persistentPresentationUrl: presentationUrl,
  })
})

void test('instructor-passcode route drops stale cookie urlHash that does not match normalized presentationUrl', async () => {
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
            },
            // Stale hash computed against the encoded URL should not be trusted.
            urlHash: computeUrlHash(hash, encodedPresentationUrl),
          },
        ]),
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, {
    instructorPasscode: 'teacher-passcode-1',
    persistentEntryPolicy: 'instructor-required',
    persistentPresentationUrl: presentationUrl,
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
          persistent_sessions: JSON.stringify([
            {
              key: `syncdeck:${hash}`,
              teacherCode,
              selectedOptions: { presentationUrl },
            },
          ]),
        },
      ),
      res,
    )

    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body, {
      instructorPasscode: 'teacher-passcode-1',
      persistentEntryPolicy: 'instructor-required',
    })
  }
})

void test('instructor-passcode route preserves already-valid cookie presentationUrl values without backfilling urlHash', async () => {
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
          persistent_sessions: JSON.stringify([
            {
              key: `syncdeck:${hash}`,
              teacherCode,
              selectedOptions: { presentationUrl },
            },
          ]),
        },
      ),
      res,
    )

    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body, {
      instructorPasscode: 'teacher-passcode-1',
      persistentEntryPolicy: 'instructor-required',
      persistentPresentationUrl: presentationUrl,
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

void test('embedded-context route resolves teacher role from valid instructor passcode', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-passcode-1'),
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-context']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      { instructorPasscode: 'teacher-passcode-1' },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { resolvedRole: 'teacher' })
})

void test('embedded-context route does not authenticate teacher when instructorPasscode is missing or blank', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createSyncDeckSession('s1', 'Student'),
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-context']
  assert.equal(typeof handler, 'function')

  const missingRes = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {},
    ),
    missingRes,
  )

  assert.equal(missingRes.statusCode, 403)
  assert.deepEqual(missingRes.body, { error: 'forbidden' })

  const blankRes = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      { instructorPasscode: '   ' },
    ),
    blankRes,
  )

  assert.equal(blankRes.statusCode, 403)
  assert.deepEqual(blankRes.body, { error: 'forbidden' })
})

void test('embedded-context route resolves student role from registered student id', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-passcode-1'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-passcode-1').data,
        lastInstructorStatePayload: {
          type: 'slidechanged',
          payload: { h: 3, v: 0, f: 0 },
        },
        students: [{
          studentId: 'student-1',
          name: 'Ada Lovelace',
          joinedAt: 100,
          lastSeenAt: 110,
          lastIndices: null,
          lastStudentStateAt: null,
        }],
      },
    },
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-context']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      { studentId: 'student-1' },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, {
    resolvedRole: 'student',
    studentId: 'student-1',
    studentName: 'Ada Lovelace',
  })
})

void test('embedded-context route rejects unknown parent identity', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-passcode-1'),
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-context']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      { studentId: 'missing-student' },
    ),
    res,
  )

  assert.equal(res.statusCode, 403)
  assert.deepEqual(res.body, { error: 'forbidden' })
})

void test('embedded-activity start route creates a child session, stores keyed map state, and broadcasts tokens', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-passcode-1'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-passcode-1').data,
        lastInstructorStatePayload: {
          type: 'slidechanged',
          payload: { h: 3, v: 0, f: 0 },
        },
        students: [{
          studentId: 'student-1',
          name: 'Ada Lovelace',
          joinedAt: 100,
          lastSeenAt: 110,
          lastIndices: null,
          lastStudentStateAt: null,
        }],
      },
    },
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-activity/start']
  assert.equal(typeof handler, 'function')

  const instructorSocket = new MockSocket()
  instructorSocket.sessionId = 's1'
  ;(instructorSocket as MockSocket & { isInstructor?: boolean }).isInstructor = true
  const studentSocket = new MockSocket()
  studentSocket.sessionId = 's1'
  studentSocket.studentId = 'student-1'
  ;(studentSocket as MockSocket & { isInstructor?: boolean }).isInstructor = false
  ws.wss.clients.add(instructorSocket)
  ws.wss.clients.add(studentSocket)

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {
        instructorPasscode: 'teacher-passcode-1',
        activityId: 'video-sync',
        instanceKey: 'video-sync:3:0',
        activityOptions: {
          sourceUrl: 'https://www.youtube.com/watch?v=mCq8-xTH7jA',
        },
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as {
    childSessionId: string
    instanceKey: string
    managerBootstrap?: { instructorPasscode?: string }
  }
  assert.equal(body.instanceKey, 'video-sync:3:0')
  assert.match(body.childSessionId, /^CHILD:s1:[a-f0-9]{5}:video-sync$/)
  assert.equal(typeof body.managerBootstrap?.instructorPasscode, 'string')
  assert.equal(body.managerBootstrap?.instructorPasscode?.length, 32)

  const parentSession = storeState.store.s1 as SessionRecord & {
    data: { embeddedActivities: Record<string, { childSessionId: string; activityId: string; startedAt: number; owner: string }> }
  }
  assert.equal(parentSession.data.embeddedActivities['video-sync:3:0']?.childSessionId, body.childSessionId)
  assert.equal(parentSession.data.embeddedActivities['video-sync:3:0']?.activityId, 'video-sync')
  assert.equal(parentSession.data.embeddedActivities['video-sync:3:0']?.owner, 'syncdeck-instructor')

  const childSession = storeState.store[body.childSessionId] as SessionRecord | undefined
  assert.equal(childSession?.type, 'video-sync')
  assert.deepEqual(
    asRecord(childSession?.data)?.embeddedLaunch,
    {
      parentSessionId: 's1',
      instanceKey: 'video-sync:3:0',
      selectedOptions: {
        sourceUrl: 'https://www.youtube.com/watch?v=mCq8-xTH7jA',
      },
    },
  )

  const instructorPayloads = instructorSocket.sent.map((entry) => JSON.parse(entry) as { type?: string; payload?: Record<string, unknown> })
  const studentPayloads = studentSocket.sent.map((entry) => JSON.parse(entry) as { type?: string; payload?: Record<string, unknown> })
  const instructorStart = instructorPayloads.find((entry) => entry.payload?.type === 'embedded-activity-start')?.payload
  const studentStart = studentPayloads.find((entry) => entry.payload?.type === 'embedded-activity-start')?.payload
  assert.equal(instructorStart?.entryParticipantToken, null)
  assert.equal(studentStart?.instanceKey, 'video-sync:3:0')
  assert.equal(studentStart?.activityId, 'video-sync')
  assert.equal(studentStart?.childSessionId, body.childSessionId)
  assert.equal(typeof studentStart?.entryParticipantToken, 'string')
})

void test('embedded-activity start route rejects unknown activities before creating a child session', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-passcode-1'),
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-activity/start']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {
        instructorPasscode: 'teacher-passcode-1',
        activityId: 'missing-activity',
        instanceKey: 'missing-activity:3:0',
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 404)
  assert.deepEqual(res.body, { error: 'invalid embedded activity' })

  const parentSession = storeState.store.s1 as SessionRecord & {
    data: { embeddedActivities: Record<string, unknown> }
  }
  assert.deepEqual(parentSession.data.embeddedActivities, {})
  assert.deepEqual(Object.keys(storeState.store), ['s1'])
})

void test('embedded-activity start route is idempotent per instance key', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-passcode-1'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-passcode-1').data,
        embeddedActivities: {
          'video-sync:3:0': {
            childSessionId: 'CHILD:s1:abc12:video-sync',
            activityId: 'video-sync',
            startedAt: 123,
            owner: 'syncdeck-instructor',
          },
        },
      },
    },
    'CHILD:s1:abc12:video-sync': {
      id: 'CHILD:s1:abc12:video-sync',
      type: 'video-sync',
      created: Date.now(),
      lastActivity: Date.now(),
      data: {},
    },
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-activity/start']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {
        instructorPasscode: 'teacher-passcode-1',
        activityId: 'video-sync',
        instanceKey: 'video-sync:3:0',
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, {
    childSessionId: 'CHILD:s1:abc12:video-sync',
    instanceKey: 'video-sync:3:0',
  })
})

void test('embedded-activity start route serializes concurrent creation for the same instance key', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-passcode-1'),
  })

  const originalSet = storeState.sessions.set.bind(storeState.sessions)
  let shouldBlockParentSet = true
  let releaseParentSet: (() => void) | null = null
  let resolveParentSetStarted: (() => void) | null = null
  const parentSetStarted = new Promise<void>((resolve) => {
    resolveParentSetStarted = resolve
  })

  storeState.sessions.set = async (id, session, ttl) => {
    if (
      id === 's1'
      && shouldBlockParentSet
      && asRecord(session.data)?.embeddedActivities != null
      && Object.prototype.hasOwnProperty.call(asRecord(session.data)?.embeddedActivities ?? {}, 'video-sync:3:0')
    ) {
      shouldBlockParentSet = false
      resolveParentSetStarted?.()
      await new Promise<void>((resolve) => {
        releaseParentSet = resolve
      })
    }

    await originalSet(id, session, ttl)
  }

  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-activity/start']
  assert.equal(typeof handler, 'function')

  const request = createRequest(
    { sessionId: 's1' },
    {
      instructorPasscode: 'teacher-passcode-1',
      activityId: 'video-sync',
      instanceKey: 'video-sync:3:0',
    },
  )

  const firstResponse = createResponse()
  const secondResponse = createResponse()
  const firstStart = handler?.(request, firstResponse)
  await parentSetStarted
  const secondStart = handler?.(request, secondResponse)
  if (releaseParentSet == null) {
    throw new Error('Expected blocked parent-session set release function')
  }
  const releaseBlockedParentSet: () => void = releaseParentSet
  releaseBlockedParentSet()

  await Promise.all([firstStart, secondStart])

  assert.equal(firstResponse.statusCode, 200)
  assert.equal(secondResponse.statusCode, 200)

  const firstBody = firstResponse.body as { childSessionId: string; instanceKey: string }
  const secondBody = secondResponse.body as { childSessionId: string; instanceKey: string }
  assert.equal(firstBody.instanceKey, 'video-sync:3:0')
  assert.equal(secondBody.instanceKey, 'video-sync:3:0')
  assert.equal(firstBody.childSessionId, secondBody.childSessionId)

  const parentSession = storeState.store.s1 as SessionRecord & {
    data: { embeddedActivities: Record<string, { childSessionId: string; activityId: string }> }
  }
  assert.equal(parentSession.data.embeddedActivities['video-sync:3:0']?.childSessionId, firstBody.childSessionId)
  assert.equal(
    Object.keys(storeState.store).filter((candidateSessionId) => candidateSessionId.startsWith('CHILD:s1:')).length,
    1,
  )
})

void test('embedded-activity start route recreates a stale child session when the stored child session is missing', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-passcode-1'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-passcode-1').data,
        embeddedActivities: {
          'video-sync:3:0': {
            childSessionId: 'CHILD:s1:stale1:video-sync',
            activityId: 'video-sync',
            startedAt: 123,
            owner: 'syncdeck-instructor',
          },
        },
      },
    },
    'CHILD:s1:abc12:video-sync': {
      id: 'CHILD:s1:abc12:video-sync',
      type: 'video-sync',
      created: Date.now(),
      lastActivity: Date.now(),
      data: {},
    },
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-activity/start']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {
        instructorPasscode: 'teacher-passcode-1',
        activityId: 'video-sync',
        instanceKey: 'video-sync:3:0',
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as { childSessionId: string; instanceKey: string }
  assert.equal(body.instanceKey, 'video-sync:3:0')
  assert.match(body.childSessionId, /^CHILD:s1:[a-f0-9]{5}:video-sync$/)
  assert.notEqual(body.childSessionId, 'CHILD:s1:stale1:video-sync')

  const parentSession = storeState.store.s1 as SessionRecord & {
    data: { embeddedActivities: Record<string, { childSessionId: string; activityId: string }> }
  }
  assert.equal(parentSession.data.embeddedActivities['video-sync:3:0']?.childSessionId, body.childSessionId)
  assert.equal(parentSession.data.embeddedActivities['video-sync:3:0']?.activityId, 'video-sync')
  assert.ok(storeState.store[body.childSessionId])
})

void test('embedded-activity start route rejects instance-key reuse for a different activity id', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-passcode-1'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-passcode-1').data,
        embeddedActivities: {
          'video-sync:3:0': {
            childSessionId: 'CHILD:s1:abc12:video-sync',
            activityId: 'video-sync',
            startedAt: 123,
            owner: 'syncdeck-instructor',
          },
        },
      },
    },
    'CHILD:s1:abc12:video-sync': {
      id: 'CHILD:s1:abc12:video-sync',
      type: 'video-sync',
      created: Date.now(),
      lastActivity: Date.now(),
      data: {},
    },
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-activity/start']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {
        instructorPasscode: 'teacher-passcode-1',
        activityId: 'raffle',
        instanceKey: 'video-sync:3:0',
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 409)
  assert.deepEqual(res.body, {
    error: 'embedded activity instance key already belongs to a different activity',
  })

  const parentSession = storeState.store.s1 as SessionRecord & {
    data: { embeddedActivities: Record<string, { childSessionId: string; activityId: string }> }
  }
  assert.equal(parentSession.data.embeddedActivities['video-sync:3:0']?.childSessionId, 'CHILD:s1:abc12:video-sync')
  assert.equal(parentSession.data.embeddedActivities['video-sync:3:0']?.activityId, 'video-sync')
})

void test('embedded-activity report route redirects to the child activity report endpoint when available', async () => {
  await initializeActivityRegistry()
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-passcode-1'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-passcode-1').data,
        embeddedActivities: {
          'gallery-walk:4:0': {
            childSessionId: 'CHILD:s1:abc12:gallery-walk',
            activityId: 'gallery-walk',
            startedAt: 123,
            owner: 'syncdeck-instructor',
          },
        },
      },
    },
    'CHILD:s1:abc12:gallery-walk': {
      id: 'CHILD:s1:abc12:gallery-walk',
      type: 'gallery-walk',
      created: Date.now(),
      lastActivity: Date.now(),
      data: {
        stage: 'review',
        config: { title: 'Critique Day' },
        reviewees: {},
        reviewers: {},
        feedback: [],
        stats: { reviewees: {}, reviewers: {} },
      },
    },
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.get['/api/syncdeck/:sessionId/embedded-activity/report/:instanceKey']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1', instanceKey: 'gallery-walk:4:0' },
      {},
      {},
      { 'x-syncdeck-instructor-passcode': 'teacher-passcode-1' },
    ),
    res,
  )

  assert.equal(res.statusCode, 302)
  assert.equal(res.headers.Location, '/api/gallery-walk/CHILD%3As1%3Aabc12%3Agallery-walk/report')
  assert.deepEqual(res.body, {
    location: '/api/gallery-walk/CHILD%3As1%3Aabc12%3Agallery-walk/report',
  })
})

void test('report-manifest route aggregates structured child activity reports', async () => {
  await initializeActivityRegistry()
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-passcode-1'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-passcode-1').data,
        embeddedActivities: {
          'gallery-walk:4:0': {
            childSessionId: 'CHILD:s1:abc12:gallery-walk',
            activityId: 'gallery-walk',
            startedAt: 123,
            owner: 'syncdeck-instructor',
          },
          'video-sync:3:0': {
            childSessionId: 'CHILD:s1:def45:video-sync',
            activityId: 'video-sync',
            startedAt: 100,
            owner: 'syncdeck-instructor',
          },
        },
      },
    },
    'CHILD:s1:abc12:gallery-walk': {
      id: 'CHILD:s1:abc12:gallery-walk',
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
        embeddedLaunch: {
          parentSessionId: 's1',
          instanceKey: 'gallery-walk:4:0',
          selectedOptions: {},
        },
      },
    },
    'CHILD:s1:def45:video-sync': {
      id: 'CHILD:s1:def45:video-sync',
      type: 'video-sync',
      created: Date.now(),
      lastActivity: Date.now(),
      data: {},
    },
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.get['/api/syncdeck/:sessionId/report-manifest']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {},
      {},
      { 'x-syncdeck-instructor-passcode': 'teacher-passcode-1' },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as {
    parentSessionId: string
    activities: Array<{ activityId: string; activityName: string; report: { instanceKey: string; students?: Array<{ studentId: string }> } }>
    students: Array<{ studentId: string; displayName?: string | null }>
  }
  assert.equal(body.parentSessionId, 's1')
  assert.equal(body.activities.length, 1)
  assert.equal(body.activities[0]?.activityId, 'gallery-walk')
  assert.equal(body.activities[0]?.activityName, 'Gallery Walk')
  assert.equal(body.activities[0]?.report.instanceKey, 'gallery-walk:4:0')
  assert.deepEqual(body.students, [
    { studentId: 'studentA', displayName: 'Avery - Bridge Design' },
  ])
})

void test('report route returns downloadable session-level HTML built from the manifest', async () => {
  await initializeActivityRegistry()
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-passcode-1'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-passcode-1').data,
        embeddedActivities: {
          'gallery-walk:4:0': {
            childSessionId: 'CHILD:s1:abc12:gallery-walk',
            activityId: 'gallery-walk',
            startedAt: 123,
            owner: 'syncdeck-instructor',
          },
        },
      },
    },
    'CHILD:s1:abc12:gallery-walk': {
      id: 'CHILD:s1:abc12:gallery-walk',
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
        embeddedLaunch: {
          parentSessionId: 's1',
          instanceKey: 'gallery-walk:4:0',
          selectedOptions: {},
        },
      },
    },
    'CHILD:s1:abc12:video-sync': {
      id: 'CHILD:s1:abc12:video-sync',
      type: 'video-sync',
      created: Date.now(),
      lastActivity: Date.now(),
      data: {},
    },
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.get['/api/syncdeck/:sessionId/report']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {},
      {},
      { 'x-syncdeck-instructor-passcode': 'teacher-passcode-1' },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8')
  assert.match(res.headers['Content-Disposition'] ?? '', /attachment; filename="syncdeck-s1\.html"/)
  assert.equal(typeof res.body, 'string')
  assert.match(String(res.body), /Session Summary/)
  assert.match(String(res.body), /By Activity/)
  assert.match(String(res.body), /By Student/)
  assert.match(String(res.body), /Critique Day/)
  assert.match(String(res.body), /Avery - Bridge Design/)
})

void test('report manifest ignores legacy embedded activity entries without a real child sessionId', async () => {
  await initializeActivityRegistry()
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-passcode-1'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-passcode-1').data,
        embeddedActivities: [
          {
            embeddedId: 'video-sync:3:0',
            activityType: 'video-sync',
            createdAt: Date.now(),
          },
        ],
      },
    },
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.get['/api/syncdeck/:sessionId/report-manifest']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {},
      {},
      { 'x-syncdeck-instructor-passcode': 'teacher-passcode-1' },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as {
    activities: Array<unknown>
  }
  assert.deepEqual(body.activities, [])
})

void test('embedded-activity end route removes keyed state, deletes child session, and broadcasts end', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-passcode-1'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-passcode-1').data,
        embeddedActivities: {
          'video-sync:3:0': {
            childSessionId: 'CHILD:s1:abc12:video-sync',
            activityId: 'video-sync',
            startedAt: 123,
            owner: 'syncdeck-instructor',
          },
        },
      },
    },
    'CHILD:s1:abc12:video-sync': {
      id: 'CHILD:s1:abc12:video-sync',
      type: 'video-sync',
      created: 1,
      lastActivity: 1,
      data: {},
    },
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-activity/end']
  assert.equal(typeof handler, 'function')

  const studentSocket = new MockSocket()
  studentSocket.sessionId = 's1'
  ;(studentSocket as MockSocket & { isInstructor?: boolean }).isInstructor = false
  ws.wss.clients.add(studentSocket)

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {
        instructorPasscode: 'teacher-passcode-1',
        instanceKey: 'video-sync:3:0',
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, {
    ok: true,
    instanceKey: 'video-sync:3:0',
    childSessionId: 'CHILD:s1:abc12:video-sync',
  })
  const storedParentSession = storeState.store.s1
  assert.ok(storedParentSession)
  assert.deepEqual((storedParentSession.data as { embeddedActivities: Record<string, unknown> }).embeddedActivities, {})
  assert.equal(storeState.store['CHILD:s1:abc12:video-sync'], undefined)

  const payloads = studentSocket.sent.map((entry) => JSON.parse(entry) as { payload?: Record<string, unknown> })
  assert.ok(payloads.some((entry) => entry.payload?.type === 'embedded-activity-end' && entry.payload?.instanceKey === 'video-sync:3:0'))
})

void test('embedded-activity entry route issues a fresh token for a registered parent student', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const childSessionId = 'CHILD:s1:abc12:video-sync'
  const storeState = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-passcode-1'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-passcode-1').data,
        lastInstructorStatePayload: {
          type: 'slidechanged',
          payload: { h: 3, v: 0, f: 0 },
        },
        students: [{
          studentId: 'student-1',
          name: 'Ada Lovelace',
          joinedAt: 100,
          lastSeenAt: 110,
          lastIndices: null,
          lastStudentStateAt: null,
        }],
        embeddedActivities: {
          'video-sync:3:0': {
            childSessionId,
            activityId: 'video-sync',
            startedAt: 123,
            owner: 'syncdeck-instructor',
          },
        },
      },
    },
    [childSessionId]: {
      id: childSessionId,
      type: 'video-sync',
      created: 1,
      lastActivity: 1,
      data: {},
    },
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-activity/entry']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {
        instanceKey: 'video-sync:3:0',
        childSessionId,
        studentId: 'student-1',
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  const body = res.body as {
    resolvedRole: string
    instanceKey: string
    childSessionId: string
    entryParticipantToken: string
    values: Record<string, unknown>
  }
  assert.equal(body.resolvedRole, 'student')
  assert.equal(body.instanceKey, 'video-sync:3:0')
  assert.equal(body.childSessionId, childSessionId)
  assert.equal(typeof body.entryParticipantToken, 'string')
  assert.equal(body.values.participantId, 'student-1')
  assert.equal(body.values.displayName, 'Ada Lovelace')
})

void test('embedded-activity auto-activate route marks released resonance children to activate all questions', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const childSessionId = 'CHILD:s1:abc12:resonance'
  const storeState = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-passcode-1'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-passcode-1').data,
        lastInstructorStatePayload: {
          type: 'slidechanged',
          payload: { h: 3, v: 0, f: 0 },
        },
        students: [{
          studentId: 'student-1',
          name: 'Ada Lovelace',
          joinedAt: 100,
          lastSeenAt: 110,
          lastIndices: null,
          lastStudentStateAt: null,
        }],
        embeddedActivities: {
          'resonance:3:1': {
            childSessionId,
            activityId: 'resonance',
            startedAt: 123,
            owner: 'syncdeck-instructor',
          },
        },
      },
    },
    [childSessionId]: {
      id: childSessionId,
      type: 'resonance',
      created: 1,
      lastActivity: 1,
      data: {
        embeddedParentSessionId: 's1',
        embeddedInstanceKey: 'resonance:3:1',
        embeddedLaunch: {
          parentSessionId: 's1',
          instanceKey: 'resonance:3:1',
          selectedOptions: {
            questions: [
              { id: 'q1', type: 'free-response', text: 'Explain why.', order: 0 },
              {
                id: 'q2',
                type: 'multiple-choice',
                text: 'Pick one.',
                order: 1,
                options: [
                  { id: 'a', text: 'A' },
                  { id: 'b', text: 'B' },
                ],
              },
            ],
          },
        },
      },
    },
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-activity/auto-activate']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {
        instanceKey: 'resonance:3:1',
        childSessionId,
        studentId: 'student-1',
        autoActivateAllQuestions: true,
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, {
    ok: true,
    instanceKey: 'resonance:3:1',
    childSessionId,
    studentId: 'student-1',
    activated: true,
  })

  const childSession = storeState.store[childSessionId] as SessionRecord & {
    data: {
      embeddedLaunch?: { selectedOptions?: Record<string, unknown> }
    }
  }
  assert.deepEqual(childSession.data.embeddedLaunch?.selectedOptions, {
    autoActivateAllQuestions: true,
    questions: [
      { id: 'q1', type: 'free-response', text: 'Explain why.', order: 0 },
      {
        id: 'q2',
        type: 'multiple-choice',
        text: 'Pick one.',
        order: 1,
        options: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
      },
    ],
  })
})

void test('embedded-activity auto-activate route allows released horizontal resonance slides even without stored student indices', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const childSessionId = 'CHILD:s1:horizontal1:resonance'
  const storeState = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-passcode-1'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-passcode-1').data,
        lastInstructorStatePayload: {
          type: 'slidechanged',
          payload: { h: 4, v: 0, f: 0 },
        },
        students: [{
          studentId: 'student-1',
          name: 'Ada Lovelace',
          joinedAt: 100,
          lastSeenAt: 110,
          lastIndices: null,
          lastStudentStateAt: null,
        }],
        embeddedActivities: {
          'resonance:2:0': {
            childSessionId,
            activityId: 'resonance',
            startedAt: 123,
            owner: 'syncdeck-instructor',
          },
        },
      },
    },
    [childSessionId]: {
      id: childSessionId,
      type: 'resonance',
      created: 1,
      lastActivity: 1,
      data: {
        embeddedParentSessionId: 's1',
        embeddedInstanceKey: 'resonance:2:0',
        embeddedLaunch: {
          parentSessionId: 's1',
          instanceKey: 'resonance:2:0',
          selectedOptions: {
            questions: [
              { id: 'q1', type: 'free-response', text: 'Explain why.', order: 0 },
            ],
          },
        },
      },
    },
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-activity/auto-activate']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {
        instanceKey: 'resonance:2:0',
        childSessionId,
        studentId: 'student-1',
        autoActivateAllQuestions: true,
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, {
    ok: true,
    instanceKey: 'resonance:2:0',
    childSessionId,
    studentId: 'student-1',
    activated: true,
  })
})

void test('embedded-activity auto-activate route supports variant-suffixed resonance instance keys', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const childSessionId = 'CHILD:s1:variant1:resonance'
  const storeState = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-passcode-1'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-passcode-1').data,
        lastInstructorStatePayload: {
          type: 'slidechanged',
          payload: { h: 3, v: 0, f: 0 },
        },
        students: [{
          studentId: 'student-1',
          name: 'Ada Lovelace',
          joinedAt: 100,
          lastSeenAt: 110,
          lastIndices: null,
          lastStudentStateAt: null,
        }],
        embeddedActivities: {
          'resonance:3:1:variantA': {
            childSessionId,
            activityId: 'resonance',
            startedAt: 123,
            owner: 'syncdeck-instructor',
          },
        },
      },
    },
    [childSessionId]: {
      id: childSessionId,
      type: 'resonance',
      created: 1,
      lastActivity: 1,
      data: {
        embeddedParentSessionId: 's1',
        embeddedInstanceKey: 'resonance:3:1:variantA',
        embeddedLaunch: {
          parentSessionId: 's1',
          instanceKey: 'resonance:3:1:variantA',
          selectedOptions: {
            questions: [
              { id: 'q1', type: 'free-response', text: 'Explain why.', order: 0 },
            ],
          },
        },
      },
    },
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-activity/auto-activate']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {
        instanceKey: 'resonance:3:1:variantA',
        childSessionId,
        studentId: 'student-1',
        autoActivateAllQuestions: true,
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, {
    ok: true,
    instanceKey: 'resonance:3:1:variantA',
    childSessionId,
    studentId: 'student-1',
    activated: true,
  })
})

void test('embedded-activity auto-activate route parses anchored indices before numeric suffix segments', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const childSessionId = 'CHILD:s1:variantnum:resonance'
  const storeState = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-passcode-1'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-passcode-1').data,
        lastInstructorStatePayload: {
          type: 'slidechanged',
          payload: { h: 3, v: 0, f: 0 },
        },
        students: [{
          studentId: 'student-1',
          name: 'Ada Lovelace',
          joinedAt: 100,
          lastSeenAt: 110,
          lastIndices: null,
          lastStudentStateAt: null,
        }],
        embeddedActivities: {
          'resonance:3:1:variant1': {
            childSessionId,
            activityId: 'resonance',
            startedAt: 123,
            owner: 'syncdeck-instructor',
          },
        },
      },
    },
    [childSessionId]: {
      id: childSessionId,
      type: 'resonance',
      created: 1,
      lastActivity: 1,
      data: {
        embeddedParentSessionId: 's1',
        embeddedInstanceKey: 'resonance:3:1:variant1',
        embeddedLaunch: {
          parentSessionId: 's1',
          instanceKey: 'resonance:3:1:variant1',
          selectedOptions: {
            questions: [
              { id: 'q1', type: 'free-response', text: 'Explain why.', order: 0 },
            ],
          },
        },
      },
    },
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-activity/auto-activate']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {
        instanceKey: 'resonance:3:1:variant1',
        childSessionId,
        studentId: 'student-1',
        autoActivateAllQuestions: true,
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, {
    ok: true,
    instanceKey: 'resonance:3:1:variant1',
    childSessionId,
    studentId: 'student-1',
    activated: true,
  })
})

void test('embedded-activity auto-activate route is idempotent after resonance activates questions', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const childSessionId = 'CHILD:s1:abc12:resonance'
  const storeState = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-passcode-1'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-passcode-1').data,
        lastInstructorStatePayload: {
          type: 'slidechanged',
          payload: { h: 3, v: 0, f: 0 },
        },
        students: [{
          studentId: 'student-1',
          name: 'Ada Lovelace',
          joinedAt: 100,
          lastSeenAt: 110,
          lastIndices: { h: 3, v: 1, f: 0 },
          lastStudentStateAt: null,
        }],
        embeddedActivities: {
          'resonance:3:1': {
            childSessionId,
            activityId: 'resonance',
            startedAt: 123,
            owner: 'syncdeck-instructor',
          },
        },
      },
    },
    [childSessionId]: {
      id: childSessionId,
      type: 'resonance',
      created: 1,
      lastActivity: 1,
      data: {
        embeddedParentSessionId: 's1',
        embeddedInstanceKey: 'resonance:3:1',
        embeddedLaunch: {
          parentSessionId: 's1',
          instanceKey: 'resonance:3:1',
          selectedOptions: {
            questions: [
              { id: 'q1', type: 'free-response', text: 'Explain why.', order: 0 },
              {
                id: 'q2',
                type: 'multiple-choice',
                text: 'Pick one.',
                order: 1,
                options: [
                  { id: 'a', text: 'A' },
                  { id: 'b', text: 'B' },
                ],
              },
            ],
          },
        },
      },
    },
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-activity/auto-activate']
  assert.equal(typeof handler, 'function')

  const firstResponse = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {
        instanceKey: 'resonance:3:1',
        childSessionId,
        studentId: 'student-1',
        autoActivateAllQuestions: true,
      },
    ),
    firstResponse,
  )

  assert.equal(firstResponse.statusCode, 200)
  assert.deepEqual(firstResponse.body, {
    ok: true,
    instanceKey: 'resonance:3:1',
    childSessionId,
    studentId: 'student-1',
    activated: true,
  })

  const childSession = storeState.store[childSessionId] as SessionRecord & {
    data: {
      activeQuestionIds?: string[]
      embeddedLaunch?: { selectedOptions?: Record<string, unknown> }
    }
  }
  childSession.data.activeQuestionIds = ['q1', 'q2']
  childSession.data.embeddedLaunch = {
    ...(childSession.data.embeddedLaunch ?? {}),
    selectedOptions: {
      questions: [
        { id: 'q1', type: 'free-response', text: 'Explain why.', order: 0 },
        {
          id: 'q2',
          type: 'multiple-choice',
          text: 'Pick one.',
          order: 1,
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
        },
      ],
    },
  }
  const childSessionBeforeSecondCall = JSON.parse(JSON.stringify(childSession))

  const secondResponse = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {
        instanceKey: 'resonance:3:1',
        childSessionId,
        studentId: 'student-1',
        autoActivateAllQuestions: true,
      },
    ),
    secondResponse,
  )

  assert.equal(secondResponse.statusCode, 200)
  assert.deepEqual(secondResponse.body, {
    ok: true,
    instanceKey: 'resonance:3:1',
    childSessionId,
    studentId: 'student-1',
    activated: false,
  })
  assert.deepEqual(storeState.store[childSessionId], childSessionBeforeSecondCall)
})

void test('embedded-activity auto-activate route is idempotent when resonance already has an active run', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const childSessionId = 'CHILD:s1:run01:resonance'
  const storeState = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-passcode-1'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-passcode-1').data,
        lastInstructorStatePayload: {
          type: 'slidechanged',
          payload: { h: 3, v: 0, f: 0 },
        },
        students: [{
          studentId: 'student-1',
          name: 'Ada Lovelace',
          joinedAt: 100,
          lastSeenAt: 110,
          lastIndices: { h: 3, v: 1, f: 0 },
          lastStudentStateAt: null,
        }],
        embeddedActivities: {
          'resonance:3:1': {
            childSessionId,
            activityId: 'resonance',
            startedAt: 123,
            owner: 'syncdeck-instructor',
          },
        },
      },
    },
    [childSessionId]: {
      id: childSessionId,
      type: 'resonance',
      created: 1,
      lastActivity: 1,
      data: {
        embeddedParentSessionId: 's1',
        embeddedInstanceKey: 'resonance:3:1',
        activeQuestionIds: [],
        activeQuestionRunStartedAt: 12345,
        embeddedLaunch: {
          parentSessionId: 's1',
          instanceKey: 'resonance:3:1',
          selectedOptions: {
            questions: [
              { id: 'q1', type: 'free-response', text: 'Explain why.', order: 0 },
            ],
          },
        },
      },
    },
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-activity/auto-activate']
  assert.equal(typeof handler, 'function')

  const childSessionBeforeCall = JSON.parse(JSON.stringify(storeState.store[childSessionId]))
  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {
        instanceKey: 'resonance:3:1',
        childSessionId,
        studentId: 'student-1',
        autoActivateAllQuestions: true,
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, {
    ok: true,
    instanceKey: 'resonance:3:1',
    childSessionId,
    studentId: 'student-1',
    activated: false,
  })
  assert.deepEqual(storeState.store[childSessionId], childSessionBeforeCall)
})

void test('embedded-activity auto-activate route is idempotent after embedded resonance already auto-activated once', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const childSessionId = 'CHILD:s1:auto01:resonance'
  const storeState = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-passcode-1'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-passcode-1').data,
        lastInstructorStatePayload: {
          type: 'slidechanged',
          payload: { h: 3, v: 0, f: 0 },
        },
        students: [{
          studentId: 'student-1',
          name: 'Ada Lovelace',
          joinedAt: 100,
          lastSeenAt: 110,
          lastIndices: { h: 3, v: 1, f: 0 },
          lastStudentStateAt: null,
        }],
        embeddedActivities: {
          'resonance:3:1': {
            childSessionId,
            activityId: 'resonance',
            startedAt: 123,
            owner: 'syncdeck-instructor',
          },
        },
      },
    },
    [childSessionId]: {
      id: childSessionId,
      type: 'resonance',
      created: 1,
      lastActivity: 1,
      data: {
        embeddedParentSessionId: 's1',
        embeddedInstanceKey: 'resonance:3:1',
        activeQuestionIds: [],
        activeQuestionRunStartedAt: null,
        embeddedAutoActivatedAt: 12345,
        embeddedLaunch: {
          parentSessionId: 's1',
          instanceKey: 'resonance:3:1',
          selectedOptions: {
            questions: [
              { id: 'q1', type: 'free-response', text: 'Explain why.', order: 0 },
            ],
          },
        },
      },
    },
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-activity/auto-activate']
  assert.equal(typeof handler, 'function')

  const childSessionBeforeCall = JSON.parse(JSON.stringify(storeState.store[childSessionId]))
  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {
        instanceKey: 'resonance:3:1',
        childSessionId,
        studentId: 'student-1',
        autoActivateAllQuestions: true,
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, {
    ok: true,
    instanceKey: 'resonance:3:1',
    childSessionId,
    studentId: 'student-1',
    activated: false,
  })
  assert.deepEqual(storeState.store[childSessionId], childSessionBeforeCall)
})

void test('embedded-activity auto-activate route rejects students who are not on a released embedded slide', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const childSessionId = 'CHILD:s1:abc12:resonance'
  const storeState = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-passcode-1'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-passcode-1').data,
        lastInstructorStatePayload: {
          type: 'slidechanged',
          payload: { h: 3, v: 0, f: 0 },
        },
        students: [{
          studentId: 'student-1',
          name: 'Ada Lovelace',
          joinedAt: 100,
          lastSeenAt: 110,
          lastIndices: { h: 3, v: 0, f: 0 },
          lastStudentStateAt: null,
        }],
        embeddedActivities: {
          'resonance:3:0': {
            childSessionId,
            activityId: 'resonance',
            startedAt: 123,
            owner: 'syncdeck-instructor',
          },
        },
      },
    },
    [childSessionId]: {
      id: childSessionId,
      type: 'resonance',
      created: 1,
      lastActivity: 1,
      data: {
        embeddedParentSessionId: 's1',
        embeddedInstanceKey: 'resonance:3:0',
        embeddedLaunch: {
          parentSessionId: 's1',
          instanceKey: 'resonance:3:0',
          selectedOptions: {
            questions: [
              { id: 'q1', type: 'free-response', text: 'Explain why.', order: 0 },
            ],
          },
        },
      },
    },
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-activity/auto-activate']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {
        instanceKey: 'resonance:3:0',
        childSessionId,
        studentId: 'student-1',
        autoActivateAllQuestions: true,
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 403)
  assert.deepEqual(res.body, { error: 'forbidden' })
  const childSession = storeState.store[childSessionId] as SessionRecord & {
    data: {
      embeddedLaunch?: { selectedOptions?: Record<string, unknown> }
    }
  }
  assert.deepEqual(childSession.data.embeddedLaunch?.selectedOptions, {
    questions: [
      { id: 'q1', type: 'free-response', text: 'Explain why.', order: 0 },
    ],
  })
})

void test('embedded-activity auto-activate route rejects future vertical resonance stacks that the instructor has not released', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const childSessionId = 'CHILD:s1:futurev:resonance'
  const storeState = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-passcode-1'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-passcode-1').data,
        lastInstructorStatePayload: {
          type: 'slidechanged',
          payload: { h: 3, v: 0, f: 0 },
        },
        students: [{
          studentId: 'student-1',
          name: 'Ada Lovelace',
          joinedAt: 100,
          lastSeenAt: 110,
          lastIndices: null,
          lastStudentStateAt: null,
        }],
        embeddedActivities: {
          'resonance:5:1': {
            childSessionId,
            activityId: 'resonance',
            startedAt: 123,
            owner: 'syncdeck-instructor',
          },
        },
      },
    },
    [childSessionId]: {
      id: childSessionId,
      type: 'resonance',
      created: 1,
      lastActivity: 1,
      data: {
        embeddedParentSessionId: 's1',
        embeddedInstanceKey: 'resonance:5:1',
        embeddedLaunch: {
          parentSessionId: 's1',
          instanceKey: 'resonance:5:1',
          selectedOptions: {
            questions: [
              { id: 'q1', type: 'free-response', text: 'Explain why.', order: 0 },
            ],
          },
        },
      },
    },
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-activity/auto-activate']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      {
        instanceKey: 'resonance:5:1',
        childSessionId,
        studentId: 'student-1',
        autoActivateAllQuestions: true,
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 403)
  assert.deepEqual(res.body, { error: 'forbidden' })
})

void test('embedded-activity start route supports concurrent instances under different keys', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-passcode-1'),
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-activity/start']
  assert.equal(typeof handler, 'function')

  const res1 = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      { instructorPasscode: 'teacher-passcode-1', activityId: 'video-sync', instanceKey: 'video-sync:3:0' },
    ),
    res1,
  )

  const res2 = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      { instructorPasscode: 'teacher-passcode-1', activityId: 'raffle', instanceKey: 'raffle:5:0' },
    ),
    res2,
  )

  assert.equal(res1.statusCode, 200)
  assert.equal(res2.statusCode, 200)

  const body1 = res1.body as { childSessionId: string; instanceKey: string }
  const body2 = res2.body as { childSessionId: string; instanceKey: string }
  assert.notEqual(body1.childSessionId, body2.childSessionId)

  const parentSession = storeState.store.s1 as SessionRecord & {
    data: { embeddedActivities: Record<string, { childSessionId: string; activityId: string }> }
  }
  assert.equal(parentSession.data.embeddedActivities['video-sync:3:0']?.activityId, 'video-sync')
  assert.equal(parentSession.data.embeddedActivities['raffle:5:0']?.activityId, 'raffle')
  assert.ok(storeState.store[body1.childSessionId])
  assert.ok(storeState.store[body2.childSessionId])
})

void test('embedded-activity start is idempotent per key even when a concurrent instance exists for a different key', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-passcode-1'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-passcode-1').data,
        embeddedActivities: {
          'video-sync:3:0': {
            childSessionId: 'CHILD:s1:abc12:video-sync',
            activityId: 'video-sync',
            startedAt: 100,
            owner: 'syncdeck-instructor',
          },
        },
      },
    },
    'CHILD:s1:abc12:video-sync': {
      id: 'CHILD:s1:abc12:video-sync',
      type: 'video-sync',
      created: Date.now(),
      lastActivity: Date.now(),
      data: {},
    },
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/syncdeck/:sessionId/embedded-activity/start']

  // Second start for the already-running key should be idempotent.
  const resIdempotent = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      { instructorPasscode: 'teacher-passcode-1', activityId: 'video-sync', instanceKey: 'video-sync:3:0' },
    ),
    resIdempotent,
  )

  // A new key for a different position should succeed independently.
  const resNew = createResponse()
  await handler?.(
    createRequest(
      { sessionId: 's1' },
      { instructorPasscode: 'teacher-passcode-1', activityId: 'video-sync', instanceKey: 'video-sync:7:0' },
    ),
    resNew,
  )

  assert.equal(resIdempotent.statusCode, 200)
  assert.deepEqual(resIdempotent.body, {
    childSessionId: 'CHILD:s1:abc12:video-sync',
    instanceKey: 'video-sync:3:0',
  })

  assert.equal(resNew.statusCode, 200)
  const newBody = resNew.body as { childSessionId: string; instanceKey: string }
  assert.equal(newBody.instanceKey, 'video-sync:7:0')
  assert.match(newBody.childSessionId, /^CHILD:s1:[a-f0-9]{5}:video-sync$/)

  const parentSession = storeState.store.s1 as SessionRecord & {
    data: { embeddedActivities: Record<string, { childSessionId: string }> }
  }
  assert.equal(parentSession.data.embeddedActivities['video-sync:3:0']?.childSessionId, 'CHILD:s1:abc12:video-sync')
  assert.equal(parentSession.data.embeddedActivities['video-sync:7:0']?.childSessionId, newBody.childSessionId)
})

void test('delete-session route cascades deletion of all child sessions', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const child1Id = 'CHILD:s1:abc12:video-sync'
  const child2Id = 'CHILD:s1:abc13:embedded-test'
  const storeState = createSessionStore({
    s1: {
      ...createSyncDeckSession('s1', 'teacher-passcode-1'),
      data: {
        ...createSyncDeckSession('s1', 'teacher-passcode-1').data,
        embeddedActivities: {
          'video-sync:3:0': {
            childSessionId: child1Id,
            activityId: 'video-sync',
            startedAt: 110,
            owner: 'syncdeck-instructor',
          },
          'embedded-test:5:0': {
            childSessionId: child2Id,
            activityId: 'embedded-test',
            startedAt: 120,
            owner: 'syncdeck-instructor',
          },
        },
      },
    },
    [child1Id]: { id: child1Id, type: 'video-sync', created: 1, lastActivity: 1, data: {} },
    [child2Id]: { id: child2Id, type: 'embedded-test', created: 1, lastActivity: 1, data: {} },
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.delete['/api/syncdeck/:sessionId']
  assert.equal(typeof handler, 'function')

  const studentSocket = new MockSocket()
  studentSocket.sessionId = 's1'
  ws.wss.clients.add(studentSocket)

  const res = createResponse()
  await handler?.(
    createRequest({ sessionId: 's1' }, { instructorPasscode: 'teacher-passcode-1' }),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { success: true, deleted: 's1' })

  // Both child sessions must be gone.
  assert.equal(storeState.store[child1Id], undefined)
  assert.equal(storeState.store[child2Id], undefined)

  // The parent session must be gone.
  assert.equal(storeState.store.s1, undefined)

  // Connected clients must receive a session-ended signal.
  assert.ok(studentSocket.sent.some((entry) => {
    const parsed = JSON.parse(entry) as { type?: string }
    return parsed.type === 'session-ended'
  }))
})

void test('delete-session route requires valid instructor passcode', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({
    s1: createSyncDeckSession('s1', 'teacher-passcode-1'),
  })
  setupSyncDeckRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.delete['/api/syncdeck/:sessionId']
  assert.equal(typeof handler, 'function')

  const resMissing = createResponse()
  await handler?.(createRequest({ sessionId: 's1' }, {}), resMissing)
  assert.equal(resMissing.statusCode, 403)

  const resWrong = createResponse()
  await handler?.(
    createRequest({ sessionId: 's1' }, { instructorPasscode: 'wrong-passcode' }),
    resWrong,
  )
  assert.equal(resWrong.statusCode, 403)

  // Session must still exist after rejected attempts.
  assert.ok(storeState.store.s1)
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
  assert.equal(updated.standaloneMode, false)
})

void test('configure route can enable standalone mode for solo-launched sessions', async () => {
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
      {
        presentationUrl: 'https://example.com/deck',
        instructorPasscode: 'teacher-pass',
        standaloneMode: true,
      },
    ),
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { ok: true })
  const updated = storeState.store.s1?.data as Record<string, unknown>
  assert.equal(updated.presentationUrl, 'https://example.com/deck')
  assert.equal(updated.standaloneMode, true)
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
