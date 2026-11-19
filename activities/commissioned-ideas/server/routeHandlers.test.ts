/**
 * End-to-end handler tests for commissioned-ideas routes.
 * Uses the same mock harness pattern as algorithm-demo and resonance:
 * a fake app/sessions/ws triple is wired to setupCommissionedIdeasRoutes,
 * then individual handlers are invoked directly and the store is inspected.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { AtomicUpdateNotCommittedError, type SessionRecord } from 'activebits-server/core/sessions.js'
import type { WsRouter } from '../../../types/websocket.js'
import { getActivityCapabilityCookieName, issueActivityCapability } from 'activebits-server/core/activityCapabilities.js'
import setupCommissionedIdeasRoutes, { buildManagerSnapshot, buildStudentSnapshot } from './routes.js'
import type { CommissionedIdeasSessionData } from '../shared/types.js'
import { nextPodiumStep, podiumPlaceCount } from '../shared/podium.js'
import { computeTeamScores } from '../shared/scoring.js'

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

/** Test controls shared by every store instance created over the same data. */
interface MockStoreHooks {
  /** Runs once, between the next update's read and its commit (inject a competing write). */
  beforeCommit: ((id: string) => void) | null
  /** Awaited once, before the next update commits (hold a write in flight). */
  commitGate: Promise<void> | null
  /** Awaited once, inside the next read (hold a read in flight); `onGet` fires when it starts. */
  getGate: Promise<void> | null
  onGet: (() => void) | null
  /** The next N `updateAtomic` calls run the mutation, then throw (a store failure after the callback). */
  failUpdatesAfterMutate: number
  /** The next N `updateAtomic` calls commit, then throw (the write landed but its reply was lost). */
  failAfterCommit: number
  /** The next N strict reads throw (a store outage). */
  failStrictReads: number
  /** Strict reads so far (every instance). */
  strictReads: number
  /** Awaited once, after the next update commits and before it returns (the reply is in flight). */
  afterCommitGate: Promise<void> | null
  /** Per channel: awaited once before a new subscription becomes active (Valkey confirms SUBSCRIBE later). */
  subscribeGates: Map<string, Promise<void>>
  /** Per channel: the next N SUBSCRIBEs fail. */
  subscribeFailures: Map<string, number>
  /** Compare-and-set attempts per `updateAtomic` call (the Valkey store uses 12). */
  casBudget: number
  casConflicts: number
  setCalls: number
}

interface BusEntry { handler: BusHandler; active: boolean; owner: symbol; onResubscribed?: () => void }
type BusHandler = (message: unknown) => void

/**
 * In-memory store with the production contracts the routes rely on:
 * - `updateAtomic`: the mutation runs on a clone and commits only if the stored record
 *   still exists with the same revision and creation identity; otherwise it re-reads and
 *   retries up to `casBudget` times, then throws like the Valkey store.
 * - `get` may serve a per-instance cache (`cacheReads`), like the Valkey wrapper;
 *   `getStrict` always reads the shared data.
 * - Pub/sub: a subscription receives messages only once active (`subscribeToBroadcast`
 *   resolves then); messages published before that are lost, as in Valkey. A SUBSCRIBE
 *   can fail (rejects, nothing registered), and `subscriberOutage()` drops this
 *   instance's subscriber connection until its `reconnect()`, which re-activates the
 *   subscriptions and calls their `onResubscribed` listeners.
 * Pass `shared` to create a second "server instance" over the same data and bus.
 */
