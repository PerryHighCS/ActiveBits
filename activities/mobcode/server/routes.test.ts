import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionRecord } from 'activebits-server/core/sessions.js'
import {
  acceptEntryParticipant,
  getSessionParticipantCookieName,
  issueAcceptedEntryParticipantToken,
} from 'activebits-server/core/acceptedEntryParticipants.js'
import {
  applyWsRelayMessageToGroupState,
  buildMobCodeManagerSnapshot,
  buildMobCodeStudentSnapshot,
  hasOpenManagerSessionClients,
  hasOpenSessionClients,
  normalizeMobCodeSessionData,
  resolveDurableStatePayload,
  resolveWsValidationGroupState,
  readDurableMessageType,
  readStatePayload,
  readWsInstructorPasscode,
  readWsRelayMessage,
} from './routes'
import setupMobCodeRoutes from './routes'

type RouteHandler = (
  req: { params: Record<string, string>; body?: unknown; headers?: { cookie?: string } },
  res: MockResponse,
) => Promise<void> | void

interface MockResponse {
  statusCode: number
  body: unknown
  headers: Record<string, string>
  cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>
  status(code: number): MockResponse
  set(name: string, value: string): MockResponse
  cookie(name: string, value: string, options: Record<string, unknown>): MockResponse
  json(payload: unknown): MockResponse
}

