import test from 'node:test'
import assert from 'node:assert/strict'
import { setupPersistentSessionWs } from './core/persistentSessionWs.js'
import type { SessionRecord } from './core/sessions.js'
import {
  cleanupPersistentSession,
  generatePersistentHash,
  getPersistentSession,
  getOrCreateActivePersistentSession,
  initializePersistentStorage,
  isSessionStarted,
  rollbackPersistentSessionStart,
  startPersistentSession,
  updatePersistentSessionUrlState,
} from './core/persistentSessions.js'
import { initializeActivityRegistry } from './activities/activityRegistry.js'

interface MockSocket {
  id?: string
  clientIp?: string
  persistentHash?: string
  readyState: number
  sent: string[]
  closed: Array<{ code?: number; reason?: string }>
  handlers: {
    message?: (payload?: unknown) => void
    close?: () => void
  }
  send(payload: string): void
  close(code?: number, reason?: string): void
  on(event: 'message' | 'close', handler: (payload?: unknown) => void): void
}

function createMockSocket(): MockSocket {
  return {
    id: 'teacher-socket',
    clientIp: '127.0.0.1',
    readyState: 1,
    sent: [],
    closed: [],
    handlers: {},
    send(payload: string) {
      this.sent.push(payload)
    },
    close(code?: number, reason?: string) {
      this.closed.push({ code, reason })
    },
    on(event, handler) {
      this.handlers[event] = handler
    },
  }
}

function waitForAsyncWork(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function createFakeValkeyClient(): {
  store: Map<string, string>
  on: () => void
  subscribe: () => Promise<number>
  publish: () => Promise<number>
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string) => Promise<string>
  del: (key: string) => Promise<number>
  eval: (script?: string, numKeys?: number, ...args: Array<string | number>) => Promise<number>
  scan: (cursor: string, ...args: Array<string | number>) => Promise<[string, string[]]>
  quit: () => Promise<string>
} {
  const store = new Map<string, string>()
  return {
    store,
    on() {},
    subscribe: async () => 1,
    publish: async () => 0,
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => { store.set(key, value); return 'OK' },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
    eval: async (script?: string, _numKeys?: number, ...args: Array<string | number>) => {
      // Interpret the persistent-session compare-and-clear script against the
      // in-memory store so rollback-scoping tests exercise the real semantics.
      if (typeof script === 'string' && script.includes('persistent-session-compare-and-clear')) {
        const [recordKey, indexKey, expectedSessionId, ttl] = args as [string, string, string, string | number]
        void ttl
        store.delete(indexKey)
        const raw = store.get(recordKey)
        if (raw == null) return 0
        const record = JSON.parse(raw) as { sessionId?: string | null; teacherSocketId?: string | null }
        if (record.sessionId !== expectedSessionId) return 0
        record.sessionId = null
        record.teacherSocketId = null
        store.set(recordKey, JSON.stringify(record))
        return 1
      }
      return 1
    },
    scan: async (_cursor: string, ...args: Array<string | number>) => {
      const matchIndex = args.findIndex((arg) => arg === 'MATCH')
      const pattern = matchIndex >= 0 ? String(args[matchIndex + 1] ?? '*') : '*'
      const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern
      return ['0', Array.from(store.keys()).filter((key) => key.startsWith(prefix))]
    },
    quit: async () => 'OK',
  }
}