function createMockSessions(
  initial: Record<string, SessionRecord> = {},
  shared?: { store: Record<string, SessionRecord>; hooks: MockStoreHooks; bus: Map<string, BusEntry[]> },
  options: { cacheReads?: boolean } = {},
) {
  const store: Record<string, SessionRecord> = shared?.store ?? { ...initial }
  const hooks: MockStoreHooks = shared?.hooks ?? {
    beforeCommit: null, commitGate: null, getGate: null, onGet: null, failUpdatesAfterMutate: 0, failAfterCommit: 0, failStrictReads: 0,
    strictReads: 0, afterCommitGate: null, subscribeGates: new Map(), subscribeFailures: new Map(),
    casBudget: 12, casConflicts: 0, setCalls: 0,
  }
  const owner = Symbol('instance')
  const bus = shared?.bus ?? new Map<string, BusEntry[]>()
  const cache = new Map<string, SessionRecord>()

  const holdRead = async () => {
    const gate = hooks.getGate
    hooks.getGate = null
    if (gate) {
      hooks.onGet?.()
      await gate
    }
  }

  return {
    store,
    hooks,
    bus,
    cache,
    sessions: {
      async get(id: string) {
        await holdRead()
        if (options.cacheReads && cache.has(id)) return structuredClone(cache.get(id)!)
        const record = store[id] ?? null
        if (record && options.cacheReads) cache.set(id, structuredClone(record))
        return record
      },
      async getStrict(id: string) {
        await holdRead()
        hooks.strictReads += 1
        if (hooks.failStrictReads > 0) {
          hooks.failStrictReads -= 1
          throw new Error('[TEST] simulated store outage on read')
        }
        const record = store[id] ?? null
        if (record && options.cacheReads) cache.set(id, structuredClone(record))
        return record
      },
      async set(id: string, session: SessionRecord) {
        hooks.setCalls += 1
        store[id] = session
      },
      async updateAtomic(id: string, mutate: (session: SessionRecord) => SessionRecord) {
        for (let attempt = 0; attempt < hooks.casBudget; attempt += 1) {
          const current = store[id]
          if (!current) return null
          const revision = current.mutationRevision ?? 0
          const created = current.created
          const next = mutate(structuredClone(current))
          if (hooks.failUpdatesAfterMutate > 0) {
            hooks.failUpdatesAfterMutate -= 1
            throw new Error('[TEST] simulated store failure after the mutation ran')
          }
          const hook = hooks.beforeCommit
          hooks.beforeCommit = null
          hook?.(id)
          const gate = hooks.commitGate
          hooks.commitGate = null
          if (gate) await gate
          await Promise.resolve()
          // Like Valkey: the record must still exist, at the same revision and incarnation.
          const stored = store[id]
          if (!stored || (stored.mutationRevision ?? 0) !== revision || stored.created !== created) {
            if (!stored) return null
            hooks.casConflicts += 1
            continue
          }
          store[id] = { ...next, mutationRevision: revision + 1 }
          const committed = store[id]
          if (hooks.failAfterCommit > 0) {
            hooks.failAfterCommit -= 1
            throw new Error('[TEST] simulated lost reply after the write committed')
          }
          const afterCommit = hooks.afterCommitGate
          hooks.afterCommitGate = null
          if (afterCommit) await afterCommit
          return committed
        }
        throw new AtomicUpdateNotCommittedError('[TEST] atomic update exhausted retries')
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
      subscribeToBroadcast(channel: string, handler: BusHandler, opts: { onResubscribed?: () => void } = {}): Promise<void> {
        const failures = hooks.subscribeFailures.get(channel) ?? 0
        if (failures > 0) {
          hooks.subscribeFailures.set(channel, failures - 1)
          return Promise.reject(new Error(`[TEST] simulated SUBSCRIBE failure on ${channel}`))
        }
        const existing = (bus.get(channel) ?? []).find((entry) => entry.handler === handler && entry.owner === owner)
        if (existing) {
          existing.onResubscribed = opts.onResubscribed
          return Promise.resolve()
        }
        const entry: BusEntry = { handler, active: false, owner, onResubscribed: opts.onResubscribed }
        bus.set(channel, [...(bus.get(channel) ?? []), entry])
        const gate = hooks.subscribeGates.get(channel)
        hooks.subscribeGates.delete(channel)
        return (gate ?? Promise.resolve()).then(() => { entry.active = true })
      },
      unsubscribeFromBroadcast(channel: string, handler: BusHandler) {
        bus.set(channel, (bus.get(channel) ?? []).filter((entry) => entry.handler !== handler))
      },
      /** Drops this instance's subscriber connection; messages meanwhile are lost. */
      subscriberOutage() {
        const mine = [...bus.values()].flat().filter((entry) => entry.owner === owner)
        for (const entry of mine) entry.active = false
        return {
          reconnect() {
            for (const entry of mine) {
              if (![...bus.values()].flat().includes(entry)) continue // released meanwhile
              entry.active = true
              entry.onResubscribed?.()
            }
          },
        }
      },
      // Every active subscriber gets every message, the publisher's instance included.
      async publishBroadcast(channel: string, message: Record<string, unknown>) {
        const payload = JSON.parse(JSON.stringify(message)) as unknown
        for (const entry of bus.get(channel) ?? []) {
          if (entry.active) queueMicrotask(() => entry.handler(payload))
        }
      },
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
  assert.deepEqual(Object.keys(body).sort(), ['name', 'participantId', 'revision'], 'no credential in the response body')

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
  assert.equal(participant.connected, false, 'online only once a socket authenticates')
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
  assert.equal((editRes.body as { ok?: unknown }).ok, true)
  assert.equal(typeof (editRes.body as { revision?: unknown }).revision, 'number', 'mutation responses carry the committed revision')

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
    withParticipantToken({ sessionId }, { expectedParticipantId: participantId }, token),
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
    withParticipantToken({ sessionId }, { expectedParticipantId: participantId }, token),
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
    withParticipantToken({ sessionId }, { expectedParticipantId: participantId }, token),
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
    withParticipantToken({ sessionId }, { expectedParticipantId: aliceId }, aliceToken), teamRes,
  )
  const { teamId } = teamRes.body as { teamId: string }

  // Bob joins Alice's team
  const joinRes = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/join-team']!(
    withParticipantToken({ sessionId }, { expectedParticipantId: bobId, teamId }, bobToken), joinRes,
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
    withParticipantToken({ sessionId }, { expectedParticipantId: aliceId }, aliceToken), teamRes,
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
    withParticipantToken({ sessionId }, { expectedParticipantId: aliceId }, aliceToken), teamRes,
  )
  const { teamId } = teamRes.body as { teamId: string }

  await app.handlers.post['/api/commissioned-ideas/:sessionId/settings']!(
    withPasscode({ sessionId }, { groupingMode: 'random' }, instructorPasscode), createResponse(),
  )

  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/join-team']!(
    withParticipantToken({ sessionId }, { expectedParticipantId: bobId, teamId }, bobToken), res,
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
    withParticipantToken({ sessionId }, { expectedParticipantId: aliceId }, aliceToken), teamRes,
  )
  const { teamId } = teamRes.body as { teamId: string }

  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/join-team']!(
    withParticipantToken({ sessionId }, { expectedParticipantId: bobId, teamId }, bobToken), res,
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
    withParticipantToken({ sessionId }, { expectedParticipantId: participantId }, token), createResponse(),
  )

  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/leave-team']!(
    withParticipantToken({ sessionId }, { expectedParticipantId: participantId }, token), res,
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
    withParticipantToken({ sessionId }, { expectedParticipantId: participantId }, token), createResponse(),
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
    withParticipantToken({ sessionId }, { expectedParticipantId: participantId }, token), res,
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
    withParticipantToken({ sessionId }, { expectedParticipantId: aliceId }, aliceToken), teamRes,
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
    withParticipantToken({ sessionId }, { expectedParticipantId: participantId }, token), createResponse(),
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
    post(name, withParticipantToken({ sessionId }, { expectedParticipantId: who.participantId, ...body }, who.token))
  const data = () => sessionData(store, sessionId)
  const register = (name: string) => registerParticipant(app, sessionId, name)
  const lastManagerFrame = () => managerFrames[managerFrames.length - 1]
  /** The team a student is on now (what their naming form would name as `expectedTeamId`). */
  const teamOf = (who: { participantId: string }) => sessionData(store, sessionId).participantRoster[who.participantId]?.teamId ?? null
  return { sessionId, instructorPasscode, post, get, asInstructor, asStudent, data, register, lastManagerFrame, teamOf, store, sessions, hooks }
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

  const res = await s.asStudent('team/proposal', s.alice, { expectedTeamId: s.teamOf(s.alice), kind: 'group', value: '  Night Owls  ' })

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
  const first = (await s.asStudent('team/proposal', s.alice, { expectedTeamId: s.teamOf(s.alice), kind: 'project', value: 'Solar Oven' })).body as { proposalId: string }

  const res = await s.asStudent('team/proposal', s.bob, { expectedTeamId: s.teamOf(s.bob), kind: 'project', value: 'solar   oven' })

  assert.equal((res.body as { proposalId: string }).proposalId, first.proposalId)
  const team = s.data().teams[s.teamId]!
  assert.equal(team.proposedProjectNames.length, 1)
  assert.equal(team.projectNameVotes[s.bob.participantId], first.proposalId)
})

void test('team/proposal-vote changes a vote and re-resolves the name', async () => {
  const s = await setupTeamOfTwo()
  const owls = (await s.asStudent('team/proposal', s.alice, { expectedTeamId: s.teamOf(s.alice), kind: 'group', value: 'Owls' })).body as { proposalId: string }
  const hawks = (await s.asStudent('team/proposal', s.bob, { expectedTeamId: s.teamOf(s.bob), kind: 'group', value: 'Hawks' })).body as { proposalId: string }
  assert.equal(s.data().teams[s.teamId]?.groupName, 'Owls', '1–1 tie goes to earlier proposal')

  const res = await s.asStudent('team/proposal-vote', s.alice, { expectedTeamId: s.teamOf(s.alice), kind: 'group', proposalId: hawks.proposalId })

  assert.equal(res.statusCode, 200)
  assert.equal(s.data().teams[s.teamId]?.groupName, 'Hawks')
  assert.notEqual(s.data().teams[s.teamId]?.groupNameVotes[s.alice.participantId], owls.proposalId)
})