function createResponse(): MockResponse {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    cookies: [],
    status(code: number) {
      this.statusCode = code
      return this
    },
    set(name: string, value: string) {
      this.headers[name] = value
      return this
    },
    cookie(name: string, value: string, options: Record<string, unknown>) {
      this.cookies.push({ name, value, options })
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
  } = {
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

function createMockWs() {
  let handler: ((socket: unknown, query: URLSearchParams) => void) | null = null
  return {
    wss: {
      clients: new Set<{
        readyState: number
        sessionId?: string | null
        send(payload: string): void
      }>(),
    },
    register(_path: string, nextHandler: (socket: unknown, query: URLSearchParams) => void) {
      handler = nextHandler
    },
    getHandler() {
      return handler
    },
  }
}

function createMockSocket() {
  const listeners = new Map<string, Array<(payload?: unknown) => void>>()

  return {
    readyState: 1,
    sessionId: null as string | null,
    sent: [] as string[],
    on(event: string, listener: (payload?: unknown) => void) {
      const existing = listeners.get(event) ?? []
      existing.push(listener)
      listeners.set(event, existing)
    },
    send(payload: string) {
      this.sent.push(payload)
    },
    emit(event: string, payload?: unknown) {
      for (const listener of listeners.get(event) ?? []) {
        listener(payload)
      }
    },
  }
}

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function createMobCodeSessionRecord(overrides?: Partial<SessionRecord & { data: ReturnType<typeof normalizeMobCodeSessionData> }>) {
  return {
    id: 'mobcode-session',
    type: 'mobcode',
    created: Date.now(),
    data: normalizeMobCodeSessionData({
      instructorPasscode: 'secret-passcode',
      groups: {
        default: {
          files: { 'Main.java': 'class Main {}' },
          activeFile: 'Main.java',
        },
      },
    }),
    ...overrides,
  } as SessionRecord & { data: ReturnType<typeof normalizeMobCodeSessionData> }
}

void test('normalizeMobCodeSessionData creates default group when missing', () => {
  const data = normalizeMobCodeSessionData({})
  assert.deepEqual(data.groups.default, { files: {}, activeFile: '' })
  assert.equal(typeof data.instructorPasscode, 'string')
  assert.equal(data.instructorPasscode?.length, 32)
})

void test('normalizeMobCodeSessionData enables embedded Try it with an initial immutable starter snapshot', () => {
  const data = normalizeMobCodeSessionData({
    embeddedLaunch: { selectedOptions: { files: { 'main.py': 'print(1)' }, activeFile: 'main.py', startTryItMode: true } },
  })
  assert.equal(data.studentCode?.tryItEnabled, true)
  assert.deepEqual(data.studentCode?.starterVersion, data.groups.default)
  assert.notEqual(data.studentCode?.starterVersion, data.groups.default)
})

void test('normalizeMobCodeSessionData drops reserved participant keys and uses a prototype-free workspace map', () => {
  const workspaces = Object.create(null) as Record<string, unknown>
  workspaces.__proto__ = {
    participantId: '__proto__', displayName: 'Unsafe', files: { 'main.py': 'unsafe' }, activeFile: 'main.py', createdAt: 1, updatedAt: 1,
  }
  workspaces.ada = {
    participantId: 'ada', displayName: 'Ada', files: { 'main.py': 'safe' }, activeFile: 'main.py', createdAt: 1, updatedAt: 1,
  }
  const data = normalizeMobCodeSessionData({
    studentCode: { tryItEnabled: true, starterVersion: { files: {}, activeFile: '' }, studentWorkspaces: workspaces, sharedExample: null },
  })
  assert.equal(Object.getPrototypeOf(data.studentCode?.studentWorkspaces), null)
  assert.equal(Object.hasOwn(data.studentCode?.studentWorkspaces ?? {}, '__proto__'), false)
  assert.deepEqual(Object.keys(data.studentCode?.studentWorkspaces ?? {}), ['ada'])
})

void test('student snapshots never include another student workspace or identity', () => {
  const data = normalizeMobCodeSessionData({
    groups: { default: { files: { 'main.py': 'print("instructor")' }, activeFile: 'main.py' } },
    studentCode: {
      tryItEnabled: true,
      starterVersion: { files: { 'main.py': 'print("starter")' }, activeFile: 'main.py' },
      studentWorkspaces: {
        ada: { participantId: 'ada', displayName: 'Ada', files: { 'main.py': 'print("ada")' }, activeFile: 'main.py', createdAt: 1, updatedAt: 2 },
        grace: { participantId: 'grace', displayName: 'Grace', files: { 'secret.py': 'private' }, activeFile: 'secret.py', createdAt: 1, updatedAt: 3 },
      },
      sharedExample: null,
    },
  })
  const snapshot = buildMobCodeStudentSnapshot(data, 'ada')
  assert.match(JSON.stringify(snapshot), /Ada/)
  assert.doesNotMatch(JSON.stringify(snapshot), /Grace|secret\.py|private/)
})

void test('manager snapshots include named student workspaces for read-only review', () => {
  const data = normalizeMobCodeSessionData({
    studentCode: {
      tryItEnabled: true,
      starterVersion: { files: { 'main.py': 'print("starter")' }, activeFile: 'main.py' },
      studentWorkspaces: {
        ada: { participantId: 'ada', displayName: 'Ada', files: { 'main.py': 'print("ada")' }, activeFile: 'main.py', createdAt: 1, updatedAt: 2 },
      },
      sharedExample: null,
    },
  })

  const snapshot = buildMobCodeManagerSnapshot(data)
  assert.deepEqual(snapshot.studentCode, {
    tryItEnabled: true,
    shareChangesEnabled: false,
    starterVersionAvailable: true,
    starterVersion: { files: { 'main.py': 'print("starter")' }, activeFile: 'main.py' },
    students: [{
      participantId: 'ada',
      displayName: 'Ada',
      files: { 'main.py': 'print("ada")' },
      activeFile: 'main.py',
      createdAt: 1,
      updatedAt: 2,
    }],
    sharedExample: null,
  })
})

void test('participant-scoped MobCode routes reject unauthenticated, forged, locked, and non-manager requests', async () => {
  console.log('[TEST] Verifying expected MobCode authorization denials.')
  const app = createMockApp()
  const ws = createMockWs()
  const session = createMobCodeSessionRecord()
  acceptEntryParticipant(session, { participantId: 'ada', displayName: 'Ada' })
  const participantToken = issueAcceptedEntryParticipantToken(session, 'ada')
  assert.ok(participantToken)
  setupMobCodeRoutes(app as never, {
    async get() {
      return session
    },
    async set() {},
  }, ws as never)

  const workspaceHandler = app.handlers.post['/api/mobcode/:sessionId/student-workspace']
  const stateHandler = app.handlers.post['/api/mobcode/:sessionId/student-workspace/state']
  const resetHandler = app.handlers.post['/api/mobcode/:sessionId/student-workspace/reset']
  const actionHandler = app.handlers.post['/api/mobcode/:sessionId/student-code/:action']
  assert.ok(workspaceHandler && stateHandler && resetHandler && actionHandler)

  for (const headers of [undefined, { cookie: `${getSessionParticipantCookieName(session.id)}=forged` }]) {
    const response = createResponse()
    await workspaceHandler({ params: { sessionId: session.id }, body: {}, headers } as never, response)
    assert.equal(response.statusCode, 403)
  }

  const lockedResponse = createResponse()
  await stateHandler({
    params: { sessionId: session.id },
    body: { files: { 'Main.java': 'class Main {}' }, activeFile: 'Main.java' },
    headers: { cookie: `${getSessionParticipantCookieName(session.id)}=${participantToken}` },
  } as never, lockedResponse)
  assert.equal(lockedResponse.statusCode, 423)

  const lockedResetResponse = createResponse()
  await resetHandler({
    params: { sessionId: session.id },
    body: {},
    headers: { cookie: `${getSessionParticipantCookieName(session.id)}=${participantToken}` },
  } as never, lockedResetResponse)
  assert.equal(lockedResetResponse.statusCode, 423)

  const managerResponse = createResponse()
  await actionHandler({
    params: { sessionId: session.id, action: 'try-it' },
    body: { instructorPasscode: 'incorrect', enabled: true },
  } as never, managerResponse)
  assert.equal(managerResponse.statusCode, 403)
})

void test('POST /api/mobcode/create-solo creates a server-backed editable workspace from starter files', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  let savedSession: SessionRecord | null = null
  setupMobCodeRoutes(app as never, {
    async get() {
      return null
    },
    async set(_id: string, session: SessionRecord) {
      savedSession = session
    },
  }, ws as never)

  const handler = app.handlers.post['/api/mobcode/create-solo']
  assert.ok(handler)
  const response = createResponse()
  await handler({
    params: {},
    body: {
      files: { 'starter.py': 'print("ready")', '../ignored.py': 'nope' },
      activeFile: 'starter.py',
      runnerId: 'brython-terminal',
    },
  } as unknown as Parameters<typeof handler>[0], response as unknown as Parameters<typeof handler>[1])

  assert.equal(response.statusCode, 200)
  assert.equal(typeof (response.body as { id?: unknown }).id, 'string')
  assert.equal(typeof (response.body as { soloEditToken?: unknown }).soloEditToken, 'string')
  assert.equal(response.headers['Cache-Control'], 'no-store')
  assert.equal(response.cookies.length, 1)
  assert.equal(response.cookies[0]?.options.httpOnly, true)
  assert.equal(response.cookies[0]?.options.maxAge, 365 * 24 * 60 * 60 * 1000)
  if (savedSession === null) throw new Error('Expected solo session to be saved')
  const data = (savedSession as SessionRecord & { data: ReturnType<typeof normalizeMobCodeSessionData> }).data
  assert.equal(data.soloMode, true)
  assert.deepEqual(data.groups.default, { files: { 'starter.py': 'print("ready")' }, activeFile: 'starter.py' })
  assert.equal(data.soloEditToken, (response.body as { soloEditToken: string }).soloEditToken)
})

void test('GET /api/mobcode/:sessionId/session does not leak instructor passcode', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const session = createMobCodeSessionRecord()
  setupMobCodeRoutes(app as never, {
    async get(id: string) {
      return id === session.id ? session : null
    },
    async set() {},
  }, ws as never)

  const sessionHandler = app.handlers.get['/api/mobcode/:sessionId/session']
  assert.ok(sessionHandler)

  const response = createResponse()
  await sessionHandler({
    params: { sessionId: session.id },
  } as unknown as Parameters<typeof sessionHandler>[0], response as unknown as Parameters<typeof sessionHandler>[1])

  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['Cache-Control'], 'no-store')
  assert.deepEqual(response.body, {
    id: session.id,
    type: session.type,
    data: {
      groups: session.data.groups,
      runnerId: null,
      soloMode: false,
      canEditSolo: false,
    },
  })
  assert.equal(
    Object.hasOwn((response.body as { data: { groups: unknown; instructorPasscode?: unknown } }).data, 'instructorPasscode'),
    false,
  )
})

