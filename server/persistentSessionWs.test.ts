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
  eval: () => Promise<number>
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
    eval: async () => 1,
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

void test('rollbackPersistentSessionStart re-reads before writing so a mid-rollback re-link survives', async (t) => {
  const valkeyClient = createFakeValkeyClient()
  initializePersistentStorage(valkeyClient as never)
  t.after(() => { initializePersistentStorage(null) })

  const activityName = 'algorithm-demo'
  const teacherCode = 'rollback-interleave-code'
  const { hash, hashedTeacherCode } = generatePersistentHash(activityName, teacherCode)
  t.after(async () => cleanupPersistentSession(hash))
  await getOrCreateActivePersistentSession(activityName, hash, hashedTeacherCode)

  // The failed attempt A has linked "sess-A" on the record.
  await startPersistentSession(hash, 'sess-A', { id: 'teacher-A', readyState: 1, send() {} } as never)

  // Simulate attempt B committing "sess-B" in the window between the rollback's
  // initial read and its pre-write re-read: right after the first record GET
  // returns, advance the stored record to sess-B.
  const recordKey = `persistent:${hash}`
  const originalGet = valkeyClient.get
  let recordGets = 0
  valkeyClient.get = async (key: string) => {
    const result = await originalGet(key)
    if (key === recordKey && result) {
      recordGets += 1
      if (recordGets === 1) {
        const parsed = JSON.parse(result) as { sessionId?: string | null }
        parsed.sessionId = 'sess-B'
        valkeyClient.store.set(recordKey, JSON.stringify(parsed))
      }
    }
    return result
  }

  console.info('[TEST] Expected concurrent re-link during rollback; the newer session must survive.')
  await rollbackPersistentSessionStart(hash, 'sess-A')

  valkeyClient.get = originalGet
  const record = await getPersistentSession(hash)
  assert.equal(record?.sessionId, 'sess-B', 'the concurrently linked session is not cleared by the stale rollback')
})