void test('team/proposal-vote rejects a proposal from another team', async () => {
  const s = await setupTeamOfTwo()
  const carol = await s.register('Carol')
  await s.asStudent('create-team', carol)
  const other = (await s.asStudent('team/proposal', carol, { expectedTeamId: s.teamOf(carol), kind: 'group', value: 'Foxes' })).body as { proposalId: string }

  console.log('[TEST] expecting 404 cross-team vote')
  const res = await s.asStudent('team/proposal-vote', s.alice, { expectedTeamId: s.teamOf(s.alice), kind: 'group', proposalId: other.proposalId })
  assert.equal(res.statusCode, 404)
})

void test('naming routes require team membership, valid kind, and participant auth', async () => {
  const s = await setupSession()
  const loner = await s.register('Loner')

  console.log('[TEST] expecting naming validation failures')
  assert.equal((await s.asStudent('team/proposal', loner, { expectedTeamId: s.teamOf(loner), kind: 'group', value: 'Solo' })).statusCode, 409)
  assert.equal((await s.asStudent('team/proposal', loner, { expectedTeamId: s.teamOf(loner), kind: 'mascot', value: 'Solo' })).statusCode, 400)
  assert.equal((await s.asStudent('team/proposal', loner, { expectedTeamId: s.teamOf(loner), kind: 'group', value: '   ' })).statusCode, 400)
  const noAuth = await s.post('team/proposal', createRequest({ sessionId: s.sessionId }, { participantId: loner.participantId, kind: 'group', value: 'X' }))
  assert.equal(noAuth.statusCode, 403)
})

void test('naming lock blocks proposals and votes but not grouping', async () => {
  const s = await setupTeamOfTwo()
  const owls = (await s.asStudent('team/proposal', s.alice, { expectedTeamId: s.teamOf(s.alice), kind: 'group', value: 'Owls' })).body as { proposalId: string }
  await s.asInstructor('settings', { namingLocked: true })

  console.log('[TEST] expecting 403 naming locked')
  assert.equal((await s.asStudent('team/proposal', s.bob, { expectedTeamId: s.teamOf(s.bob), kind: 'group', value: 'Hawks' })).statusCode, 403)
  assert.equal((await s.asStudent('team/proposal-vote', s.bob, { expectedTeamId: s.teamOf(s.bob), kind: 'group', proposalId: owls.proposalId })).statusCode, 403)
  assert.equal((await s.asStudent('leave-team', s.bob)).statusCode, 200, 'grouping lock is independent of naming lock')
})

void test('grouping lock does not block naming', async () => {
  const s = await setupTeamOfTwo()
  await s.asInstructor('settings', { studentGroupingLocked: true })
  const res = await s.asStudent('team/proposal', s.alice, { expectedTeamId: s.teamOf(s.alice), kind: 'project', value: 'Rain Catcher' })
  assert.equal(res.statusCode, 200)
})

void test('team/proposal-moderation rejects and restores, recomputing the displayed name', async () => {
  const s = await setupTeamOfTwo()
  const rude = (await s.asStudent('team/proposal', s.alice, { expectedTeamId: s.teamOf(s.alice), kind: 'group', value: 'Rude Name' })).body as { proposalId: string }
  await s.asStudent('team/proposal-vote', s.bob, { expectedTeamId: s.teamOf(s.bob), kind: 'group', proposalId: rude.proposalId })
  await s.asStudent('team/proposal', s.bob, { expectedTeamId: s.teamOf(s.bob), kind: 'group', value: 'Owls' })
  // Bob moved his vote to Owls by proposing it; Alice still on Rude Name → 1–1, Rude Name is older.
  assert.equal(s.data().teams[s.teamId]?.groupName, 'Rude Name')

  const rejectRes = await s.asInstructor('team/proposal-moderation', {
    teamId: s.teamId, kind: 'group', proposalId: rude.proposalId, rejected: true,
  })
  assert.equal(rejectRes.statusCode, 200)
  assert.equal(s.data().teams[s.teamId]?.groupName, 'Owls')

  console.log('[TEST] expecting 409 for re-proposing / voting a rejected name')
  assert.equal((await s.asStudent('team/proposal', s.bob, { expectedTeamId: s.teamOf(s.bob), kind: 'group', value: 'rude name' })).statusCode, 409)
  assert.equal((await s.asStudent('team/proposal-vote', s.bob, { expectedTeamId: s.teamOf(s.bob), kind: 'group', proposalId: rude.proposalId })).statusCode, 409)

  await s.asInstructor('team/proposal-moderation', {
    teamId: s.teamId, kind: 'group', proposalId: rude.proposalId, rejected: false,
  })
  assert.equal(s.data().teams[s.teamId]?.groupName, 'Rude Name', 'restored proposal votes count again')
})

void test('team/proposal-moderation requires instructor auth and a boolean rejected flag', async () => {
  const s = await setupTeamOfTwo()
  const p = (await s.asStudent('team/proposal', s.alice, { expectedTeamId: s.teamOf(s.alice), kind: 'group', value: 'Owls' })).body as { proposalId: string }

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
  await s.asStudent('team/proposal', s.alice, { expectedTeamId: s.teamOf(s.alice), kind: 'group', value: 'Owls' })
  const hawks = (await s.asStudent('team/proposal', s.bob, { expectedTeamId: s.teamOf(s.bob), kind: 'group', value: 'Hawks' })).body as { proposalId: string }
  await s.asStudent('team/proposal-vote', carol, { expectedTeamId: s.teamOf(carol), kind: 'group', proposalId: hawks.proposalId })
  assert.equal(s.data().teams[s.teamId]?.groupName, 'Hawks')

  await s.asStudent('leave-team', carol)

  assert.equal(s.data().teams[s.teamId]?.groupName, 'Owls')
  assert.equal(carol.participantId in (s.data().teams[s.teamId]?.groupNameVotes ?? {}), false)
})

void test('proposal count per kind is capped', async () => {
  const s = await setupTeamOfTwo()
  for (let i = 0; i < 20; i++) {
    const r = await s.asStudent('team/proposal', s.alice, { expectedTeamId: s.teamOf(s.alice), kind: 'group', value: `Name ${i}` })
    assert.equal(r.statusCode, 200)
  }
  console.log('[TEST] expecting 409 proposal limit')
  assert.equal((await s.asStudent('team/proposal', s.alice, { expectedTeamId: s.teamOf(s.alice), kind: 'group', value: 'One too many' })).statusCode, 409)
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
/** The step the reveal button offers for this state (what the client sends as `toStep`). */
function revealButtonStep(data: CommissionedIdeasSessionData) {
  return nextPodiumStep(data.podiumRevealStep, podiumPlaceCount(computeTeamScores(data.teams, data.ballots)))
}

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
    const res = await s.asInstructor('podium-step', { action: 'next', toStep: revealButtonStep(s.data()) })
    assert.equal(res.statusCode, 200)
    steps.push((res.body as { step: string }).step)
  }
  assert.deepEqual(steps, ['third', 'second', 'winner', 'complete'])
  console.log('[TEST] expecting 409 podium already revealed')
  assert.equal((await s.asInstructor('podium-step', { action: 'next', toStep: revealButtonStep(s.data()) })).statusCode, 409)

  assert.equal((await s.asInstructor('podium-step', { action: 'reset' })).statusCode, 200)
  assert.equal(s.data().podiumRevealStep, 'hidden')
})