void test('GET /api/mobcode/:sessionId/session does not leak a solo edit token', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const session = createMobCodeSessionRecord({
    data: normalizeMobCodeSessionData({
      soloMode: true,
      soloEditToken: 'solo-edit-token',
      groups: { default: { files: { 'main.py': 'print(1)' }, activeFile: 'main.py' } },
    }),
  })
  setupMobCodeRoutes(app as never, {
    async get(id: string) { return id === session.id ? session : null },
    async set() {},
  }, ws as never)

  const handler = app.handlers.get['/api/mobcode/:sessionId/session']
  assert.ok(handler)
  const response = createResponse()
  await handler({ params: { sessionId: session.id } } as never, response as never)

  assert.equal(response.statusCode, 200)
  assert.equal(Object.hasOwn((response.body as { data: Record<string, unknown> }).data, 'soloEditToken'), false)
})

void test('GET /api/mobcode/:sessionId/session enables solo editing for the matching cookie', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const session = createMobCodeSessionRecord({
    data: normalizeMobCodeSessionData({
      soloMode: true,
      soloEditToken: 'solo-edit-token',
      groups: { default: { files: { 'main.py': 'print(1)' }, activeFile: 'main.py' } },
    }),
  })
  setupMobCodeRoutes(app as never, {
    async get(id: string) { return id === session.id ? session : null },
    async set() {},
  }, ws as never)

  const handler = app.handlers.get['/api/mobcode/:sessionId/session']
  assert.ok(handler)
  const response = createResponse()
  await handler({
    params: { sessionId: session.id },
    headers: { cookie: `mobcode_solo_edit_${session.id}=solo-edit-token` },
  } as never, response as never)

  assert.equal(response.statusCode, 200)
  assert.equal((response.body as { data: { canEditSolo: boolean } }).data.canEditSolo, true)
})

void test('GET /api/mobcode/:sessionId/session exposes sanitized embedded runner id', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const session = createMobCodeSessionRecord({
    data: normalizeMobCodeSessionData({
      instructorPasscode: 'secret-passcode',
      groups: {
        default: {
          files: { 'main.py': 'print("hello")' },
          activeFile: 'main.py',
        },
      },
      embeddedLaunch: {
        selectedOptions: {
          runnerId: 'brython-terminal',
        },
      },
    }),
  })
  setupMobCodeRoutes(app as never, {
    async get(id: string) {
      return id === session.id ? session : null
    },
    async set() {},
  }, ws as never)

  const sessionHandler = app.handlers.get['/api/mobcode/:sessionId/session']
  assert.ok(sessionHandler)

  const response = createResponse()
  await sessionHandler({
    params: { sessionId: session.id },
  } as unknown as Parameters<typeof sessionHandler>[0], response as unknown as Parameters<typeof sessionHandler>[1])

  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['Cache-Control'], 'no-store')
  assert.deepEqual(response.body, {
    id: session.id,
    type: session.type,
    data: {
      groups: session.data.groups,
      runnerId: 'brython-terminal',
      soloMode: false,
      canEditSolo: false,
    },
  })
})

