import assert from 'node:assert/strict'
import test from 'node:test'
import setupJavaFormatPracticeRoutes from './routes.js'
import type { SessionRecord } from 'activebits-server/core/sessions.js'
import { acceptEntryParticipant, getSessionParticipantCookieName, issueAcceptedEntryParticipantToken } from 'activebits-server/core/acceptedEntryParticipants.js'
import { getActivityCapabilityCookieName, issueActivityCapability } from 'activebits-server/core/activityCapabilities.js'

type Handler = (req: { params: Record<string, string>; body?: unknown; cookies?: Record<string, unknown> }, res: MockResponse) => void | Promise<void>
type TestSocket = {
  readyState: number
  upgradeHeaders: { cookie: string }
  principalKind?: 'manager' | 'participant'
  send: (value: string) => number
  close: (code?: number, reason?: string) => void
  on(): void
  once(): void
  terminate(): void
  ping(): void
  sent: string[]
  closed: { code?: number; reason?: string } | null
}

class MockResponse {
  statusCode = 200
  body: unknown = null
  cookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = []
  headers: Record<string, string> = {}
  status(code: number): this { this.statusCode = code; return this }
  cookie(name: string, value: string, options: Record<string, unknown>): void { this.cookies.push({ name, value, options }) }
  setHeader(name: string, value: string): void { this.headers[name.toLowerCase()] = value }
  json(body: unknown): void { this.body = body }
}

void test('Java Format creation issues a manager cookie and manager routes reject a missing or wrong-session cookie', async () => {
  const routes = new Map<string, Handler>()
  const records = new Map<string, SessionRecord>()
  const app = {
    post(path: string, handler: Handler) { routes.set(`POST ${path}`, handler) },
    get(path: string, handler: Handler) { routes.set(`GET ${path}`, handler) },
  }
  const sessions = {
    get: async (id: string) => records.get(id) ?? null,
    set: async (id: string, record: SessionRecord) => { records.set(id, record) },
  }
  const ws = { wss: { clients: new Set(), close() {} }, register() {} }
  setupJavaFormatPracticeRoutes(app, sessions as never, ws as never)

  const create = routes.get('POST /api/java-format-practice/create')
  const difficulty = routes.get('POST /api/java-format-practice/:sessionId/difficulty')
  assert.ok(create)
  assert.ok(difficulty)
  const created = new MockResponse()
  await create({ params: {} }, created)
  const sessionId = (created.body as { id: string }).id
  const managerCookie = created.cookies[0]
  assert.ok(managerCookie)
  assert.equal(managerCookie.options.httpOnly, true)
  assert.equal(created.headers['cache-control'], 'no-store')

  const denied = new MockResponse()
  await difficulty({ params: { sessionId }, body: { difficulty: 'advanced' } }, denied)
  assert.equal(denied.statusCode, 403)

  const allowed = new MockResponse()
  await difficulty({ params: { sessionId }, body: { difficulty: 'advanced' }, cookies: { [managerCookie.name]: managerCookie.value } }, allowed)
  assert.equal(allowed.statusCode, 200)
  assert.deepEqual(allowed.body, { success: true, difficulty: 'advanced' })

  const wrongSession = new MockResponse()
  await difficulty({ params: { sessionId: 'wrong-session' }, body: { difficulty: 'advanced' }, cookies: { [managerCookie.name]: managerCookie.value } }, wrongSession)
  assert.equal(wrongSession.statusCode, 404)
})