void test('persistent session websocket bootstraps started sessions with canonical selected options', async (t) => {
  initializePersistentStorage(null)

  const sessionStore = new Map<string, SessionRecord>()
  const sessions = {
    async get(id: string) {
      return sessionStore.get(id) ?? null
    },
    async set(id: string, value: SessionRecord) {
      sessionStore.set(id, value)
    },
  }

  let registeredHandler: ((socket: MockSocket, query: URLSearchParams, _wss: unknown) => void) | undefined
  setupPersistentSessionWs({
    register(pathname, handler) {
      if (pathname === '/ws/persistent-session') {
        registeredHandler = handler as (socket: MockSocket, query: URLSearchParams, _wss: unknown) => void
      }
    },
  }, sessions)

  assert.ok(registeredHandler)

  const activityName = 'algorithm-demo'
  const teacherCode = 'persistent-bootstrap-code'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await updatePersistentSessionUrlState(hash, {
    selectedOptions: {
      algorithm: 'merge-sort',
    },
  })

  const socket = createMockSocket()
  registeredHandler(socket, new URLSearchParams({ hash, activityName }), null)
  await waitForAsyncWork()

  socket.handlers.message?.(JSON.stringify({
    type: 'verify-teacher-code',
    teacherCode,
  }))
  await waitForAsyncWork()

  assert.equal(sessionStore.size, 1)
  const startedSession = Array.from(sessionStore.values())[0]
  assert.ok(startedSession)
  assert.deepEqual(startedSession.data, {
    embeddedLaunch: {
      selectedOptions: {
        algorithm: 'merge-sort',
      },
    },
  })

  const teacherAuthenticated = socket.sent
    .map((payload) => JSON.parse(payload) as { type?: string })
    .some((payload) => payload.type === 'teacher-authenticated')
  assert.equal(teacherAuthenticated, true)
})

void test('persistent session websocket hydrates syncdeck presentationUrl onto live session data', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()

  const sessionStore = new Map<string, SessionRecord>()
  const sessions = {
    async get(id: string) {
      return sessionStore.get(id) ?? null
    },
    async set(id: string, value: SessionRecord) {
      sessionStore.set(id, value)
    },
  }

  let registeredHandler: ((socket: MockSocket, query: URLSearchParams, _wss: unknown) => void) | undefined
  setupPersistentSessionWs({
    register(pathname, handler) {
      if (pathname === '/ws/persistent-session') {
        registeredHandler = handler as (socket: MockSocket, query: URLSearchParams, _wss: unknown) => void
      }
    },
  }, sessions)

  assert.ok(registeredHandler)

  const activityName = 'syncdeck'
  const teacherCode = 'syncdeck-persistent-code'
  const presentationUrl = 'https://slides.example/deck'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await updatePersistentSessionUrlState(hash, {
    selectedOptions: {
      presentationUrl,
    },
  })

  const socket = createMockSocket()
  registeredHandler(socket, new URLSearchParams({ hash, activityName }), null)
  await waitForAsyncWork()

  socket.handlers.message?.(JSON.stringify({
    type: 'verify-teacher-code',
    teacherCode,
  }))
  await waitForAsyncWork()

  assert.equal(sessionStore.size, 1)
  const startedSession = Array.from(sessionStore.values())[0]
  assert.ok(startedSession)
  assert.deepEqual(startedSession.data, {
    presentationUrl,
    embeddedLaunch: {
      selectedOptions: {
        presentationUrl,
      },
    },
  })
})

void test('persistent session websocket decodes syncdeck presentationUrl before hydrating live session data', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()

  const sessionStore = new Map<string, SessionRecord>()
  const sessions = {
    async get(id: string) {
      return sessionStore.get(id) ?? null
    },
    async set(id: string, value: SessionRecord) {
      sessionStore.set(id, value)
    },
  }

  let registeredHandler: ((socket: MockSocket, query: URLSearchParams, _wss: unknown) => void) | undefined
  setupPersistentSessionWs({
    register(pathname, handler) {
      if (pathname === '/ws/persistent-session') {
        registeredHandler = handler as (socket: MockSocket, query: URLSearchParams, _wss: unknown) => void
      }
    },
  }, sessions)

  assert.ok(registeredHandler)

  const activityName = 'syncdeck'
  const teacherCode = 'encoded-syncdeck-persistent-code'
  const presentationUrl = 'https://perryhighcs.github.io/Presentations/CSP/Algorithms/algorithms-solve-problems.html'
  const encodedPresentationUrl = encodeURIComponent(presentationUrl)
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await updatePersistentSessionUrlState(hash, {
    selectedOptions: {
      presentationUrl: encodedPresentationUrl,
    },
  })

  const socket = createMockSocket()
  registeredHandler(socket, new URLSearchParams({ hash, activityName }), null)
  await waitForAsyncWork()

  socket.handlers.message?.(JSON.stringify({
    type: 'verify-teacher-code',
    teacherCode,
  }))
  await waitForAsyncWork()

  assert.equal(sessionStore.size, 1)
  const startedSession = Array.from(sessionStore.values())[0]
  assert.ok(startedSession)
  assert.deepEqual(startedSession.data, {
    presentationUrl,
    embeddedLaunch: {
      selectedOptions: {
        presentationUrl: encodedPresentationUrl,
      },
    },
  })
})