void test('GET /api/mobcode/:sessionId/session drops invalid embedded runner id', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const session = createMobCodeSessionRecord({
    data: normalizeMobCodeSessionData({
      instructorPasscode: 'secret-passcode',
      groups: {
        default: {
          files: { 'Main.java': 'class Main {}' },
          activeFile: 'Main.java',
        },
      },
      embeddedLaunch: {
        selectedOptions: {
          runnerId: 'cheerpj',
        },
      },
    }),
  })
  setupMobCodeRoutes(app as never, {
    async get(id: string) {
      return id === session.id ? session : null
    },
    async set() {},
  }, ws as never)

  const sessionHandler = app.handlers.get['/api/mobcode/:sessionId/session']
  assert.ok(sessionHandler)

  const response = createResponse()
  await sessionHandler({
    params: { sessionId: session.id },
  } as unknown as Parameters<typeof sessionHandler>[0], response as unknown as Parameters<typeof sessionHandler>[1])

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.body, {
    id: session.id,
    type: session.type,
    data: {
      groups: session.data.groups,
      runnerId: null,
      soloMode: false,
      canEditSolo: false,
    },
  })
})

void test('POST /api/mobcode/:sessionId/state returns 403 for a bad instructor passcode', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const session = createMobCodeSessionRecord()
  let setCalls = 0
  setupMobCodeRoutes(app as never, {
    async get(id: string) {
      return id === session.id ? session : null
    },
    async set() {
      setCalls += 1
    },
  }, ws as never)

  const stateHandler = app.handlers.post['/api/mobcode/:sessionId/state']
  assert.ok(stateHandler)

  const response = createResponse()
  await stateHandler({
    params: { sessionId: session.id },
    body: {
      instructorPasscode: 'wrong-passcode',
      files: { 'Main.java': 'updated' },
      activeFile: 'Main.java',
    },
  } as unknown as Parameters<typeof stateHandler>[0], response as unknown as Parameters<typeof stateHandler>[1])

  assert.equal(response.statusCode, 403)
  assert.deepEqual(response.body, { error: 'Forbidden' })
  assert.equal(setCalls, 0)
})

void test('POST /api/mobcode/:sessionId/state accepts the scoped solo edit token', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const session = createMobCodeSessionRecord({
    data: normalizeMobCodeSessionData({
      soloMode: true,
      soloEditToken: 'solo-edit-token',
      groups: { default: { files: { 'main.py': 'print(1)' }, activeFile: 'main.py' } },
    }),
  })
  let saved: SessionRecord | null = null
  setupMobCodeRoutes(app as never, {
    async get(id: string) { return id === session.id ? session : null },
    async set(_id: string, nextSession: SessionRecord) { saved = nextSession },
  }, ws as never)

  const handler = app.handlers.post['/api/mobcode/:sessionId/state']
  assert.ok(handler)
  const response = createResponse()
  await handler({
    params: { sessionId: session.id },
    body: {
      soloEditToken: 'solo-edit-token',
      files: { 'main.py': 'print(2)' },
      activeFile: 'main.py',
    },
  } as unknown as Parameters<typeof handler>[0], response as unknown as Parameters<typeof handler>[1])

  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['Cache-Control'], 'no-store')
  if (saved === null) throw new Error('Expected solo state to be saved')
  const savedGroup = (saved as SessionRecord & { data: ReturnType<typeof normalizeMobCodeSessionData> }).data.groups.default
  if (!savedGroup) throw new Error('Expected saved default group')
  assert.equal(savedGroup.files['main.py'] ?? '', 'print(2)')
})

void test('POST /api/mobcode/:sessionId/state accepts the matching solo edit cookie', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const session = createMobCodeSessionRecord({
    data: normalizeMobCodeSessionData({
      soloMode: true,
      soloEditToken: 'solo-edit-token',
      groups: { default: { files: { 'main.py': 'print(1)' }, activeFile: 'main.py' } },
    }),
  })
  let saved: SessionRecord | null = null
  setupMobCodeRoutes(app as never, {
    async get(id: string) { return id === session.id ? session : null },
    async set(_id: string, nextSession: SessionRecord) { saved = nextSession },
  }, ws as never)

  const handler = app.handlers.post['/api/mobcode/:sessionId/state']
  assert.ok(handler)
  const response = createResponse()
  await handler({
    params: { sessionId: session.id },
    headers: { cookie: `mobcode_solo_edit_${session.id}=solo-edit-token` },
    body: {
      files: { 'main.py': 'print(2)' },
      activeFile: 'main.py',
    },
  } as never, response as never)

  assert.equal(response.statusCode, 200)
  if (saved === null) throw new Error('Expected solo state to be saved')
  const savedGroup = (saved as SessionRecord & { data: ReturnType<typeof normalizeMobCodeSessionData> }).data.groups.default
  if (!savedGroup) throw new Error('Expected saved default group')
  assert.equal(savedGroup.files['main.py'] ?? '', 'print(2)')
})

