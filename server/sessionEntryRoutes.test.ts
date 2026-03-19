import test from 'node:test'
import assert from 'node:assert/strict'
import { initializeActivityRegistry } from './activities/activityRegistry.js'
import { EMBEDDED_CHILD_SESSION_PREFIX, setupSessionRoutes, type SessionRecord } from './core/sessions.js'

interface MockResponse {
  statusCode: number
  jsonBody: Record<string, unknown> | null
  headers: Record<string, string>
  status(code: number): MockResponse
  set(field: string, value: string): MockResponse
  json(payload: Record<string, unknown>): void
}

type MockRequest = { params: Record<string, string>; body?: Record<string, unknown> }
type RouteHandler = (req: MockRequest, res: MockResponse) => void | Promise<void>

function createMockApp(): {
  get: (path: string, handler: RouteHandler) => void
  post: (path: string, handler: RouteHandler) => void
  delete: (path: string, handler: RouteHandler) => void
  routes: { get: Map<string, RouteHandler>; post: Map<string, RouteHandler>; delete: Map<string, RouteHandler> }
} {
  const routes = {
    get: new Map<string, RouteHandler>(),
    post: new Map<string, RouteHandler>(),
    delete: new Map<string, RouteHandler>(),
  }
  return {
    get(path: string, handler: RouteHandler) {
      routes.get.set(path, handler)
    },
    post(path: string, handler: RouteHandler) {
      routes.post.set(path, handler)
    },
    delete(path: string, handler: RouteHandler) {
      routes.delete.set(path, handler)
    },
    routes,
  }
}

function createMockResponse(): MockResponse {
  return {
    statusCode: 200,
    jsonBody: null,
    headers: {},
    status(code: number) {
      this.statusCode = code
      return this
    },
    set(field: string, value: string) {
      this.headers[field.toLowerCase()] = value
      return this
    },
    json(payload: Record<string, unknown>) {
      this.jsonBody = payload
    },
  }
}

function getRoute(app: ReturnType<typeof createMockApp>, method: 'get' | 'post' | 'delete', path: string): RouteHandler {
  const handler = app.routes[method].get(path)
  if (!handler) {
    throw new Error(`Route ${method.toUpperCase()} ${path} not registered`)
  }
  return handler
}

void test('session delete route rejects embedded child sessions', async () => {
  await initializeActivityRegistry()

  let deleted = false
  const sessions = {
    get: async (id: string) => id === 'CHILD:parent:abc12:embedded-test' ? createSessionRecord(id, 'embedded-test') : null,
    set: async () => {},
    delete: async () => {
      deleted = true
      return true
    },
    touch: async () => true,
    getAll: async () => [],
    getAllIds: async () => [],
    cleanup: () => {},
    close: async () => {},
  }
  const app = createMockApp()
  setupSessionRoutes(app as unknown as Parameters<typeof setupSessionRoutes>[0], sessions)

  const res = createMockResponse()
  await getRoute(app, 'delete', '/api/session/:sessionId')({ params: { sessionId: 'CHILD:parent:abc12:embedded-test' } }, res)

  assert.equal(res.statusCode, 403)
  assert.deepEqual(res.jsonBody, { error: 'embedded child sessions must be ended by the parent session' })
  assert.equal(deleted, false)
})

function createSessionRecord(id: string, type: string): SessionRecord {
  return {
    id,
    type,
    created: Date.now(),
    lastActivity: Date.now(),
    data: {},
  }
}

void test('session entry route returns render-ui for activities with waiting-room fields', async () => {
  await initializeActivityRegistry()
  const sessions = {
    get: async (id: string) => id === 'session-1' ? createSessionRecord(id, 'java-string-practice') : null,
    set: async () => {},
    delete: async () => true,
    touch: async () => true,
    getAll: async () => [],
    getAllIds: async () => [],
    cleanup: () => {},
    close: async () => {},
  }
  const app = createMockApp()
  setupSessionRoutes(app as unknown as Parameters<typeof setupSessionRoutes>[0], sessions)

  const res = createMockResponse()
  await getRoute(app, 'get', '/api/session/:sessionId/entry')({ params: { sessionId: 'session-1' } }, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    sessionId: 'session-1',
    activityName: 'java-string-practice',
    waitingRoomFieldCount: 1,
    resolvedRole: 'student',
    entryOutcome: 'join-live',
    presentationMode: 'render-ui',
  })
})

