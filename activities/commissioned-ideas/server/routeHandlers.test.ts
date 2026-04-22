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
  body?: unknown
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
        delete store[id]  // eslint-disable-line @typescript-eslint/no-dynamic-delete
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
): MockRequest {
  return { params, body }
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
