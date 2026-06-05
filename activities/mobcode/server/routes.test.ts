import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionRecord } from 'activebits-server/core/sessions.js'
import {
  applyWsRelayMessageToGroupState,
  hasOpenSessionClients,
  normalizeMobCodeSessionData,
  resolveWsValidationGroupState,
  readDurableMessageType,
  readStatePayload,
  readWsInstructorPasscode,
  readWsRelayMessage,
} from './routes'
import setupMobCodeRoutes from './routes'

type RouteHandler = (
  req: { params: Record<string, string>; body?: unknown },
  res: MockResponse,
) => Promise<void> | void

interface MockResponse {
  statusCode: number
  body: unknown
  status(code: number): MockResponse
  json(payload: unknown): MockResponse
}

function createResponse(): MockResponse {
  return {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code
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
  return {
    wss: {
      clients: new Set<{
        readyState: number
        sessionId?: string | null
        send(payload: string): void
      }>(),
    },
    register(_path: string, _handler: (socket: unknown, query: URLSearchParams) => void) {},
  }
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
  assert.deepEqual(response.body, {
    id: session.id,
    type: session.type,
    data: {
      groups: session.data.groups,
    },
  })
  assert.equal(
    Object.hasOwn((response.body as { data: { groups: unknown; instructorPasscode?: unknown } }).data, 'instructorPasscode'),
    false,
  )
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
        files: { '../bad': 'x', 'src/Main.java': 'ok', binary: 7 },
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