void test('student snapshot reveals only podium places already shown', async () => {
  const s = await setupResultsSession()
  const view = () => buildStudentSnapshot(s.data(), s.loner.participantId).podium.map((e) => [e.place, e.teams.map((t) => t.teamId).join()])

  assert.deepEqual(view(), [])
  await s.asInstructor('podium-step', { action: 'next', toStep: revealButtonStep(s.data()) })
  assert.deepEqual(view(), [[3, s.t2]])
  await s.asInstructor('podium-step', { action: 'next', toStep: revealButtonStep(s.data()) })
  assert.deepEqual(view(), [[3, s.t2], [2, s.t3]])
  await s.asInstructor('podium-step', { action: 'next', toStep: revealButtonStep(s.data()) })
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
  await s.asInstructor('podium-step', { action: 'next', toStep: revealButtonStep(s.data()) })
  await s.asInstructor('phase', { phase: 'presentation' })
  await s.asInstructor('phase', { phase: 'voting' })
  await s.asInstructor('phase', { phase: 'results' })
  assert.equal(s.data().podiumRevealStep, 'hidden')
})

void test('no funding at all means nothing to reveal', async () => {
  const s = await setupVotingSession(2)
  await s.asInstructor('phase', { phase: 'results' })
  console.log('[TEST] expecting 409 podium with no funding')
  assert.equal((await s.asInstructor('podium-step', { action: 'next', toStep: revealButtonStep(s.data()) })).statusCode, 409)
  assert.equal(buildStudentSnapshot(s.data(), null).podiumPlaceCount, 0)
})

void test('two funded teams reveal 2nd then winner', async () => {
  const s = await setupVotingSession(3)
  const [, b, c] = s.teamIds as [string, string, string]
  // Team 1's member funds b and c; Team 1 stays at $0, so there are two podium steps.
  await s.asStudent('ballot', s.members[0]!, { allocations: [{ teamId: b, amount: 500 }, { teamId: c, amount: 300 }] })
  await s.asInstructor('phase', { phase: 'results' })
  const first = await s.asInstructor('podium-step', { action: 'next', toStep: revealButtonStep(s.data()) })
  assert.equal((first.body as { step: string }).step, 'second')
  const second = await s.asInstructor('podium-step', { action: 'next', toStep: revealButtonStep(s.data()) })
  assert.equal((second.body as { step: string }).step, 'winner')
})

void test('podium-step requires instructor auth, results phase, and a valid action', async () => {
  const s = await setupVotingSession(2)
  console.log('[TEST] expecting podium-step failures')
  assert.equal((await s.asInstructor('podium-step', { action: 'next', toStep: revealButtonStep(s.data()) })).statusCode, 409, 'not in results yet')
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
  for (let i = 0; i < 3; i++) await s.asInstructor('podium-step', { action: 'next', toStep: revealButtonStep(s.data()) })

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
  const { store, sessions, hooks, bus } = createMockSessions()
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
  return { app, store, hooks, bus, sessionId, instructorPasscode, res, cookieName: cookieName!, cookie: cookie!, exchange }
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

void test('instructor-passcode sees a manager capability reissued on another instance (no stale cache)', async () => {
  const a = await createSessionWithCookie()
  // Instance B over the same store, with a per-instance read cache like the Valkey wrapper.
  const appB = createMockApp()
  const b = createMockSessions({}, { store: a.store, hooks: a.hooks, bus: a.bus }, { cacheReads: true })
  setupCommissionedIdeasRoutes(appB, b.sessions, createMockWs())
  await b.sessions.get(a.sessionId) // B caches the record before the reissue

  // Another instance reissues the manager capability (core persistent-link reissue).
  const record = structuredClone(a.store[a.sessionId]!)
  const { token } = issueActivityCapability(record, 'manager')
  a.store[a.sessionId] = { ...record, mutationRevision: (record.mutationRevision ?? 0) + 1 }

  const out = createCookieResponse()
  await appB.handlers.get['/api/commissioned-ideas/:sessionId/instructor-passcode']!(
    { params: { sessionId: a.sessionId }, cookies: { [a.cookieName]: token } } as MockRequest,
    out,
  )
  assert.equal(out.statusCode, 200)
  assert.equal((out.body as { instructorPasscode: string }).instructorPasscode, a.instructorPasscode)
})

void test('instructor-passcode answers a store outage with a retryable 500, not 404', async () => {
  const s = await createSessionWithCookie()
  s.hooks.failStrictReads = 1
  console.log('[TEST] expecting a passcode recovery read failure')
  assert.equal((await s.exchange({ [s.cookieName]: s.cookie.value })).statusCode, 500)
})

void test('a store error after the write may have committed is not retried (no double apply)', async () => {
  const app = createMockApp()
  const { store, sessions, hooks } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())
  const { id: sessionId } = await createSession(app)
  const roster = () => Object.values((store[sessionId]!.data as CommissionedIdeasSessionData).participantRoster)

  hooks.failAfterCommit = 1
  console.log('[TEST] expecting an ambiguous store failure to surface as 500 without a retry')
  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/register-participant']!(createRequest({ sessionId }, { name: 'Ada' }), res)
  assert.equal(res.statusCode, 500, 'the outcome is unknown to the client')
  assert.equal(roster().length, 1, 'registered once, not once per retry round')
})

void test('a definitely uncommitted update (compare-and-set budget exhausted) is retried', async () => {
  const app = createMockApp()
  const { store, sessions, hooks } = createMockSessions()
  setupCommissionedIdeasRoutes(app, sessions, createMockWs())
  const { id: sessionId } = await createSession(app)

  hooks.casBudget = 1
  // The first round's only compare-and-set loses to a competing write; the next round commits.
  hooks.beforeCommit = (id) => { store[id] = { ...store[id]!, mutationRevision: (store[id]!.mutationRevision ?? 0) + 1 } }
  console.log('[TEST] expecting one uncommitted round, then a retry')
  const res = createResponse()
  await app.handlers.post['/api/commissioned-ideas/:sessionId/register-participant']!(createRequest({ sessionId }, { name: 'Ada' }), res)
  assert.equal(res.statusCode, 200)
  assert.equal(Object.keys((store[sessionId]!.data as CommissionedIdeasSessionData).participantRoster).length, 1)
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
  studentAuth?: string
  readyState: number
  send(message: string): void
  close(code?: number, reason?: string): void
  on(event: string, handler: (raw?: unknown) => void): void
}

/**
 * One "server instance" (its own routes, sockets, and instance id). Pass another
 * harness as `sameStoreAs` to start a second instance over the same store and pub/sub
 * bus, sharing its session.
 */
interface SharedWsStore {
  store: Record<string, SessionRecord>
  hooks: MockStoreHooks
  bus: Map<string, BusEntry[]>
  sessionId: string
  instructorPasscode: string
}

async function setupWsHarness(sameStoreAs?: SharedWsStore) {
  const app = createMockApp()
  const { store, sessions, hooks, bus, cache } = createMockSessions(
    {},
    sameStoreAs ? { store: sameStoreAs.store, hooks: sameStoreAs.hooks, bus: sameStoreAs.bus } : undefined,
    // A second instance caches reads, like the Valkey wrapper, so stale-cache bugs show up.
    { cacheReads: sameStoreAs !== undefined },
  )
  const clients = new Set<WsTestSocket>()
  let wsHandler: ((socket: WsTestSocket, query: URLSearchParams) => void) | null = null
  const wsRouter = {
    wss: { clients, close() {} },
    register(path: string, handler: unknown) {
      if (path === '/ws/commissioned-ideas') wsHandler = handler as typeof wsHandler
    },
  } as unknown as WsRouter
  setupCommissionedIdeasRoutes(app, sessions, wsRouter)
  const { id: sessionId, instructorPasscode } = sameStoreAs
    ? { id: sameStoreAs.sessionId, instructorPasscode: sameStoreAs.instructorPasscode }
    : await createSession(app)
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
  const asInstructor = async (path: string, body: unknown) => {
    const res = createResponse()
    await app.handlers.post[ROUTE(path)]!(withPasscode({ sessionId }, body, instructorPasscode), res)
    return res
  }

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
      withParticipantToken({ sessionId }, { expectedParticipantId: who.participantId }, who.token), res,
    )
    return (res.body as { teamId: string }).teamId
  }
  return { store, sessions, hooks, bus, cache, sessionId, instructorPasscode, connect, register, createTeam, tick, settle, asInstructor }
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
  await s.asInstructor('podium-step', { action: 'next', toStep: revealButtonStep(s.data()) })
  await s.asInstructor('podium-step', { action: 'next', toStep: revealButtonStep(s.data()) })
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
  let releaseRead: () => void = () => {}
  let readStarted = false
  h.hooks.getGate = new Promise<void>((resolve) => { releaseRead = resolve })
  h.hooks.onGet = () => { readStarted = true }

  const conn = await h.connect({}, { as: student, wait: false })
  await h.settle()
  assert.equal(readStarted, true, 'auth is inside the session read')
  await conn.hangUp() // closes while the read is held
  releaseRead() // the late read completes after the close
  await h.settle()
  assert.equal(sessionDataFromHarness(h).participantRoster[student.participantId]?.connected, false)
  assert.equal(conn.socket.participantId, null, 'a closed socket is never bound')
  assert.equal(h.bus.get(`session:${h.sessionId}:commissioned-ideas`)?.length ?? 0, 0, 'no subscription left behind')
})