void test('Java Format websocket admits only cookie principals and keeps roster updates manager-only', async () => {
  const registration: { socketHandler?: (socket: TestSocket, query: URLSearchParams) => void } = {}
  const records = new Map<string, SessionRecord>()
  const session: SessionRecord = { id: 'session-a', type: 'java-format-practice', created: 1, lastActivity: 1, data: { students: [] } }
  const manager = issueActivityCapability(session, 'manager')
  acceptEntryParticipant(session, { participantId: 'student-a', displayName: 'Ada' })
  const participantToken = issueAcceptedEntryParticipantToken(session, 'student-a')
  records.set(session.id, session)
  const clients = new Set<TestSocket>()
  const ws = { wss: { clients, close() {} }, register(_path: string, handler: (socket: TestSocket, query: URLSearchParams) => void) { registration.socketHandler = handler } }
  const app = { post() {}, get() {} }
  const sessions = { get: async (id: string) => records.get(id) ?? null, set: async (id: string, record: SessionRecord) => { records.set(id, record) } }
  setupJavaFormatPracticeRoutes(app as never, sessions as never, ws as never)
  const registeredSocketHandler = registration.socketHandler
  if (registeredSocketHandler === undefined) {
    throw new Error('Java Format socket handler was not registered')
  }

  const makeSocket = (cookie = ''): TestSocket => {
    const sent: string[] = []
    const socket: TestSocket = {
      readyState: 1,
      upgradeHeaders: { cookie },
      send: (value: string) => sent.push(value),
      close(code?: number, reason?: string) { socket.closed = { code, reason } },
      on() {},
      once() {},
      terminate() {},
      ping() {},
      sent,
      closed: null,
    }
    clients.add(socket)
    return socket
  }
  const denied = makeSocket()
  console.info('[TEST] java-format websocket denial: manager socket without a capability cookie is expected to close 1008')
  registeredSocketHandler(denied, new URLSearchParams(`sessionId=${session.id}&principal=manager`))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(denied.closed, { code: 1008, reason: 'activity-auth-required' })

  const unknownSession = makeSocket()
  console.info('[TEST] java-format websocket denial: connecting to an unknown session is expected to close 1008')
  registeredSocketHandler(unknownSession, new URLSearchParams('sessionId=does-not-exist&principal=participant'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(unknownSession.closed, { code: 1008, reason: 'activity-auth-required' })

  const missingSession = makeSocket()
  console.info('[TEST] java-format websocket denial: connecting without a sessionId is expected to close 1008')
  registeredSocketHandler(missingSession, new URLSearchParams('principal=participant'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(missingSession.closed, { code: 1008, reason: 'activity-auth-required' })

  const managerSocket = makeSocket(`${getActivityCapabilityCookieName('manager', session.id)}=${manager.token}`)
  registeredSocketHandler(managerSocket, new URLSearchParams(`sessionId=${session.id}&principal=manager`))
  const studentSocket = makeSocket([
    `${getActivityCapabilityCookieName('manager', session.id)}=${manager.token}`,
    `${getSessionParticipantCookieName(session.id)}=${participantToken}`,
  ].join('; '))
  registeredSocketHandler(studentSocket, new URLSearchParams(`sessionId=${session.id}&principal=participant`))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(managerSocket.principalKind, 'manager')
  assert.equal(studentSocket.principalKind, 'participant')
  assert.ok(managerSocket.sent.some((value) => JSON.parse(value).type === 'studentsUpdate'))
  assert.equal(studentSocket.sent.some((value) => JSON.parse(value).type === 'studentsUpdate'), false)
})

void test('Java Format stats route authorizes the participant cookie and broadcasts roster changes to managers only', async () => {
  const routes = new Map<string, Handler>()
  const records = new Map<string, SessionRecord>()
  const session: SessionRecord = {
    id: 'session-stats',
    type: 'java-format-practice',
    created: 1,
    lastActivity: 1,
    data: {
      students: [
        { id: 'student-a', name: 'Ada', connected: true, joined: 1, lastSeen: 1, stats: { total: 1, correct: 1, streak: 1, longestStreak: 1 } },
        { id: 'student-b', name: 'Bob', connected: true, joined: 1, lastSeen: 1, stats: { total: 2, correct: 2, streak: 2, longestStreak: 2 } },
      ],
    },
  }
  acceptEntryParticipant(session, { participantId: 'student-a', displayName: 'Ada' })
  const participantToken = issueAcceptedEntryParticipantToken(session, 'student-a')
  assert.ok(participantToken)
  records.set(session.id, session)

  const managerBroadcasts: string[] = []
  const allBroadcasts: string[] = []
  const clients = new Set<{ readyState: number; sessionId: string; principalKind: string; send: (value: string) => void }>([
    { readyState: 1, sessionId: session.id, principalKind: 'manager', send: (value) => managerBroadcasts.push(value) },
    { readyState: 1, sessionId: session.id, principalKind: 'participant', send: (value) => allBroadcasts.push(value) },
  ])
  const app = {
    post(path: string, handler: Handler) { routes.set(`POST ${path}`, handler) },
    get(path: string, handler: Handler) { routes.set(`GET ${path}`, handler) },
  }
  const sessions = {
    get: async (id: string) => records.get(id) ?? null,
    set: async (id: string, record: SessionRecord) => { records.set(id, record) },
  }
  const ws = { wss: { clients, close() {} }, register() {} }
  setupJavaFormatPracticeRoutes(app as never, sessions as never, ws as never)

  const stats = routes.get('POST /api/java-format-practice/:sessionId/stats')
  const roster = routes.get('GET /api/java-format-practice/:sessionId/students')
  assert.ok(stats)
  assert.ok(roster)
  const cookieName = getSessionParticipantCookieName(session.id)
  const nextStats = { total: 5, correct: 3, streak: 2, longestStreak: 4 }

  const denied = new MockResponse()
  console.info('[TEST] java-format stats: request without a participant cookie is expected to be rejected 403')
  await stats({ params: { sessionId: session.id }, body: { stats: nextStats } }, denied)
  assert.equal(denied.statusCode, 403)

  const invalid = new MockResponse()
  console.info('[TEST] java-format stats: non-object stats payload is expected to be rejected 400')
  await stats({ params: { sessionId: session.id }, body: { stats: 'not-an-object' }, cookies: { [cookieName]: participantToken } }, invalid)
  assert.equal(invalid.statusCode, 400)

  const accepted = new MockResponse()
  await stats({ params: { sessionId: session.id }, body: { stats: nextStats }, cookies: { [cookieName]: participantToken } }, accepted)
  assert.equal(accepted.statusCode, 200)
  assert.deepEqual(accepted.body, { success: true })

  const persisted = records.get(session.id)?.data as { students: Array<{ id: string; stats: unknown }> }
  assert.deepEqual(persisted.students.find((student) => student.id === 'student-a')?.stats, nextStats)
  assert.deepEqual(persisted.students.find((student) => student.id === 'student-b')?.stats, { total: 2, correct: 2, streak: 2, longestStreak: 2 })

  assert.ok(managerBroadcasts.some((value) => JSON.parse(value).type === 'studentsUpdate'))
  assert.equal(allBroadcasts.some((value) => JSON.parse(value).type === 'studentsUpdate'), false)

  const rosterRes = new MockResponse()
  await roster({ params: { sessionId: session.id }, cookies: { [getActivityCapabilityCookieName('manager', session.id)]: issueActivityCapability(session, 'manager').token } }, rosterRes)
  assert.equal(rosterRes.statusCode, 200)
  assert.equal(rosterRes.headers['cache-control'], 'no-store')
})

void test('Java Format stats route establishes the roster record when the socket has not connected yet', async () => {
  const routes = new Map<string, Handler>()
  const records = new Map<string, SessionRecord>()
  const session: SessionRecord = {
    id: 'session-stats-preconnect',
    type: 'java-format-practice',
    created: 1,
    lastActivity: 1,
    data: { students: [] },
  }
  acceptEntryParticipant(session, { participantId: 'student-z', displayName: 'Zoe' })
  const participantToken = issueAcceptedEntryParticipantToken(session, 'student-z')
  assert.ok(participantToken)
  records.set(session.id, session)

  const managerBroadcasts: string[] = []
  const clients = new Set<{ readyState: number; sessionId: string; principalKind: string; send: (value: string) => void }>([
    { readyState: 1, sessionId: session.id, principalKind: 'manager', send: (value) => managerBroadcasts.push(value) },
  ])
  const app = {
    post(path: string, handler: Handler) { routes.set(`POST ${path}`, handler) },
    get(path: string, handler: Handler) { routes.set(`GET ${path}`, handler) },
  }
  const sessions = {
    get: async (id: string) => records.get(id) ?? null,
    set: async (id: string, record: SessionRecord) => { records.set(id, record) },
  }
  setupJavaFormatPracticeRoutes(app as never, sessions as never, { wss: { clients, close() {} }, register() {} } as never)

  const stats = routes.get('POST /api/java-format-practice/:sessionId/stats')
  assert.ok(stats)
  const nextStats = { total: 7, correct: 4, streak: 3, longestStreak: 5 }

  const res = new MockResponse()
  await stats({
    params: { sessionId: session.id },
    body: { stats: nextStats },
    cookies: { [getSessionParticipantCookieName(session.id)]: participantToken },
  }, res)
  assert.equal(res.statusCode, 200)

  const persisted = records.get(session.id)?.data as { students: Array<{ id: string; name: string; stats: unknown }> }
  assert.equal(persisted.students.length, 1)
  assert.equal(persisted.students[0]?.id, 'student-z')
  assert.equal(persisted.students[0]?.name, 'Zoe')
  assert.deepEqual(persisted.students[0]?.stats, nextStats)
  assert.ok(managerBroadcasts.some((value) => JSON.parse(value).type === 'studentsUpdate'))
})

void test('Java Format participant admission aborts if the socket closes during the session lookup', async () => {
  const registration: { socketHandler?: (socket: TestSocket, query: URLSearchParams) => void } = {}
  const session: SessionRecord = { id: 'session-race', type: 'java-format-practice', created: 1, lastActivity: 1, data: { students: [] } }
  acceptEntryParticipant(session, { participantId: 'student-a', displayName: 'Ada' })
  const participantToken = issueAcceptedEntryParticipantToken(session, 'student-a')
  assert.ok(participantToken)

  let releaseGet: () => void = () => {}
  const getGate = new Promise<void>((resolve) => { releaseGet = resolve })
  let setCalls = 0
  const sessions = {
    get: async (id: string) => {
      if (id !== session.id) return null
      await getGate
      return session
    },
    set: async () => { setCalls += 1 },
  }
  const clients = new Set<TestSocket>()
  const broadcasts: string[] = []
  clients.add({
    readyState: 1, upgradeHeaders: { cookie: '' }, principalKind: 'manager',
    send: (value: string) => broadcasts.push(value), close() {}, on() {}, once() {}, terminate() {}, ping() {},
    sent: [], closed: null,
  } as unknown as TestSocket)
  const ws = { wss: { clients, close() {} }, register(_p: string, handler: (socket: TestSocket, query: URLSearchParams) => void) { registration.socketHandler = handler } }
  setupJavaFormatPracticeRoutes({ post() {}, get() {} } as never, sessions as never, ws as never)
  const socketHandler = registration.socketHandler
  assert.ok(socketHandler)

  const sent: string[] = []
  const socket: TestSocket = {
    readyState: 1,
    upgradeHeaders: { cookie: `${getSessionParticipantCookieName(session.id)}=${participantToken}` },
    send: (value: string) => sent.push(value), close() {}, on() {}, once() {}, terminate() {}, ping() {},
    sent, closed: null,
  }
  clients.add(socket)

  socketHandler(socket, new URLSearchParams(`sessionId=${session.id}&principal=participant`))
  // Close the socket before the deferred session lookup resolves.
  socket.readyState = 3
  releaseGet()
  await new Promise((resolve) => setTimeout(resolve, 0))

  const roster = (session.data as { students: unknown[] }).students
  assert.equal(socket.principalKind, undefined)
  assert.equal(roster.length, 0, 'no roster record is created for a closed socket')
  assert.equal(setCalls, 0)
  assert.equal(broadcasts.length, 0)
})