void test('session entry route returns pass-through for activities without waiting-room fields', async () => {
  await initializeActivityRegistry()
  const sessions = {
    get: async (id: string) => id === 'session-2' ? createSessionRecord(id, 'raffle') : null,
    set: async () => {},
    delete: async () => true,
    touch: async () => true,
    getAll: async () => [],
    getAllIds: async () => [],
    cleanup: () => {},
    close: async () => {},
  }
  const app = createMockApp()
  setupSessionRoutes(app as unknown as Parameters<typeof setupSessionRoutes>[0], sessions)

  const res = createMockResponse()
  await getRoute(app, 'get', '/api/session/:sessionId/entry')({ params: { sessionId: 'session-2' } }, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    sessionId: 'session-2',
    activityName: 'raffle',
    waitingRoomFieldCount: 0,
    resolvedRole: 'student',
    entryOutcome: 'join-live',
    presentationMode: 'pass-through',
  })
})

void test('session entry route returns 404 for missing sessions', async () => {
  await initializeActivityRegistry()
  const sessions = {
    get: async () => null,
    set: async () => {},
    delete: async () => true,
    touch: async () => true,
    getAll: async () => [],
    getAllIds: async () => [],
    cleanup: () => {},
    close: async () => {},
  }
  const app = createMockApp()
  setupSessionRoutes(app as unknown as Parameters<typeof setupSessionRoutes>[0], sessions)

  const res = createMockResponse()
  await getRoute(app, 'get', '/api/session/:sessionId/entry')({ params: { sessionId: 'missing' } }, res)

  assert.equal(res.statusCode, 404)
  assert.deepEqual(res.jsonBody, { error: 'invalid session' })
})