void test('POST /api/mobcode/:sessionId/state returns 400 for an invalid payload', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const session = createMobCodeSessionRecord()
  let setCalls = 0
  setupMobCodeRoutes(app as never, {
    async get(id: string) {
      return id === session.id ? session : null
    },
    async set() {
      setCalls += 1
    },
  }, ws as never)

  const stateHandler = app.handlers.post['/api/mobcode/:sessionId/state']
  assert.ok(stateHandler)

  const response = createResponse()
  await stateHandler({
    params: { sessionId: session.id },
    body: {
      instructorPasscode: 'secret-passcode',
      activeFile: 'Main.java',
    },
  } as unknown as Parameters<typeof stateHandler>[0], response as unknown as Parameters<typeof stateHandler>[1])

  assert.equal(response.statusCode, 400)
  assert.deepEqual(response.body, { error: 'Invalid state payload' })
  assert.equal(setCalls, 0)
})

void test('POST /api/mobcode/:sessionId/shared-workspace/state updates only the editable shared copy', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const session = createMobCodeSessionRecord({
    data: normalizeMobCodeSessionData({
      instructorPasscode: 'secret-passcode',
      groups: { default: { files: { 'instructor.py': 'print("instructor")' }, activeFile: 'instructor.py' } },
      studentCode: {
        sharedExample: {
          sourceParticipantId: 'ada',
          workspace: { files: { 'student.py': 'print("student")' }, activeFile: 'student.py' },
          sharedAt: 1,
        },
      },
    }),
  })
  let saved: SessionRecord | null = null
  setupMobCodeRoutes(app as never, {
    async get(id: string) { return id === session.id ? session : null },
    async set(_id: string, nextSession: SessionRecord) { saved = nextSession },
  }, ws as never)

  const handler = app.handlers.post['/api/mobcode/:sessionId/shared-workspace/state']
  assert.ok(handler)
  const response = createResponse()
  await handler({
    params: { sessionId: session.id },
    body: {
      instructorPasscode: 'secret-passcode',
      files: { 'shared.py': 'print("shared")' },
      activeFile: 'shared.py',
    },
  } as never, response as never)

  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['Cache-Control'], 'no-store')
  assert.deepEqual(response.body, {
    ok: true,
    workspace: { files: { 'shared.py': 'print("shared")' }, activeFile: 'shared.py' },
  })
  if (saved === null) throw new Error('Expected shared workspace to be saved')
  const savedData = (saved as SessionRecord & { data: ReturnType<typeof normalizeMobCodeSessionData> }).data
  assert.deepEqual(savedData.groups.default, { files: { 'instructor.py': 'print("instructor")' }, activeFile: 'instructor.py' })
  assert.deepEqual(savedData.studentCode?.sharedExample?.workspace, { files: { 'shared.py': 'print("shared")' }, activeFile: 'shared.py' })
})

void test('normalizeMobCodeSessionData preserves valid files and active file', () => {
  const data = normalizeMobCodeSessionData({
    instructorPasscode: 'secret',
    groups: {
      default: {
        files: { 'Main.java': 'class Main {}' },
        activeFile: 'Main.java',
      },
    },
  })
  assert.deepEqual(data.groups.default, {
    files: { 'Main.java': 'class Main {}' },
    activeFile: 'Main.java',
  })
  assert.equal(data.instructorPasscode, 'secret')
})

void test('normalizeMobCodeSessionData drops invalid file records and repairs active file', () => {
  const data = normalizeMobCodeSessionData({
    instructorPasscode: 42,
    groups: {
      default: {
        files: { '../bad': 'x', '__proto__/polluted.java': 'x', 'src/Main.java': 'ok', binary: 7 },
        activeFile: '../bad',
      },
    },
  })
  assert.deepEqual(data.groups.default, {
    files: { 'src/Main.java': 'ok' },
    activeFile: 'src/Main.java',
  })
  assert.equal(typeof data.instructorPasscode, 'string')
  assert.equal(data.instructorPasscode?.length, 32)
})

void test('normalizeMobCodeSessionData seeds starter files from embedded launch options when groups are missing', () => {
  const data = normalizeMobCodeSessionData({
    embeddedLaunch: {
      selectedOptions: {
        files: {
          'src/Main.java': 'class Main {}',
          '../bad': 'ignored',
        },
        activeFile: 'src/Main.java',
      },
    },
  })

  assert.deepEqual(data.groups.default, {
    files: { 'src/Main.java': 'class Main {}' },
    activeFile: 'src/Main.java',
  })
})

void test('normalizeMobCodeSessionData normalizes activeFile before matching starter files', () => {
  const data = normalizeMobCodeSessionData({
    embeddedLaunch: {
      selectedOptions: {
        files: {
          'src/Main.java': 'class Main {}',
          'src/Helper.java': 'class Helper {}',
        },
        activeFile: ' /src\\Main.java ',
      },
    },
  })

  assert.deepEqual(data.groups.default, {
    files: {
      'src/Main.java': 'class Main {}',
      'src/Helper.java': 'class Helper {}',
    },
    activeFile: 'src/Main.java',
  })
})