void test('persistent session websocket sends configured create-session bootstrap payload to teacher client', async (t) => {
  initializePersistentStorage(null)
  await initializeActivityRegistry()

  const sessionStore = new Map<string, SessionRecord>()
  const sessions = {
    async get(id: string) {
      return sessionStore.get(id) ?? null
    },
    async set(id: string, value: SessionRecord) {
      if (value.type === 'syncdeck') {
        value.data.instructorPasscode = 'teacher-passcode-from-normalizer'
      }
      sessionStore.set(id, value)
    },
  }

  let registeredHandler: ((socket: MockSocket, query: URLSearchParams, _wss: unknown) => void) | undefined
  setupPersistentSessionWs({
    register(pathname, handler) {
      if (pathname === '/ws/persistent-session') {
        registeredHandler = handler as (socket: MockSocket, query: URLSearchParams, _wss: unknown) => void
      }
    },
  }, sessions)

  assert.ok(registeredHandler)

  const activityName = 'syncdeck'
  const teacherCode = 'syncdeck-bootstrap-payload-code'
  const presentationUrl = 'https://slides.example/deck'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await updatePersistentSessionUrlState(hash, {
    selectedOptions: {
      presentationUrl,
    },
  })

  const socket = createMockSocket()
  registeredHandler(socket, new URLSearchParams({ hash, activityName }), null)
  await waitForAsyncWork()

  socket.handlers.message?.(JSON.stringify({
    type: 'verify-teacher-code',
    teacherCode,
  }))
  await waitForAsyncWork()

  const teacherAuthenticated = socket.sent
    .map((payload) => JSON.parse(payload) as { type?: string; createSessionPayload?: Record<string, unknown> })
    .find((payload) => payload.type === 'teacher-authenticated')

  assert.deepEqual(teacherAuthenticated?.createSessionPayload, {
    instructorPasscode: 'teacher-passcode-from-normalizer',
  })
})

void test('updatePersistentSessionUrlState keeps existing selectedOptions when selectedOptions is omitted', async (t) => {
  initializePersistentStorage(null)

  const activityName = 'algorithm-demo'
  const teacherCode = 'preserve-selected-options'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'instructor-required')
  await updatePersistentSessionUrlState(hash, {
    selectedOptions: {
      algorithm: 'merge-sort',
    },
  })

  await updatePersistentSessionUrlState(hash, {
    entryPolicy: 'solo-allowed',
  })

  const stored = await getPersistentSession(hash)
  assert.equal(stored?.entryPolicy, 'solo-allowed')
  assert.deepEqual(stored?.selectedOptions, {
    algorithm: 'merge-sort',
  })
})

void test('updatePersistentSessionUrlState trims selectedOptions and drops blank values', async (t) => {
  initializePersistentStorage(null)

  const activityName = 'algorithm-demo'
  const teacherCode = 'trim-selected-options'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))

  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode, 'instructor-required')
  await updatePersistentSessionUrlState(hash, {
    selectedOptions: {
      algorithm: '  binary-search  ',
      utm_source: '   ',
    },
  })

  const stored = await getPersistentSession(hash)
  assert.deepEqual(stored?.selectedOptions, {
    algorithm: 'binary-search',
  })
})