void test('a student socket gets no snapshot until its presence write commits, even if another write broadcasts first', async () => {
  const h = await setupWsHarness()
  const student = await h.register('Student')
  let releaseCommit: () => void = () => {}
  h.hooks.commitGate = new Promise<void>((resolve) => { releaseCommit = resolve })

  const conn = await h.connect({}, { as: student, wait: false })
  await h.settle() // the presence write is now held before commit
  assert.equal((conn.socket as { studentAuth?: string }).studentAuth, 'pending')

  // Another write commits and broadcasts while this socket's auth is still in flight.
  assert.equal((await h.asInstructor('settings', { maxTeamSize: 5 })).statusCode, 200)
  await h.settle()
  assert.equal(conn.sent.length, 0, 'no snapshot before auth commits')

  releaseCommit()
  await h.settle()
  const first = conn.sent[0]
  assert.equal((first?.data as { viewerParticipantId?: unknown } | undefined)?.viewerParticipantId, student.participantId, 'the first snapshot is personalized')
  assert.equal((first?.data as { maxTeamSize?: unknown } | undefined)?.maxTeamSize, 5, 'and reflects the committed state')
})

void test('changes on one server instance reach sockets on another', async () => {
  const a = await setupWsHarness()
  const b = await setupWsHarness(a)
  const student = await a.register('Student')
  await a.createTeam(student)

  const studentOnB = await b.connect({}, { as: student })
  const managerOnA = await a.connect({ role: 'manager' })
  await managerOnA.say({ type: 'commissioned-ideas:manager-auth', instructorPasscode: a.instructorPasscode })
  const managerFramesBefore = managerOnA.sent.length

  assert.equal((await a.asInstructor('phase', { phase: 'presentation' })).statusCode, 200)
  await a.settle()
  await b.settle()

  const phaseFrame = studentOnB.sent.find((m) => m.type === 'commissioned-ideas:phase-changed')
  assert.ok(phaseFrame, 'the student on instance B saw the phase change')
  assert.equal((phaseFrame.data as { phase: string }).phase, 'presentation')
  assert.equal((phaseFrame.data as { viewerParticipantId: string }).viewerParticipantId, student.participantId, 'B built its own personalized snapshot')
  assert.equal(
    managerOnA.sent.slice(managerFramesBefore).filter((m) => m.type === 'commissioned-ideas:phase-changed').length,
    1,
    'the origin instance ignores its own invalidation (no duplicate)',
  )
})