void test('embedded launch route returns only selectedOptions and not raw session data', async () => {
  await initializeActivityRegistry()
  const embeddedSessionId = `${EMBEDDED_CHILD_SESSION_PREFIX}session-embedded`
  const session: SessionRecord = {
    ...createSessionRecord(embeddedSessionId, 'video-sync'),
    data: {
      instructorPasscode: 'secret-passcode',
      embeddedLaunch: {
        parentSessionId: 'parent-1',
        instanceKey: 'video-sync:3:0',
        selectedOptions: {
          sourceUrl: 'https://www.youtube.com/watch?v=mCq8-xTH7jA',
        },
      },
    },
  }
  const sessions = {
    get: async (id: string) => id === embeddedSessionId ? session : null,
    set: async () => {},
    delete: async () => true,
    touch: async () => true,
    getAll: async () => [],
    getAllIds: async () => [],
    cleanup: () => {},
    close: async () => {},
  }
  const app = createMockApp()
  setupSessionRoutes(app as unknown as Parameters<typeof setupSessionRoutes>[0], sessions)

  const res = createMockResponse()
  await getRoute(app, 'get', '/api/session/:sessionId/embedded-launch')({ params: { sessionId: embeddedSessionId } }, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.deepEqual(res.jsonBody, {
    embeddedLaunch: {
      selectedOptions: {
        sourceUrl: 'https://www.youtube.com/watch?v=mCq8-xTH7jA',
      },
    },
  })
  assert.equal('session' in (res.jsonBody ?? {}), false)
  assert.equal(JSON.stringify(res.jsonBody).includes('secret-passcode'), false)
})

void test('embedded launch route treats array session.data as absent object data', async () => {
  await initializeActivityRegistry()
  const embeddedSessionId = `${EMBEDDED_CHILD_SESSION_PREFIX}session-array`
  const session: SessionRecord = {
    ...createSessionRecord(embeddedSessionId, 'video-sync'),
    data: [] as unknown as Record<string, unknown>,
  }
  const sessions = {
    get: async (id: string) => id === embeddedSessionId ? session : null,
    set: async () => {},
    delete: async () => true,
    touch: async () => true,
    getAll: async () => [],
    getAllIds: async () => [],
    cleanup: () => {},
    close: async () => {},
  }
  const app = createMockApp()
  setupSessionRoutes(app as unknown as Parameters<typeof setupSessionRoutes>[0], sessions)

  const res = createMockResponse()
  await getRoute(app, 'get', '/api/session/:sessionId/embedded-launch')({ params: { sessionId: embeddedSessionId } }, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.jsonBody, {
    embeddedLaunch: {
      selectedOptions: null,
    },
  })
})

void test('embedded launch route rejects non-child session ids', async () => {
  await initializeActivityRegistry()
  const session = createSessionRecord('session-parent', 'video-sync')
  const sessions = {
    get: async (id: string) => id === 'session-parent' ? session : null,
    set: async () => {},
    delete: async () => true,
    touch: async () => true,
    getAll: async () => [],
    getAllIds: async () => [],
    cleanup: () => {},
    close: async () => {},
  }
  const app = createMockApp()
  setupSessionRoutes(app as unknown as Parameters<typeof setupSessionRoutes>[0], sessions)

  const res = createMockResponse()
  await getRoute(app, 'get', '/api/session/:sessionId/embedded-launch')({ params: { sessionId: 'session-parent' } }, res)

  assert.equal(res.statusCode, 403)
  assert.deepEqual(res.jsonBody, {
    error: 'embedded launch is only available for embedded child sessions',
  })
})

void test('session entry participant store route returns 404 for missing sessions', async () => {
  await initializeActivityRegistry()
  const sessions = {
    get: async () => null,
    set: async () => {},
    delete: async () => true,
    touch: async () => true,
    getAll: async () => [],
    getAllIds: async () => [],
    cleanup: () => {},
    close: async () => {},
  }
  const app = createMockApp()
  setupSessionRoutes(app as unknown as Parameters<typeof setupSessionRoutes>[0], sessions)

  const res = createMockResponse()
  await getRoute(app, 'post', '/api/session/:sessionId/entry-participant')({
    params: { sessionId: 'missing' },
    body: { values: { displayName: 'Ada' } },
  }, res)

  assert.equal(res.statusCode, 404)
  assert.deepEqual(res.jsonBody, { error: 'invalid session' })
})

void test('session entry participant routes store and consume waiting-room values by token', async () => {
  await initializeActivityRegistry()
  const session = createSessionRecord('session-3', 'java-string-practice')
  const sessionMap = new Map<string, SessionRecord>([['session-3', session]])
  const sessions = {
    get: async (id: string) => sessionMap.get(id) ?? null,
    set: async (id: string, nextSession: SessionRecord) => {
      sessionMap.set(id, nextSession)
    },
    delete: async () => true,
    touch: async () => true,
    getAll: async () => [],
    getAllIds: async () => [],
    cleanup: () => {},
    close: async () => {},
  }
  const app = createMockApp()
  setupSessionRoutes(app as unknown as Parameters<typeof setupSessionRoutes>[0], sessions)

  const storeRes = createMockResponse()
  await getRoute(app, 'post', '/api/session/:sessionId/entry-participant')({
    params: { sessionId: 'session-3' },
    body: {
      values: {
        displayName: 'Ada',
        ignored: () => 'x',
      },
    },
  }, storeRes)

  assert.equal(storeRes.statusCode, 200)
  assert.equal(storeRes.headers['cache-control'], 'no-store')
  const token = typeof storeRes.jsonBody?.entryParticipantToken === 'string' ? storeRes.jsonBody.entryParticipantToken : null
  assert.equal(typeof token, 'string')
  const participantId = typeof (storeRes.jsonBody?.values as Record<string, unknown> | undefined)?.participantId === 'string'
    ? (storeRes.jsonBody?.values as Record<string, unknown>).participantId as string
    : null
  assert.equal(typeof participantId, 'string')
  assert.deepEqual(
    storeRes.jsonBody?.values,
    {
      displayName: 'Ada',
      participantId,
    },
  )

  const consumeRes = createMockResponse()
  await getRoute(app, 'post', '/api/session/:sessionId/entry-participant/consume')({
    params: { sessionId: 'session-3' },
    body: { token: token as string },
  }, consumeRes)

  assert.equal(consumeRes.statusCode, 200)
  assert.equal(consumeRes.headers['cache-control'], 'no-store')
  assert.deepEqual(
    consumeRes.jsonBody,
    {
      values: {
        displayName: 'Ada',
        participantId,
      },
    },
  )
  assert.deepEqual(
    (sessionMap.get('session-3')?.data as Record<string, unknown>).acceptedEntryParticipants,
    {
      [participantId as string]: {
        participantId,
        displayName: 'Ada',
        acceptedAt: (sessionMap.get('session-3')?.data as {
          acceptedEntryParticipants?: Record<string, { acceptedAt: number }>
        }).acceptedEntryParticipants?.[participantId as string]?.acceptedAt,
      },
    },
  )

  const missingRes = createMockResponse()
  await getRoute(app, 'post', '/api/session/:sessionId/entry-participant/consume')({
    params: { sessionId: 'session-3' },
    body: { token: token as string },
  }, missingRes)

  assert.equal(missingRes.statusCode, 404)
  assert.deepEqual(missingRes.jsonBody, { error: 'entry participant not found' })
})

void test('session entry participant consume route trims tokens and rejects blank token requests', async () => {
  await initializeActivityRegistry()
  const session = createSessionRecord('session-4', 'java-string-practice')
  const sessionMap = new Map<string, SessionRecord>([['session-4', session]])
  const sessions = {
    get: async (id: string) => sessionMap.get(id) ?? null,
    set: async (id: string, nextSession: SessionRecord) => {
      sessionMap.set(id, nextSession)
    },
    delete: async () => true,
    touch: async () => true,
    getAll: async () => [],
    getAllIds: async () => [],
    cleanup: () => {},
    close: async () => {},
  }
  const app = createMockApp()
  setupSessionRoutes(app as unknown as Parameters<typeof setupSessionRoutes>[0], sessions)

  const storeRes = createMockResponse()
  await getRoute(app, 'post', '/api/session/:sessionId/entry-participant')({
    params: { sessionId: 'session-4' },
    body: {
      values: {
        displayName: 'Grace',
      },
    },
  }, storeRes)

  const token = String(storeRes.jsonBody?.entryParticipantToken)

  const trimmedConsumeRes = createMockResponse()
  await getRoute(app, 'post', '/api/session/:sessionId/entry-participant/consume')({
    params: { sessionId: 'session-4' },
    body: { token: `  ${token}  ` },
  }, trimmedConsumeRes)

  assert.equal(trimmedConsumeRes.statusCode, 200)
  assert.equal(
    typeof (trimmedConsumeRes.jsonBody?.values as Record<string, unknown> | undefined)?.participantId,
    'string',
  )

  const blankConsumeRes = createMockResponse()
  await getRoute(app, 'post', '/api/session/:sessionId/entry-participant/consume')({
    params: { sessionId: 'session-4' },
    body: { token: '   ' },
  }, blankConsumeRes)

  assert.equal(blankConsumeRes.statusCode, 404)
  assert.deepEqual(blankConsumeRes.jsonBody, { error: 'entry participant not found' })
})

void test('session entry participant store route rejects oversized payloads', async () => {
  await initializeActivityRegistry()
  const session = createSessionRecord('session-5', 'java-string-practice')
  const sessionMap = new Map<string, SessionRecord>([['session-5', session]])
  const sessions = {
    get: async (id: string) => sessionMap.get(id) ?? null,
    set: async (id: string, nextSession: SessionRecord) => {
      sessionMap.set(id, nextSession)
    },
    delete: async () => true,
    touch: async () => true,
    getAll: async () => [],
    getAllIds: async () => [],
    cleanup: () => {},
    close: async () => {},
  }
  const app = createMockApp()
  setupSessionRoutes(app as unknown as Parameters<typeof setupSessionRoutes>[0], sessions)

  const res = createMockResponse()
  await getRoute(app, 'post', '/api/session/:sessionId/entry-participant')({
    params: { sessionId: 'session-5' },
    body: {
      values: {
        displayName: 'x'.repeat(9000),
      },
    },
  }, res)

  assert.equal(res.statusCode, 413)
  assert.deepEqual(res.jsonBody, { error: 'entry participant payload too large' })
})

void test('session entry participant consume route returns 404 for missing sessions', async () => {
  await initializeActivityRegistry()
  const sessions = {
    get: async () => null,
    set: async () => {},
    delete: async () => true,
    touch: async () => true,
    getAll: async () => [],
    getAllIds: async () => [],
    cleanup: () => {},
    close: async () => {},
  }
  const app = createMockApp()
  setupSessionRoutes(app as unknown as Parameters<typeof setupSessionRoutes>[0], sessions)

  const res = createMockResponse()
  await getRoute(app, 'post', '/api/session/:sessionId/entry-participant/consume')({
    params: { sessionId: 'missing' },
    body: { token: 'token-1' },
  }, res)

  assert.equal(res.statusCode, 404)
  assert.deepEqual(res.jsonBody, { error: 'invalid session' })
})