void test('persistent session websocket rolls back and reports a retryable error when starting the session fails', async (t) => {
  const valkeyClient = createFakeValkeyClient()
  initializePersistentStorage(valkeyClient as never)
  t.after(() => { initializePersistentStorage(null) })

  const activityName = 'algorithm-demo'
  const teacherCode = 'ws-start-failure-code'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)

  const sessionStore = new Map<string, SessionRecord>()
  const deleted: string[] = []
  const sessions = {
    async get(id: string) { return sessionStore.get(id) ?? null },
    async set(id: string, value: SessionRecord) { sessionStore.set(id, value) },
    async delete(id: string) { deleted.push(id); return sessionStore.delete(id) },
  }

  let registeredHandler: ((socket: MockSocket, query: URLSearchParams, _wss: unknown) => void) | undefined
  setupPersistentSessionWs({
    register(pathname, handler) {
      if (pathname === '/ws/persistent-session') {
        registeredHandler = handler as (socket: MockSocket, query: URLSearchParams, _wss: unknown) => void
      }
    },
  }, sessions)
  assert.ok(registeredHandler)

  const socket = createMockSocket()
  registeredHandler(socket, new URLSearchParams({ hash, activityName }), null)
  await waitForAsyncWork()

  // startPersistentSession's reverse-index write now rejects (the record write
  // has already landed), so the WS boundary must roll the orphan back rather
  // than leak an unhandled rejection.
  const originalSet = valkeyClient.set
  valkeyClient.set = async (key: string, value: string) => {
    if (key.startsWith('persistent-session-by-session:')) {
      throw new Error('[TEST] reverse-index write failed')
    }
    return originalSet(key, value)
  }

  console.info('[TEST] Expected persistent-session start failure surfaced at the websocket message boundary.')
  socket.handlers.message?.(JSON.stringify({ type: 'verify-teacher-code', teacherCode }))
  await waitForAsyncWork()
  await waitForAsyncWork()

  const messageTypes = socket.sent.map((payload) => (JSON.parse(payload) as { type?: string }).type)
  assert.ok(messageTypes.includes('teacher-code-error'), 'the teacher receives a controlled error')
  assert.equal(messageTypes.includes('teacher-authenticated'), false, 'no success message is sent')
  assert.equal(messageTypes.includes('session-started'), false, 'no waiter is told the session started')
  assert.equal(deleted.length, 1, 'the orphaned live session is rolled back')
  assert.equal(sessionStore.size, 0, 'no live session is left behind')
  // The persistent record must not stay marked as started with the deleted id,
  // or the next waiter gets `session-started` and cannot retry verification.
  assert.equal(await isSessionStarted(hash), false, 'the persistent record start state is rolled back')
})

void test('rollbackPersistentSessionStart scopes to the failed attempt and leaves a concurrently started session intact', async (t) => {
  const valkeyClient = createFakeValkeyClient()
  initializePersistentStorage(valkeyClient as never)
  t.after(() => { initializePersistentStorage(null) })

  const activityName = 'algorithm-demo'
  const teacherCode = 'rollback-scope-code'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)

  // Attempt A links "sess-A" onto the record, but its reverse-index write fails.
  const originalSet = valkeyClient.set
  valkeyClient.set = async (key: string, value: string) => {
    if (key === 'persistent-session-by-session:sess-A') {
      throw new Error('[TEST] reverse-index write failed for the first start attempt')
    }
    return originalSet(key, value)
  }
  console.info('[TEST] Expected reverse-index write failure for the first persistent start attempt.')
  await assert.rejects(
    startPersistentSession(hash, 'sess-A', { id: 'teacher-A', readyState: 1, send() {} } as never),
    /reverse-index write failed/,
  )

  // Attempt B then succeeds and links a newer session to the same record.
  valkeyClient.set = originalSet
  await startPersistentSession(hash, 'sess-B', { id: 'teacher-B', readyState: 1, send() {} } as never)

  // Attempt A's cleanup runs late. It must not clear B's association.
  await rollbackPersistentSessionStart(hash, 'sess-A')

  const record = await getPersistentSession(hash)
  assert.equal(record?.sessionId, 'sess-B', 'the concurrently started session stays linked')
  assert.equal(
    valkeyClient.store.get('persistent-session-by-session:sess-B'),
    hash,
    'the newer reverse-index entry is untouched',
  )
  assert.equal(
    valkeyClient.store.get('persistent-session-by-session:sess-A') ?? null,
    null,
    'the failed attempt\'s reverse-index entry is cleaned up',
  )

  // A bare (unscoped) rollback still fully resets the record.
  await rollbackPersistentSessionStart(hash)
  assert.equal(await isSessionStarted(hash), false, 'an unscoped rollback clears the record')
})