void test('normalizeMobCodeSessionData does not rehydrate embedded starter files when an explicit group already exists', () => {
  const data = normalizeMobCodeSessionData({
    groups: {
      default: {
        files: {},
        activeFile: '',
      },
    },
    embeddedLaunch: {
      selectedOptions: {
        files: {
          'src/Main.java': 'class Main {}',
        },
        activeFile: 'src/Main.java',
      },
    },
  })

  assert.deepEqual(data.groups.default, {
    files: {},
    activeFile: '',
  })
})

void test('readStatePayload rejects malformed requests instead of clearing state', () => {
  assert.equal(readStatePayload(null), null)
  assert.equal(readStatePayload({ activeFile: 'Main.java' }), null)
  assert.equal(readStatePayload({ files: {}, activeFile: 3 }), null)
  assert.deepEqual(readStatePayload({ files: { '../bad': 'x', 'Main.java': 'ok' }, activeFile: '../bad' }), {
    files: { 'Main.java': 'ok' },
    activeFile: 'Main.java',
  })
})

void test('readDurableMessageType only accepts supported persisted broadcast types', () => {
  assert.equal(readDurableMessageType('state-sync'), 'state-sync')
  assert.equal(readDurableMessageType('file-tree-changed'), 'file-tree-changed')
  assert.equal(readDurableMessageType('active-file-changed'), 'state-sync')
  assert.equal(readDurableMessageType({}), 'state-sync')
})

void test('readWsRelayMessage validates websocket mutation payloads against session files', () => {
  const files = { 'src/Main.java': 'class Main {}' }

  assert.deepEqual(
    readWsRelayMessage({ type: 'file-content-update', payload: { path: 'src/Main.java', content: 'updated' } }, files),
    { type: 'file-content-update', payload: { path: 'src/Main.java', content: 'updated' } },
  )
  assert.deepEqual(
    readWsRelayMessage({ type: 'active-file-changed', payload: { activeFile: 'src/Main.java' } }, files),
    { type: 'active-file-changed', payload: { activeFile: 'src/Main.java' } },
  )
  assert.deepEqual(
    readWsRelayMessage(
      {
        type: 'editor-presence-update',
        payload: { path: 'src/Main.java', selections: [{ anchor: 2, head: 5 }] },
      },
      files,
    ),
    { type: 'editor-presence-update', payload: { path: 'src/Main.java', selections: [{ anchor: 2, head: 5 }] } },
  )
  assert.equal(
    readWsRelayMessage({ type: 'file-content-update', payload: { path: '../bad', content: 'x' } }, files),
    null,
  )
  assert.equal(
    readWsRelayMessage({ type: 'file-content-update', payload: { path: 'missing.java', content: 'x' } }, files),
    null,
  )
  assert.equal(
    readWsRelayMessage({ type: 'active-file-changed', payload: { activeFile: 'missing.java' } }, files),
    null,
  )
  assert.equal(
    readWsRelayMessage(
      {
        type: 'editor-presence-update',
        payload: { path: 'src/Main.java', selections: [{ anchor: -1, head: 2 }] },
      },
      files,
    ),
    null,
  )
  assert.equal(
    readWsRelayMessage(
      {
        type: 'editor-presence-update',
        payload: { path: 'src/Main.java', selections: [{ anchor: 100, head: 100 }] },
      },
      files,
    ),
    null,
  )
})

void test('readWsRelayMessage rejects content updates that would exceed total workspace bytes', () => {
  const files = {
    'src/File0.txt': '😀'.repeat(300_000),
    'src/File1.txt': '😀'.repeat(300_000),
    'src/File2.txt': '😀'.repeat(300_000),
    'src/File3.txt': '😀'.repeat(300_000),
  }

  assert.equal(
    readWsRelayMessage(
      {
        type: 'file-content-update',
        payload: { path: 'src/File0.txt', content: '😀'.repeat(400_000) },
      },
      files,
    ),
    null,
  )
})

void test('applyWsRelayMessageToGroupState advances in-memory files for cumulative ws validation', () => {
  const initialGroup = {
    files: {
      'src/File0.txt': 'x'.repeat(1_000_000),
      'src/File1.txt': 'x'.repeat(1_000_000),
      'src/File2.txt': 'x'.repeat(1_000_000),
      'src/File3.txt': 'x'.repeat(700_000),
      'src/File4.txt': 'x'.repeat(400_000),
    },
    activeFile: 'src/File0.txt',
  }

  const acceptedUpdate = readWsRelayMessage(
    {
      type: 'file-content-update',
      payload: { path: 'src/File4.txt', content: 'x'.repeat(450_000) },
    },
    initialGroup.files,
  )
  assert.notEqual(acceptedUpdate, null)

  const updatedGroup = applyWsRelayMessageToGroupState(initialGroup, acceptedUpdate!)
  assert.equal(
    readWsRelayMessage(
      {
        type: 'file-content-update',
        payload: { path: 'src/File3.txt', content: 'x'.repeat(750_000) },
      },
      updatedGroup.files,
    ),
    null,
  )
})

