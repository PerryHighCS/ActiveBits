/**
 * End-to-end handler tests for commissioned-ideas routes.
 * Uses the same mock harness pattern as algorithm-demo and resonance:
 * a fake app/sessions/ws triple is wired to setupCommissionedIdeasRoutes,
 * then individual handlers are invoked directly and the store is inspected.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { SessionRecord } from 'activebits-server/core/sessions.js'
import type { WsRouter } from '../../../types/websocket.js'
import setupCommissionedIdeasRoutes from './routes.js'
import type { CommissionedIdeasSessionData } from '../shared/types.js'

// ── Mock infrastructure ───────────────────────────────────────────────────────

type RouteHandler = (req: MockRequest, res: MockResponse) => Promise<void> | void

interface MockRequest {
  params: Record<string, string | undefined>
  query?: Record<string, string | undefined>
  body?: unknown
  headers?: Record<string, string | undefined>
}

interface MockResponse {
  statusCode: number
  body: unknown
  status(code: number): MockResponse
  json(payload: unknown): MockResponse
}

function createResponse(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    body: null,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  return res
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

function createMockWs(): WsRouter {
  return {
    wss: { clients: new Set(), close() {} },
    register() {},
  }
}

function createMockSessions(initial: Record<string, SessionRecord> = {}) {
  const store: Record<string, SessionRecord> = { ...initial }

  return {
    store,
    sessions: {
      async get(id: string) {
        return store[id] ?? null
      },
      async set(id: string, session: SessionRecord) {
        store[id] = session
      },
      async delete(id: string) {
        const had = id in store
        delete store[id]
        return had
      },
      async touch(_id: string) { return true },
      async getAll() { return Object.values(store) },
      async getAllIds() { return Object.keys(store) },
      cleanup() {},
      async close() {},
      subscribeToBroadcast() {},
    },
  }
}

function createRequest(
  params: Record<string, string | undefined> = {},
  body: unknown = {},
  headers: Record<string, string | undefined> = {},
): MockRequest {
  return { params, body, headers }
}

function withPasscode(
  params: Record<string, string | undefined>,
  body: unknown,
  passcode: string,
): MockRequest {
  return createRequest(params, body, { 'x-commissioned-ideas-instructor-passcode': passcode })
}

function withParticipantToken(
  params: Record<string, string | undefined>,
  body: unknown,
  token: string,
): MockRequest {
  return createRequest(params, body, { 'x-commissioned-ideas-participant-token': token })
}

function sessionData(store: Record<string, SessionRecord>, id: string): CommissionedIdeasSessionData {
  const session = store[id]
  assert.ok(session, `Session ${id} not found in store`)
  return session.data as CommissionedIdeasSessionData
}

// ── Helper: set up routes and pull a named handler ────────────────────────────

function setupAndGet(
  method: 'post' | 'get',
  path: string,
  initial: Record<string, SessionRecord> = {},
) {
  const app = createMockApp()
  const ws = createMockWs()
  const { store, sessions } = createMockSessions(initial)
  setupCommissionedIdeasRoutes(app, sessions, ws)
  const handler = app.handlers[method][path]
  assert.ok(handler, `Handler not registered: ${method.toUpperCase()} ${path}`)
  return { handler, store, sessions }
}

// ── POST /api/commissioned-ideas/create ──────────────────────────────────────

void test('create route returns 200 with a session id', async () => {
  const { handler } = setupAndGet('post', '/api/commissioned-ideas/create')

  const res = createResponse()
  await handler(createRequest(), res)

  assert.equal(res.statusCode, 200)
  const body = res.body as { id?: string }
  assert.equal(typeof body.id, 'string')
  assert.ok(body.id)
})

void test('create route persists a commissioned-ideas session in the store', async () => {
  const { handler, store } = setupAndGet('post', '/api/commissioned-ideas/create')

  const res = createResponse()
  await handler(createRequest(), res)

  const id = (res.body as { id: string }).id
  const session = store[id]
  assert.ok(session, 'Session was stored')
  assert.equal(session.type, 'commissioned-ideas')
})

void test('create route initializes default session data', async () => {
  const { handler, store } = setupAndGet('post', '/api/commissioned-ideas/create')

  const res = createResponse()
  await handler(createRequest(), res)

  const id = (res.body as { id: string }).id
  const data = sessionData(store, id)

  assert.equal(data.phase, 'registration')
  assert.equal(data.studentGroupingLocked, false)
  assert.equal(data.namingLocked, false)
  assert.equal(data.maxTeamSize, 4)
  assert.equal(data.groupingMode, 'manual')
  assert.equal(data.presentationRound, 1)
  assert.equal(data.allowLateRegistration, true)
  assert.deepEqual(data.teams, {})
  assert.deepEqual(data.participantRoster, {})
  assert.deepEqual(data.ballots, {})
  assert.deepEqual(data.presentationHistory, [])
  assert.equal(data.currentPresentationTeamId, null)
  assert.equal(data.podiumRevealStep, 'hidden')
})

void test('create route generates a unique id on each call', async () => {
  const { handler } = setupAndGet('post', '/api/commissioned-ideas/create')

  const res1 = createResponse()
  const res2 = createResponse()
  await handler(createRequest(), res1)
  await handler(createRequest(), res2)

  const id1 = (res1.body as { id: string }).id
  const id2 = (res2.body as { id: string }).id
  assert.notEqual(id1, id2)
})

// ── GET /api/commissioned-ideas/:sessionId/state ──────────────────────────────

void test('state route returns 400 when sessionId param is missing', async () => {
  const { handler } = setupAndGet('get', '/api/commissioned-ideas/:sessionId/state')

  const res = createResponse()
  await handler(createRequest({ sessionId: undefined }), res)

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, { error: 'Missing sessionId' })
})

void test('state route returns 404 for an unknown sessionId', async () => {
  const { handler } = setupAndGet('get', '/api/commissioned-ideas/:sessionId/state')

  const res = createResponse()
  await handler(createRequest({ sessionId: 'does-not-exist' }), res)

  assert.equal(res.statusCode, 404)
  assert.deepEqual(res.body, { error: 'Session not found' })
})

void test('state route returns 404 for a session of a different activity type', async () => {
  const foreignSession: SessionRecord = {
    id: 'wrong-type',
    type: 'raffle',
    created: Date.now(),
    lastActivity: Date.now(),
    data: { tickets: [] },
  }
  const { handler } = setupAndGet(
    'get',
    '/api/commissioned-ideas/:sessionId/state',
    { 'wrong-type': foreignSession },
  )

  const res = createResponse()
  await handler(createRequest({ sessionId: 'wrong-type' }), res)

  assert.equal(res.statusCode, 404)
})

void test('state route returns 200 with sessionId and data for a valid session', async () => {
  // First create a session so we have a real id
  const { handler: create, store, sessions } = setupAndGet('post', '/api/commissioned-ideas/create')
  const app = createMockApp()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())

  const createRes = createResponse()
  await create(createRequest(), createRes)
  const id = (createRes.body as { id: string }).id

  const stateHandler = app.handlers.get['/api/commissioned-ideas/:sessionId/state']
  assert.ok(stateHandler)
  const stateRes = createResponse()
  await stateHandler(createRequest({ sessionId: id }), stateRes)

  assert.equal(stateRes.statusCode, 200)
  const body = stateRes.body as { sessionId: string; data: Record<string, unknown> }
  assert.equal(body.sessionId, id)
  assert.notEqual(body.data, null)
  assert.equal(body.data.phase, 'registration')

  void store
})

void test('state route snapshot does not include instructorPasscode', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const { sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, ws)

  const createRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/create']!(createRequest(), createRes)
  const id = (createRes.body as { id: string }).id

  const stateRes = createResponse()
  await app.handlers.get['/api/commissioned-ideas/:sessionId/state']!(
    createRequest({ sessionId: id }),
    stateRes,
  )

  const data = (stateRes.body as { data: Record<string, unknown> }).data
  assert.equal('instructorPasscode' in data, false, 'instructorPasscode must not appear in student snapshot')
})

void test('state route snapshot does not include raw ballots field', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const { store: _store, sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, ws)

  const createRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/create']!(createRequest(), createRes)
  const id = (createRes.body as { id: string }).id

  const stateRes = createResponse()
  await app.handlers.get['/api/commissioned-ideas/:sessionId/state']!(
    createRequest({ sessionId: id }),
    stateRes,
  )

  const data = (stateRes.body as { data: Record<string, unknown> }).data
  assert.equal('ballots' in data, false, 'raw ballots must not appear in student snapshot')
  assert.equal(typeof data.ballotsReceived, 'number')
})

void test('state route never returns myBallot even when participantId query param is supplied', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const { sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, ws)

  const createRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/create']!(createRequest(), createRes)
  const sessionId = (createRes.body as { id: string }).id

  // Register a participant so there is a real id to attempt to look up
  const regRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/register-participant']!(
    createRequest({ sessionId }, { name: 'Alice' }),
    regRes,
  )
  const participantId = (regRes.body as { participantId: string }).participantId

  // Request state with the participant's own id — ballot data must still be absent
  const stateHandler = app.handlers.get['/api/commissioned-ideas/:sessionId/state']!
  const stateRes = createResponse()
  await stateHandler(
    { params: { sessionId }, query: { participantId }, body: {} },
    stateRes,
  )

  assert.equal(stateRes.statusCode, 200)
  const data = (stateRes.body as { data: Record<string, unknown> }).data
  assert.equal(data.myBallot, null, 'myBallot must always be null from the REST route')
  assert.equal(data.ballotSubmitted, false)
})

void test('state route snapshot participantRoster omits instructor-only fields', async () => {
  const now = Date.now()
  const sessionWithParticipants: SessionRecord = {
    id: 'sess-participants',
    type: 'commissioned-ideas',
    created: now,
    lastActivity: now,
    data: {
      phase: 'registration',
      studentGroupingLocked: false,
      namingLocked: false,
      maxTeamSize: 4,
      groupingMode: 'manual',
      presentationRound: 1,
      allowLateRegistration: true,
      teams: {},
      participantRoster: {
        p1: {
          id: 'p1',
          name: 'Alice',
          teamId: null,
          connected: true,
          lastSeen: 12345,
          rejectedByInstructor: false,
        },
      },
      ballots: {},
      presentationHistory: [],
      currentPresentationTeamId: null,
      podiumRevealStep: 'hidden',
    },
  }

  const { handler } = setupAndGet(
    'get',
    '/api/commissioned-ideas/:sessionId/state',
    { 'sess-participants': sessionWithParticipants },
  )

  const res = createResponse()
  await handler(createRequest({ sessionId: 'sess-participants' }), res)

  assert.equal(res.statusCode, 200)
  const data = (res.body as { data: Record<string, unknown> }).data
  const roster = data.participantRoster as Record<string, Record<string, unknown>>
  const p1 = roster['p1']
  assert.ok(p1, 'p1 should be present')
  assert.equal('connected' in p1, false)
  assert.equal('lastSeen' in p1, false)
  assert.equal('rejectedByInstructor' in p1, false)
  assert.equal('token' in p1, false, 'token must never appear in student snapshot')
  assert.equal(p1.id, 'p1')
  assert.equal(p1.name, 'Alice')
  assert.equal(p1.teamId, null)
})

void test('state route snapshot omits rejected participants', async () => {
  const now = Date.now()
  const sessionWithRejected: SessionRecord = {
    id: 'sess-rejected',
    type: 'commissioned-ideas',
    created: now,
    lastActivity: now,
    data: {
      phase: 'registration',
      studentGroupingLocked: false,
      namingLocked: false,
      maxTeamSize: 4,
      groupingMode: 'manual',
      presentationRound: 1,
      allowLateRegistration: true,
      teams: {},
      participantRoster: {
        approved: {
          id: 'approved',
          name: 'Alice',
          teamId: null,
          connected: true,
          lastSeen: 0,
          rejectedByInstructor: false,
        },
        rejected: {
          id: 'rejected',
          name: 'BadName',
          teamId: null,
          connected: false,
          lastSeen: 0,
          rejectedByInstructor: true,
        },
      },
      ballots: {},
      presentationHistory: [],
      currentPresentationTeamId: null,
      podiumRevealStep: 'hidden',
    },
  }

  const { handler } = setupAndGet(
    'get',
    '/api/commissioned-ideas/:sessionId/state',
    { 'sess-rejected': sessionWithRejected },
  )

  const res = createResponse()
  await handler(createRequest({ sessionId: 'sess-rejected' }), res)

  assert.equal(res.statusCode, 200)
  const data = (res.body as { data: Record<string, unknown> }).data
  const roster = data.participantRoster as Record<string, unknown>
  assert.ok('approved' in roster, 'approved participant should be visible')
  assert.equal('rejected' in roster, false, 'rejected participant must not appear in student snapshot')
})

void test('state route snapshot preserves team groupName from persisted value when no proposals', async () => {
  const now = Date.now()
  const sessionWithTeam: SessionRecord = {
    id: 'sess-team-name',
    type: 'commissioned-ideas',
    created: now,
    lastActivity: now,
    data: {
      phase: 'registration',
      studentGroupingLocked: false,
      namingLocked: false,
      maxTeamSize: 4,
      groupingMode: 'manual',
      presentationRound: 1,
      allowLateRegistration: true,
      teams: {
        t1: {
          id: 't1',
          groupName: 'The Finalists',
          projectName: 'Fin Tracker',
          registeredAt: now,
          presenterOrder: null,
          locked: false,
          memberIds: [],
          proposedGroupNames: [],
          proposedProjectNames: [],
          groupNameVotes: {},
          projectNameVotes: {},
        },
      },
      participantRoster: {},
      ballots: {},
      presentationHistory: [],
      currentPresentationTeamId: null,
      podiumRevealStep: 'hidden',
    },
  }

  const { handler } = setupAndGet(
    'get',
    '/api/commissioned-ideas/:sessionId/state',
    { 'sess-team-name': sessionWithTeam },
  )

  const res = createResponse()
  await handler(createRequest({ sessionId: 'sess-team-name' }), res)

  assert.equal(res.statusCode, 200)
  const data = (res.body as { data: Record<string, unknown> }).data
  const teams = data.teams as Record<string, Record<string, unknown>>
  assert.equal(teams['t1']?.groupName, 'The Finalists')
  assert.equal(teams['t1']?.projectName, 'Fin Tracker')
})

// ── POST /api/commissioned-ideas/:sessionId/register-participant ──────────────

void test('register-participant returns 400 when sessionId is missing', async () => {
  const { handler } = setupAndGet(
    'post',
    '/api/commissioned-ideas/:sessionId/register-participant',
  )

  const res = createResponse()
  await handler(createRequest({ sessionId: undefined }, { name: 'Alice' }), res)

  assert.equal(res.statusCode, 400)
})

void test('register-participant returns 404 for unknown session', async () => {
  const { handler } = setupAndGet(
    'post',
    '/api/commissioned-ideas/:sessionId/register-participant',
  )

  const res = createResponse()
  await handler(createRequest({ sessionId: 'no-such-session' }, { name: 'Alice' }), res)

  assert.equal(res.statusCode, 404)
})

void test('register-participant returns 400 when name is missing', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const { sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, ws)

  // Create a session first
  const createRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/create']!(createRequest(), createRes)
  const sessionId = (createRes.body as { id: string }).id

  const handler = app.handlers.post['/api/commissioned-ideas/:sessionId/register-participant']!
  const res = createResponse()
  await handler(createRequest({ sessionId }, { name: '' }), res)

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, { error: 'name is required' })
})

void test('register-participant creates a new participant and returns id + name + token', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const { sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, ws)

  const createRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/create']!(createRequest(), createRes)
  const sessionId = (createRes.body as { id: string }).id

  const handler = app.handlers.post['/api/commissioned-ideas/:sessionId/register-participant']!
  const res = createResponse()
  await handler(createRequest({ sessionId }, { name: 'Alice' }), res)

  assert.equal(res.statusCode, 200)
  const body = res.body as { participantId: string; name: string; token: string }
  assert.equal(typeof body.participantId, 'string')
  assert.ok(body.participantId.length > 0)
  assert.equal(body.name, 'Alice')
  assert.equal(typeof body.token, 'string', 'token must be returned for student auth')
  assert.ok(body.token.length > 0)
})

void test('register-participant stores participant in session roster', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const { store, sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, ws)

  const createRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/create']!(createRequest(), createRes)
  const sessionId = (createRes.body as { id: string }).id

  const handler = app.handlers.post['/api/commissioned-ideas/:sessionId/register-participant']!
  const regRes = createResponse()
  await handler(createRequest({ sessionId }, { name: 'Bob' }), regRes)

  const body = regRes.body as { participantId: string }
  const data = sessionData(store, sessionId)
  const participant = data.participantRoster[body.participantId]
  assert.ok(participant, 'participant must exist in roster')
  assert.equal(participant.name, 'Bob')
  assert.equal(participant.teamId, null)
  assert.equal(participant.rejectedByInstructor, false)
  assert.equal(participant.connected, true)
})

void test('register-participant reconnects an existing participant by id', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const { store, sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, ws)

  const createRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/create']!(createRequest(), createRes)
  const sessionId = (createRes.body as { id: string }).id

  const handler = app.handlers.post['/api/commissioned-ideas/:sessionId/register-participant']!

  // First registration
  const firstRes = createResponse()
  await handler(createRequest({ sessionId }, { name: 'Carol' }), firstRes)
  const firstId = (firstRes.body as { participantId: string }).participantId

  // Reconnect with same id
  const reconnectRes = createResponse()
  await handler(
    createRequest({ sessionId }, { name: 'Carol Updated', participantId: firstId }),
    reconnectRes,
  )

  assert.equal(reconnectRes.statusCode, 200)
  const reconnectBody = reconnectRes.body as { participantId: string; name: string }
  assert.equal(reconnectBody.participantId, firstId, 'same id returned on reconnect')

  // Only one participant in roster
  const data = sessionData(store, sessionId)
  assert.equal(Object.keys(data.participantRoster).length, 1)
})

void test('register-participant reconnect does not overwrite instructor-moderated name', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const { store, sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, ws)

  const createRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/create']!(createRequest(), createRes)
  const sessionId = (createRes.body as { id: string }).id
  const passcode = (createRes.body as { instructorPasscode: string }).instructorPasscode

  const regHandler = app.handlers.post['/api/commissioned-ideas/:sessionId/register-participant']!
  const moderateHandler = app.handlers.post['/api/commissioned-ideas/:sessionId/participant-name']!

  // Student registers with a typo
  const regRes = createResponse()
  await regHandler(createRequest({ sessionId }, { name: 'bbo' }), regRes)
  const participantId = (regRes.body as { participantId: string }).participantId

  // Instructor corrects the name
  await moderateHandler(withPasscode({ sessionId }, { participantId, name: 'Bob' }, passcode), createResponse())

  // Student reconnects with stale local storage name
  await regHandler(createRequest({ sessionId }, { name: 'bbo', participantId }), createResponse())

  const data = sessionData(store, sessionId)
  assert.equal(
    data.participantRoster[participantId]?.name,
    'Bob',
    'instructor-corrected name must survive reconnect',
  )
})

// ── POST /api/commissioned-ideas/:sessionId/participant-name ──────────────────

void test('participant-name returns 400 when sessionId is missing', async () => {
  const { handler } = setupAndGet(
    'post',
    '/api/commissioned-ideas/:sessionId/participant-name',
  )

  const res = createResponse()
  await handler(
    createRequest({ sessionId: undefined }, { participantId: 'p1', name: 'Alice' }),
    res,
  )

  assert.equal(res.statusCode, 400)
})

void test('participant-name returns 404 for unknown session', async () => {
  const { handler } = setupAndGet(
    'post',
    '/api/commissioned-ideas/:sessionId/participant-name',
  )

  const res = createResponse()
  await handler(
    createRequest({ sessionId: 'no-session' }, { participantId: 'p1', name: 'Alice' }),
    res,
  )

  assert.equal(res.statusCode, 404)
})

void test('participant-name returns 403 when instructor passcode is absent', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const { sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, ws)

  const createRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/create']!(createRequest(), createRes)
  const sessionId = (createRes.body as { id: string }).id

  const handler = app.handlers.post['/api/commissioned-ideas/:sessionId/participant-name']!
  const res = createResponse()
  await handler(createRequest({ sessionId }, { participantId: 'p1', name: 'Alice' }), res)

  assert.equal(res.statusCode, 403)
  assert.deepEqual(res.body, { error: 'Instructor authentication required' })
})

void test('participant-name returns 403 when instructor passcode is wrong', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const { sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, ws)

  const createRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/create']!(createRequest(), createRes)
  const sessionId = (createRes.body as { id: string }).id

  const handler = app.handlers.post['/api/commissioned-ideas/:sessionId/participant-name']!
  const res = createResponse()
  await handler(
    withPasscode({ sessionId }, { participantId: 'p1', name: 'Alice' }, 'WRONGPASSCODE'),
    res,
  )

  assert.equal(res.statusCode, 403)
})

void test('participant-name returns 400 when participantId is missing from body', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const { sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, ws)

  const createRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/create']!(createRequest(), createRes)
  const sessionId = (createRes.body as { id: string }).id
  const passcode = (createRes.body as { instructorPasscode: string }).instructorPasscode

  const handler = app.handlers.post['/api/commissioned-ideas/:sessionId/participant-name']!
  const res = createResponse()
  await handler(withPasscode({ sessionId }, { name: 'Alice' }, passcode), res)

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, { error: 'participantId is required' })
})

void test('participant-name returns 404 when participant does not exist', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const { sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, ws)

  const createRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/create']!(createRequest(), createRes)
  const sessionId = (createRes.body as { id: string }).id
  const passcode = (createRes.body as { instructorPasscode: string }).instructorPasscode

  const handler = app.handlers.post['/api/commissioned-ideas/:sessionId/participant-name']!
  const res = createResponse()
  await handler(withPasscode({ sessionId }, { participantId: 'ghost', name: 'Ghost' }, passcode), res)

  assert.equal(res.statusCode, 404)
})

void test('participant-name edits a name and clears rejection', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const { store, sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, ws)

  const createRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/create']!(createRequest(), createRes)
  const sessionId = (createRes.body as { id: string }).id
  const passcode = (createRes.body as { instructorPasscode: string }).instructorPasscode

  const regHandler = app.handlers.post['/api/commissioned-ideas/:sessionId/register-participant']!
  const regRes = createResponse()
  await regHandler(createRequest({ sessionId }, { name: 'BadName' }), regRes)
  const participantId = (regRes.body as { participantId: string }).participantId

  // Reject them first
  const moderateHandler = app.handlers.post['/api/commissioned-ideas/:sessionId/participant-name']!
  await moderateHandler(withPasscode({ sessionId }, { participantId, rejected: true }, passcode), createResponse())

  let data = sessionData(store, sessionId)
  assert.equal(data.participantRoster[participantId]?.rejectedByInstructor, true)

  // Edit name — should clear rejection
  const editRes = createResponse()
  await moderateHandler(withPasscode({ sessionId }, { participantId, name: 'GoodName' }, passcode), editRes)

  assert.equal(editRes.statusCode, 200)
  assert.deepEqual(editRes.body, { ok: true })

  data = sessionData(store, sessionId)
  assert.equal(data.participantRoster[participantId]?.name, 'GoodName')
  assert.equal(data.participantRoster[participantId]?.rejectedByInstructor, false)
})

void test('participant-name can reject a participant', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const { store, sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, ws)

  const createRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/create']!(createRequest(), createRes)
  const sessionId = (createRes.body as { id: string }).id
  const passcode = (createRes.body as { instructorPasscode: string }).instructorPasscode

  const regHandler = app.handlers.post['/api/commissioned-ideas/:sessionId/register-participant']!
  const regRes = createResponse()
  await regHandler(createRequest({ sessionId }, { name: 'SlightlyBad' }), regRes)
  const participantId = (regRes.body as { participantId: string }).participantId

  const moderateHandler = app.handlers.post['/api/commissioned-ideas/:sessionId/participant-name']!
  const rejectRes = createResponse()
  await moderateHandler(withPasscode({ sessionId }, { participantId, rejected: true }, passcode), rejectRes)

  assert.equal(rejectRes.statusCode, 200)
  const data = sessionData(store, sessionId)
  assert.equal(data.participantRoster[participantId]?.rejectedByInstructor, true)
  assert.equal(data.participantRoster[participantId]?.name, 'SlightlyBad')
})

void test('create route returns instructorPasscode in the response', async () => {
  const { handler } = setupAndGet('post', '/api/commissioned-ideas/create')

  const res = createResponse()
  await handler(createRequest(), res)

  const body = res.body as { id: string; instructorPasscode?: string }
  assert.equal(typeof body.instructorPasscode, 'string')
  assert.ok(body.instructorPasscode && body.instructorPasscode.length > 0)
})

// ── WebSocket registration ────────────────────────────────────────────────────

void test('setupCommissionedIdeasRoutes registers the websocket namespace', () => {
  const app = createMockApp()
  const { sessions } = createMockSessions()

  const registered: string[] = []
  const trackingWs: WsRouter = {
    wss: { clients: new Set(), close() {} },
    register(path: string) {
      registered.push(path)
    },
  }

  setupCommissionedIdeasRoutes(app, sessions, trackingWs)
  assert.ok(registered.includes('/ws/commissioned-ideas'), 'WS namespace must be registered')
})

void test('manager websocket authenticates with a post-connect message instead of a URL passcode', async () => {
  const app = createMockApp()
  const { sessions } = createMockSessions()

  type CommissionedIdeasWsTestSocket = {
    sessionId?: string
    participantId?: string | null
    isManager?: boolean
    wantsManager?: boolean
    readyState: number
    send(message: string): void
    close(code?: number, reason?: string): void
    on(event: string, handler: (raw?: unknown) => void): void
  }

  type CommissionedIdeasWsHandler = (socket: CommissionedIdeasWsTestSocket, query: URLSearchParams) => void

  let wsHandler: CommissionedIdeasWsHandler | null = null

  const trackingWs: WsRouter = {
    wss: { clients: new Set(), close() {} },
    register(path, handler) {
      if (path === '/ws/commissioned-ideas') {
        wsHandler = handler as CommissionedIdeasWsHandler
      }
    },
  }

  setupCommissionedIdeasRoutes(app, sessions, trackingWs)

  const createHandler = app.handlers.post['/api/commissioned-ideas/create']
  assert.ok(createHandler)
  const createRes = createResponse()
  await createHandler(createRequest(), createRes)

  const { id: sessionId, instructorPasscode } = createRes.body as { id: string; instructorPasscode: string }
  if (wsHandler == null) {
    throw new Error('Expected commissioned-ideas websocket handler to be registered')
  }
  const registeredWsHandler: CommissionedIdeasWsHandler = wsHandler

  const sentMessages: string[] = []
  const messageHandlers: Array<(raw?: unknown) => void> = []
  const socket: CommissionedIdeasWsTestSocket = {
    readyState: 1,
    send(message: string) {
      sentMessages.push(message)
    },
    close() {},
    on(event: string, handler: (raw?: unknown) => void) {
      if (event === 'message') {
        messageHandlers.push(handler)
      }
    },
  }

  registeredWsHandler(socket, new URLSearchParams({ sessionId, role: 'manager' }))
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(
    sentMessages.some((message) => message.includes('commissioned-ideas:session-state')),
    false,
    'manager socket should not receive a privileged snapshot before authenticating',
  )

  messageHandlers[0]?.(JSON.stringify({
    type: 'commissioned-ideas:manager-auth',
    instructorPasscode,
  }))
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(
    sentMessages.some((message) => message.includes('commissioned-ideas:session-state')),
    true,
    'manager socket should receive a session snapshot after authenticating over the socket',
  )
})

// ── POST /api/commissioned-ideas/:sessionId/settings ─────────────────────────

async function createSession(app: ReturnType<typeof createMockApp>) {
  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/create']!(createRequest(), res)
  return res.body as { id: string; instructorPasscode: string }
}

async function registerParticipant(
  app: ReturnType<typeof createMockApp>,
  sessionId: string,
  name: string,
): Promise<{ participantId: string; token: string }> {
  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/register-participant']!(
    createRequest({ sessionId }, { name }),
    res,
  )
  return res.body as { participantId: string; token: string }
}

void test('settings route returns 403 without instructor auth', async () => {
  const app = createMockApp()
  setupCommissionedIdeasRoutes(app, createMockSessions().sessions, createMockWs())
  const { id: sessionId } = await createSession(app)

  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/settings']!(
    createRequest({ sessionId }, { maxTeamSize: 5 }),
    res,
  )
  assert.equal(res.statusCode, 403)
})

void test('settings route updates maxTeamSize', async () => {
  const app = createMockApp()
  const { store, sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())
  const { id: sessionId, instructorPasscode } = await createSession(app)

  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/settings']!(
    withPasscode({ sessionId }, { maxTeamSize: 5 }, instructorPasscode),
    res,
  )
  assert.equal(res.statusCode, 200)
  assert.equal(sessionData(store, sessionId).maxTeamSize, 5)
})

void test('settings route rejects non-integer maxTeamSize', async () => {
  const app = createMockApp()
  const { sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())
  const { id: sessionId, instructorPasscode } = await createSession(app)

  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/settings']!(
    withPasscode({ sessionId }, { maxTeamSize: 'big' }, instructorPasscode),
    res,
  )
  assert.equal(res.statusCode, 400)
})

void test('settings route sets studentGroupingLocked', async () => {
  const app = createMockApp()
  const { store, sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())
  const { id: sessionId, instructorPasscode } = await createSession(app)

  await app.handlers.post['/api/commissioned-ideas/:sessionId/settings']!(
    withPasscode({ sessionId }, { studentGroupingLocked: true }, instructorPasscode),
    createResponse(),
  )
  assert.equal(sessionData(store, sessionId).studentGroupingLocked, true)
})

// ── POST /api/commissioned-ideas/:sessionId/create-team ───────────────────────

void test('create-team creates a team and sets participant teamId', async () => {
  const app = createMockApp()
  const { store, sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())
  const { id: sessionId } = await createSession(app)

  const { participantId, token } = await registerParticipant(app, sessionId, 'Alice')

  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/create-team']!(
    withParticipantToken({ sessionId }, { participantId }, token),
    res,
  )

  assert.equal(res.statusCode, 200)
  const { teamId } = res.body as { teamId: string }
  assert.ok(teamId)
  const data = sessionData(store, sessionId)
  assert.ok(data.teams[teamId], 'team must exist in store')
  assert.equal(data.participantRoster[participantId]?.teamId, teamId)
  assert.deepEqual(data.teams[teamId]?.memberIds, [participantId])
})

void test('create-team returns 403 without participant token', async () => {
  const app = createMockApp()
  const { sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())
  const { id: sessionId } = await createSession(app)
  const { participantId } = await registerParticipant(app, sessionId, 'Alice')

  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/create-team']!(
    createRequest({ sessionId }, { participantId }),
    res,
  )
  assert.equal(res.statusCode, 403)
})

void test('create-team returns 403 when grouping is locked', async () => {
  const app = createMockApp()
  const { sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())
  const { id: sessionId, instructorPasscode } = await createSession(app)

  const { participantId, token } = await registerParticipant(app, sessionId, 'Alice')

  await app.handlers.post['/api/commissioned-ideas/:sessionId/settings']!(
    withPasscode({ sessionId }, { studentGroupingLocked: true }, instructorPasscode),
    createResponse(),
  )

  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/create-team']!(
    withParticipantToken({ sessionId }, { participantId }, token),
    res,
  )
  assert.equal(res.statusCode, 403)
})

void test('create-team returns 403 in random grouping mode', async () => {
  const app = createMockApp()
  const { sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())
  const { id: sessionId, instructorPasscode } = await createSession(app)

  const { participantId, token } = await registerParticipant(app, sessionId, 'Alice')

  await app.handlers.post['/api/commissioned-ideas/:sessionId/settings']!(
    withPasscode({ sessionId }, { groupingMode: 'random' }, instructorPasscode),
    createResponse(),
  )

  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/create-team']!(
    withParticipantToken({ sessionId }, { participantId }, token),
    res,
  )
  assert.equal(res.statusCode, 403)
})

// ── POST /api/commissioned-ideas/:sessionId/join-team ────────────────────────

void test('join-team adds participant to existing team', async () => {
  const app = createMockApp()
  const { store, sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())
  const { id: sessionId } = await createSession(app)

  const { participantId: aliceId, token: aliceToken } = await registerParticipant(app, sessionId, 'Alice')
  const { participantId: bobId, token: bobToken } = await registerParticipant(app, sessionId, 'Bob')

  // Alice creates a team
  const teamRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/create-team']!(
    withParticipantToken({ sessionId }, { participantId: aliceId }, aliceToken), teamRes,
  )
  const { teamId } = teamRes.body as { teamId: string }

  // Bob joins Alice's team
  const joinRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/join-team']!(
    withParticipantToken({ sessionId }, { participantId: bobId, teamId }, bobToken), joinRes,
  )

  assert.equal(joinRes.statusCode, 200)
  const data = sessionData(store, sessionId)
  assert.equal(data.participantRoster[bobId]?.teamId, teamId)
  assert.ok(data.teams[teamId]?.memberIds.includes(bobId))
})

void test('join-team returns 403 without participant token', async () => {
  const app = createMockApp()
  const { sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())
  const { id: sessionId } = await createSession(app)

  const { participantId: aliceId, token: aliceToken } = await registerParticipant(app, sessionId, 'Alice')
  const { participantId: bobId } = await registerParticipant(app, sessionId, 'Bob')

  const teamRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/create-team']!(
    withParticipantToken({ sessionId }, { participantId: aliceId }, aliceToken), teamRes,
  )
  const { teamId } = teamRes.body as { teamId: string }

  // Bob tries to join without his token
  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/join-team']!(
    createRequest({ sessionId }, { participantId: bobId, teamId }), res,
  )
  assert.equal(res.statusCode, 403)
})

void test('join-team returns 403 in random grouping mode', async () => {
  const app = createMockApp()
  const { sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())
  const { id: sessionId, instructorPasscode } = await createSession(app)

  const { participantId: aliceId, token: aliceToken } = await registerParticipant(app, sessionId, 'Alice')
  const { participantId: bobId, token: bobToken } = await registerParticipant(app, sessionId, 'Bob')

  // Alice creates team while still in manual mode, then instructor switches to random
  const teamRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/create-team']!(
    withParticipantToken({ sessionId }, { participantId: aliceId }, aliceToken), teamRes,
  )
  const { teamId } = teamRes.body as { teamId: string }

  await app.handlers.post['/api/commissioned-ideas/:sessionId/settings']!(
    withPasscode({ sessionId }, { groupingMode: 'random' }, instructorPasscode), createResponse(),
  )

  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/join-team']!(
    withParticipantToken({ sessionId }, { participantId: bobId, teamId }, bobToken), res,
  )
  assert.equal(res.statusCode, 403)
})

void test('join-team returns 409 when team is full', async () => {
  const app = createMockApp()
  const { sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())
  const { id: sessionId, instructorPasscode } = await createSession(app)

  await app.handlers.post['/api/commissioned-ideas/:sessionId/settings']!(
    withPasscode({ sessionId }, { maxTeamSize: 1 }, instructorPasscode), createResponse(),
  )

  const { participantId: aliceId, token: aliceToken } = await registerParticipant(app, sessionId, 'Alice')
  const { participantId: bobId, token: bobToken } = await registerParticipant(app, sessionId, 'Bob')

  const teamRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/create-team']!(
    withParticipantToken({ sessionId }, { participantId: aliceId }, aliceToken), teamRes,
  )
  const { teamId } = teamRes.body as { teamId: string }

  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/join-team']!(
    withParticipantToken({ sessionId }, { participantId: bobId, teamId }, bobToken), res,
  )
  assert.equal(res.statusCode, 409)
})

// ── POST /api/commissioned-ideas/:sessionId/leave-team ───────────────────────

void test('leave-team removes participant from their team', async () => {
  const app = createMockApp()
  const { store, sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())
  const { id: sessionId } = await createSession(app)

  const { participantId, token } = await registerParticipant(app, sessionId, 'Alice')

  await app.handlers.post['/api/commissioned-ideas/:sessionId/create-team']!(
    withParticipantToken({ sessionId }, { participantId }, token), createResponse(),
  )

  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/leave-team']!(
    withParticipantToken({ sessionId }, { participantId }, token), res,
  )

  assert.equal(res.statusCode, 200)
  assert.equal(sessionData(store, sessionId).participantRoster[participantId]?.teamId, null)
})

void test('leave-team returns 403 without participant token', async () => {
  const app = createMockApp()
  const { sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())
  const { id: sessionId } = await createSession(app)

  const { participantId, token } = await registerParticipant(app, sessionId, 'Alice')
  await app.handlers.post['/api/commissioned-ideas/:sessionId/create-team']!(
    withParticipantToken({ sessionId }, { participantId }, token), createResponse(),
  )

  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/leave-team']!(
    createRequest({ sessionId }, { participantId }), res,
  )
  assert.equal(res.statusCode, 403)
})

void test('leave-team returns 409 when participant is not in a team', async () => {
  const app = createMockApp()
  const { sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())
  const { id: sessionId } = await createSession(app)

  const { participantId, token } = await registerParticipant(app, sessionId, 'Alice')

  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/leave-team']!(
    withParticipantToken({ sessionId }, { participantId }, token), res,
  )
  assert.equal(res.statusCode, 409)
})

// ── POST /api/commissioned-ideas/:sessionId/assign-participant ────────────────

void test('assign-participant moves a participant to a specified team', async () => {
  const app = createMockApp()
  const { store, sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())
  const { id: sessionId, instructorPasscode } = await createSession(app)

  const { participantId: aliceId, token: aliceToken } = await registerParticipant(app, sessionId, 'Alice')
  const { participantId: bobId } = await registerParticipant(app, sessionId, 'Bob')

  const teamRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/create-team']!(
    withParticipantToken({ sessionId }, { participantId: aliceId }, aliceToken), teamRes,
  )
  const { teamId } = teamRes.body as { teamId: string }

  await app.handlers.post['/api/commissioned-ideas/:sessionId/settings']!(
    withPasscode({ sessionId }, { studentGroupingLocked: true }, instructorPasscode), createResponse(),
  )

  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/assign-participant']!(
    withPasscode({ sessionId }, { participantId: bobId, teamId }, instructorPasscode), res,
  )

  assert.equal(res.statusCode, 200)
  assert.equal(sessionData(store, sessionId).participantRoster[bobId]?.teamId, teamId)
})

void test('assign-participant removes from team when teamId is null', async () => {
  const app = createMockApp()
  const { store, sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())
  const { id: sessionId, instructorPasscode } = await createSession(app)

  const { participantId, token } = await registerParticipant(app, sessionId, 'Alice')

  await app.handlers.post['/api/commissioned-ideas/:sessionId/create-team']!(
    withParticipantToken({ sessionId }, { participantId }, token), createResponse(),
  )

  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/assign-participant']!(
    withPasscode({ sessionId }, { participantId, teamId: null }, instructorPasscode), res,
  )

  assert.equal(res.statusCode, 200)
  assert.equal(sessionData(store, sessionId).participantRoster[participantId]?.teamId, null)
})

// ── POST /api/commissioned-ideas/:sessionId/assign-random ────────────────────

void test('assign-random places all ungrouped participants', async () => {
  const app = createMockApp()
  const { store, sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())
  const { id: sessionId, instructorPasscode } = await createSession(app)

  for (const name of ['A', 'B', 'C', 'D']) {
    await app.handlers.post['/api/commissioned-ideas/:sessionId/register-participant']!(
      createRequest({ sessionId }, { name }), createResponse(),
    )
  }

  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/assign-random']!(
    withPasscode({ sessionId }, {}, instructorPasscode), res,
  )

  assert.equal(res.statusCode, 200)
  const data = sessionData(store, sessionId)
  for (const p of Object.values(data.participantRoster)) {
    assert.ok(p.teamId !== null, `${p.name} must be placed in a team`)
  }
  for (const team of Object.values(data.teams)) {
    assert.ok(team.memberIds.length <= data.maxTeamSize, 'team must not exceed maxTeamSize')
  }
})

void test('assign-random returns 403 without instructor auth', async () => {
  const app = createMockApp()
  const { sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())
  const { id: sessionId } = await createSession(app)

  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/assign-random']!(
    createRequest({ sessionId }, {}), res,
  )
  assert.equal(res.statusCode, 403)
})

// ── Phase 3b + Phase 4 helpers ───────────────────────────────────────────────

const ROUTE = (name: string) => `/api/commissioned-ideas/:sessionId/${name}`

async function setupSession() {
  const app = createMockApp()
  const { store, sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())
  const { id: sessionId, instructorPasscode } = await createSession(app)
  const post = async (name: string, req: MockRequest) => {
    const res = createResponse()
    await app.handlers.post[ROUTE(name)]!(req, res)
    return res
  }
  const asInstructor = (name: string, body: unknown) => post(name, withPasscode({ sessionId }, body, instructorPasscode))
  const asStudent = (name: string, who: { participantId: string; token: string }, body: Record<string, unknown> = {}) =>
    post(name, withParticipantToken({ sessionId }, { ...body, participantId: who.participantId }, who.token))
  const data = () => sessionData(store, sessionId)
  const register = (name: string) => registerParticipant(app, sessionId, name)
  return { sessionId, instructorPasscode, post, asInstructor, asStudent, data, register }
}

function assertMembershipConsistent(data: CommissionedIdeasSessionData) {
  for (const p of Object.values(data.participantRoster)) {
    if (p.teamId) {
      assert.ok(data.teams[p.teamId]?.memberIds.includes(p.id), `${p.name} teamId must point at a team listing them`)
    }
  }
  for (const team of Object.values(data.teams)) {
    assert.ok(team.memberIds.length > 0, 'empty teams must be deleted')
    for (const id of team.memberIds) {
      assert.equal(data.participantRoster[id]?.teamId, team.id, `member ${id} must point back at team ${team.id}`)
    }
  }
}

// ── Phase 3b: instructor arrangement ─────────────────────────────────────────

void test('assign-participant moves a student directly between two teams', async () => {
  const s = await setupSession()
  const alice = await s.register('Alice')
  const bob = await s.register('Bob')
  const carol = await s.register('Carol')
  const teamA = (await s.asStudent('create-team', alice)).body as { teamId: string }
  await s.asStudent('join-team', bob, { teamId: teamA.teamId })
  const teamC = (await s.asStudent('create-team', carol)).body as { teamId: string }

  const res = await s.asInstructor('assign-participant', { participantId: bob.participantId, teamId: teamC.teamId })

  assert.equal(res.statusCode, 200)
  assert.deepEqual(s.data().teams[teamA.teamId]?.memberIds, [alice.participantId])
  assert.deepEqual(s.data().teams[teamC.teamId]?.memberIds, [carol.participantId, bob.participantId])
  assertMembershipConsistent(s.data())
})

void test('assign-participant with newTeam creates a team for the student', async () => {
  const s = await setupSession()
  const alice = await s.register('Alice')
  const bob = await s.register('Bob')
  const team = (await s.asStudent('create-team', alice)).body as { teamId: string }
  await s.asStudent('join-team', bob, { teamId: team.teamId })

  const res = await s.asInstructor('assign-participant', { participantId: bob.participantId, newTeam: true })

  assert.equal(res.statusCode, 200)
  const { teamId } = res.body as { teamId: string }
  assert.notEqual(teamId, team.teamId)
  assert.deepEqual(s.data().teams[teamId]?.memberIds, [bob.participantId])
  assertMembershipConsistent(s.data())
})

void test('assign-participant still works after grouping is locked', async () => {
  const s = await setupSession()
  const alice = await s.register('Alice')
  const bob = await s.register('Bob')
  const team = (await s.asStudent('create-team', alice)).body as { teamId: string }
  await s.asInstructor('settings', { studentGroupingLocked: true })

  const res = await s.asInstructor('assign-participant', { participantId: bob.participantId, teamId: team.teamId })
  assert.equal(res.statusCode, 200)
  assert.equal(s.data().participantRoster[bob.participantId]?.teamId, team.teamId)
})

void test('assign-participant refuses a full team without mutating state', async () => {
  const s = await setupSession()
  await s.asInstructor('settings', { maxTeamSize: 1 })
  const alice = await s.register('Alice')
  const bob = await s.register('Bob')
  const team = (await s.asStudent('create-team', alice)).body as { teamId: string }

  console.log('[TEST] expecting 409 Team is full')
  const res = await s.asInstructor('assign-participant', { participantId: bob.participantId, teamId: team.teamId })
  assert.equal(res.statusCode, 409)
  assert.equal(s.data().participantRoster[bob.participantId]?.teamId, null)
})

void test('assign-participant refuses to place a rejected participant', async () => {
  const s = await setupSession()
  const alice = await s.register('Alice')
  const bob = await s.register('Bob')
  const team = (await s.asStudent('create-team', alice)).body as { teamId: string }
  await s.asInstructor('participant-name', { participantId: bob.participantId, rejected: true })

  console.log('[TEST] expecting 409 rejected participant placement')
  const res = await s.asInstructor('assign-participant', { participantId: bob.participantId, teamId: team.teamId })
  assert.equal(res.statusCode, 409)
  const newTeamRes = await s.asInstructor('assign-participant', { participantId: bob.participantId, newTeam: true })
  assert.equal(newTeamRes.statusCode, 409)
})

void test('assign-participant is refused outside the registration phase', async () => {
  const s = await setupSession()
  const alice = await s.register('Alice')
  const session = s.data()
  session.phase = 'presentation'

  console.log('[TEST] expecting 409 outside registration')
  const res = await s.asInstructor('assign-participant', { participantId: alice.participantId, newTeam: true })
  assert.equal(res.statusCode, 409)
})

void test('rejecting a participant removes them from their team', async () => {
  const s = await setupSession()
  const alice = await s.register('Alice')
  const bob = await s.register('Bob')
  const team = (await s.asStudent('create-team', alice)).body as { teamId: string }
  await s.asStudent('join-team', bob, { teamId: team.teamId })

  await s.asInstructor('participant-name', { participantId: bob.participantId, rejected: true })

  assert.equal(s.data().participantRoster[bob.participantId]?.teamId, null)
  assert.deepEqual(s.data().teams[team.teamId]?.memberIds, [alice.participantId])
  assertMembershipConsistent(s.data())
})

void test("assign-random scope 'all' reshuffles every student while unlocked", async () => {
  const s = await setupSession()
  await s.asInstructor('settings', { groupingMode: 'random', maxTeamSize: 2 })
  for (const name of ['A', 'B', 'C', 'D', 'E']) await s.register(name)
  await s.asInstructor('assign-random', {})
  const before = Object.keys(s.data().teams).sort()

  const res = await s.asInstructor('assign-random', { scope: 'all' })

  assert.equal(res.statusCode, 200)
  const after = Object.keys(s.data().teams).sort()
  assert.equal(after.length, 3)
  assert.equal(after.some((id) => before.includes(id)), false, 'full reshuffle builds fresh teams')
  assertMembershipConsistent(s.data())
})

void test("assign-random scope 'all' is refused while grouping is locked", async () => {
  const s = await setupSession()
  await s.register('A')
  await s.asInstructor('settings', { studentGroupingLocked: true })

  console.log('[TEST] expecting 409 full reshuffle while locked')
  const res = await s.asInstructor('assign-random', { scope: 'all' })
  assert.equal(res.statusCode, 409)
})

void test('join-team lets a student switch directly from one team to another', async () => {
  const s = await setupSession()
  const alice = await s.register('Alice')
  const bob = await s.register('Bob')
  const carol = await s.register('Carol')
  const teamA = (await s.asStudent('create-team', alice)).body as { teamId: string }
  await s.asStudent('join-team', bob, { teamId: teamA.teamId })
  const teamC = (await s.asStudent('create-team', carol)).body as { teamId: string }

  const res = await s.asStudent('join-team', bob, { teamId: teamC.teamId })
  assert.equal(res.statusCode, 200)
  assertMembershipConsistent(s.data())
  assert.equal(s.data().participantRoster[bob.participantId]?.teamId, teamC.teamId)
})

// ── Phase 4: naming proposals and votes ──────────────────────────────────────

async function setupTeamOfTwo() {
  const s = await setupSession()
  const alice = await s.register('Alice')
  const bob = await s.register('Bob')
  const { teamId } = (await s.asStudent('create-team', alice)).body as { teamId: string }
  await s.asStudent('join-team', bob, { teamId })
  return { ...s, alice, bob, teamId }
}

void test('team/proposal creates a proposal, auto-votes, and sets the displayed name', async () => {
  const s = await setupTeamOfTwo()

  const res = await s.asStudent('team/proposal', s.alice, { kind: 'group', value: '  Night Owls  ' })

  assert.equal(res.statusCode, 200)
  const team = s.data().teams[s.teamId]!
  assert.equal(team.proposedGroupNames.length, 1)
  assert.equal(team.proposedGroupNames[0]?.value, 'Night Owls')
  assert.equal(team.groupNameVotes[s.alice.participantId], team.proposedGroupNames[0]?.id)
  assert.equal(team.groupName, 'Night Owls')
  assert.equal(team.projectName, null, 'project name is independent of group name')
})

void test('team/proposal with a duplicate value votes for the existing proposal', async () => {
  const s = await setupTeamOfTwo()
  const first = (await s.asStudent('team/proposal', s.alice, { kind: 'project', value: 'Solar Oven' })).body as { proposalId: string }

  const res = await s.asStudent('team/proposal', s.bob, { kind: 'project', value: 'solar   oven' })

  assert.equal((res.body as { proposalId: string }).proposalId, first.proposalId)
  const team = s.data().teams[s.teamId]!
  assert.equal(team.proposedProjectNames.length, 1)
  assert.equal(team.projectNameVotes[s.bob.participantId], first.proposalId)
})

void test('team/proposal-vote changes a vote and re-resolves the name', async () => {
  const s = await setupTeamOfTwo()
  const owls = (await s.asStudent('team/proposal', s.alice, { kind: 'group', value: 'Owls' })).body as { proposalId: string }
  const hawks = (await s.asStudent('team/proposal', s.bob, { kind: 'group', value: 'Hawks' })).body as { proposalId: string }
  assert.equal(s.data().teams[s.teamId]?.groupName, 'Owls', '1–1 tie goes to earlier proposal')

  const res = await s.asStudent('team/proposal-vote', s.alice, { kind: 'group', proposalId: hawks.proposalId })

  assert.equal(res.statusCode, 200)
  assert.equal(s.data().teams[s.teamId]?.groupName, 'Hawks')
  assert.notEqual(s.data().teams[s.teamId]?.groupNameVotes[s.alice.participantId], owls.proposalId)
})

void test('team/proposal-vote rejects a proposal from another team', async () => {
  const s = await setupTeamOfTwo()
  const carol = await s.register('Carol')
  await s.asStudent('create-team', carol)
  const other = (await s.asStudent('team/proposal', carol, { kind: 'group', value: 'Foxes' })).body as { proposalId: string }

  console.log('[TEST] expecting 404 cross-team vote')
  const res = await s.asStudent('team/proposal-vote', s.alice, { kind: 'group', proposalId: other.proposalId })
  assert.equal(res.statusCode, 404)
})

void test('naming routes require team membership, valid kind, and participant auth', async () => {
  const s = await setupSession()
  const loner = await s.register('Loner')

  console.log('[TEST] expecting naming validation failures')
  assert.equal((await s.asStudent('team/proposal', loner, { kind: 'group', value: 'Solo' })).statusCode, 409)
  assert.equal((await s.asStudent('team/proposal', loner, { kind: 'mascot', value: 'Solo' })).statusCode, 400)
  assert.equal((await s.asStudent('team/proposal', loner, { kind: 'group', value: '   ' })).statusCode, 400)
  const noAuth = await s.post('team/proposal', createRequest({ sessionId: s.sessionId }, { participantId: loner.participantId, kind: 'group', value: 'X' }))
  assert.equal(noAuth.statusCode, 403)
})

void test('naming lock blocks proposals and votes but not grouping', async () => {
  const s = await setupTeamOfTwo()
  const owls = (await s.asStudent('team/proposal', s.alice, { kind: 'group', value: 'Owls' })).body as { proposalId: string }
  await s.asInstructor('settings', { namingLocked: true })

  console.log('[TEST] expecting 403 naming locked')
  assert.equal((await s.asStudent('team/proposal', s.bob, { kind: 'group', value: 'Hawks' })).statusCode, 403)
  assert.equal((await s.asStudent('team/proposal-vote', s.bob, { kind: 'group', proposalId: owls.proposalId })).statusCode, 403)
  assert.equal((await s.asStudent('leave-team', s.bob)).statusCode, 200, 'grouping lock is independent of naming lock')
})

void test('grouping lock does not block naming', async () => {
  const s = await setupTeamOfTwo()
  await s.asInstructor('settings', { studentGroupingLocked: true })
  const res = await s.asStudent('team/proposal', s.alice, { kind: 'project', value: 'Rain Catcher' })
  assert.equal(res.statusCode, 200)
})

void test('team/proposal-moderation rejects and restores, recomputing the displayed name', async () => {
  const s = await setupTeamOfTwo()
  const rude = (await s.asStudent('team/proposal', s.alice, { kind: 'group', value: 'Rude Name' })).body as { proposalId: string }
  await s.asStudent('team/proposal-vote', s.bob, { kind: 'group', proposalId: rude.proposalId })
  await s.asStudent('team/proposal', s.bob, { kind: 'group', value: 'Owls' })
  // Bob moved his vote to Owls by proposing it; Alice still on Rude Name → 1–1, Rude Name is older.
  assert.equal(s.data().teams[s.teamId]?.groupName, 'Rude Name')

  const rejectRes = await s.asInstructor('team/proposal-moderation', {
    teamId: s.teamId, kind: 'group', proposalId: rude.proposalId, rejected: true,
  })
  assert.equal(rejectRes.statusCode, 200)
  assert.equal(s.data().teams[s.teamId]?.groupName, 'Owls')

  console.log('[TEST] expecting 409 for re-proposing / voting a rejected name')
  assert.equal((await s.asStudent('team/proposal', s.bob, { kind: 'group', value: 'rude name' })).statusCode, 409)
  assert.equal((await s.asStudent('team/proposal-vote', s.bob, { kind: 'group', proposalId: rude.proposalId })).statusCode, 409)

  await s.asInstructor('team/proposal-moderation', {
    teamId: s.teamId, kind: 'group', proposalId: rude.proposalId, rejected: false,
  })
  assert.equal(s.data().teams[s.teamId]?.groupName, 'Rude Name', 'restored proposal votes count again')
})

void test('team/proposal-moderation requires instructor auth and a boolean rejected flag', async () => {
  const s = await setupTeamOfTwo()
  const p = (await s.asStudent('team/proposal', s.alice, { kind: 'group', value: 'Owls' })).body as { proposalId: string }

  console.log('[TEST] expecting moderation auth/validation failures')
  const noAuth = await s.post('team/proposal-moderation', createRequest({ sessionId: s.sessionId }, {
    teamId: s.teamId, kind: 'group', proposalId: p.proposalId, rejected: true,
  }))
  assert.equal(noAuth.statusCode, 403)
  const bad = await s.asInstructor('team/proposal-moderation', { teamId: s.teamId, kind: 'group', proposalId: p.proposalId, rejected: 'yes' })
  assert.equal(bad.statusCode, 400)
})

void test('leaving a team removes the leaver vote from the displayed-name tally', async () => {
  const s = await setupTeamOfTwo()
  const carol = await s.register('Carol')
  await s.asStudent('join-team', carol, { teamId: s.teamId })
  await s.asStudent('team/proposal', s.alice, { kind: 'group', value: 'Owls' })
  const hawks = (await s.asStudent('team/proposal', s.bob, { kind: 'group', value: 'Hawks' })).body as { proposalId: string }
  await s.asStudent('team/proposal-vote', carol, { kind: 'group', proposalId: hawks.proposalId })
  assert.equal(s.data().teams[s.teamId]?.groupName, 'Hawks')

  await s.asStudent('leave-team', carol)

  assert.equal(s.data().teams[s.teamId]?.groupName, 'Owls')
  assert.equal(carol.participantId in (s.data().teams[s.teamId]?.groupNameVotes ?? {}), false)
})

void test('proposal count per kind is capped', async () => {
  const s = await setupTeamOfTwo()
  for (let i = 0; i < 20; i++) {
    const r = await s.asStudent('team/proposal', s.alice, { kind: 'group', value: `Name ${i}` })
    assert.equal(r.statusCode, 200)
  }
  console.log('[TEST] expecting 409 proposal limit')
  assert.equal((await s.asStudent('team/proposal', s.alice, { kind: 'group', value: 'One too many' })).statusCode, 409)
})

// ── Phase 5: phases, order, spotlight, rounds ────────────────────────────────

async function setupPresentationSession(teamNames = ['Alice', 'Bob', 'Carol']) {
  const s = await setupSession()
  const members: { participantId: string; token: string }[] = []
  const teamIds: string[] = []
  for (const name of teamNames) {
    const who = await s.register(name)
    members.push(who)
    teamIds.push(((await s.asStudent('create-team', who)).body as { teamId: string }).teamId)
  }
  return { ...s, members, teamIds }
}

void test('phase route requires instructor auth and a known phase', async () => {
  const s = await setupPresentationSession()
  console.log('[TEST] expecting phase auth/validation failures')
  const noAuth = await s.post('phase', createRequest({ sessionId: s.sessionId }, { phase: 'presentation' }))
  assert.equal(noAuth.statusCode, 403)
  assert.equal((await s.asInstructor('phase', { phase: 'lobby' })).statusCode, 400)
})

void test('phase route refuses disallowed transitions without changing state', async () => {
  const s = await setupSession()
  console.log('[TEST] expecting 409 phase transitions')
  assert.equal((await s.asInstructor('phase', { phase: 'presentation' })).statusCode, 409, 'no teams yet')
  assert.equal((await s.asInstructor('phase', { phase: 'results' })).statusCode, 409)
  assert.equal(s.data().phase, 'registration')
})

void test('entering presentation normalizes presenter order and resets the podium', async () => {
  const s = await setupPresentationSession()
  s.data().podiumRevealStep = 'winner'

  const res = await s.asInstructor('phase', { phase: 'presentation' })

  assert.equal(res.statusCode, 200)
  const data = s.data()
  assert.equal(data.phase, 'presentation')
  assert.equal(data.podiumRevealStep, 'hidden')
  const orders = Object.values(data.teams).map((team) => team.presenterOrder).sort()
  assert.deepEqual(orders, [0, 1, 2])
})

void test('reopening registration from presentation is refused once a ballot exists', async () => {
  const s = await setupPresentationSession()
  await s.asInstructor('phase', { phase: 'presentation' })
  s.data().ballots['someone'] = { voterId: 'someone', voterName: 'X', voterTeamId: null, allocations: [], submittedAt: 1 }

  console.log('[TEST] expecting 409 reopen registration with ballots')
  assert.equal((await s.asInstructor('phase', { phase: 'registration' })).statusCode, 409)
})

void test('full phase cycle including results back to presentation', async () => {
  const s = await setupPresentationSession()
  for (const phase of ['presentation', 'voting', 'results', 'presentation']) {
    const res = await s.asInstructor('phase', { phase })
    assert.equal(res.statusCode, 200, `→ ${phase}`)
  }
  assert.equal(s.data().phase, 'presentation')
})

void test('presentation-order accepts a full permutation and rejects partial lists', async () => {
  const s = await setupPresentationSession()
  await s.asInstructor('phase', { phase: 'presentation' })
  const reversed = [...s.teamIds].reverse()

  assert.equal((await s.asInstructor('presentation-order', { teamIds: reversed })).statusCode, 200)
  reversed.forEach((id, index) => assert.equal(s.data().teams[id]?.presenterOrder, index))

  console.log('[TEST] expecting 400 partial presentation order')
  assert.equal((await s.asInstructor('presentation-order', { teamIds: reversed.slice(1) })).statusCode, 400)
})

void test('presentation-active records a team once per round and can clear the spotlight', async () => {
  const s = await setupPresentationSession()
  await s.asInstructor('phase', { phase: 'presentation' })
  const [a, b] = s.teamIds as [string, string]

  await s.asInstructor('presentation-active', { teamId: a })
  await s.asInstructor('presentation-active', { teamId: b })
  await s.asInstructor('presentation-active', { teamId: a })
  assert.equal(s.data().currentPresentationTeamId, a)
  assert.deepEqual(s.data().presentationHistory.map((e) => [e.round, e.teamId]), [[1, a], [1, b]])

  await s.asInstructor('presentation-active', { teamId: null })
  assert.equal(s.data().currentPresentationTeamId, null)

  console.log('[TEST] expecting presentation-active validation failures')
  assert.equal((await s.asInstructor('presentation-active', { teamId: 'nope' })).statusCode, 404)
  assert.equal((await s.asInstructor('presentation-active', {})).statusCode, 400)
})

void test('presentation-randomize only picks unpresented teams and refuses when exhausted', async () => {
  const s = await setupPresentationSession()
  await s.asInstructor('phase', { phase: 'presentation' })
  await s.asInstructor('presentation-active', { teamId: s.teamIds[0] })

  const picked = new Set<string>()
  for (let i = 0; i < 2; i++) {
    const res = await s.asInstructor('presentation-randomize', {})
    assert.equal(res.statusCode, 200)
    picked.add((res.body as { teamId: string }).teamId)
  }
  assert.deepEqual([...picked].sort(), [s.teamIds[1], s.teamIds[2]].sort())

  console.log('[TEST] expecting 409 everyone presented')
  assert.equal((await s.asInstructor('presentation-randomize', {})).statusCode, 409)
})

void test('presentation-round next starts a fresh round; reset clears only the current round', async () => {
  const s = await setupPresentationSession()
  await s.asInstructor('phase', { phase: 'presentation' })
  await s.asInstructor('presentation-active', { teamId: s.teamIds[0] })

  const next = await s.asInstructor('presentation-round', { action: 'next' })
  assert.equal((next.body as { round: number }).round, 2)
  assert.equal(s.data().currentPresentationTeamId, null)

  await s.asInstructor('presentation-active', { teamId: s.teamIds[1] })
  await s.asInstructor('presentation-round', { action: 'reset' })
  assert.deepEqual(s.data().presentationHistory.map((e) => [e.round, e.teamId]), [[1, s.teamIds[0]]])
  assert.equal(s.data().presentationRound, 2)

  console.log('[TEST] expecting 400 bad round action')
  assert.equal((await s.asInstructor('presentation-round', { action: 'skip' })).statusCode, 400)
})

void test('presentation controls are refused outside the presentation phase', async () => {
  const s = await setupPresentationSession()
  console.log('[TEST] expecting 409 presentation controls during registration')
  assert.equal((await s.asInstructor('presentation-active', { teamId: s.teamIds[0] })).statusCode, 409)
  assert.equal((await s.asInstructor('presentation-randomize', {})).statusCode, 409)
  assert.equal((await s.asInstructor('presentation-round', { action: 'next' })).statusCode, 409)
  assert.equal((await s.asInstructor('presentation-order', { teamIds: s.teamIds })).statusCode, 200, 'order is editable in registration')
})

void test('team changes are refused once presentations start', async () => {
  const s = await setupPresentationSession()
  await s.asInstructor('phase', { phase: 'presentation' })
  console.log('[TEST] expecting 409 team change during presentations')
  assert.equal((await s.asStudent('leave-team', s.members[0]!)).statusCode, 409)
})