void test('invalidations carry no snapshot data', async () => {
  const a = await setupWsHarness()
  const published: unknown[] = []
  a.bus.set(`session:${a.sessionId}:commissioned-ideas`, [{ handler: (message) => { published.push(message) }, active: true, owner: Symbol('observer') }])
  await a.asInstructor('settings', { maxTeamSize: 6 })
  await a.settle()
  assert.equal(published.length, 1)
  assert.deepEqual(Object.keys(published[0] as object).sort(), ['origin', 'type'])
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
  console.log('[TEST] expecting participant auth persistence failure after all retry rounds')
  const conn = await h.connect({}, { as: student })
  // atomicUpdate retries a few rounds with backoff before giving up.
  for (let i = 0; i < 100 && conn.closed() === null; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
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

void test('a student action is refused when the tab’s bound participant is not the cookie’s participant', async () => {
  const s = await setupVotingSession()
  const [, a, b, c] = s.teamIds as [string, string, string, string]
  const [alice, bob] = s.members as [{ participantId: string; token: string }, { participantId: string; token: string }]
  const allocations = [{ teamId: a, amount: 500 }, { teamId: b, amount: 300 }, { teamId: c, amount: 100 }]

  // The tab is bound to Alice, but another tab replaced the browser's cookie with Bob's.
  console.log('[TEST] expecting 409 participant-mismatch')
  const res = await s.post('ballot', withParticipantToken({ sessionId: s.sessionId }, { expectedParticipantId: alice.participantId, allocations }, bob.token))
  assert.equal(res.statusCode, 409)
  assert.equal((res.body as { code?: string }).code, 'participant-mismatch')
  assert.deepEqual(s.data().ballots, {}, 'nothing stored under either participant')

  // A ballot that is valid for Bob, so only the missing id can explain a refusal.
  // Bob is on teamIds[1]; the other three teams are eligible for him.
  const [t0, , t2, t3] = s.teamIds as [string, string, string, string]
  const bobAllocations = [{ teamId: t0, amount: 500 }, { teamId: t2, amount: 300 }, { teamId: t3, amount: 100 }]
  console.log('[TEST] expecting 400 without expectedParticipantId')
  const missing = await s.post('ballot', withParticipantToken({ sessionId: s.sessionId }, { allocations: bobAllocations }, bob.token))
  assert.equal(missing.statusCode, 400)
  assert.equal((missing.body as { error: string }).error, 'expectedParticipantId is required')
  const withId = await s.post('ballot', withParticipantToken({ sessionId: s.sessionId }, { allocations: bobAllocations, expectedParticipantId: bob.participantId }, bob.token))
  assert.equal(withId.statusCode, 200, 'the same ballot succeeds with the right id')
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

// ── Review round 4 ───────────────────────────────────────────────────────────

void test('registration does not mark a student online; HTTP reconnect leaves presence unchanged', async () => {
  const s = await setupSession()
  const alice = await s.register('Alice')
  assert.equal(s.data().participantRoster[alice.participantId]?.connected, false, 'offline until a socket authenticates')

  // Offline: an HTTP reconnect must not mark her online.
  const offlineReconnect = await s.post('register-participant', withParticipantToken({ sessionId: s.sessionId }, { name: 'Alice' }, alice.token))
  assert.equal(offlineReconnect.statusCode, 200)
  assert.equal(s.data().participantRoster[alice.participantId]?.connected, false, 'reconnect while offline stays offline')

  s.data().participantRoster[alice.participantId]!.connected = true // as if her socket were open
  await s.post('register-participant', withParticipantToken({ sessionId: s.sessionId }, { name: 'Alice' }, alice.token))
  assert.equal(s.data().participantRoster[alice.participantId]?.connected, true, 'reconnect does not touch presence')
})

void test('participant moderation requires a boolean rejected value', async () => {
  const s = await setupSession()
  const alice = await s.register('Alice')
  await s.asStudent('create-team', alice)
  console.log('[TEST] expecting 400 for non-boolean rejected values')
  for (const rejected of ['false', 'true', 0, 1, null]) {
    const res = await s.asInstructor('participant-name', { participantId: alice.participantId, rejected })
    assert.equal(res.statusCode, 400, JSON.stringify(rejected))
  }
  assert.equal(s.data().participantRoster[alice.participantId]?.rejectedByInstructor, false)
  assert.equal(Object.keys(s.data().teams).length, 1, 'no team was deleted')
})

void test('ballot removal is logged only after the change commits', async () => {
  const s = await setupVotingSession(2)
  const [teamA, teamB] = s.teamIds as [string, string]
  const [alice, bob] = s.members as [{ participantId: string; token: string }, { participantId: string; token: string }]
  await s.asStudent('ballot', alice, { allocations: [{ teamId: teamB, amount: 500 }] })
  await s.asStudent('ballot', bob, { allocations: [{ teamId: teamA, amount: 500 }] })

  const logged: unknown[][] = []
  const realInfo = console.info
  console.info = (...args: unknown[]) => { logged.push(args) }
  const realUpdate = s.sessions.updateAtomic
  try {
    // Every round runs the mutation (which withdraws the ballots on its draft) and then fails.
    s.sessions.updateAtomic = async (id, mutate) => {
      mutate(structuredClone(s.store[id]!))
      throw new Error('[TEST] simulated store failure after the mutation ran')
    }
    console.log('[TEST] expecting a 500 after repeated store failures')
    const failed = await s.asInstructor('participant-name', { participantId: bob.participantId, rejected: true })
    assert.equal(failed.statusCode, 500)
    assert.equal(logged.some((args) => String(args[0]).includes('Ballots removed')), false, 'no log for an uncommitted change')

    s.sessions.updateAtomic = realUpdate
    await s.asInstructor('participant-name', { participantId: bob.participantId, rejected: true })
  } finally {
    console.info = realInfo
    s.sessions.updateAtomic = realUpdate
  }
  const removed = logged.filter((args) => String(args[0]).includes('Ballots removed'))
  assert.equal(removed.length, 1, 'logged once, after commit')
  assert.deepEqual((removed[0]![1] as { count: number }).count, 2)
})

void test('a burst of registrations all succeed despite compare-and-set conflicts', async () => {
  const s = await setupSession()
  const responses = await Promise.all(
    Array.from({ length: 30 }, (_, i) => s.post('register-participant', createRequest({ sessionId: s.sessionId }, { name: `Student ${i}` }))),
  )
  const statuses = responses.map((res) => res.statusCode)
  assert.equal(statuses.filter((code) => code === 500).length, 0, `500s: ${JSON.stringify(statuses)}`)
  assert.equal(Object.keys(s.data().participantRoster).length, 30)
  assert.ok(s.hooks.casConflicts > 0, 'the burst really contended')
})

void test('an exhausted compare-and-set budget is retried in another round before failing', async () => {
  const s = await setupSession()
  s.hooks.casBudget = 1
  // The first round's only attempt loses to a competing write; the next round commits.
  s.hooks.beforeCommit = (id) => {
    const record = s.store[id]!
    s.store[id] = { ...record, mutationRevision: (record.mutationRevision ?? 0) + 1 }
  }
  console.log('[TEST] expecting one retried round after CAS exhaustion')
  const res = await s.post('register-participant', createRequest({ sessionId: s.sessionId }, { name: 'Resilient' }))
  assert.equal(res.statusCode, 200)
  assert.equal(Object.keys(s.data().participantRoster).length, 1)
})

// ── Review round 5 ───────────────────────────────────────────────────────────

void test('mutation responses and snapshots carry the same committed revision', async () => {
  const s = await setupSession()
  const before = s.store[s.sessionId]!.mutationRevision ?? 0
  const res = await s.asInstructor('settings', { maxTeamSize: 5 })
  const revision = (res.body as { revision: number }).revision
  assert.equal(revision, before + 1)
  assert.equal(revision, s.store[s.sessionId]!.mutationRevision)
  assert.equal(s.lastManagerFrame()?.data.revision, revision, 'the snapshot from that commit names the same revision')
})

void test('podium next must name the step its button offered', async () => {
  const s = await setupResultsSession()
  assert.equal((await s.asInstructor('podium-step', { action: 'next', toStep: 'third' })).statusCode, 200)
  assert.equal(s.data().podiumRevealStep, 'third')

  console.log('[TEST] expecting 409 stale-step')
  for (const toStep of ['third', undefined, 'winner']) {
    const res = await s.asInstructor('podium-step', { action: 'next', toStep })
    assert.equal(res.statusCode, 409, String(toStep))
    assert.equal((res.body as { code?: string }).code, 'stale-step')
  }
  assert.equal(s.data().podiumRevealStep, 'third', 'unchanged')
  assert.equal((await s.asInstructor('podium-step', { action: 'reset' })).statusCode, 200, 'reset names no step')
})

void test('podium next is refused when moderation changed the place count before the click', async () => {
  const s = await setupResultsSession()
  // The button rendered "Reveal 3rd place" (three funded places). Then t2 loses its
  // funding, leaving two places: the same click would now reveal 2nd place.
  const ballot = Object.values(s.store[s.sessionId]!.data.ballots as CommissionedIdeasSessionData['ballots'])[0]!
  ballot.allocations = ballot.allocations.filter((entry) => entry.teamId !== s.t2)
  assert.equal(revealButtonStep(s.data()), 'second')

  console.log('[TEST] expecting 409 stale-step after the place count changed')
  const res = await s.asInstructor('podium-step', { action: 'next', toStep: 'third' })
  assert.equal(res.statusCode, 409)
  assert.equal((res.body as { code?: string }).code, 'stale-step')
  assert.equal(s.data().podiumRevealStep, 'hidden')
})

void test('podium next is accepted when an unrelated change leaves the next step the same', async () => {
  const s = await setupResultsSession()
  // Totals change (t2 and t3 swap amounts) but three distinct funded places remain.
  const ballot = Object.values(s.store[s.sessionId]!.data.ballots as CommissionedIdeasSessionData['ballots'])[0]!
  const amountOf = (teamId: string) => ballot.allocations.find((entry) => entry.teamId === teamId)!.amount
  const [t2Amount, t3Amount] = [amountOf(s.t2), amountOf(s.t3)]
  ballot.allocations = ballot.allocations.map((entry) =>
    entry.teamId === s.t2 ? { ...entry, amount: t3Amount } : entry.teamId === s.t3 ? { ...entry, amount: t2Amount } : entry)
  assert.equal(revealButtonStep(s.data()), 'third')
  assert.equal((await s.asInstructor('podium-step', { action: 'next', toStep: 'third' })).statusCode, 200)
  assert.equal(s.data().podiumRevealStep, 'third')
})

void test('name proposals and votes are refused if the student’s team changed since the form was shown', async () => {
  const s = await setupTeamOfTwo()
  const formTeam = s.teamOf(s.alice)!
  const owls = (await s.asStudent('team/proposal', s.bob, { expectedTeamId: s.teamOf(s.bob), kind: 'group', value: 'Owls' })).body as { proposalId: string }
  const before = JSON.stringify(s.data().teams)

  console.log('[TEST] expecting 409 team-changed')
  for (const [path, body] of [
    ['team/proposal', { kind: 'group', value: 'Hawks', expectedTeamId: 'some-other-team' }],
    ['team/proposal-vote', { kind: 'group', proposalId: owls.proposalId, expectedTeamId: 'some-other-team' }],
    ['team/proposal', { kind: 'group', value: 'Hawks' }],
  ] as const) {
    const res = await s.asStudent(path, s.alice, body)
    assert.equal(res.statusCode, 409, `${path} ${JSON.stringify(body)}`)
    assert.equal((res.body as { code?: string }).code, 'team-changed')
  }
  assert.equal(JSON.stringify(s.data().teams), before, 'no proposal or vote recorded')
  assert.equal((await s.asStudent('team/proposal', s.alice, { kind: 'group', value: 'Hawks', expectedTeamId: formTeam })).statusCode, 200)
})

void test('a store outage on socket connect closes with a retryable 1011, not 1008', async () => {
  const h = await setupWsHarness()
  h.hooks.failStrictReads = 1
  console.log('[TEST] expecting a retryable socket close after a read failure')
  const conn = await h.connect({})
  assert.equal(conn.closed()?.code, 1011)
  assert.ok(conn.sent.some((m) => m.code === 'session-unavailable'))
})

void test('socket auth re-checks the cookie inside the presence write (a CAS retry sees it revoked)', async () => {
  const h = await setupWsHarness()
  const student = await h.register('Student')
  // The first commit loses to a write that also revokes every capability; the retry re-checks.
  h.hooks.beforeCommit = (id) => {
    const record = h.store[id]!
    const data = structuredClone(record.data) as Record<string, unknown>
    data.activityCapabilities = {}
    h.store[id] = { ...record, data, mutationRevision: (record.mutationRevision ?? 0) + 1 }
  }
  console.log('[TEST] expecting socket auth refusal after the cookie was revoked mid-write')
  const conn = await h.connect({}, { as: student })
  assert.equal(conn.socket.participantId, null)
  assert.ok(conn.sent.some((m) => m.code === 'participant-auth-refused'))
  assert.equal(sessionDataFromHarness(h).participantRoster[student.participantId]?.connected, false)
  assert.equal(conn.sent.some((m) => typeof (m.data as { viewerParticipantId?: unknown } | undefined)?.viewerParticipantId === 'string'), false, 'no personalized snapshot')
})

void test('a refused socket auth whose follow-up read fails closes with a retryable 1011', async () => {
  const h = await setupWsHarness()
  const student = await h.register('Student')
  h.hooks.beforeCommit = (id) => {
    const record = h.store[id]!
    const data = structuredClone(record.data) as Record<string, unknown>
    data.activityCapabilities = {}
    h.store[id] = { ...record, data, mutationRevision: (record.mutationRevision ?? 0) + 1 }
    // Every read from here fails, including the one after the refusal (the presence
    // reconcile and the subscription's refresh also read).
    h.hooks.failStrictReads = 100
  }
  console.log('[TEST] expecting auth refusal, then a failed re-read and a 1011 close')
  const conn = await h.connect({}, { as: student, wait: false })
  await waitFor(() => conn.closed() !== null, 'the socket is closed, not left pending')
  assert.equal(conn.closed()?.code, 1011)
  assert.equal(conn.sent.some((m) => m.type === 'commissioned-ideas:session-state'), false)
})

void test('a tab closing while a replacement tab finishes auth leaves the participant online', async () => {
  const h = await setupWsHarness()
  const student = await h.register('Student')
  const tabA = await h.connect({}, { as: student })
  assert.equal(sessionDataFromHarness(h).participantRoster[student.participantId]?.connected, true)

  // Tab B's presence write commits, but its reply has not reached the route yet.
  let deliverReply: () => void = () => {}
  h.hooks.afterCommitGate = new Promise<void>((resolve) => { deliverReply = resolve })
  const tabB = await h.connect({}, { as: student, wait: false })
  await waitFor(() => h.hooks.afterCommitGate === null, 'B committed')
  await tabA.hangUp()
  await h.settle()
  deliverReply()
  await h.settle()
  assert.equal(tabB.socket.studentAuth, 'authenticated')
  assert.equal(sessionDataFromHarness(h).participantRoster[student.participantId]?.connected, true, 'B is open')

  await tabB.hangUp()
  await h.settle()
  assert.equal(sessionDataFromHarness(h).participantRoster[student.participantId]?.connected, false, 'last tab closed')
})

void test('a failed socket auth reconciles presence with the sockets that remain', async () => {
  const h = await setupWsHarness()
  const student = await h.register('Student')
  sessionDataFromHarness(h).participantRoster[student.participantId]!.connected = true // stale: no socket is open
  h.hooks.failUpdatesAfterMutate = 1 // the auth write fails after its mutation ran (ambiguous: not retried)
  console.log('[TEST] expecting socket auth failure after all retry rounds')
  const conn = await h.connect({}, { as: student, wait: false })
  for (let i = 0; i < 100 && conn.closed() === null; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
  await h.settle()
  assert.equal(conn.closed()?.code, 1011)
  assert.equal(sessionDataFromHarness(h).participantRoster[student.participantId]?.connected, false, 'presence matches the open sockets (none)')
})

void test('an instance that subscribes late still delivers changes published before its subscription was active', async () => {
  const a = await setupWsHarness()
  const b = await setupWsHarness(a)
  const student = await a.register('Student')
  await a.createTeam(student)

  let activate: () => void = () => {}
  // Hold the activity channel specifically (socket setup subscribes to the core
  // broadcast channel first).
  a.hooks.subscribeGates.set(`session:${a.sessionId}:commissioned-ideas`, new Promise<void>((resolve) => { activate = resolve }))
  const studentOnB = await b.connect({}, { as: student }) // B's subscription is not active yet
  assert.equal((await a.asInstructor('phase', { phase: 'presentation' })).statusCode, 200) // published while B is deaf
  await a.settle()
  await b.settle()
  assert.equal((studentOnB.lastSnapshot() as { phase?: string } | undefined)?.phase, 'registration', 'B missed the invalidation')

  activate()
  await b.settle()
  assert.equal((studentOnB.lastSnapshot() as { phase?: string } | undefined)?.phase, 'presentation', 'B re-read after activation')
})

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.ok(condition(), label)
}

void test('an invalidation is delivered with one committed read', async () => {
  const a = await setupWsHarness()
  const b = await setupWsHarness(a)
  const student = await a.register('Student')
  await a.createTeam(student)
  const studentOnB = await b.connect({}, { as: student })
  const before = a.hooks.strictReads

  assert.equal((await a.asInstructor('phase', { phase: 'presentation' })).statusCode, 200)
  await a.settle()
  await b.settle()
  assert.equal((studentOnB.lastSnapshot() as { phase?: string } | undefined)?.phase, 'presentation')
  assert.equal(a.hooks.strictReads - before, 1)
})

void test('a failed committed-state read after an invalidation is retried', async () => {
  const a = await setupWsHarness()
  const b = await setupWsHarness(a)
  const student = await a.register('Student')
  await a.createTeam(student)
  const studentOnB = await b.connect({}, { as: student })

  a.hooks.failStrictReads = 1 // B's read for the invalidation fails once
  console.log('[TEST] expecting one failed invalidation read, then a retry')
  assert.equal((await a.asInstructor('phase', { phase: 'presentation' })).statusCode, 200)
  await waitFor(() => (studentOnB.lastSnapshot() as { phase?: string } | undefined)?.phase === 'presentation', 'B delivered after the retry')
})

void test('invalidation read retries stop once no local socket needs the session', async () => {
  const a = await setupWsHarness()
  const b = await setupWsHarness(a)
  const student = await a.register('Student')
  await a.createTeam(student)
  const studentOnB = await b.connect({}, { as: student })

  a.hooks.failStrictReads = 1
  console.log('[TEST] expecting one failed invalidation read, then no retry after release')
  assert.equal((await a.asInstructor('phase', { phase: 'presentation' })).statusCode, 200)
  await b.settle()
  await studentOnB.hangUp()
  await b.settle() // the close's own presence check reads once
  const reads = a.hooks.strictReads
  await new Promise((resolve) => setTimeout(resolve, 400))
  assert.equal(a.hooks.strictReads, reads, 'released: the pending retry does not read again')
})

void test('a failed invalidation SUBSCRIBE is retried, then refreshes local sockets', async () => {
  const a = await setupWsHarness()
  const b = await setupWsHarness(a)
  const student = await a.register('Student')
  await a.createTeam(student)

  a.hooks.subscribeFailures.set(`session:${a.sessionId}:commissioned-ideas`, 1)
  console.log('[TEST] expecting a failed invalidation SUBSCRIBE, then a retry')
  const studentOnB = await b.connect({}, { as: student })
  assert.equal((await a.asInstructor('phase', { phase: 'presentation' })).statusCode, 200) // B is not subscribed
  await waitFor(() => (studentOnB.lastSnapshot() as { phase?: string } | undefined)?.phase === 'presentation', 'B refreshed after re-subscribing')
})

void test('after its subscriber reconnects, an instance refreshes local sockets with committed state', async () => {
  const a = await setupWsHarness()
  const b = await setupWsHarness(a)
  const student = await a.register('Student')
  await a.createTeam(student)
  const studentOnB = await b.connect({}, { as: student })

  const outage = b.sessions.subscriberOutage()
  assert.equal((await a.asInstructor('phase', { phase: 'presentation' })).statusCode, 200) // lost on B
  await a.settle()
  await b.settle()
  assert.equal((studentOnB.lastSnapshot() as { phase?: string } | undefined)?.phase, 'registration', 'B missed it')

  outage.reconnect()
  await b.settle()
  assert.equal((studentOnB.lastSnapshot() as { phase?: string } | undefined)?.phase, 'presentation', 'B refreshed after reconnecting')
})

void test('an instance reads committed state, not its cache, when another instance invalidates', async () => {
  const a = await setupWsHarness()
  const b = await setupWsHarness(a)
  const student = await a.register('Student')
  await a.createTeam(student)
  const studentOnB = await b.connect({}, { as: student })
  await b.sessions.get(b.sessionId) // B's cache now holds the registration-phase record

  assert.equal((await a.asInstructor('phase', { phase: 'presentation' })).statusCode, 200)
  await a.settle()
  await b.settle()
  const frame = studentOnB.sent.find((m) => m.type === 'commissioned-ideas:phase-changed')
  assert.equal((frame?.data as { phase?: string } | undefined)?.phase, 'presentation', 'not the cached phase')
})

void test('an instance releases its subscription when its last socket for the session closes', async () => {
  const h = await setupWsHarness()
  const student = await h.register('Student')
  const channel = `session:${h.sessionId}:commissioned-ideas`
  const first = await h.connect({}, { as: student })
  const second = await h.connect({}, { as: student })
  assert.equal(h.bus.get(channel)?.length, 1, 'one subscription per instance and session')

  await first.hangUp()
  assert.equal(h.bus.get(channel)?.length, 1, 'kept while another local socket is open')
  await second.hangUp()
  assert.equal(h.bus.get(channel)?.length ?? 0, 0, 'released with the last socket')

  await h.connect({}, { as: student })
  assert.equal(h.bus.get(channel)?.length, 1, 'a new socket subscribes again')
})

void test('the mock store rejects a commit to a deleted or replaced record (like Valkey)', async () => {
  const s = await setupSession()
  let release: () => void = () => {}
  s.hooks.commitGate = new Promise<void>((resolve) => { release = resolve })
  const pending = s.asInstructor('settings', { maxTeamSize: 6 })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const record = s.store[s.sessionId]!
  s.store[s.sessionId] = { ...record, created: (record.created ?? 0) + 1 } // same id and revision, new incarnation
  release()
  const res = await pending
  assert.equal(res.statusCode, 200, 'the retry commits against the replacement')
  assert.equal(s.data().maxTeamSize, 6)
  assert.notEqual(s.store[s.sessionId]!.created, record.created, 'the replacement was not overwritten by the stale attempt')
})