void test('resolveWsValidationGroupState prefers live ws state over persisted session data', () => {
  const persistedGroup = {
    files: { 'src/Main.java': 'persisted' },
    activeFile: 'src/Main.java',
  }
  const liveGroup = {
    files: { 'src/Main.java': 'live' },
    activeFile: 'src/Main.java',
  }

  assert.deepEqual(resolveWsValidationGroupState(persistedGroup, liveGroup), liveGroup)
  assert.deepEqual(resolveWsValidationGroupState(persistedGroup, undefined), persistedGroup)
  assert.deepEqual(resolveWsValidationGroupState(undefined, undefined), { files: {}, activeFile: '' })
})

void test('resolveDurableStatePayload merges requested tree changes with live edits while a manager is active', () => {
  const requestedPayload = {
    files: {
      'src/Main.java': 'stale persisted snapshot',
      'src/New.java': 'new file from tree change',
    },
    activeFile: 'src/New.java',
  }
  const liveGroup = {
    files: {
      'src/Main.java': 'newer live edit',
      'src/Deleted.java': 'deleted live file should not return',
    },
    activeFile: 'src/Main.java',
  }

  const mergedPayload = {
    files: {
      'src/Main.java': 'newer live edit',
      'src/New.java': 'new file from tree change',
    },
    activeFile: 'src/Main.java',
  }

  assert.deepEqual(resolveDurableStatePayload('state-sync', requestedPayload, liveGroup, true), mergedPayload)
  assert.deepEqual(resolveDurableStatePayload('state-sync', requestedPayload, liveGroup, false), requestedPayload)
  assert.deepEqual(resolveDurableStatePayload('state-sync', requestedPayload, undefined, true), requestedPayload)
  assert.deepEqual(resolveDurableStatePayload('file-tree-changed', requestedPayload, liveGroup, true), mergedPayload)
  assert.deepEqual(
    resolveDurableStatePayload('file-tree-changed', {
      files: { 'src/New.java': 'new file from tree change' },
      activeFile: 'src/New.java',
    }, liveGroup, true),
    {
      files: { 'src/New.java': 'new file from tree change' },
      activeFile: 'src/New.java',
    },
  )
  assert.deepEqual(resolveDurableStatePayload('file-tree-changed', requestedPayload, liveGroup, false), requestedPayload)
})

void test('websocket relay updates live validation state without mutating session data in place', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const session = createMobCodeSessionRecord({
    data: normalizeMobCodeSessionData({
      instructorPasscode: 'secret-passcode',
      groups: {
        default: {
          files: { 'Main.java': 'class Main {}' },
          activeFile: 'Main.java',
        },
      },
      studentCode: {
        tryItEnabled: true,
        shareChangesEnabled: true,
        starterVersion: {
          files: { 'Main.java': 'class Main {}' },
          activeFile: 'Main.java',
        },
      },
    }),
  })
  acceptEntryParticipant(session, { participantId: 'ada', displayName: 'Ada' })
  const participantToken = issueAcceptedEntryParticipantToken(session, 'ada')
  assert.ok(participantToken)

  setupMobCodeRoutes(app as never, {
    async get(id: string) {
      return id === session.id ? session : null
    },
    async set() {},
  }, ws as never)

  const managerSocket = createMockSocket()
  const studentSocket = createMockSocket()
  const forgedManagerSocket = createMockSocket()
  ws.wss.clients.add(managerSocket)
  ws.wss.clients.add(studentSocket)
  ws.wss.clients.add(forgedManagerSocket)

  const wsHandler = ws.getHandler()
  assert.ok(wsHandler)
  wsHandler(managerSocket, new URLSearchParams({ sessionId: session.id, role: 'manager' }))
  wsHandler(studentSocket, new URLSearchParams({ sessionId: session.id, role: 'student' }))
  wsHandler(forgedManagerSocket, new URLSearchParams({ sessionId: session.id, role: 'manager' }))

  managerSocket.emit('message', JSON.stringify({
    type: 'manager-auth',
    payload: { instructorPasscode: 'secret-passcode' },
  }))
  await flushAsyncWork()
  managerSocket.emit('message', JSON.stringify({
    type: 'file-content-update',
    payload: { path: 'Main.java', content: 'class Main { int x = 1; }' },
  }))
  await flushAsyncWork()

  const defaultGroup = session.data.groups.default
  assert.ok(defaultGroup)
  assert.equal(defaultGroup.files['Main.java'], 'class Main {}')
  assert.equal(studentSocket.sent.length, 1)
  const outgoing = JSON.parse(studentSocket.sent[0] ?? '{}') as { type: string; payload: { path: string; content: string } }
  assert.equal(outgoing.type, 'file-content-update')
  assert.deepEqual(outgoing.payload, {
    path: 'Main.java',
    content: 'class Main { int x = 1; }',
  })

  const studentStateHandler = app.handlers.post['/api/mobcode/:sessionId/student-workspace/state']
  assert.ok(studentStateHandler)
  managerSocket.sent.length = 0
  forgedManagerSocket.sent.length = 0
  const studentStateResponse = createResponse()
  await studentStateHandler({
    params: { sessionId: session.id },
    body: { files: { 'Main.java': 'class Main { int student = 1; }' }, activeFile: 'Main.java' },
    headers: { cookie: `${getSessionParticipantCookieName(session.id)}=${participantToken}` },
  } as never, studentStateResponse)
  assert.equal(studentStateResponse.statusCode, 200)
  assert.equal(managerSocket.sent.length, 1)
  assert.equal(JSON.parse(managerSocket.sent[0] ?? '{}').type, 'student-code-updated')
  assert.equal(forgedManagerSocket.sent.length, 0)

  session.data.studentCode!.shareChangesEnabled = false
  forgedManagerSocket.sent.length = 0
  managerSocket.emit('message', JSON.stringify({
    type: 'file-content-update',
    payload: { path: 'Main.java', content: 'class Main { int x = 2; }' },
  }))
  await flushAsyncWork()
  assert.equal(studentSocket.sent.length, 1)
  assert.equal(forgedManagerSocket.sent.length, 0)
})