void test('rollbackPersistentSessionStart clears through a single atomic compare-and-clear (no read-modify-write)', async (t) => {
  const valkeyClient = createFakeValkeyClient()
  initializePersistentStorage(valkeyClient as never)
  t.after(() => { initializePersistentStorage(null) })

  const activityName = 'algorithm-demo'
  const teacherCode = 'rollback-atomic-code'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  await startPersistentSession(hash, 'sess-A', { id: 'teacher-A', readyState: 1, send() {} } as never)

  // The scoped rollback must go through `compareAndClearSessionId` and must not
  // do its own GET-then-SET on the record (that is the TOCTOU the atomic op
  // exists to remove).
  const evalCalls: Array<string> = []
  const recordSets: Array<string> = []
  const originalEval = valkeyClient.eval
  const originalSet = valkeyClient.set
  valkeyClient.eval = async (script?: string, numKeys?: number, ...args: Array<string | number>) => {
    if (typeof script === 'string') evalCalls.push(script)
    return originalEval(script, numKeys, ...args)
  }
  valkeyClient.set = async (key: string, value: string) => {
    if (key === `persistent:${hash}`) recordSets.push(value)
    return originalSet(key, value)
  }

  await rollbackPersistentSessionStart(hash, 'sess-A')

  assert.equal(evalCalls.some((s) => s.includes('persistent-session-compare-and-clear')), true, 'used the atomic compare-and-clear script')
  assert.equal(recordSets.length, 0, 'no read-modify-write SET on the persistent record')
  assert.equal(await isSessionStarted(hash), false, 'the record start state is cleared')
  assert.equal(valkeyClient.store.get('persistent-session-by-session:sess-A') ?? null, null, 'the reverse index is dropped')
})

void test('compareAndClearSessionId only clears while the record still points at the expected session id', async (t) => {
  const valkeyClient = createFakeValkeyClient()
  initializePersistentStorage(valkeyClient as never)
  t.after(() => { initializePersistentStorage(null) })

  const activityName = 'algorithm-demo'
  const teacherCode = 'rollback-cas-code'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)
  // A concurrent attempt has already linked sess-B.
  await startPersistentSession(hash, 'sess-B', { id: 'teacher-B', readyState: 1, send() {} } as never)

  // The failed attempt A's rollback (scoped to sess-A) must not touch sess-B.
  await rollbackPersistentSessionStart(hash, 'sess-A')
  let record = await getPersistentSession(hash)
  assert.equal(record?.sessionId, 'sess-B', 'a mismatched compare-and-clear leaves the newer session linked')
  assert.equal(valkeyClient.store.get('persistent-session-by-session:sess-B'), hash, 'sess-B reverse index untouched')
  assert.equal(valkeyClient.store.get('persistent-session-by-session:sess-A') ?? null, null, 'sess-A reverse index still cleaned up')

  // Scoped to the id the record actually holds -> it clears.
  await rollbackPersistentSessionStart(hash, 'sess-B')
  record = await getPersistentSession(hash)
  assert.equal(record?.sessionId ?? null, null, 'a matching compare-and-clear resets the record')
})
