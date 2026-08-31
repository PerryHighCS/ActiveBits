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
  assert.equal(deleted.length, 1, 'the orphaned live session is rolled back')
  assert.equal(sessionStore.size, 0, 'no live session is left behind')
})