void test('hasOpenSessionClients only retains live ws state when a session still has open sockets', () => {
  assert.equal(
    hasOpenSessionClients([
      { readyState: 1, sessionId: 'session-a' },
      { readyState: 3, sessionId: 'session-b' },
    ], 'session-a'),
    true,
  )
  assert.equal(
    hasOpenSessionClients([
      { readyState: 3, sessionId: 'session-a' },
      { readyState: 1, sessionId: 'session-b' },
    ], 'session-a'),
    false,
  )
})

void test('hasOpenManagerSessionClients requires an authenticated open manager socket for the session', () => {
  assert.equal(
    hasOpenManagerSessionClients([
      { readyState: 1, sessionId: 'session-a', mobCodeRole: 'student', instructorPasscode: 'secret' },
      { readyState: 1, sessionId: 'session-b', mobCodeRole: 'manager', instructorPasscode: 'secret' },
    ], 'session-a', 'secret'),
    false,
  )
  assert.equal(
    hasOpenManagerSessionClients([
      { readyState: 1, sessionId: 'session-a', mobCodeRole: 'manager', instructorPasscode: 'wrong' },
    ], 'session-a', 'secret'),
    false,
  )
  assert.equal(
    hasOpenManagerSessionClients([
      {
        readyState: 1,
        sessionId: 'session-a',
        mobCodeRole: 'manager',
        isAuthenticatedManager: true,
        instructorPasscode: 'secret',
      },
    ], 'session-a', 'secret'),
    true,
  )
})

void test('readWsInstructorPasscode accepts only explicit manager auth payloads', () => {
  assert.equal(
    readWsInstructorPasscode({ type: 'manager-auth', payload: { instructorPasscode: 'secret' } }),
    'secret',
  )
  assert.equal(
    readWsInstructorPasscode({ type: 'manager-auth', payload: { instructorPasscode: '' } }),
    null,
  )
  assert.equal(
    readWsInstructorPasscode({ type: 'file-content-update', payload: { instructorPasscode: 'secret' } }),
    null,
  )
  assert.equal(
    readWsInstructorPasscode({ type: 'manager-auth', payload: { instructorPasscode: 'x'.repeat(513) } }),
    null,
  )
})

void test('normalizeMobCodeSessionData verification path rejects oversized passcodes before buffer comparison', () => {
  const data = normalizeMobCodeSessionData({
    instructorPasscode: 'x'.repeat(513),
    groups: { default: { files: {}, activeFile: '' } },
  })
  assert.equal(typeof data.instructorPasscode, 'string')
  assert.equal(data.instructorPasscode?.length, 32)
  assert.notEqual(data.instructorPasscode, 'x'.repeat(513))
})

void test('normalizeMobCodeSessionData enforces UTF-8 byte limits for file content and total size', () => {
  const oversizedSingle = normalizeMobCodeSessionData({
    groups: {
      default: {
        files: {
          'Emoji.txt': '😀'.repeat(300_000),
        },
        activeFile: 'Emoji.txt',
      },
    },
  })
  const singleGroup = oversizedSingle.groups.default!
  assert.equal(Buffer.byteLength(singleGroup.files['Emoji.txt'] ?? '', 'utf8') <= 1_000_000, true)

  const oversizedTotal = normalizeMobCodeSessionData({
    groups: {
      default: {
        files: Object.fromEntries(
          Array.from({ length: 5 }, (_, index) => [`src/File${index}.txt`, '😀'.repeat(300_000)]),
        ),
        activeFile: 'src/File0.txt',
      },
    },
  })
  const totalGroup = oversizedTotal.groups.default!
  assert.deepEqual(Object.keys(totalGroup.files), [
    'src/File0.txt',
    'src/File1.txt',
    'src/File2.txt',
    'src/File3.txt',
  ])
})

void test('normalizeMobCodeSessionData drops file entries that collide with implied folder paths', () => {
  const data = normalizeMobCodeSessionData({
    groups: {
      default: {
        files: {
          src: 'hidden',
          'src/Main.java': 'class Main {}',
          'src/utils/math.ts': 'export const math = 1',
        },
        activeFile: 'src',
      },
    },
  })

  assert.deepEqual(data.groups.default, {
    files: {
      'src/Main.java': 'class Main {}',
      'src/utils/math.ts': 'export const math = 1',
    },
    activeFile: 'src/Main.java',
  })
})
