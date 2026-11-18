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
import { getActivityCapabilityCookieName } from 'activebits-server/core/activityCapabilities.js'
import setupCommissionedIdeasRoutes, { buildManagerSnapshot, buildStudentSnapshot } from './routes.js'
import type { CommissionedIdeasSessionData } from '../shared/types.js'

// ── Mock infrastructure ───────────────────────────────────────────────────────

type RouteHandler = (req: MockRequest, res: MockResponse) => Promise<void> | void

interface MockRequest {
  params: Record<string, string | undefined>
  query?: Record<string, string | undefined>
  body?: unknown
  headers?: Record<string, string | undefined>
  cookies?: Record<string, unknown>
}

interface MockResponse {
  statusCode: number
  body: unknown
  cookies: Record<string, { value: string; options: Record<string, unknown> }>
  status(code: number): MockResponse
  json(payload: unknown): MockResponse
  cookie(name: string, value: string, options: Record<string, unknown>): void
  setHeader(name: string, value: string): void
}

function createResponse(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    body: null,
    cookies: {},
    cookie(name, value, options) {
      res.cookies[name] = { value, options }
    },
    setHeader() {},
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

/**
 * In-memory store with the production `updateAtomic` contract: the mutation runs on a
 * clone and commits only if the stored revision is unchanged, otherwise it re-reads and
 * retries. `beforeCommit` lets a test inject a conflicting write between read and commit.
 */
function createMockSessions(initial: Record<string, SessionRecord> = {}) {
  const store: Record<string, SessionRecord> = { ...initial }
  const hooks: { beforeCommit: ((id: string) => void) | null; setCalls: number } = { beforeCommit: null, setCalls: 0 }

  return {
    store,
    hooks,
    sessions: {
      async get(id: string) {
        return store[id] ?? null
      },
      async set(id: string, session: SessionRecord) {
        hooks.setCalls += 1
        store[id] = session
      },
      async updateAtomic(id: string, mutate: (session: SessionRecord) => SessionRecord) {
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const current = store[id]
          if (!current) return null
          const revision = current.mutationRevision ?? 0
          const next = mutate(structuredClone(current))
          const hook = hooks.beforeCommit
          hooks.beforeCommit = null
          hook?.(id)
          await Promise.resolve()
          if ((store[id]?.mutationRevision ?? 0) !== revision) continue
          store[id] = { ...next, mutationRevision: revision + 1 }
          return store[id]
        }
        throw new Error('[TEST] atomic update exhausted retries')
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

/** The participant capability cookie value issued by register-participant (the student's only credential). */
function participantCookieValue(res: MockResponse, sessionId: string): string {
  return res.cookies[getActivityCapabilityCookieName('participant', sessionId)]?.value ?? ''
}

/** A request that carries a participant cookie, as a browser would after registering. */
function withParticipantToken(
  params: Record<string, string | undefined>,
  body: unknown,
  token: string,
): MockRequest {
  const sessionId = params.sessionId ?? ''
  return { ...createRequest(params, body), cookies: { [getActivityCapabilityCookieName('participant', sessionId)]: token } }
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
  // A real ballot must exist, or this test would pass even if the route trusted the query.
  const s = await setupVotingSession()
  const [, a, b, c] = s.teamIds as [string, string, string, string]
  const alice = s.members[0]!
  const ballotRes = await s.asStudent('ballot', alice, {
    allocations: [{ teamId: a, amount: 500 }, { teamId: b, amount: 300 }, { teamId: c, amount: 100 }],
  })
  assert.equal(ballotRes.statusCode, 200)
  // Alice's authenticated (socket) view does carry her ballot.
  assert.notEqual(buildStudentSnapshot(s.data(), alice.participantId).myBallot, null)

  const stateRes = await s.get('state', { params: { sessionId: s.sessionId }, query: { participantId: alice.participantId }, body: {} })

  assert.equal(stateRes.statusCode, 200)
  const data = (stateRes.body as { data: Record<string, unknown> }).data
  assert.equal(data.myBallot, null, 'myBallot must always be null from the REST route')
  assert.equal(data.ballotSubmitted, false)
  assert.equal(data.ballotsReceived, 1, 'the count is public')
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

void test('register-participant creates a participant, sets an httpOnly participant cookie, and returns no credential', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const { store, sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, ws)

  const createRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/create']!(createRequest(), createRes)
  const sessionId = (createRes.body as { id: string }).id

  const handler = app.handlers.post['/api/commissioned-ideas/:sessionId/register-participant']!
  const res = createResponse()
  await handler(createRequest({ sessionId }, { name: 'Alice' }), res)

  assert.equal(res.statusCode, 200)
  const body = res.body as Record<string, unknown>
  assert.equal(typeof body.participantId, 'string')
  assert.ok((body.participantId as string).length > 0)
  assert.equal(body.name, 'Alice')
  assert.deepEqual(Object.keys(body).sort(), ['name', 'participantId'], 'no credential in the response body')

  const cookie = res.cookies[getActivityCapabilityCookieName('participant', sessionId)]
  assert.ok(cookie && cookie.value.length > 0, 'participant capability cookie is set')
  assert.equal(cookie.options.httpOnly, true)
  assert.equal(cookie.options.sameSite, 'lax')

  const stored = JSON.stringify(sessionData(store, sessionId))
  assert.equal(stored.includes(cookie.value), false, 'only a digest of the capability is stored')
  assert.equal('token' in sessionData(store, sessionId).participantRoster[body.participantId as string]!, false)
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

void test('register-participant reconnects the participant its cookie proves, and ignores a client participantId', async () => {
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
  const firstCookie = participantCookieValue(firstRes, sessionId)

  // Reconnect: the cookie alone decides, even with no or a different participantId in the body
  const reconnectRes = createResponse()
  await handler(withParticipantToken({ sessionId }, { name: 'Carol Updated', participantId: 'SOMEONEELSE' }, firstCookie), reconnectRes)

  assert.equal(reconnectRes.statusCode, 200)
  assert.equal((reconnectRes.body as { participantId: string }).participantId, firstId, 'same participant on reconnect')
  assert.deepEqual(reconnectRes.cookies, {}, 'a valid cookie is not reissued')
  assert.equal(Object.keys(sessionData(store, sessionId).participantRoster).length, 1)

  // Knowing someone's id without their cookie registers a new participant.
  const impostorRes = createResponse()
  console.log('[TEST] expecting registration without a cookie to create a new participant')
  await handler(createRequest({ sessionId }, { name: 'Mallory', participantId: firstId }), impostorRes)
  assert.notEqual((impostorRes.body as { participantId: string }).participantId, firstId)
  assert.equal(Object.keys(sessionData(store, sessionId).participantRoster).length, 2)
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
  const token = participantCookieValue(regRes, sessionId)

  // Instructor corrects the name
  await moderateHandler(withPasscode({ sessionId }, { participantId, name: 'Bob' }, passcode), createResponse())

  // Student reconnects (with their cookie) using a stale local storage name
  const reconnectRes = createResponse()
  await regHandler(withParticipantToken({ sessionId }, { name: 'bbo', participantId }, token), reconnectRes)
  assert.equal((reconnectRes.body as { participantId: string }).participantId, participantId, 'must be a reconnect')

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
  return { participantId: (res.body as { participantId: string }).participantId, token: participantCookieValue(res, sessionId) }
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
  const { store, sessions, hooks } = createMockSessions()
  const ws = createMockWs()
  setupCommissionedIdeasRoutes(app, sessions, ws)
  const { id: sessionId, instructorPasscode } = await createSession(app)
  // An authenticated manager socket that records every frame it receives.
  const managerFrames: { type: string; data: Record<string, unknown> }[] = []
  ;(ws.wss.clients as Set<unknown>).add({
    sessionId,
    isManager: true,
    readyState: 1,
    send(message: string) { managerFrames.push(JSON.parse(message) as { type: string; data: Record<string, unknown> }) },
  })
  const post = async (name: string, req: MockRequest) => {
    const res = createResponse()
    await app.handlers.post[ROUTE(name)]!(req, res)
    return res
  }
  const get = async (name: string, req: MockRequest) => {
    const res = createResponse()
    await app.handlers.get[ROUTE(name)]!(req, res)
    return res
  }
  const asInstructor = (name: string, body: unknown) => post(name, withPasscode({ sessionId }, body, instructorPasscode))
  const asStudent = (name: string, who: { participantId: string; token: string }, body: Record<string, unknown> = {}) =>
    post(name, withParticipantToken({ sessionId }, { ...body, participantId: who.participantId }, who.token))
  const data = () => sessionData(store, sessionId)
  const register = (name: string) => registerParticipant(app, sessionId, name)
  const lastManagerFrame = () => managerFrames[managerFrames.length - 1]
  return { sessionId, instructorPasscode, post, get, asInstructor, asStudent, data, register, lastManagerFrame, store, sessions, hooks }
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

// ── Phase 6: ballots ─────────────────────────────────────────────────────────

async function setupVotingSession(teamCount = 4) {
  const names = ['Alice', 'Bob', 'Carol', 'Dan', 'Eve'].slice(0, teamCount)
  const s = await setupPresentationSession(names)
  const loner = await s.register('Loner')
  await s.asInstructor('phase', { phase: 'presentation' })
  await s.asInstructor('phase', { phase: 'voting' })
  return { ...s, loner }
}

void test('ballot route stores a valid ballot and reports it to the manager by id only', async () => {
  const s = await setupVotingSession()
  const [own, a, b, c] = s.teamIds as [string, string, string, string]
  const alice = s.members[0]!
  assert.equal(s.data().participantRoster[alice.participantId]?.teamId, own)

  const res = await s.asStudent('ballot', alice, {
    allocations: [{ teamId: a, amount: 500 }, { teamId: b, amount: 300 }, { teamId: c, amount: 100 }],
  })

  assert.equal(res.statusCode, 200)
  assert.equal((res.body as { replaced: boolean }).replaced, false)
  const ballot = s.data().ballots[alice.participantId]
  assert.equal(ballot?.voterTeamId, own)
  assert.equal(ballot?.allocations.length, 3)

  // The manager is told who voted and how many, never what they voted.
  const frame = s.lastManagerFrame()
  assert.ok(frame, 'the manager socket received an update')
  assert.deepEqual(frame.data.ballotSubmitterIds, [alice.participantId])
  assert.equal(frame.data.ballotsReceived, 1)
  assert.equal('ballots' in frame.data, false)
  assert.equal(JSON.stringify(frame).includes('allocations'), false, 'no ballot contents in the manager frame')
})

void test('ballot route replaces an existing ballot', async () => {
  const s = await setupVotingSession()
  const [, a, b, c] = s.teamIds as [string, string, string, string]
  const alice = s.members[0]!
  await s.asStudent('ballot', alice, { allocations: [{ teamId: a, amount: 500 }, { teamId: b, amount: 300 }, { teamId: c, amount: 100 }] })

  const res = await s.asStudent('ballot', alice, { allocations: [{ teamId: c, amount: 500 }, { teamId: b, amount: 300 }, { teamId: a, amount: 100 }] })

  assert.equal((res.body as { replaced: boolean }).replaced, true)
  assert.equal(Object.keys(s.data().ballots).length, 1)
  assert.equal(s.data().ballots[alice.participantId]?.allocations.find((x) => x.amount === 500)?.teamId, c)
})

void test('ballot route accepts a reduced two-award ballot when only two other teams exist', async () => {
  const s = await setupVotingSession(3)
  const [, a, b] = s.teamIds as [string, string, string]
  const res = await s.asStudent('ballot', s.members[0]!, { allocations: [{ teamId: a, amount: 500 }, { teamId: b, amount: 300 }] })
  assert.equal(res.statusCode, 200)
})

void test('a late arrival cannot vote until the instructor places them on a team', async () => {
  const s = await setupVotingSession(3)
  const [a, b, c] = s.teamIds as [string, string, string]
  const late = await s.register('Late Larry')
  assert.equal(s.data().phase, 'voting')

  console.log('[TEST] expecting 409 ballot from ungrouped late arrival')
  const early = await s.asStudent('ballot', late, { allocations: [{ teamId: b, amount: 500 }, { teamId: c, amount: 300 }] })
  assert.equal(early.statusCode, 409)

  const placed = await s.asInstructor('assign-participant', { participantId: late.participantId, teamId: a })
  assert.equal(placed.statusCode, 200)
  assert.equal(s.data().participantRoster[late.participantId]?.teamId, a)

  const res = await s.asStudent('ballot', late, { allocations: [{ teamId: b, amount: 500 }, { teamId: c, amount: 300 }] })
  assert.equal(res.statusCode, 200)
})

void test('late placement may exceed the max team size; other moves stay locked after registration', async () => {
  const s = await setupVotingSession(2)
  const [a, b] = s.teamIds as [string, string]
  await s.asInstructor('phase', { phase: 'presentation' })
  s.data().maxTeamSize = 1
  const late = await s.register('Late Larry')

  const placed = await s.asInstructor('assign-participant', { participantId: late.participantId, teamId: a })
  assert.equal(placed.statusCode, 200, 'team a already has 1 of 1 members')
  assert.equal(s.data().teams[a]?.memberIds.length, 2)

  console.log('[TEST] expecting 409 for non-late moves after registration')
  assert.equal((await s.asInstructor('assign-participant', { participantId: late.participantId, teamId: b })).statusCode, 409, 'grouped student cannot move')
  assert.equal((await s.asInstructor('assign-participant', { participantId: late.participantId, teamId: null })).statusCode, 409, 'no removals')
  const other = await s.register('Other Late')
  assert.equal((await s.asInstructor('assign-participant', { participantId: other.participantId, newTeam: true })).statusCode, 409, 'no new teams')
  assert.equal(Object.keys(s.data().teams).length, 2)
})

void test('ballot route rejects invalid ballots without storing them', async () => {
  const s = await setupVotingSession()
  const [own, a, b] = s.teamIds as [string, string, string]
  console.log('[TEST] expecting 400 invalid ballots')
  const selfVote = await s.asStudent('ballot', s.members[0]!, {
    allocations: [{ teamId: own, amount: 500 }, { teamId: a, amount: 300 }, { teamId: b, amount: 100 }],
  })
  assert.equal(selfVote.statusCode, 400)
  const short = await s.asStudent('ballot', s.members[0]!, { allocations: [{ teamId: a, amount: 500 }] })
  assert.equal(short.statusCode, 400)
  assert.equal(Object.keys(s.data().ballots).length, 0)
})

void test('ballot route requires participant auth and the voting phase', async () => {
  const s = await setupPresentationSession(['Alice', 'Bob'])
  const [, b] = s.teamIds as [string, string]
  console.log('[TEST] expecting ballot auth/phase failures')
  const early = await s.asStudent('ballot', s.members[0]!, { allocations: [{ teamId: b, amount: 500 }] })
  assert.equal(early.statusCode, 409)
  const noAuth = await s.post('ballot', createRequest({ sessionId: s.sessionId }, {
    participantId: s.members[0]!.participantId, allocations: [{ teamId: b, amount: 500 }],
  }))
  assert.equal(noAuth.statusCode, 403)
})

void test('rejecting a voter deletes their ballot', async () => {
  const s = await setupVotingSession(2)
  const [, b] = s.teamIds as [string, string]
  const alice = s.members[0]!
  await s.asStudent('ballot', alice, { allocations: [{ teamId: b, amount: 500 }] })
  assert.ok(s.data().ballots[alice.participantId])

  await s.asInstructor('participant-name', { participantId: alice.participantId, rejected: true })

  assert.equal(alice.participantId in s.data().ballots, false)
})

void test('ballots survive results → voting and can be edited again', async () => {
  const s = await setupVotingSession(2)
  const [, b] = s.teamIds as [string, string]
  const alice = s.members[0]!
  await s.asStudent('ballot', alice, { allocations: [{ teamId: b, amount: 500 }] })
  await s.asInstructor('phase', { phase: 'results' })
  console.log('[TEST] expecting 409 ballot during results')
  assert.equal((await s.asStudent('ballot', alice, { allocations: [{ teamId: b, amount: 500 }] })).statusCode, 409)
  await s.asInstructor('phase', { phase: 'voting' })
  assert.ok(s.data().ballots[alice.participantId])
  assert.equal((await s.asStudent('ballot', alice, { allocations: [{ teamId: b, amount: 500 }] })).statusCode, 200)
})

// ── Phase 7: results and podium ──────────────────────────────────────────────

/** 4 teams; Loner (ungrouped) funds Team 4 > Team 3 > Team 2, so Team 1 is last. */
async function setupResultsSession() {
  const s = await setupVotingSession(4)
  const [t1, t2, t3, t4] = s.teamIds as [string, string, string, string]
  // Team 1's member votes, so Team 1 ends on $0.
  await s.asStudent('ballot', s.members[0]!, {
    allocations: [{ teamId: t4, amount: 500 }, { teamId: t3, amount: 300 }, { teamId: t2, amount: 100 }],
  })
  await s.asInstructor('phase', { phase: 'results' })
  return { ...s, t1, t2, t3, t4 }
}

void test('podium-step reveals 3rd, 2nd, winner, then complete and refuses further steps', async () => {
  const s = await setupResultsSession()
  const steps: string[] = []
  for (let i = 0; i < 4; i++) {
    const res = await s.asInstructor('podium-step', { action: 'next' })
    assert.equal(res.statusCode, 200)
    steps.push((res.body as { step: string }).step)
  }
  assert.deepEqual(steps, ['third', 'second', 'winner', 'complete'])
  console.log('[TEST] expecting 409 podium already revealed')
  assert.equal((await s.asInstructor('podium-step', { action: 'next' })).statusCode, 409)

  assert.equal((await s.asInstructor('podium-step', { action: 'reset' })).statusCode, 200)
  assert.equal(s.data().podiumRevealStep, 'hidden')
})

void test('student snapshot reveals only podium places already shown', async () => {
  const s = await setupResultsSession()
  const view = () => buildStudentSnapshot(s.data(), s.loner.participantId).podium.map((e) => [e.place, e.teams.map((t) => t.teamId).join()])

  assert.deepEqual(view(), [])
  await s.asInstructor('podium-step', { action: 'next' })
  assert.deepEqual(view(), [[3, s.t2]])
  await s.asInstructor('podium-step', { action: 'next' })
  assert.deepEqual(view(), [[3, s.t2], [2, s.t3]])
  await s.asInstructor('podium-step', { action: 'next' })
  assert.deepEqual(view(), [[3, s.t2], [2, s.t3], [1, s.t4]])

  const snapshot = buildStudentSnapshot(s.data(), s.loner.participantId)
  assert.equal('results' in snapshot, false, 'students never receive the full ranking')
})

void test('manager snapshot carries the full ranking only in results', async () => {
  const s = await setupResultsSession()
  const ranking = buildManagerSnapshot(s.data()).results
  assert.deepEqual(ranking?.map((r) => r.teamId), [s.t4, s.t3, s.t2, s.t1])
  assert.deepEqual(ranking?.map((r) => r.totalDollars), [500, 300, 100, 0])

  await s.asInstructor('phase', { phase: 'presentation' })
  assert.equal(buildManagerSnapshot(s.data()).results, null)
  assert.deepEqual(buildStudentSnapshot(s.data(), null).podium, [])
})

void test('leaving and re-entering results restarts the reveal', async () => {
  const s = await setupResultsSession()
  await s.asInstructor('podium-step', { action: 'next' })
  await s.asInstructor('phase', { phase: 'presentation' })
  await s.asInstructor('phase', { phase: 'voting' })
  await s.asInstructor('phase', { phase: 'results' })
  assert.equal(s.data().podiumRevealStep, 'hidden')
})

void test('no funding at all means nothing to reveal', async () => {
  const s = await setupVotingSession(2)
  await s.asInstructor('phase', { phase: 'results' })
  console.log('[TEST] expecting 409 podium with no funding')
  assert.equal((await s.asInstructor('podium-step', { action: 'next' })).statusCode, 409)
  assert.equal(buildStudentSnapshot(s.data(), null).podiumPlaceCount, 0)
})

void test('two funded teams reveal 2nd then winner', async () => {
  const s = await setupVotingSession(3)
  const [, b, c] = s.teamIds as [string, string, string]
  // Team 1's member funds b and c; Team 1 stays at $0, so there are two podium steps.
  await s.asStudent('ballot', s.members[0]!, { allocations: [{ teamId: b, amount: 500 }, { teamId: c, amount: 300 }] })
  await s.asInstructor('phase', { phase: 'results' })
  const first = await s.asInstructor('podium-step', { action: 'next' })
  assert.equal((first.body as { step: string }).step, 'second')
  const second = await s.asInstructor('podium-step', { action: 'next' })
  assert.equal((second.body as { step: string }).step, 'winner')
})

void test('podium-step requires instructor auth, results phase, and a valid action', async () => {
  const s = await setupVotingSession(2)
  console.log('[TEST] expecting podium-step failures')
  assert.equal((await s.asInstructor('podium-step', { action: 'next' })).statusCode, 409, 'not in results yet')
  await s.asInstructor('phase', { phase: 'results' })
  assert.equal((await s.asInstructor('podium-step', { action: 'skip' })).statusCode, 400)
  const noAuth = await s.post('podium-step', createRequest({ sessionId: s.sessionId }, { action: 'next' }))
  assert.equal(noAuth.statusCode, 403)
})

void test('teams with equal funding share a podium step', async () => {
  const s = await setupVotingSession(5)
  const [t1, t2, t3, t4, t5] = s.teamIds as [string, string, string, string, string]
  // Members of t1 and t5 vote: t3 and t4 both end on $800; t2 gets $200; t1 and t5 stay at $0.
  await s.asStudent('ballot', s.members[0]!, {
    allocations: [{ teamId: t4, amount: 500 }, { teamId: t3, amount: 300 }, { teamId: t2, amount: 100 }],
  })
  await s.asStudent('ballot', s.members[4]!, {
    allocations: [{ teamId: t3, amount: 500 }, { teamId: t4, amount: 300 }, { teamId: t2, amount: 100 }],
  })
  await s.asInstructor('phase', { phase: 'results' })
  for (let i = 0; i < 3; i++) await s.asInstructor('podium-step', { action: 'next' })

  const snapshot = buildStudentSnapshot(s.data(), s.loner.participantId)
  assert.equal(snapshot.podiumPlaceCount, 2, 'two funded totals → two steps; $0 team gets none')
  const winners = snapshot.podium.find((e) => e.place === 1)
  assert.deepEqual(winners?.teams.map((t) => t.teamId).sort(), [t3, t4].sort())
  assert.equal(winners?.totalDollars, 800)
  assert.deepEqual(snapshot.podium.find((e) => e.place === 2)?.teams.map((t) => t.teamId), [t2])
  assert.equal(JSON.stringify(snapshot.podium).includes(t1), false)
  assert.equal(JSON.stringify(snapshot.podium).includes(t5), false)
  assert.equal(s.data().podiumRevealStep, 'complete', '2 places: second → winner → complete')
})

// ── Manager reload recovery and snapshot privacy ─────────────────────────────

function createCookieResponse() {
  const res = createResponse() as MockResponse & {
    cookies: Record<string, { value: string; options: Record<string, unknown> }>
    headers: Record<string, string>
    cookie(name: string, value: string, options: Record<string, unknown>): void
    setHeader(name: string, value: string): void
  }
  res.cookies = {}
  res.headers = {}
  res.cookie = (name, value, options) => { res.cookies[name] = { value, options } }
  res.setHeader = (name, value) => { res.headers[name] = value }
  return res
}

async function createSessionWithCookie() {
  const app = createMockApp()
  const { store, sessions } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())
  const res = createCookieResponse()
  await app.handlers.post['/api/commissioned-ideas/create']!(createRequest(), res)
  const { id: sessionId, instructorPasscode } = res.body as { id: string; instructorPasscode: string }
  const [cookieName, cookie] = Object.entries(res.cookies)[0] ?? []
  const exchange = async (cookies: Record<string, unknown> | undefined, id = sessionId) => {
    const out = createCookieResponse()
    await app.handlers.get['/api/commissioned-ideas/:sessionId/instructor-passcode']!(
      { params: { sessionId: id }, cookies } as MockRequest,
      out,
    )
    return out
  }
  return { app, store, sessionId, instructorPasscode, res, cookieName: cookieName!, cookie: cookie!, exchange }
}

void test('create issues an httpOnly manager capability cookie and stores only its digest', async () => {
  const s = await createSessionWithCookie()
  assert.match(s.cookieName, /^activebits_cap_manager_/)
  assert.equal(s.cookie.options.httpOnly, true)
  assert.equal(s.cookie.options.sameSite, 'lax')
  assert.equal(s.res.headers['Cache-Control'], 'no-store')
  const stored = JSON.stringify(sessionData(s.store, s.sessionId))
  assert.equal(stored.includes(s.cookie.value), false, 'raw capability token must not be stored')
})

void test('instructor-passcode returns the passcode only for a valid manager capability cookie', async () => {
  const s = await createSessionWithCookie()

  const ok = await s.exchange({ [s.cookieName]: s.cookie.value })
  assert.equal(ok.statusCode, 200)
  assert.equal((ok.body as { instructorPasscode: string }).instructorPasscode, s.instructorPasscode)
  assert.equal(ok.headers['Cache-Control'], 'no-store')

  console.log('[TEST] expecting 403 passcode recovery refusals')
  assert.equal((await s.exchange(undefined)).statusCode, 403, 'no cookie')
  assert.equal((await s.exchange({ [s.cookieName]: 'not-the-token' })).statusCode, 403, 'wrong token')
  assert.equal((await s.exchange({ instructorPasscode: s.instructorPasscode })).statusCode, 403, 'the passcode itself is not proof')
})

void test('a manager capability for one session does not unlock another', async () => {
  const first = await createSessionWithCookie()
  const res = createCookieResponse()
  await first.app.handlers.post['/api/commissioned-ideas/create']!(createRequest(), res)
  const otherId = (res.body as { id: string }).id

  console.log('[TEST] expecting 403 cross-session recovery')
  // Same token presented under the other session's cookie name.
  const otherCookieName = Object.keys(res.cookies)[0]!
  assert.equal((await first.exchange({ [otherCookieName]: first.cookie.value }, otherId)).statusCode, 403)
  assert.equal((await first.exchange({ [first.cookieName]: first.cookie.value }, otherId)).statusCode, 403)
})

void test('snapshots never include passcodes, participant tokens, capability records, or unknown session fields', async () => {
  const s = await setupTeamOfTwo()
  const data = s.data()
  data.activityCapabilities = { cap1: { id: 'cap1', tokenHash: 'HASH-SECRET', principalKind: 'manager', issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER } }
  data.someFieldCoreAddsLater = 'CORE-SECRET'
  const aliceToken = s.alice.token // the participant cookie value

  for (const [label, snapshot] of [
    ['manager', buildManagerSnapshot(data)],
    ['student', buildStudentSnapshot(data, s.alice.participantId)],
    ['anonymous', buildStudentSnapshot(data, null)],
  ] as const) {
    const json = JSON.stringify(snapshot)
    assert.equal(json.includes(data.instructorPasscode), false, `${label}: passcode`)
    assert.equal(json.includes(aliceToken), false, `${label}: participant cookie value`)
    assert.equal(json.includes('HASH-SECRET'), false, `${label}: capability records`)
    assert.equal(json.includes('CORE-SECRET'), false, `${label}: unknown session fields`)
  }
  assert.equal(buildManagerSnapshot(data).participantRoster[s.alice.participantId]?.name, 'Alice')
})

// ── Participant identity must be proven (CodeRabbit: impersonation) ──────────

void test('register-participant with someone else\'s id but no valid token creates a new participant', async () => {
  const s = await setupSession()
  const victim = await s.register('Victim')
  const handler = (body: unknown, token?: string) => s.post('register-participant', token
    ? withParticipantToken({ sessionId: s.sessionId }, body, token)
    : createRequest({ sessionId: s.sessionId }, body))

  for (const [label, res] of [
    ['no token', await handler({ name: 'Attacker', participantId: victim.participantId })],
    ['wrong token', await handler({ name: 'Attacker', participantId: victim.participantId }, 'WRONGTOKEN')],
  ] as const) {
    const body = res.body as { participantId: string; token: string }
    assert.equal(res.statusCode, 200, label)
    assert.notEqual(body.participantId, victim.participantId, `${label}: must not take over the victim id`)
    assert.notEqual(body.token, victim.token, `${label}: must never receive the victim token`)
  }
  assert.equal(s.data().participantRoster[victim.participantId]?.name, 'Victim')
})

void test('a rejected student reconnecting with their token stays themselves (and rejected)', async () => {
  const s = await setupSession()
  const student = await s.register('Rude Name')
  await s.asInstructor('participant-name', { participantId: student.participantId, rejected: true })

  const res = await s.post('register-participant', withParticipantToken({ sessionId: s.sessionId }, { name: 'Rude Name', participantId: student.participantId }, student.token))
  assert.equal((res.body as { participantId: string }).participantId, student.participantId)
  assert.equal(Object.keys(s.data().participantRoster).length, 1, 'no new identity to slip past the rejection')
  assert.equal(s.data().participantRoster[student.participantId]?.rejectedByInstructor, true)
})

// ── WebSocket auth: failure paths and identity binding ───────────────────────

interface WsTestSocket {
  upgradeHeaders?: Record<string, string>
  sessionId?: string
  participantId?: string | null
  isManager?: boolean
  wantsManager?: boolean
  readyState: number
  send(message: string): void
  close(code?: number, reason?: string): void
  on(event: string, handler: (raw?: unknown) => void): void
}

async function setupWsHarness() {
  const app = createMockApp()
  const { store, sessions } = createMockSessions()
  const clients = new Set<WsTestSocket>()
  let wsHandler: ((socket: WsTestSocket, query: URLSearchParams) => void) | null = null
  const wsRouter = {
    wss: { clients, close() {} },
    register(path: string, handler: unknown) {
      if (path === '/ws/commissioned-ideas') wsHandler = handler as typeof wsHandler
    },
  } as unknown as WsRouter
  setupCommissionedIdeasRoutes(app, sessions, wsRouter)
  const { id: sessionId, instructorPasscode } = await createSession(app)
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

  /** A browser that registered sends its participant cookie on the upgrade request. */
  const cookieHeader = (who: { token: string }) => `${getActivityCapabilityCookieName('participant', sessionId)}=${who.token}`
  const settle = async () => { for (let i = 0; i < 5; i += 1) await tick() }

  const connect = async (
    query: Record<string, string>,
    opts: { as?: { token: string }; wait?: boolean } = {},
  ) => {
    const sent: Record<string, unknown>[] = []
    const handlers: Record<string, (raw?: unknown) => void> = {}
    let closed: { code?: number; reason?: string } | null = null
    const socket: WsTestSocket = {
      readyState: 1,
      send(message) { sent.push(JSON.parse(message) as Record<string, unknown>) },
      // Like a real socket: CLOSED state, then the 'close' event.
      close(code, reason) {
        if (socket.readyState === 3) return
        closed = { code, reason }
        socket.readyState = 3
        handlers.close?.()
      },
      on(event, handler) { handlers[event] = handler },
    }
    if (opts.as) socket.upgradeHeaders = { cookie: `theme=dark; ${cookieHeader(opts.as)}` }
    clients.add(socket)
    wsHandler!(socket, new URLSearchParams({ sessionId, ...query }))
    if (opts.wait !== false) await settle()
    return {
      socket,
      sent,
      closed: () => closed,
      say: async (payload: unknown) => {
        // A closed socket delivers nothing.
        if (socket.readyState === 1) handlers.message?.(typeof payload === 'string' ? payload : JSON.stringify(payload))
        await tick()
        await tick()
      },
      /** Sends a message without waiting, for interleaving tests. */
      sayNow: (payload: unknown) => {
        if (socket.readyState === 1) handlers.message?.(JSON.stringify(payload))
      },
      /** Client-side close (tab closed): CLOSED state, then the 'close' event. */
      hangUp: async () => {
        socket.close(1001, 'going away')
        await tick()
        await tick()
      },
      lastSnapshot: () => [...sent].reverse().find((m) => m.type !== 'commissioned-ideas:error')?.data as Record<string, unknown> | undefined,
    }
  }
  const register = (name: string) => registerParticipant(app, sessionId, name)
  const createTeam = async (who: { participantId: string; token: string }) => {
    const res = createResponse()
    await app.handlers.post['/api/commissioned-ideas/:sessionId/create-team']!(
      withParticipantToken({ sessionId }, { participantId: who.participantId }, who.token), res,
    )
    return (res.body as { teamId: string }).teamId
  }
  return { store, sessions, sessionId, instructorPasscode, connect, register, createTeam, tick, settle }
}

void test('manager websocket with a wrong passcode gets an error, a 1008 close, and no snapshot', async () => {
  const h = await setupWsHarness()
  const conn = await h.connect({ role: 'manager' })
  console.log('[TEST] expecting manager auth failure over websocket')
  await conn.say({ type: 'commissioned-ideas:manager-auth', instructorPasscode: 'WRONGPASS' })
  assert.equal(conn.sent.some((m) => m.type === 'commissioned-ideas:session-state'), false)
  assert.ok(conn.sent.some((m) => m.type === 'commissioned-ideas:error'))
  assert.equal(conn.closed()?.code, 1008)
  assert.notEqual(conn.socket.isManager, true)
})

void test('manager websocket ignores malformed frames without closing, and can still authenticate', async () => {
  const h = await setupWsHarness()
  const conn = await h.connect({ role: 'manager' })
  await conn.say('not json {')
  await conn.say({ type: 'commissioned-ideas:something-else' })
  assert.equal(conn.closed(), null, 'ignored frames must not close the socket')
  assert.equal(conn.sent.some((m) => m.type === 'commissioned-ideas:session-state'), false)

  await conn.say({ type: 'commissioned-ideas:manager-auth', instructorPasscode: h.instructorPasscode })
  assert.equal(conn.socket.isManager, true)
})

for (const [name, payload] of [
  ['missing passcode', { type: 'commissioned-ideas:manager-auth' }],
  ['non-string passcode', { type: 'commissioned-ideas:manager-auth', instructorPasscode: 42 }],
] as const) {
  void test(`manager websocket refuses ${name} with a 1008 close`, async () => {
    const h = await setupWsHarness()
    const conn = await h.connect({ role: 'manager' })
    console.log(`[TEST] expecting manager websocket refusal: ${name}`)
    await conn.say(payload)
    assert.equal(conn.closed()?.code, 1008)
    assert.equal(conn.sent.some((m) => m.type === 'commissioned-ideas:session-state'), false)
    assert.notEqual(conn.socket.isManager, true)
  })
}

void test('a participantId in the websocket URL grants nothing', async () => {
  const h = await setupWsHarness()
  const victim = await h.register('Victim')
  const teamId = await h.createTeam(victim)

  console.log('[TEST] expecting participant websocket refusal without a cookie')
  const attacker = await h.connect({ participantId: victim.participantId })
  assert.equal(attacker.socket.participantId, null, 'identity must not bind from the URL')
  assert.ok(attacker.sent.some((m) => m.type === 'commissioned-ideas:error' && m.code === 'participant-auth-refused'))
  const teams = attacker.lastSnapshot()?.teams as Record<string, { naming?: unknown }>
  assert.equal(teams[teamId]?.naming, undefined, 'victim team naming details must not be sent')
  assert.equal(attacker.lastSnapshot()?.viewerParticipantId, null)
})

void test('participant websocket binds identity only from a valid participant cookie', async () => {
  const h = await setupWsHarness()
  const student = await h.register('Student')
  const teamId = await h.createTeam(student)

  console.log('[TEST] expecting participant websocket refusal with a forged cookie')
  const forged = await h.connect({}, { as: { token: 'FORGED' } })
  assert.equal(forged.socket.participantId, null)
  assert.ok(forged.sent.some((m) => m.type === 'commissioned-ideas:error' && m.code === 'participant-auth-refused'))

  const conn = await h.connect({}, { as: student })
  assert.equal(conn.socket.participantId, student.participantId)
  assert.equal(conn.sent.filter((m) => m.type === 'commissioned-ideas:error').length, 0)
  assert.equal(conn.lastSnapshot()?.viewerParticipantId, student.participantId)
  const teams = conn.lastSnapshot()?.teams as Record<string, { naming?: unknown }>
  assert.notEqual(teams[teamId]?.naming, undefined, 'own team naming details arrive after auth')
  assert.equal(sessionData(h.store, h.sessionId).participantRoster[student.participantId]?.connected, true)
})

// ── Review round 3: request validation ───────────────────────────────────────

void test('assign-participant requires an explicit target and never treats a missing one as Ungrouped', async () => {
  const s = await setupSession()
  const alice = await s.register('Alice')
  const teamId = ((await s.asStudent('create-team', alice)).body as { teamId: string }).teamId

  console.log('[TEST] expecting 400 for assign-participant without a valid target')
  for (const body of [{}, { teamId: 42 }, { teamId: '' }, { newTeam: 'yes' }, { newTeam: true, teamId: teamId }]) {
    const res = await s.asInstructor('assign-participant', { participantId: alice.participantId, ...body })
    assert.equal(res.statusCode, 400, JSON.stringify(body))
  }
  assert.equal(s.data().participantRoster[alice.participantId]?.teamId, teamId, 'membership unchanged')
  assert.ok(s.data().teams[teamId], 'the team was not dissolved')

  // Explicit null still means Ungrouped.
  assert.equal((await s.asInstructor('assign-participant', { participantId: alice.participantId, teamId: null })).statusCode, 200)
  assert.equal(s.data().participantRoster[alice.participantId]?.teamId, null)
})

void test('team routes treat inherited property names as unknown teams (404, not a crash)', async () => {
  const s = await setupSession()
  const alice = await s.register('Alice')
  const bob = await s.register('Bob')
  await s.asStudent('create-team', alice)
  console.log('[TEST] expecting 404 for inherited property names used as team ids')
  for (const teamId of ['__proto__', 'toString', 'constructor']) {
    assert.equal((await s.asStudent('join-team', bob, { teamId })).statusCode, 404, `join ${teamId}`)
    assert.equal((await s.asInstructor('assign-participant', { participantId: bob.participantId, teamId })).statusCode, 404, `assign ${teamId}`)
    assert.equal(
      (await s.asInstructor('team/proposal-moderation', { teamId, kind: 'group', proposalId: 'x', rejected: true })).statusCode,
      404,
      `moderate ${teamId}`,
    )
  }
  assert.equal(
    (await s.asInstructor('participant-name', { participantId: '__proto__', rejected: true })).statusCode,
    404,
    'participant lookups use own keys too',
  )
})

void test('settings can only change during registration', async () => {
  const s = await setupPresentationSession()
  assert.equal((await s.asInstructor('settings', { maxTeamSize: 5 })).statusCode, 200)
  await s.asInstructor('phase', { phase: 'presentation' })

  console.log('[TEST] expecting 409 for settings changes after registration')
  for (const body of [{ maxTeamSize: 6 }, { groupingMode: 'random' }, { namingLocked: false }]) {
    assert.equal((await s.asInstructor('settings', body)).statusCode, 409, JSON.stringify(body))
  }
  assert.equal(s.data().maxTeamSize, 5)
  assert.equal(s.data().groupingMode, 'manual')
})

void test('a verified reconnect returns the instructor-moderated name, not the stale one sent', async () => {
  const s = await setupSession()
  const student = await s.register('bbo')
  await s.asInstructor('participant-name', { participantId: student.participantId, name: 'Bob' })

  const res = await s.post(
    'register-participant',
    withParticipantToken({ sessionId: s.sessionId }, { name: 'bbo', participantId: student.participantId }, student.token),
  )
  assert.equal(res.statusCode, 200)
  assert.equal((res.body as { name: string }).name, 'Bob')
  assert.equal(s.data().participantRoster[student.participantId]?.name, 'Bob')

  const fresh = await s.post('register-participant', createRequest({ sessionId: s.sessionId }, { name: '  Newcomer  ' }))
  assert.equal((fresh.body as { name: string }).name, 'Newcomer', 'new registrations still echo the sanitized name')
})

// ── Review round 3: ballot and podium integrity under moderation ──────────────

void test('rejecting the only member of a funded team withdraws ballots that funded it', async () => {
  const s = await setupVotingSession(2)
  const [teamA, teamB] = s.teamIds as [string, string]
  const [alice, bob] = s.members as [{ participantId: string; token: string }, { participantId: string; token: string }]
  assert.equal((await s.asStudent('ballot', alice, { allocations: [{ teamId: teamB, amount: 500 }] })).statusCode, 200)
  assert.equal((await s.asStudent('ballot', bob, { allocations: [{ teamId: teamA, amount: 500 }] })).statusCode, 200)

  await s.asInstructor('participant-name', { participantId: bob.participantId, rejected: true })

  const data = s.data()
  assert.equal(data.teams[teamB], undefined, 'team B is gone')
  assert.equal(data.ballots[alice.participantId], undefined, 'Alice funded the deleted team, so her ballot is withdrawn')
  assert.equal(data.ballots[bob.participantId], undefined, 'the rejected student’s own ballot does not count')
  assert.deepEqual(s.lastManagerFrame()?.data.ballotSubmitterIds, [], 'the manager no longer counts Alice as voted')
  for (const ballot of Object.values(data.ballots)) {
    for (const allocation of ballot.allocations) assert.ok(data.teams[allocation.teamId], 'no ballot funds a missing team')
  }
})

void test('ballots that did not fund the removed team are kept', async () => {
  const s = await setupVotingSession(5)
  const [t1, t2, t3, t4, t5] = s.teamIds as [string, string, string, string, string]
  const [m1, m2] = s.members as [{ participantId: string; token: string }, { participantId: string; token: string }]
  assert.equal((await s.asStudent('ballot', m1, { allocations: [{ teamId: t2, amount: 500 }, { teamId: t3, amount: 300 }, { teamId: t4, amount: 100 }] })).statusCode, 200)
  assert.equal((await s.asStudent('ballot', m2, { allocations: [{ teamId: t1, amount: 500 }, { teamId: t3, amount: 300 }, { teamId: t5, amount: 100 }] })).statusCode, 200)

  // Team 4's only member is rejected; m2 never funded team 4.
  await s.asInstructor('participant-name', { participantId: s.members[3]!.participantId, rejected: true })

  assert.equal(s.data().ballots[m1.participantId], undefined, 'm1 funded team 4')
  assert.notEqual(s.data().ballots[m2.participantId], undefined, 'm2 keeps their ballot')
})

void test('podium reveal resets when moderation changes the ranking, and survives changes that do not', async () => {
  const s = await setupResultsSession()
  await s.asInstructor('podium-step', { action: 'next' })
  await s.asInstructor('podium-step', { action: 'next' })
  assert.equal(s.data().podiumRevealStep, 'second')

  // Late placement of a student without a ballot leaves the podium as it was.
  const late = await s.register('Late')
  assert.equal((await s.asInstructor('assign-participant', { participantId: late.participantId, teamId: s.t1 })).statusCode, 200)
  assert.equal(s.data().podiumRevealStep, 'second', 'unchanged podium keeps the reveal')

  // Rejecting the only voter withdraws the only ballot: the podium changes.
  await s.asInstructor('participant-name', { participantId: s.members[0]!.participantId, rejected: true })
  assert.equal(s.data().podiumRevealStep, 'hidden', 'a changed podium is never shown under the old reveal')
  assert.equal(s.data().podiumRevealKey, null)
})

// ── Review round 3: websocket auth state machine and presence ────────────────

void test('student websocket for an unknown session closes without subscribing', async () => {
  const h = await setupWsHarness()
  const subscribed: string[] = []
  ;(h.sessions as unknown as { subscribeToBroadcast: (id: string) => void }).subscribeToBroadcast = (id: string) => { subscribed.push(id) }
  console.log('[TEST] expecting websocket refusal for an unknown session')
  const conn = await h.connect({ sessionId: 'NOPE' })
  assert.equal(conn.closed()?.code, 1008)
  assert.deepEqual(subscribed, [], 'stale links must not add broadcast subscriptions')
})

void test('a student socket gets no snapshot before cookie auth completes', async () => {
  const h = await setupWsHarness()
  const student = await h.register('Student')
  const conn = await h.connect({}, { as: student, wait: false })
  assert.equal(conn.sent.length, 0, 'nothing is sent while auth is pending')
  await h.settle()
  const first = conn.sent.find((m) => m.type !== 'commissioned-ideas:error')
  assert.equal((first?.data as { viewerParticipantId?: unknown } | undefined)?.viewerParticipantId, student.participantId, 'the first snapshot is already personalized')
})

void test('participant auth messages are ignored: identity comes only from the cookie', async () => {
  const h = await setupWsHarness()
  const student = await h.register('Student')
  console.log('[TEST] expecting participant websocket refusal without a cookie')
  const conn = await h.connect({})
  await conn.say({ type: 'commissioned-ideas:participant-auth', participantId: student.participantId, token: student.token })
  assert.equal(conn.socket.participantId, null)
})

void test('a socket closed while auth is reading the session never marks the student online', async () => {
  const h = await setupWsHarness()
  const student = await h.register('Student')
  sessionDataFromHarness(h).participantRoster[student.participantId]!.connected = false
  const conn = await h.connect({}, { as: student, wait: false })
  await conn.hangUp()
  await h.settle()
  assert.equal(sessionDataFromHarness(h).participantRoster[student.participantId]?.connected, false)
})

void test('presence stays online while another authenticated tab is open', async () => {
  const h = await setupWsHarness()
  const student = await h.register('Student')
  const oldTab = await h.connect({}, { as: student })
  const newTab = await h.connect({}, { as: student })

  await oldTab.hangUp()
  await h.settle()
  assert.equal(sessionDataFromHarness(h).participantRoster[student.participantId]?.connected, true, 'the new tab is still open')

  await newTab.hangUp()
  await h.settle()
  assert.equal(sessionDataFromHarness(h).participantRoster[student.participantId]?.connected, false, 'last tab closed')
})

void test('a store failure during participant auth leaves the socket retryable', async () => {
  const h = await setupWsHarness()
  const student = await h.register('Student')
  const realUpdate = h.sessions.updateAtomic
  h.sessions.updateAtomic = async () => { throw new Error('[TEST] simulated store write failure') }
  console.log('[TEST] expecting participant auth persistence failure')
  const conn = await h.connect({}, { as: student })
  h.sessions.updateAtomic = realUpdate

  assert.equal(conn.socket.participantId, null, 'binding is not committed')
  assert.equal((conn.socket as { studentAuth?: string }).studentAuth, 'pending')
  assert.ok(conn.sent.some((m) => m.type === 'commissioned-ideas:error' && m.code === 'participant-auth-failed'))
  assert.equal(conn.closed()?.code, 1011, 'a non-policy close lets the client reconnect and retry')

  // The reconnect authenticates normally.
  const retry = await h.connect({}, { as: student })
  assert.equal(retry.socket.participantId, student.participantId)
})

function sessionDataFromHarness(h: Awaited<ReturnType<typeof setupWsHarness>>): CommissionedIdeasSessionData {
  return sessionData(h.store, h.sessionId)
}

// ── Atomic-write contract ────────────────────────────────────────────────────

void test('routes never write with a plain set after create', async () => {
  const s = await setupPresentationSession()
  const setsAfterCreate = s.hooks.setCalls
  const late = await s.register('Late')
  await s.asInstructor('settings', { maxTeamSize: 5 })
  await s.asInstructor('assign-participant', { participantId: late.participantId, teamId: s.teamIds[0] })
  await s.asInstructor('phase', { phase: 'presentation' })
  await s.asInstructor('presentation-randomize', {})
  assert.equal(s.hooks.setCalls, setsAfterCreate, 'every write goes through updateAtomic')
})

void test('a refused request writes nothing', async () => {
  const s = await setupPresentationSession()
  const before = s.store[s.sessionId]!.mutationRevision
  console.log('[TEST] expecting refused requests')
  assert.equal((await s.asInstructor('phase', { phase: 'results' })).statusCode, 409)
  assert.equal((await s.asStudent('join-team', s.members[0]!, { teamId: 'missing' })).statusCode, 404)
  assert.equal((await s.post('settings', createRequest({ sessionId: s.sessionId }, { maxTeamSize: 9 }))).statusCode, 403)
  assert.equal(s.store[s.sessionId]!.mutationRevision, before, 'no revision bump for refusals')
})

void test('two concurrent joins cannot overfill a team', async () => {
  const s = await setupSession()
  await s.asInstructor('settings', { maxTeamSize: 2 })
  const alice = await s.register('Alice')
  const teamId = ((await s.asStudent('create-team', alice)).body as { teamId: string }).teamId
  const bob = await s.register('Bob')
  const carol = await s.register('Carol')

  console.log('[TEST] expecting one concurrent join to be refused as full')
  const [bobRes, carolRes] = await Promise.all([
    s.asStudent('join-team', bob, { teamId }),
    s.asStudent('join-team', carol, { teamId }),
  ])
  assert.deepEqual([bobRes.statusCode, carolRes.statusCode].sort(), [200, 409])
  assert.equal(s.data().teams[teamId]?.memberIds.length, 2)
})

void test('a write from another instance between read and commit is retried, not overwritten', async () => {
  const s = await setupSession()
  await s.asInstructor('settings', { maxTeamSize: 2 })
  const alice = await s.register('Alice')
  const teamId = ((await s.asStudent('create-team', alice)).body as { teamId: string }).teamId
  const bob = await s.register('Bob')
  const carol = await s.register('Carol')

  // Another instance places Bob, and core issues a capability, after Carol's request read the session.
  s.hooks.beforeCommit = (id) => {
    const record = s.store[id]!
    const data = structuredClone(record.data) as CommissionedIdeasSessionData & { activityCapabilities?: Record<string, unknown> }
    data.teams[teamId]!.memberIds.push(bob.participantId)
    data.participantRoster[bob.participantId]!.teamId = teamId
    data.activityCapabilities = { ...(data.activityCapabilities ?? {}), other: { id: 'other', principalKind: 'manager' } }
    s.store[id] = { ...record, data, mutationRevision: (record.mutationRevision ?? 0) + 1 }
  }

  console.log('[TEST] expecting the retried join to be refused as full')
  const res = await s.asStudent('join-team', carol, { teamId })
  assert.equal(res.statusCode, 409, 'the retry sees the team is now full')
  const data = s.data() as CommissionedIdeasSessionData & { activityCapabilities?: Record<string, unknown> }
  assert.deepEqual(data.teams[teamId]?.memberIds, [alice.participantId, bob.participantId], 'the other write survives')
  assert.notEqual(data.activityCapabilities?.other, undefined, 'a concurrent core capability write is not clobbered')
})

void test('a store failure during a route write returns 500 and changes nothing', async () => {
  const s = await setupSession()
  const alice = await s.register('Alice')
  const realUpdate = s.sessions.updateAtomic
  s.sessions.updateAtomic = async () => { throw new Error('[TEST] simulated store outage') }
  console.log('[TEST] expecting a 500 from a store failure')
  const res = await s.asStudent('create-team', alice)
  s.sessions.updateAtomic = realUpdate
  assert.equal(res.statusCode, 500)
  assert.deepEqual(s.data().teams, {})
})

// ── Participant cookie identity ──────────────────────────────────────────────

void test('student actions act as the cookie owner, whatever participantId the body names', async () => {
  const s = await setupSession()
  const alice = await s.register('Alice')
  const bob = await s.register('Bob')
  // Alice's cookie, Bob's id in the body: the team is Alice's.
  const res = await s.post('create-team', withParticipantToken({ sessionId: s.sessionId }, { participantId: bob.participantId }, alice.token))
  assert.equal(res.statusCode, 200)
  const teamId = (res.body as { teamId: string }).teamId
  assert.deepEqual(s.data().teams[teamId]?.memberIds, [alice.participantId])
  assert.equal(s.data().participantRoster[bob.participantId]?.teamId, null)
})

void test('student actions without a valid cookie are refused, and rejection still applies', async () => {
  const s = await setupSession()
  const alice = await s.register('Alice')
  console.log('[TEST] expecting 403 for missing, forged, and rejected participant cookies')
  assert.equal((await s.post('create-team', createRequest({ sessionId: s.sessionId }, { participantId: alice.participantId }))).statusCode, 403)
  assert.equal((await s.post('create-team', withParticipantToken({ sessionId: s.sessionId }, {}, 'FORGED'))).statusCode, 403)

  await s.asInstructor('participant-name', { participantId: alice.participantId, rejected: true })
  assert.equal((await s.asStudent('create-team', alice)).statusCode, 403, 'a rejected student cannot act')
  const again = await s.post('register-participant', withParticipantToken({ sessionId: s.sessionId }, { name: 'Alice 2' }, alice.token))
  assert.equal((again.body as { participantId: string }).participantId, alice.participantId, 'reconnecting cannot shed a rejection')
  assert.equal(s.data().participantRoster[alice.participantId]?.rejectedByInstructor, true)
})

void test('registration is refused once the session reaches the participant capability limit', async () => {
  const s = await setupSession()
  let last = 0
  for (let i = 0; i < 260 && last !== 409; i += 1) {
    last = (await s.post('register-participant', createRequest({ sessionId: s.sessionId }, { name: `Student ${i}` }))).statusCode
  }
  console.log('[TEST] expected registration refusal at the capability limit')
  assert.equal(last, 409)
  const before = Object.keys(s.data().participantRoster).length
  assert.ok(before >= 150, 'a full class registers before the limit')
  assert.equal((await s.post('register-participant', createRequest({ sessionId: s.sessionId }, { name: 'One more' }))).statusCode, 409)
  assert.equal(Object.keys(s.data().participantRoster).length, before, 'a refused registration adds nobody')
})
