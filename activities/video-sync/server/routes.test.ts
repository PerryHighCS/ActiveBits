import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cleanupPersistentSession,
  generatePersistentHash,
  getOrCreateActivePersistentSession,
  initializePersistentStorage,
  startPersistentSession,
} from 'activebits-server/core/persistentSessions.js'
import type { SessionRecord } from 'activebits-server/core/sessions.js'
import type { WsRouter } from '../../../types/websocket.js'
import setupVideoSyncRoutes, { waitForInstructorAuthMessage } from './routes.js'

const TEST_INSTRUCTOR_PASSCODE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const ALT_TEST_INSTRUCTOR_PASSCODE = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

type RouteHandler = (
  req: { params: Record<string, string>; body?: unknown; cookies?: Record<string, unknown> },
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
    patch: Record<string, RouteHandler>
  } = {
    post: {},
    get: {},
    patch: {},
  }

  return {
    handlers,
    post(path: string, handler: RouteHandler) {
      handlers.post[path] = handler
    },
    get(path: string, handler: RouteHandler) {
      handlers.get[path] = handler
    },
    patch(path: string, handler: RouteHandler) {
      handlers.patch[path] = handler
    },
  }
}

function createMockWs() {
  const sockets = new Set<{ readyState: number; sessionId?: string | null; send(payload: string): void }>()
  const registered: Record<string, (socket: unknown, query: URLSearchParams) => void> = {}

  return {
    registered,
    wss: {
      clients: sockets,
      close(_callback?: () => void) {},
    },
    register(path: string, handler: (socket: unknown, query: URLSearchParams) => void) {
      registered[path] = handler
    },
  }
}

function createMockSocket() {
  const sent: string[] = []
  const handlers: Record<string, Array<{ listener: (...args: unknown[]) => void; once: boolean }>> = {
    close: [],
    error: [],
    message: [],
  }
  let closed: { code?: number; reason?: string } | null = null

  return {
    sent,
    get closed() {
      return closed
    },
    emit(event: 'close' | 'error' | 'message', ...args: unknown[]) {
      const listeners = handlers[event]
      if (!listeners) {
        throw new Error(`Unknown mock socket event: ${event}`)
      }

      const toRun = [...listeners]
      handlers[event] = listeners.filter((entry) => !entry.once)
      for (const entry of toRun) {
        entry.listener(...args)
      }
    },
    socket: {
      readyState: 1,
      sessionId: null,
      videoSyncRole: null,
      on(event: 'close' | 'error' | 'message', handler: (...args: unknown[]) => void) {
        const listeners = handlers[event]
        if (!listeners) {
          throw new Error(`Unknown mock socket event: ${event}`)
        }
        listeners.push({ listener: handler, once: false })
      },
      once(event: 'close' | 'error' | 'message', handler: (...args: unknown[]) => void) {
        const listeners = handlers[event]
        if (!listeners) {
          throw new Error(`Unknown mock socket event: ${event}`)
        }
        listeners.push({ listener: handler, once: true })
      },
      send(payload: string) {
        sent.push(payload)
      },
      close(code?: number, reason?: string) {
        closed = { code, reason }
      },
      terminate() {},
      ping(_data?: string | Buffer | ArrayBuffer | Buffer[], _mask?: boolean, cb?: (err: Error) => void) {
        cb?.(new Error('not implemented'))
      },
    },
  }
}

function createSocketRecorder(sessionId: string) {
  const delivered: string[] = []

  return {
    socket: {
      readyState: 1,
      sessionId,
      send(payload: string) {
        delivered.push(payload)
      },
    },
    delivered,
  }
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs: number,
  pollIntervalMs = 5,
): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`[TEST] Timed out waiting for condition after ${timeoutMs}ms`)
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
}

function createMockVideoSyncValkeyStore() {
  const entries = new Map<string, { value: string; expiresAt: number }>()

  const readState = (key: string, nowMs: number): Record<string, number> => {
    const entry = entries.get(key)
    if (!entry) {
      return {}
    }

    if (entry.expiresAt <= nowMs) {
      entries.delete(key)
      return {}
    }

    try {
      const parsed = JSON.parse(entry.value) as Record<string, unknown>
      const normalized: Record<string, number> = {}
      for (const [studentId, timestamp] of Object.entries(parsed)) {
        if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
          normalized[studentId] = timestamp
        }
      }
      return normalized
    } catch {
      entries.delete(key)
      return {}
    }
  }

  const writeState = (key: string, state: Record<string, number>, ttlMs: number, nowMs: number): void => {
    if (Object.keys(state).length === 0) {
      entries.delete(key)
      return
    }

    entries.set(key, {
      value: JSON.stringify(state),
      expiresAt: nowMs + ttlMs,
    })
  }

  return {
    client: {
      async eval(script: string, numKeys: number, ...args: Array<string | number>) {
        assert.equal(numKeys, 1)
        const [keyArg, ...rawArgs] = args
        const key = String(keyArg)

        if (script.includes('video-sync-unsynced-upsert')) {
          const [studentIdArg, nowArg, staleArg, maxArg, ttlArg] = rawArgs
          const studentId = String(studentIdArg)
          const nowMs = Number(nowArg)
          const staleMs = Number(staleArg)
          const maxStudents = Number(maxArg)
          const ttlMs = Number(ttlArg)
          const state = readState(key, nowMs)

          for (const [existingStudentId, timestamp] of Object.entries(state)) {
            if (nowMs - timestamp > staleMs) {
              delete state[existingStudentId]
            }
          }

          const currentCount = Object.keys(state).length
          if (!(studentId in state) && currentCount >= maxStudents) {
            writeState(key, state, ttlMs, nowMs)
            return currentCount
          }

          state[studentId] = nowMs
          writeState(key, state, ttlMs, nowMs)
          return Object.keys(state).length
        }

        if (script.includes('video-sync-unsynced-clear')) {
          const [studentIdArg, nowArg, staleArg, ttlArg] = rawArgs
          const studentId = String(studentIdArg)
          const nowMs = Number(nowArg)
          const staleMs = Number(staleArg)
          const ttlMs = Number(ttlArg)
          const state = readState(key, nowMs)

          for (const [existingStudentId, timestamp] of Object.entries(state)) {
            if (nowMs - timestamp > staleMs) {
              delete state[existingStudentId]
            }
          }

          delete state[studentId]
          writeState(key, state, ttlMs, nowMs)
          return Object.keys(state).length
        }

        if (script.includes('video-sync-unsynced-count')) {
          const [nowArg, staleArg, ttlArg] = rawArgs
          const nowMs = Number(nowArg)
          const staleMs = Number(staleArg)
          const ttlMs = Number(ttlArg)
          const state = readState(key, nowMs)

          for (const [existingStudentId, timestamp] of Object.entries(state)) {
            if (nowMs - timestamp > staleMs) {
              delete state[existingStudentId]
            }
          }

          writeState(key, state, ttlMs, nowMs)
          return Object.keys(state).length
        }

        throw new Error(`[TEST] unexpected mock valkey eval script: ${script.slice(0, 48)}`)
      },
    },
  }
}

function cloneSessionRecord(session: SessionRecord): SessionRecord {
  return structuredClone(session)
}

function createSessionStore(
  initial: Record<string, SessionRecord>,
  options: {
    sharedStore?: Record<string, SessionRecord>
    valkeyStore?: { client: { eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown> } }
  } = {},
) {
  const store = options.sharedStore ?? { ...initial }
  const published: Array<{ channel: string; message: Record<string, unknown> }> = []
  const subscriptions: string[] = []

  return {
    store,
    published,
    subscriptions,
    sessions: {
      async get(id: string) {
        const session = store[id]
        return session ? cloneSessionRecord(session) : null
      },
      async set(id: string, session: SessionRecord) {
        store[id] = cloneSessionRecord(session)
      },
      ...(options.valkeyStore ? { valkeyStore: options.valkeyStore } : {}),
      async publishBroadcast(channel: string, message: Record<string, unknown>) {
        published.push({ channel, message })
      },
      subscribeToBroadcast(channel: string) {
        subscriptions.push(channel)
      },
    },
  }
}

function createVideoSyncSession(id: string, instructorPasscode = TEST_INSTRUCTOR_PASSCODE): SessionRecord {
  return {
    id,
    type: 'video-sync',
    created: Date.now(),
    lastActivity: Date.now(),
    data: {
      instructorPasscode,
      standaloneMode: false,
      state: {
        provider: 'youtube',
        videoId: '',
        startSec: 0,
        stopSec: null,
        positionSec: 0,
        isPlaying: false,
        playbackRate: 1,
        updatedBy: 'system',
        serverTimestampMs: Date.now(),
      },
      telemetry: {
        connections: { activeCount: 0 },
        autoplay: { blockedCount: 0 },
        sync: { unsyncedStudents: 0, lastDriftSec: null, lastCorrectionResult: 'none' },
        error: { code: null, message: null },
      },
    },
  }
}

void test('create route initializes video-sync session', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({})

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/video-sync/create']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.({ params: {} }, res)

  assert.equal(res.statusCode, 200)
  const createdBody = res.body as { id?: string; instructorPasscode?: string }
  const createdId = createdBody.id
  assert.equal(typeof createdId, 'string')
  assert.ok(createdId)
  assert.equal(typeof createdBody.instructorPasscode, 'string')
  assert.equal(createdBody.instructorPasscode?.length, 32)

  const created = storeState.store[createdId as string]
  assert.equal(created?.type, 'video-sync')
  const createdData = created?.data as Record<string, unknown>
  assert.equal(createdData.instructorPasscode, createdBody.instructorPasscode)
  const state = createdData.state as Record<string, unknown>
  assert.equal(state.provider, 'youtube')
  assert.equal(state.videoId, '')
})

void test('session get route redacts instructor-only fields from public payload', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1', 'secret-passcode') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.get['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const payload = res.body as {
    id?: string
    type?: string
    data?: Record<string, unknown>
  }
  assert.equal(payload.id, 's1')
  assert.equal(payload.type, 'video-sync')
  assert.ok(payload.data)
  assert.equal(payload.data?.standaloneMode, false)
  assert.equal(typeof payload.data?.state, 'object')
  assert.equal(typeof payload.data?.telemetry, 'object')
  assert.equal('instructorPasscode' in (payload.data ?? {}), false)
})

void test('session get route includes standaloneMode for standalone sessions', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const session = createVideoSyncSession('s1')
  ;(session.data as { standaloneMode: boolean }).standaloneMode = true
  const storeState = createSessionStore({ s1: session })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.get['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const payload = res.body as {
    data?: Record<string, unknown>
  }
  assert.equal(payload.data?.standaloneMode, true)
})

void test('session get route regenerates malformed persisted instructor passcodes', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const session = createVideoSyncSession('s1')
  ;(session.data as { instructorPasscode: string }).instructorPasscode = 'legacy-passcode'
  const storeState = createSessionStore({ s1: session })
  let setCalls = 0
  const sessionsWithTrackedSet = {
    ...storeState.sessions,
    async set(id: string, updatedSession: SessionRecord) {
      setCalls += 1
      return storeState.sessions.set(id, updatedSession)
    },
  }

  setupVideoSyncRoutes(app, sessionsWithTrackedSet, ws)

  const handler = app.handlers.get['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const payload = res.body as {
    data?: {
      instructorPasscode?: string
    }
  }
  assert.equal('instructorPasscode' in (payload.data ?? {}), false)
  assert.equal(setCalls, 1)

  const persisted = storeState.store.s1?.data as {
    instructorPasscode?: string
  }
  assert.equal(typeof persisted.instructorPasscode, 'string')
  assert.equal(persisted.instructorPasscode?.length, 32)
  assert.match(persisted.instructorPasscode ?? '', /^[a-f0-9]{32}$/)
  assert.notEqual(persisted.instructorPasscode, 'legacy-passcode')
})

void test('session get route canonicalizes persisted instructor passcodes to lowercase', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const session = createVideoSyncSession('s1')
  ;(session.data as { instructorPasscode: string }).instructorPasscode = TEST_INSTRUCTOR_PASSCODE.toUpperCase()
  const storeState = createSessionStore({ s1: session })
  let setCalls = 0
  const sessionsWithTrackedSet = {
    ...storeState.sessions,
    async set(id: string, updatedSession: SessionRecord) {
      setCalls += 1
      return storeState.sessions.set(id, updatedSession)
    },
  }

  setupVideoSyncRoutes(app, sessionsWithTrackedSet, ws)

  const handler = app.handlers.get['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.equal(setCalls, 1)
  const persisted = storeState.store.s1?.data as {
    instructorPasscode?: string
  }
  assert.equal(persisted.instructorPasscode, TEST_INSTRUCTOR_PASSCODE)
})

void test('session get route normalizes oversized persisted telemetry.error fields', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const session = createVideoSyncSession('s1')
  ;(session.data as { telemetry: { error: { code: string; message: string } } }).telemetry.error = {
    code: `  ${'C'.repeat(90)}  `,
    message: `  ${'M'.repeat(300)}  `,
  }
  const storeState = createSessionStore({ s1: session })
  let setCalls = 0
  const sessionsWithTrackedSet = {
    ...storeState.sessions,
    async set(id: string, updatedSession: SessionRecord) {
      setCalls += 1
      return storeState.sessions.set(id, updatedSession)
    },
  }

  setupVideoSyncRoutes(app, sessionsWithTrackedSet, ws)

  const handler = app.handlers.get['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const payload = res.body as {
    data?: {
      telemetry?: {
        error?: {
          code?: string | null
          message?: string | null
        }
      }
    }
  }
  assert.equal(payload.data?.telemetry?.error?.code, 'C'.repeat(64))
  assert.equal(payload.data?.telemetry?.error?.message, 'M'.repeat(256))
  assert.equal(setCalls, 1)

  const persisted = storeState.store.s1?.data as {
    telemetry?: {
      error?: {
        code?: string | null
        message?: string | null
      }
    }
  }
  assert.equal(persisted.telemetry?.error?.code, 'C'.repeat(64))
  assert.equal(persisted.telemetry?.error?.message, 'M'.repeat(256))
})

void test('session get route clears malformed persisted video ids during normalization', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const session = createVideoSyncSession('s1')
  ;(session.data as { state: { videoId: string; startSec: number; positionSec: number } }).state.videoId = 'bad-id'
  ;(session.data as { state: { videoId: string; startSec: number; positionSec: number } }).state.startSec = 12
  ;(session.data as { state: { videoId: string; startSec: number; positionSec: number } }).state.positionSec = 18
  const storeState = createSessionStore({ s1: session })
  let setCalls = 0
  const sessionsWithTrackedSet = {
    ...storeState.sessions,
    async set(id: string, updatedSession: SessionRecord) {
      setCalls += 1
      return storeState.sessions.set(id, updatedSession)
    },
  }

  setupVideoSyncRoutes(app, sessionsWithTrackedSet, ws)

  const handler = app.handlers.get['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const payload = res.body as {
    data?: {
      state?: {
        videoId?: string
      }
    }
  }
  assert.equal(payload.data?.state?.videoId, '')
  assert.equal(setCalls, 1)

  const persisted = storeState.store.s1?.data as {
    state?: {
      videoId?: string
    }
  }
  assert.equal(persisted.state?.videoId, '')
})

void test('session get route replaces non-positive persisted server timestamps during normalization', async () => {
  const originalDateNow = Date.now
  Date.now = () => 50_000

  try {
    const app = createMockApp()
    const ws = createMockWs() as unknown as WsRouter
    const session = createVideoSyncSession('s1')
    ;(session.data as {
      state: {
        serverTimestampMs: number
      }
    }).state.serverTimestampMs = -1
    const storeState = createSessionStore({ s1: session })
    let setCalls = 0
    const sessionsWithTrackedSet = {
      ...storeState.sessions,
      async set(id: string, updatedSession: SessionRecord) {
        setCalls += 1
        return storeState.sessions.set(id, updatedSession)
      },
    }

    setupVideoSyncRoutes(app, sessionsWithTrackedSet, ws)

    const handler = app.handlers.get['/api/video-sync/:sessionId/session']
    assert.equal(typeof handler, 'function')

    const res = createResponse()
    await handler?.(
      {
        params: { sessionId: 's1' },
      },
      res,
    )

    assert.equal(res.statusCode, 200)
    const payload = res.body as {
      data?: {
        state?: {
          serverTimestampMs?: number
        }
      }
    }
    assert.equal(payload.data?.state?.serverTimestampMs, 50_000)
    assert.equal(setCalls, 1)

    const persisted = storeState.store.s1?.data as {
      state?: {
        serverTimestampMs?: number
      }
    }
    assert.equal(persisted.state?.serverTimestampMs, 50_000)
  } finally {
    Date.now = originalDateNow
  }
})

void test('session get route returns projected playback without persisting ordinary reads', async () => {
  const originalDateNow = Date.now
  const nowMs = 12_000
  Date.now = () => nowMs

  try {
    const app = createMockApp()
    const ws = createMockWs() as unknown as WsRouter
    const session = createVideoSyncSession('s1')
    ;(session.data as {
      state: {
        provider: 'youtube'
        videoId: string
        startSec: number
        stopSec: number | null
        positionSec: number
        isPlaying: boolean
        playbackRate: 1
        updatedBy: 'instructor' | 'system'
        serverTimestampMs: number
      }
    }).state = {
      provider: 'youtube',
      videoId: 'dQw4w9WgXcQ',
      startSec: 0,
      stopSec: null,
      positionSec: 5,
      isPlaying: true,
      playbackRate: 1,
      updatedBy: 'instructor',
      serverTimestampMs: 10_000,
    }
    const storeState = createSessionStore({ s1: session })
    let setCalls = 0
    const sessionsWithTrackedSet = {
      ...storeState.sessions,
      async set(id: string, updatedSession: SessionRecord) {
        setCalls += 1
        return storeState.sessions.set(id, updatedSession)
      },
    }

    setupVideoSyncRoutes(app, sessionsWithTrackedSet, ws)

    const handler = app.handlers.get['/api/video-sync/:sessionId/session']
    assert.equal(typeof handler, 'function')

    const res = createResponse()
    await handler?.(
      {
        params: { sessionId: 's1' },
      },
      res,
    )

    assert.equal(res.statusCode, 200)
    const payload = res.body as {
      data?: {
        state?: {
          positionSec?: number
          serverTimestampMs?: number
          isPlaying?: boolean
        }
      }
    }
    assert.equal(payload.data?.state?.positionSec, 7)
    assert.equal(payload.data?.state?.serverTimestampMs, 12_000)
    assert.equal(payload.data?.state?.isPlaying, true)
    assert.equal(setCalls, 0)

    const persisted = storeState.store.s1?.data as {
      state?: {
        positionSec?: number
        serverTimestampMs?: number
        isPlaying?: boolean
      }
    }
    assert.equal(persisted.state?.positionSec, 5)
    assert.equal(persisted.state?.serverTimestampMs, 10_000)
    assert.equal(persisted.state?.isPlaying, true)
  } finally {
    Date.now = originalDateNow
  }
})

void test('session get route persists the session when projected playback reaches stopSec', async () => {
  const originalDateNow = Date.now
  const nowMs = 12_000
  Date.now = () => nowMs

  try {
    const app = createMockApp()
    const ws = createMockWs() as unknown as WsRouter
    const session = createVideoSyncSession('s1')
    ;(session.data as {
      state: {
        provider: 'youtube'
        videoId: string
        startSec: number
        stopSec: number | null
        positionSec: number
        isPlaying: boolean
        playbackRate: 1
        updatedBy: 'instructor' | 'system'
        serverTimestampMs: number
      }
    }).state = {
      provider: 'youtube',
      videoId: 'dQw4w9WgXcQ',
      startSec: 0,
      stopSec: 6,
      positionSec: 5,
      isPlaying: true,
      playbackRate: 1,
      updatedBy: 'instructor',
      serverTimestampMs: 10_000,
    }
    const storeState = createSessionStore({ s1: session })
    let setCalls = 0
    const sessionsWithTrackedSet = {
      ...storeState.sessions,
      async set(id: string, updatedSession: SessionRecord) {
        setCalls += 1
        return storeState.sessions.set(id, updatedSession)
      },
    }

    setupVideoSyncRoutes(app, sessionsWithTrackedSet, ws)

    const handler = app.handlers.get['/api/video-sync/:sessionId/session']
    assert.equal(typeof handler, 'function')

    const res = createResponse()
    await handler?.(
      {
        params: { sessionId: 's1' },
      },
      res,
    )

    assert.equal(res.statusCode, 200)
    const payload = res.body as {
      data?: {
        state?: {
          positionSec?: number
          serverTimestampMs?: number
          isPlaying?: boolean
        }
      }
    }
    assert.equal(payload.data?.state?.positionSec, 6)
    assert.equal(payload.data?.state?.serverTimestampMs, 12_000)
    assert.equal(payload.data?.state?.isPlaying, false)
    assert.equal(setCalls, 1)

    const persisted = storeState.store.s1?.data as {
      state?: {
        positionSec?: number
        serverTimestampMs?: number
        isPlaying?: boolean
      }
    }
    assert.equal(persisted.state?.positionSec, 6)
    assert.equal(persisted.state?.serverTimestampMs, 12_000)
    assert.equal(persisted.state?.isPlaying, false)
  } finally {
    Date.now = originalDateNow
  }
})

void test('session patch returns invalid source url for unsupported non-YouTube host', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.patch['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { sourceUrl: 'https://vimeo.com/1234', instructorPasscode: TEST_INSTRUCTOR_PASSCODE },
    },
    res,
  )

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, {
    error: 'INVALID_SOURCE_URL',
    message: 'Only youtube.com/watch and youtu.be URLs are supported in v1.',
  })
})

void test('session patch returns invalid source url for malformed url input', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.patch['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { sourceUrl: 'not a url', instructorPasscode: TEST_INSTRUCTOR_PASSCODE },
    },
    res,
  )

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, {
    error: 'INVALID_SOURCE_URL',
    message: 'Only youtube.com/watch and youtu.be URLs are supported in v1.',
  })
})

void test('session patch returns invalid video id for YouTube url without a usable id', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.patch['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { sourceUrl: 'https://www.youtube.com/watch?list=abc123', instructorPasscode: TEST_INSTRUCTOR_PASSCODE },
    },
    res,
  )

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, {
    error: 'INVALID_VIDEO_ID',
    message: 'Could not determine a valid YouTube video id from sourceUrl.',
  })
})

void test('session patch accepts youtu.be urls with extra path segments by using only the first segment', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.patch['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { sourceUrl: 'https://youtu.be/dQw4w9WgXcQ/extra-segment?t=45', instructorPasscode: TEST_INSTRUCTOR_PASSCODE },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const updated = storeState.store.s1?.data as Record<string, unknown>
  const state = updated.state as Record<string, unknown>
  assert.equal(state.videoId, 'dQw4w9WgXcQ')
  assert.equal(state.startSec, 45)
})

void test('session patch returns invalid video id for malformed youtu.be ids', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.patch['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { sourceUrl: 'https://youtu.be/dQw4w9WgX$Q', instructorPasscode: TEST_INSTRUCTOR_PASSCODE },
    },
    res,
  )

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, {
    error: 'INVALID_VIDEO_ID',
    message: 'Could not determine a valid YouTube video id from sourceUrl.',
  })
})

void test('session patch returns invalid time range when stop time is before parsed start time', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.patch['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43', stopSec: 20, instructorPasscode: TEST_INSTRUCTOR_PASSCODE },
    },
    res,
  )

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, {
    error: 'INVALID_TIME_RANGE',
    message: 'stopSec must be greater than startSec and both must be >= 0.',
  })
})

void test('session patch returns invalid stopSec when stopSec is not numeric', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.patch['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43', stopSec: '120', instructorPasscode: TEST_INSTRUCTOR_PASSCODE },
    },
    res,
  )

  assert.equal(res.statusCode, 400)
  assert.deepEqual(res.body, {
    error: 'INVALID_STOP_SEC',
    message: 'stopSec must be a finite number of seconds or omitted.',
  })
})

void test('session patch normalizes youtube source and publishes extensible envelope', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') }, { valkeyStore: createMockVideoSyncValkeyStore() })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.patch['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43', stopSec: 120, instructorPasscode: TEST_INSTRUCTOR_PASSCODE },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const patchResponse = res.body as { success?: boolean; data?: Record<string, unknown> }
  assert.equal(patchResponse.success, true)
  assert.equal('instructorPasscode' in (patchResponse.data ?? {}), false)

  const updated = storeState.store.s1?.data as Record<string, unknown>
  assert.equal(updated.standaloneMode, false)
  const state = updated.state as Record<string, unknown>
  assert.equal(state.videoId, 'dQw4w9WgXcQ')
  assert.equal(state.startSec, 43)
  assert.equal(state.stopSec, 120)

  assert.equal(storeState.published.length, 1)
  assert.equal(storeState.published[0]?.channel, 'session:s1:broadcast')

  const message = storeState.published[0]?.message as Record<string, unknown>
  assert.equal(message.activity, 'video-sync')
  assert.equal(message.sessionId, 's1')
  assert.equal(message.type, 'state-update')
  assert.equal(typeof message.timestamp, 'number')
  assert.equal(message.version, '1')
  assert.equal(typeof message.payload, 'object')
})

void test('session patch can mark a configured session as standalone', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.patch['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: {
        sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43',
        instructorPasscode: TEST_INSTRUCTOR_PASSCODE,
        standaloneMode: true,
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const updated = storeState.store.s1?.data as Record<string, unknown>
  assert.equal(updated.standaloneMode, true)
  assert.deepEqual(res.body, {
    success: true,
    data: {
      standaloneMode: true,
      state: {
        provider: 'youtube',
        videoId: 'dQw4w9WgXcQ',
        startSec: 43,
        stopSec: null,
        positionSec: 43,
        isPlaying: false,
        playbackRate: 1,
        updatedBy: 'instructor',
        serverTimestampMs: updated.state != null && typeof updated.state === 'object'
          ? (updated.state as { serverTimestampMs?: unknown }).serverTimestampMs
          : undefined,
      },
      telemetry: updated.telemetry,
    },
  })
})

void test('session patch ignores partially numeric timestamp query values', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.patch['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=83abc', instructorPasscode: TEST_INSTRUCTOR_PASSCODE },
    },
    res,
  )

  assert.equal(res.statusCode, 200)

  const updated = storeState.store.s1?.data as Record<string, unknown>
  const state = updated.state as Record<string, unknown>
  assert.equal(state.startSec, 0)
  assert.equal(state.positionSec, 0)
})

void test('session patch falls back to valid t param when start param is malformed', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.patch['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?start=oops&t=1m23s', instructorPasscode: TEST_INSTRUCTOR_PASSCODE },
    },
    res,
  )

  assert.equal(res.statusCode, 200)

  const updated = storeState.store.s1?.data as Record<string, unknown>
  const state = updated.state as Record<string, unknown>
  assert.equal(state.startSec, 83)
  assert.equal(state.positionSec, 83)
})

void test('session patch rejects reconfiguration after a video is already set', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const session = createVideoSyncSession('s1')
  ;(session.data as { state: { videoId: string; startSec: number; stopSec: number | null } }).state.videoId = 'existing123'
  ;(session.data as { state: { videoId: string; startSec: number; stopSec: number | null } }).state.startSec = 15
  ;(session.data as { state: { videoId: string; startSec: number; stopSec: number | null } }).state.stopSec = 45
  const storeState = createSessionStore({ s1: session })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.patch['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43', stopSec: 120, instructorPasscode: TEST_INSTRUCTOR_PASSCODE },
    },
    res,
  )

  assert.equal(res.statusCode, 409)
  assert.deepEqual(res.body, {
    error: 'CONFIG_LOCKED',
    message: 'Video source is already configured for this session.',
  })
})

void test('session patch publishes through broadcast channel without direct local websocket send when pubsub is available', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') }, { valkeyStore: createMockVideoSyncValkeyStore() })
  const recorder = createSocketRecorder('s1')
  ws.wss.clients.add(recorder.socket)

  setupVideoSyncRoutes(app, storeState.sessions, ws as unknown as WsRouter)

  const handler = app.handlers.patch['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43', stopSec: 120, instructorPasscode: TEST_INSTRUCTOR_PASSCODE },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.equal(storeState.published.length, 1)
  assert.deepEqual(recorder.delivered, [])
})

void test('session patch falls back to direct local websocket send when pubsub publish is unavailable', { concurrency: false }, async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })
  const subscriber = createMockSocket()
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  const heartbeatToken = { id: 'video-sync-test-heartbeat-no-publish' }

  globalThis.setInterval = (((callback: TimerHandler, _delay?: number, ...args: unknown[]) => {
    void callback
    void args
    return heartbeatToken as unknown as ReturnType<typeof setInterval>
  }) as unknown) as typeof setInterval
  globalThis.clearInterval = (((timer: ReturnType<typeof setInterval> | number | undefined) => {
    void timer
  }) as unknown) as typeof clearInterval

  const sessionsWithoutPublish = {
    get: storeState.sessions.get,
    set: storeState.sessions.set,
    subscribeToBroadcast: storeState.sessions.subscribeToBroadcast,
  }

  try {
    setupVideoSyncRoutes(app, sessionsWithoutPublish, ws as unknown as WsRouter)
    const websocketHandler = ws.registered['/ws/video-sync']
    assert.equal(typeof websocketHandler, 'function')
    websocketHandler?.(subscriber.socket, new URLSearchParams(`sessionId=s1&role=student`))
    await new Promise((resolve) => setImmediate(resolve))
    subscriber.sent.length = 0

    const handler = app.handlers.patch['/api/video-sync/:sessionId/session']
    assert.equal(typeof handler, 'function')

    const res = createResponse()
    await handler?.(
      {
        params: { sessionId: 's1' },
        body: { sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43', stopSec: 120, instructorPasscode: TEST_INSTRUCTOR_PASSCODE },
      },
      res,
    )

    assert.equal(res.statusCode, 200)
    assert.equal(storeState.published.length, 0)
    assert.equal(subscriber.sent.length, 1)
    const payload = JSON.parse(subscriber.sent[0] ?? '{}') as { type?: unknown; sessionId?: unknown }
    assert.equal(payload.type, 'state-update')
    assert.equal(payload.sessionId, 's1')

    subscriber.emit('close')
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
  }
})

void test('session patch falls back to direct local websocket send when publishBroadcast exists without a real pubsub backend', { concurrency: false }, async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })
  const subscriber = createMockSocket()
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  const heartbeatToken = { id: 'video-sync-test-heartbeat' }

  globalThis.setInterval = (((callback: TimerHandler, _delay?: number, ...args: unknown[]) => {
    void callback
    void args
    return heartbeatToken as unknown as ReturnType<typeof setInterval>
  }) as unknown) as typeof setInterval
  globalThis.clearInterval = (((timer: ReturnType<typeof setInterval> | number | undefined) => {
    void timer
  }) as unknown) as typeof clearInterval

  const sessionsWithNoOpPublish = {
    get: storeState.sessions.get,
    set: storeState.sessions.set,
    publishBroadcast: storeState.sessions.publishBroadcast,
    subscribeToBroadcast: storeState.sessions.subscribeToBroadcast,
  }

  try {
    setupVideoSyncRoutes(app, sessionsWithNoOpPublish, ws as unknown as WsRouter)
    const websocketHandler = ws.registered['/ws/video-sync']
    assert.equal(typeof websocketHandler, 'function')
    websocketHandler?.(subscriber.socket, new URLSearchParams(`sessionId=s1&role=student`))
    await new Promise((resolve) => setImmediate(resolve))
    subscriber.sent.length = 0

    const handler = app.handlers.patch['/api/video-sync/:sessionId/session']
    assert.equal(typeof handler, 'function')

    const res = createResponse()
    await handler?.(
      {
        params: { sessionId: 's1' },
        body: { sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43', stopSec: 120, instructorPasscode: TEST_INSTRUCTOR_PASSCODE },
      },
      res,
    )

    assert.equal(res.statusCode, 200)
    assert.equal(storeState.published.length, 0)
    assert.equal(subscriber.sent.length, 1)
    const payload = JSON.parse(subscriber.sent[0] ?? '{}') as { type?: unknown; sessionId?: unknown }
    assert.equal(payload.type, 'state-update')
    assert.equal(payload.sessionId, 's1')

    subscriber.emit('close')
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
  }
})

void test('command route updates playback and emits extensible envelope', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') }, { valkeyStore: createMockVideoSyncValkeyStore() })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/video-sync/:sessionId/command']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { type: 'play', instructorPasscode: TEST_INSTRUCTOR_PASSCODE },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  const commandResponse = res.body as { success?: boolean; data?: Record<string, unknown> }
  assert.equal(commandResponse.success, true)
  assert.equal('instructorPasscode' in (commandResponse.data ?? {}), false)

  const updated = storeState.store.s1?.data as Record<string, unknown>
  const state = updated.state as Record<string, unknown>
  assert.equal(state.isPlaying, true)
  assert.equal(state.updatedBy, 'instructor')

  assert.equal(storeState.published.length, 1)
  const message = storeState.published[0]?.message as Record<string, unknown>
  assert.equal(message.activity, 'video-sync')
  assert.equal(message.sessionId, 's1')
  assert.equal(message.type, 'state-update')
})

void test('session patch rejects requests without a valid instructor passcode', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.patch['/api/video-sync/:sessionId/session']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { sourceUrl: 'https://youtu.be/dQw4w9WgXcQ' },
    },
    res,
  )

  assert.equal(res.statusCode, 403)
  assert.deepEqual(res.body, {
    error: 'FORBIDDEN',
    message: 'Valid instructorPasscode is required',
  })
})

void test('command route rejects requests without a valid instructor passcode', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/video-sync/:sessionId/command']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { type: 'play' },
    },
    res,
  )

  assert.equal(res.statusCode, 403)
  assert.deepEqual(res.body, {
    error: 'FORBIDDEN',
    message: 'Valid instructorPasscode is required',
  })
})

void test('command route rejects oversized instructor passcodes before verification', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/video-sync/:sessionId/command']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { type: 'play', instructorPasscode: 'a'.repeat(10_000) },
    },
    res,
  )

  assert.equal(res.statusCode, 403)
  assert.deepEqual(res.body, {
    error: 'FORBIDDEN',
    message: 'Valid instructorPasscode is required',
  })
})

void test('instructor-passcode route returns passcode for persistent teacher cookie', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1', ALT_TEST_INSTRUCTOR_PASSCODE) })
  let setCalls = 0
  const sessionsWithTrackedSet = {
    ...storeState.sessions,
    async set(id: string, updatedSession: SessionRecord) {
      setCalls += 1
      return storeState.sessions.set(id, updatedSession)
    },
  }
  const teacherCode = 'persistent-teacher-code'
  const { hash, hashedTeacherCode } = generatePersistentHash('video-sync', teacherCode)
  await getOrCreateActivePersistentSession('video-sync', hash, hashedTeacherCode)
  await startPersistentSession(hash, 's1', {
    id: 'teacher-ws',
    readyState: 1,
    send() {},
  })

  setupVideoSyncRoutes(app, sessionsWithTrackedSet, ws)

  const handler = app.handlers.get['/api/video-sync/:sessionId/instructor-passcode']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      cookies: {
        persistent_sessions: JSON.stringify([
          {
            key: `video-sync:${hash}`,
            teacherCode,
          },
        ]),
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { instructorPasscode: ALT_TEST_INSTRUCTOR_PASSCODE })
  assert.equal(setCalls, 0)
  await cleanupPersistentSession(hash)
})

void test('instructor-passcode route persists normalized session data when recovery reads repair malformed fields', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const session = createVideoSyncSession('s1')
  ;(session.data as { instructorPasscode: string }).instructorPasscode = 'legacy-passcode'
  const storeState = createSessionStore({ s1: session })
  let setCalls = 0
  const sessionsWithTrackedSet = {
    ...storeState.sessions,
    async set(id: string, updatedSession: SessionRecord) {
      setCalls += 1
      return storeState.sessions.set(id, updatedSession)
    },
  }
  const teacherCode = 'persistent-teacher-code'
  const { hash, hashedTeacherCode } = generatePersistentHash('video-sync', teacherCode)
  await getOrCreateActivePersistentSession('video-sync', hash, hashedTeacherCode)
  await startPersistentSession(hash, 's1', {
    id: 'teacher-ws',
    readyState: 1,
    send() {},
  })

  setupVideoSyncRoutes(app, sessionsWithTrackedSet, ws)

  const handler = app.handlers.get['/api/video-sync/:sessionId/instructor-passcode']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      cookies: {
        persistent_sessions: JSON.stringify([
          {
            key: `video-sync:${hash}`,
            teacherCode,
          },
        ]),
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.equal(setCalls, 1)
  assert.equal(typeof (res.body as { instructorPasscode?: unknown }).instructorPasscode, 'string')
  const persisted = storeState.store.s1?.data as { instructorPasscode?: string }
  assert.equal(persisted.instructorPasscode?.length, 32)
  assert.match(persisted.instructorPasscode ?? '', /^[a-f0-9]{32}$/)
  assert.notEqual(persisted.instructorPasscode, 'legacy-passcode')
  await cleanupPersistentSession(hash)
})

void test('instructor-passcode route returns passcode for embedded child sessions when parent syncdeck teacher cookie matches', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const embeddedSession = createVideoSyncSession('CHILD:parent-syncdeck:abcde:video-sync', ALT_TEST_INSTRUCTOR_PASSCODE)
  embeddedSession.data = {
    ...embeddedSession.data,
    embeddedParentSessionId: 'parent-syncdeck',
    embeddedInstanceKey: 'video-sync:3:0',
    embeddedLaunch: {
      parentSessionId: 'parent-syncdeck',
      instanceKey: 'video-sync:3:0',
      selectedOptions: {
        sourceUrl: 'https://www.youtube.com/watch?v=mCq8-xTH7jA',
      },
    },
  }
  const storeState = createSessionStore({
    'CHILD:parent-syncdeck:abcde:video-sync': embeddedSession,
    'parent-syncdeck': {
      id: 'parent-syncdeck',
      type: 'syncdeck',
      created: Date.now(),
      lastActivity: Date.now(),
      data: {},
    },
  })
  const teacherCode = 'persistent-teacher-code'
  const { hash, hashedTeacherCode } = generatePersistentHash('syncdeck', teacherCode)
  await getOrCreateActivePersistentSession('syncdeck', hash, hashedTeacherCode)
  await startPersistentSession(hash, 'parent-syncdeck', {
    id: 'teacher-ws',
    readyState: 1,
    send() {},
  })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.get['/api/video-sync/:sessionId/instructor-passcode']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.(
    {
      params: { sessionId: 'CHILD:parent-syncdeck:abcde:video-sync' },
      cookies: {
        persistent_sessions: JSON.stringify([
          {
            key: `syncdeck:${hash}`,
            teacherCode,
          },
        ]),
      },
    },
    res,
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { instructorPasscode: ALT_TEST_INSTRUCTOR_PASSCODE })
  await cleanupPersistentSession(hash)
})

void test('instructor-passcode route ignores malformed persistent teacher cookie without logging', async () => {
  initializePersistentStorage(null)

  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1', ALT_TEST_INSTRUCTOR_PASSCODE) })
  const teacherCode = 'persistent-teacher-code'
  const { hash, hashedTeacherCode } = generatePersistentHash('video-sync', teacherCode)
  await getOrCreateActivePersistentSession('video-sync', hash, hashedTeacherCode)
  await startPersistentSession(hash, 's1', {
    id: 'teacher-ws',
    readyState: 1,
    send() {},
  })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.get['/api/video-sync/:sessionId/instructor-passcode']
  assert.equal(typeof handler, 'function')

  const originalConsoleError = console.error
  let consoleErrorCalls = 0
  console.error = () => {
    consoleErrorCalls += 1
  }

  try {
    const res = createResponse()
    await handler?.(
      {
        params: { sessionId: 's1' },
        cookies: {
          persistent_sessions: '{not-json',
        },
      },
      res,
    )

    assert.equal(res.statusCode, 403)
    assert.deepEqual(res.body, {
      error: 'FORBIDDEN',
      message: 'Instructor credential recovery is not available for this session',
    })
    assert.equal(consoleErrorCalls, 0)
  } finally {
    console.error = originalConsoleError
    await cleanupPersistentSession(hash)
  }
})

void test('instructor websocket rejects connections without a valid instructor passcode', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') }, { valkeyStore: createMockVideoSyncValkeyStore() })

  setupVideoSyncRoutes(app, storeState.sessions, ws as unknown as WsRouter)

  const handler = ws.registered['/ws/video-sync']
  assert.equal(typeof handler, 'function')

  const recorder = createMockSocket()
  handler?.(recorder.socket, new URLSearchParams({
    sessionId: 's1',
    role: 'instructor',
  }))
  recorder.emit('message', JSON.stringify({
    type: 'authenticate',
  }))

  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(recorder.closed, { code: 1008, reason: 'Forbidden' })
  assert.deepEqual(recorder.sent, [])
  assert.equal(storeState.published.length, 0)
  const persisted = storeState.store.s1?.data as {
    telemetry: {
      connections: { activeCount: number }
    }
  }
  assert.equal(persisted.telemetry.connections.activeCount, 0)
})

void test('instructor websocket rejects oversized instructor passcodes before verification', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws as unknown as WsRouter)

  const handler = ws.registered['/ws/video-sync']
  assert.equal(typeof handler, 'function')

  const recorder = createMockSocket()
  handler?.(recorder.socket, new URLSearchParams({
    sessionId: 's1',
    role: 'instructor',
  }))
  recorder.emit('message', JSON.stringify({
    type: 'authenticate',
    instructorPasscode: 'a'.repeat(10_000),
  }))

  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(recorder.closed, { code: 1008, reason: 'Forbidden' })
  assert.deepEqual(recorder.sent, [])
})

void test('waitForInstructorAuthMessage closes when auth does not arrive in time', async () => {
  const recorder = createMockSocket()
  const authPromise = waitForInstructorAuthMessage(recorder.socket, 75)

  await waitForCondition(() => recorder.closed != null, 1000)
  const authMessage = await authPromise

  assert.equal(authMessage, null)
  assert.deepEqual(recorder.closed, { code: 1008, reason: 'Auth timeout' })
  assert.deepEqual(recorder.sent, [])
})

void test('instructor websocket accepts connections with a valid instructor passcode', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1', TEST_INSTRUCTOR_PASSCODE) })

  setupVideoSyncRoutes(app, storeState.sessions, ws as unknown as WsRouter)

  const handler = ws.registered['/ws/video-sync']
  assert.equal(typeof handler, 'function')

  const recorder = createMockSocket()
  handler?.(recorder.socket, new URLSearchParams({
    sessionId: 's1',
    role: 'instructor',
  }))
  recorder.emit('message', JSON.stringify({
    type: 'authenticate',
    instructorPasscode: TEST_INSTRUCTOR_PASSCODE,
  }))

  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(recorder.closed, null)
  assert.equal(recorder.sent.length, 2)
  const payload = JSON.parse(recorder.sent[0] ?? '{}') as { type?: string; payload?: { role?: string } }
  assert.equal(payload.type, 'state-snapshot')
  assert.equal(payload.payload?.role, 'instructor')
  const telemetryEnvelope = JSON.parse(recorder.sent[1] ?? '{}') as { type?: string; payload?: { reason?: string } }
  assert.equal(telemetryEnvelope.type, 'telemetry-update')
  assert.equal(telemetryEnvelope.payload?.reason, 'connection-change')
  recorder.emit('close')
  await new Promise((resolve) => setTimeout(resolve, 0))
})

void test('instructor websocket accepts uppercase instructor passcodes by canonicalizing hex casing', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1', TEST_INSTRUCTOR_PASSCODE) })

  setupVideoSyncRoutes(app, storeState.sessions, ws as unknown as WsRouter)

  const handler = ws.registered['/ws/video-sync']
  assert.equal(typeof handler, 'function')

  const recorder = createMockSocket()
  handler?.(recorder.socket, new URLSearchParams({
    sessionId: 's1',
    role: 'instructor',
  }))
  recorder.emit('message', JSON.stringify({
    type: 'authenticate',
    instructorPasscode: TEST_INSTRUCTOR_PASSCODE.toUpperCase(),
  }))

  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(recorder.closed, null)
  assert.equal(recorder.sent.length, 2)
  recorder.emit('close')
  await new Promise((resolve) => setTimeout(resolve, 0))
})

void test('legacy manager websocket role is normalized to instructor', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1', TEST_INSTRUCTOR_PASSCODE) })

  setupVideoSyncRoutes(app, storeState.sessions, ws as unknown as WsRouter)

  const handler = ws.registered['/ws/video-sync']
  assert.equal(typeof handler, 'function')

  const recorder = createMockSocket()
  handler?.(recorder.socket, new URLSearchParams({
    sessionId: 's1',
    role: 'manager',
  }))
  recorder.emit('message', JSON.stringify({
    type: 'authenticate',
    instructorPasscode: TEST_INSTRUCTOR_PASSCODE,
  }))

  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(recorder.closed, null)
  const payload = JSON.parse(recorder.sent[0] ?? '{}') as { payload?: { role?: string } }
  assert.equal(payload.payload?.role, 'instructor')
  recorder.emit('close')
  await new Promise((resolve) => setTimeout(resolve, 0))
})

void test('websocket close during async initialization does not leave a stale subscriber', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })
  let releaseSessionGate!: () => void
  const sessionGetGate = new Promise<void>((resolve) => {
    releaseSessionGate = resolve
  })
  const originalGet = storeState.sessions.get

  storeState.sessions.get = async (id: string) => {
    await sessionGetGate
    return originalGet(id)
  }

  setupVideoSyncRoutes(app, storeState.sessions, ws as unknown as WsRouter)

  const handler = ws.registered['/ws/video-sync']
  assert.equal(typeof handler, 'function')

  const recorder = createMockSocket()
  handler?.(recorder.socket, new URLSearchParams({
    sessionId: 's1',
    role: 'student',
  }))

  recorder.emit('close')
  releaseSessionGate()
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(storeState.subscriptions, [])
  assert.deepEqual(recorder.sent, [])

  const persisted = storeState.store.s1?.data as {
    telemetry: {
      connections: { activeCount: number }
    }
  }
  assert.equal(persisted.telemetry.connections.activeCount, 0)
})

void test('websocket cleanup runs only once when error is followed by close', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') }, { valkeyStore: createMockVideoSyncValkeyStore() })

  setupVideoSyncRoutes(app, storeState.sessions, ws as unknown as WsRouter)

  const handler = ws.registered['/ws/video-sync']
  assert.equal(typeof handler, 'function')

  const recorder = createMockSocket()
  handler?.(recorder.socket, new URLSearchParams({
    sessionId: 's1',
    role: 'student',
  }))

  await new Promise((resolve) => setTimeout(resolve, 0))

  const initialPublishedCount = storeState.published.length
  const initialSetData = storeState.store.s1?.data as {
    telemetry: {
      connections: { activeCount: number }
    }
  }
  assert.equal(initialSetData.telemetry.connections.activeCount, 1)

  recorder.emit('error')
  recorder.emit('close')
  await new Promise((resolve) => setTimeout(resolve, 0))

  const finalData = storeState.store.s1?.data as {
    telemetry: {
      connections: { activeCount: number }
    }
  }
  assert.equal(finalData.telemetry.connections.activeCount, 0)
  assert.equal(storeState.published.length, initialPublishedCount + 1)

  const disconnectEnvelope = storeState.published.at(-1)?.message as {
    type?: string
    payload?: {
      reason?: string
      telemetry?: {
        connections?: { activeCount?: number }
      }
    }
  }
  assert.equal(disconnectEnvelope.type, 'telemetry-update')
  assert.equal(disconnectEnvelope.payload?.reason, 'connection-change')
  assert.equal(disconnectEnvelope.payload?.telemetry?.connections?.activeCount, 0)
})

void test('invalid websocket session is rejected before subscription side effects are created', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({})

  setupVideoSyncRoutes(app, storeState.sessions, ws as unknown as WsRouter)

  const handler = ws.registered['/ws/video-sync']
  assert.equal(typeof handler, 'function')

  const recorder = createMockSocket()
  handler?.(recorder.socket, new URLSearchParams({
    sessionId: 'missing-session',
    role: 'student',
  }))

  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(storeState.subscriptions, [])
  assert.equal(storeState.published.length, 0)
  assert.equal(recorder.sent.length, 1)
  const payload = JSON.parse(recorder.sent[0] ?? '{}') as { type?: string; payload?: { code?: string } }
  assert.equal(payload.type, 'error')
  assert.equal(payload.payload?.code, 'NOT_FOUND')
  assert.deepEqual(recorder.closed, { code: 1008, reason: 'Session not found' })
})

void test('invalid websocket session still closes when sending the not-found envelope throws', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({})

  setupVideoSyncRoutes(app, storeState.sessions, ws as unknown as WsRouter)

  const handler = ws.registered['/ws/video-sync']
  assert.equal(typeof handler, 'function')

  const recorder = createMockSocket()
  recorder.socket.send = () => {
    throw new Error('[TEST] simulated socket send failure')
  }

  handler?.(recorder.socket, new URLSearchParams({
    sessionId: 'missing-session',
    role: 'student',
  }))

  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(recorder.closed, { code: 1008, reason: 'Session not found' })
})

void test('heartbeat stops and closes subscribers when the backing session disappears', { concurrency: false }, async () => {
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  const heartbeatState: { callback: (() => void) | null } = { callback: null }
  const clearedTimers: unknown[] = []
  const timerToken = { id: 'heartbeat-token' }

  globalThis.setInterval = (((callback: TimerHandler) => {
    heartbeatState.callback = callback as () => void
    return timerToken as unknown as ReturnType<typeof setInterval>
  }) as unknown) as typeof setInterval
  globalThis.clearInterval = (((timer: ReturnType<typeof setInterval> | undefined) => {
    clearedTimers.push(timer)
  }) as unknown) as typeof clearInterval

  try {
    const app = createMockApp()
    const ws = createMockWs()
    const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

    setupVideoSyncRoutes(app, storeState.sessions, ws as unknown as WsRouter)

    const handler = ws.registered['/ws/video-sync']
    assert.equal(typeof handler, 'function')

    const recorder = createMockSocket()
    handler?.(recorder.socket, new URLSearchParams({
      sessionId: 's1',
      role: 'student',
    }))

    await new Promise((resolve) => setTimeout(resolve, 0))
    const runHeartbeat = heartbeatState.callback
    assert.equal(typeof runHeartbeat, 'function')
    assert.equal(recorder.closed, null)

    delete storeState.store.s1
    if (runHeartbeat == null) {
      throw new Error('Expected heartbeat callback to be registered')
    }
    runHeartbeat()
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.deepEqual(recorder.closed, { code: 1008, reason: 'Session not found' })
    assert.deepEqual(clearedTimers, [timerToken])
  } finally {
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
  }
})

void test('heartbeat skips overlapping ticks while a previous tick is still in flight', { concurrency: false }, async () => {
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  const heartbeatState: { callback: (() => void) | null } = { callback: null }
  const timerToken = { id: 'heartbeat-token-overlap' }

  globalThis.setInterval = (((callback: TimerHandler) => {
    heartbeatState.callback = callback as () => void
    return timerToken as unknown as ReturnType<typeof setInterval>
  }) as unknown) as typeof setInterval
  globalThis.clearInterval = (((_timer: ReturnType<typeof setInterval> | undefined) => {
    // no-op for this test
  }) as unknown) as typeof clearInterval

  try {
    const app = createMockApp()
    const ws = createMockWs()
    const session = createVideoSyncSession('s1')
    const storeState = createSessionStore({ s1: session }, { valkeyStore: createMockVideoSyncValkeyStore() })

    const slowPublishState: { resolve: (() => void) | null } = { resolve: null }
    let publishCalls = 0
    const initialPublishedCount = () => storeState.published.length
    const sessionsWithSlowBroadcast = {
      ...storeState.sessions,
      async publishBroadcast(channel: string, message: Record<string, unknown>) {
        publishCalls += 1
        if (publishCalls === 1) {
          return storeState.sessions.publishBroadcast?.(channel, message)
        }
        if (publishCalls === 2) {
          await new Promise<void>((resolve) => {
            slowPublishState.resolve = resolve
          })
        }
        return storeState.sessions.publishBroadcast?.(channel, message)
      },
    }

    setupVideoSyncRoutes(app, sessionsWithSlowBroadcast, ws as unknown as WsRouter)

    const handler = ws.registered['/ws/video-sync']
    assert.equal(typeof handler, 'function')

    const recorder = createMockSocket()
    handler?.(recorder.socket, new URLSearchParams({
      sessionId: 's1',
      role: 'student',
    }))

    await new Promise((resolve) => setTimeout(resolve, 0))
    const runHeartbeat = heartbeatState.callback
    assert.equal(typeof runHeartbeat, 'function')
    if (runHeartbeat == null) {
      throw new Error('Expected heartbeat callback to be registered')
    }

    const publishedBeforeHeartbeat = initialPublishedCount()
    runHeartbeat()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(publishCalls, 2)

    runHeartbeat()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(publishCalls, 2)

    const releaseHeartbeatBroadcast = slowPublishState.resolve
    if (releaseHeartbeatBroadcast == null) {
      throw new Error('Expected stalled heartbeat broadcast to register a resolver')
    }
    releaseHeartbeatBroadcast()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(storeState.published.length, publishedBeforeHeartbeat + 1)

    recorder.emit('close')
    await new Promise((resolve) => setTimeout(resolve, 0))
  } finally {
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
  }
})

void test('heartbeat broadcasts projected playback without persisting transient timestamps', { concurrency: false }, async () => {
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  const originalDateNow = Date.now
  const heartbeatState: { callback: (() => void) | null } = { callback: null }
  const timerToken = { id: 'heartbeat-token-projected' }
  let nowMs = 10_000

  globalThis.setInterval = (((callback: TimerHandler) => {
    heartbeatState.callback = callback as () => void
    return timerToken as unknown as ReturnType<typeof setInterval>
  }) as unknown) as typeof setInterval
  globalThis.clearInterval = (((_timer: ReturnType<typeof setInterval> | undefined) => {
    // no-op for this test
  }) as unknown) as typeof clearInterval
  Date.now = () => nowMs

  try {
    const app = createMockApp()
    const ws = createMockWs()
    const session = createVideoSyncSession('s1')
    ;(session.data as {
      state: {
        provider: 'youtube'
        videoId: string
        startSec: number
        stopSec: number | null
        positionSec: number
        isPlaying: boolean
        playbackRate: 1
        updatedBy: 'instructor' | 'system'
        serverTimestampMs: number
      }
    }).state = {
      provider: 'youtube',
      videoId: 'dQw4w9WgXcQ',
      startSec: 0,
      stopSec: 30,
      positionSec: 5,
      isPlaying: true,
      playbackRate: 1,
      updatedBy: 'instructor',
      serverTimestampMs: nowMs,
    }
    const storeState = createSessionStore({ s1: session }, { valkeyStore: createMockVideoSyncValkeyStore() })
    let setCalls = 0
    const sessionsWithTrackedSet = {
      ...storeState.sessions,
      async set(id: string, updatedSession: SessionRecord) {
        setCalls += 1
        return storeState.sessions.set(id, updatedSession)
      },
    }

    setupVideoSyncRoutes(app, sessionsWithTrackedSet, ws as unknown as WsRouter)

    const handler = ws.registered['/ws/video-sync']
    assert.equal(typeof handler, 'function')

    const recorder = createMockSocket()
    handler?.(recorder.socket, new URLSearchParams({
      sessionId: 's1',
      role: 'student',
    }))

    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(setCalls, 1)

    nowMs += 3_000
    const runHeartbeat = heartbeatState.callback
    if (runHeartbeat == null) {
      throw new Error('Expected heartbeat callback to be registered')
    }

    runHeartbeat()
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(setCalls, 1)
    const heartbeatEnvelope = storeState.published.at(-1)?.message as {
      type?: string
      payload?: {
        state?: {
          positionSec?: number
          serverTimestampMs?: number
          isPlaying?: boolean
        }
      }
    }
    assert.equal(heartbeatEnvelope.type, 'heartbeat')
    assert.equal(heartbeatEnvelope.payload?.state?.positionSec, 8)
    assert.equal(heartbeatEnvelope.payload?.state?.serverTimestampMs, 13_000)
    assert.equal(heartbeatEnvelope.payload?.state?.isPlaying, true)

    const persistedState = (storeState.store.s1?.data as {
      state: {
        positionSec: number
        serverTimestampMs: number
        isPlaying: boolean
      }
    }).state
    assert.equal(persistedState.positionSec, 5)
    assert.equal(persistedState.serverTimestampMs, 10_000)
    assert.equal(persistedState.isPlaying, true)

    recorder.emit('close')
    await new Promise((resolve) => setTimeout(resolve, 0))
  } finally {
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
    Date.now = originalDateNow
  }
})

void test('heartbeat persists the session when playback reaches stopSec', { concurrency: false }, async () => {
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  const originalDateNow = Date.now
  const heartbeatState: { callback: (() => void) | null } = { callback: null }
  const timerToken = { id: 'heartbeat-token-stop' }
  let nowMs = 20_000

  globalThis.setInterval = (((callback: TimerHandler) => {
    heartbeatState.callback = callback as () => void
    return timerToken as unknown as ReturnType<typeof setInterval>
  }) as unknown) as typeof setInterval
  globalThis.clearInterval = (((_timer: ReturnType<typeof setInterval> | undefined) => {
    // no-op for this test
  }) as unknown) as typeof clearInterval
  Date.now = () => nowMs

  try {
    const app = createMockApp()
    const ws = createMockWs()
    const session = createVideoSyncSession('s1')
    ;(session.data as {
      state: {
        provider: 'youtube'
        videoId: string
        startSec: number
        stopSec: number | null
        positionSec: number
        isPlaying: boolean
        playbackRate: 1
        updatedBy: 'instructor' | 'system'
        serverTimestampMs: number
      }
    }).state = {
      provider: 'youtube',
      videoId: 'dQw4w9WgXcQ',
      startSec: 0,
      stopSec: 6,
      positionSec: 5,
      isPlaying: true,
      playbackRate: 1,
      updatedBy: 'instructor',
      serverTimestampMs: nowMs,
    }
    const storeState = createSessionStore({ s1: session })
    let setCalls = 0
    const sessionsWithTrackedSet = {
      ...storeState.sessions,
      async set(id: string, updatedSession: SessionRecord) {
        setCalls += 1
        return storeState.sessions.set(id, updatedSession)
      },
    }

    setupVideoSyncRoutes(app, sessionsWithTrackedSet, ws as unknown as WsRouter)

    const handler = ws.registered['/ws/video-sync']
    assert.equal(typeof handler, 'function')

    const recorder = createMockSocket()
    handler?.(recorder.socket, new URLSearchParams({
      sessionId: 's1',
      role: 'student',
    }))

    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(setCalls, 1)

    nowMs += 2_000
    const runHeartbeat = heartbeatState.callback
    if (runHeartbeat == null) {
      throw new Error('Expected heartbeat callback to be registered')
    }

    runHeartbeat()
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(setCalls, 2)
    const persistedState = (storeState.store.s1?.data as {
      state: {
        positionSec: number
        serverTimestampMs: number
        isPlaying: boolean
      }
    }).state
    assert.equal(persistedState.positionSec, 6)
    assert.equal(persistedState.serverTimestampMs, 22_000)
    assert.equal(persistedState.isPlaying, false)

    recorder.emit('close')
    await new Promise((resolve) => setTimeout(resolve, 0))
  } finally {
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
    Date.now = originalDateNow
  }
})

void test('event route tracks current unsynced student count', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/video-sync/:sessionId/event']
  assert.equal(typeof handler, 'function')

  const unsyncResponse = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { type: 'unsync', studentId: 'student-a', driftSec: 1.2 },
    },
    unsyncResponse,
  )

  assert.equal(unsyncResponse.statusCode, 200)
  const unsyncTelemetry = (unsyncResponse.body as { telemetry: { sync: { unsyncedStudents: number } } }).telemetry
  assert.equal(unsyncTelemetry.sync.unsyncedStudents, 1)

  const correctionResponse = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { type: 'sync-correction', studentId: 'student-a', correctionResult: 'success' },
    },
    correctionResponse,
  )

  assert.equal(correctionResponse.statusCode, 200)
  const correctionTelemetry = (correctionResponse.body as { telemetry: { sync: { unsyncedStudents: number } } }).telemetry
  assert.equal(correctionTelemetry.sync.unsyncedStudents, 0)
})

void test('event route stores lastDriftSec as a non-negative magnitude', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/video-sync/:sessionId/event']
  assert.equal(typeof handler, 'function')

  const response = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: { type: 'unsync', studentId: 'student-a', driftSec: -1.25 },
    },
    response,
  )

  assert.equal(response.statusCode, 200)
  const telemetry = (response.body as {
    telemetry: {
      sync: {
        lastDriftSec: number | null
      }
    }
  }).telemetry
  assert.equal(telemetry.sync.lastDriftSec, 1.25)

  const persisted = storeState.store.s1?.data as {
    telemetry?: {
      sync?: {
        lastDriftSec?: number | null
      }
    }
  }
  assert.equal(persisted.telemetry?.sync?.lastDriftSec, 1.25)
})

void test('event and session routes share unsynced student telemetry across simulated instances when valkeyStore is available', async () => {
  const sharedSessionStore = { s1: createVideoSyncSession('s1') }
  const sharedValkeyStore = createMockVideoSyncValkeyStore()

  const appA = createMockApp()
  const appB = createMockApp()
  const wsA = createMockWs() as unknown as WsRouter
  const wsB = createMockWs() as unknown as WsRouter
  const instanceA = createSessionStore({}, { sharedStore: sharedSessionStore, valkeyStore: sharedValkeyStore })
  const instanceB = createSessionStore({}, { sharedStore: sharedSessionStore, valkeyStore: sharedValkeyStore })

  setupVideoSyncRoutes(appA, instanceA.sessions, wsA)
  setupVideoSyncRoutes(appB, instanceB.sessions, wsB)

  const eventHandlerA = appA.handlers.post['/api/video-sync/:sessionId/event']
  const eventHandlerB = appB.handlers.post['/api/video-sync/:sessionId/event']
  const sessionHandlerB = appB.handlers.get['/api/video-sync/:sessionId/session']
  assert.equal(typeof eventHandlerA, 'function')
  assert.equal(typeof eventHandlerB, 'function')
  assert.equal(typeof sessionHandlerB, 'function')

  const unsyncResponse = createResponse()
  await eventHandlerA?.(
    {
      params: { sessionId: 's1' },
      body: { type: 'unsync', studentId: 'student-a', driftSec: 1.2 },
    },
    unsyncResponse,
  )

  assert.equal(unsyncResponse.statusCode, 200)
  assert.equal((unsyncResponse.body as { telemetry: { sync: { unsyncedStudents: number } } }).telemetry.sync.unsyncedStudents, 1)

  const sessionResponse = createResponse()
  await sessionHandlerB?.(
    {
      params: { sessionId: 's1' },
    },
    sessionResponse,
  )

  assert.equal(sessionResponse.statusCode, 200)
  assert.equal(
    (sessionResponse.body as { data?: { telemetry?: { sync?: { unsyncedStudents?: number } } } }).data?.telemetry?.sync?.unsyncedStudents,
    1,
  )

  const correctionResponse = createResponse()
  await eventHandlerB?.(
    {
      params: { sessionId: 's1' },
      body: { type: 'sync-correction', studentId: 'student-a', correctionResult: 'success' },
    },
    correctionResponse,
  )

  assert.equal(correctionResponse.statusCode, 200)
  assert.equal((correctionResponse.body as { telemetry: { sync: { unsyncedStudents: number } } }).telemetry.sync.unsyncedStudents, 0)
})

void test('event route reuses Valkey unsynced count returned by mutation scripts', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const valkeyStore = createMockVideoSyncValkeyStore()
  const evalScripts: string[] = []
  const originalEval = valkeyStore.client.eval.bind(valkeyStore.client)
  valkeyStore.client.eval = (async (script: string, numKeys: number, ...args: Array<string | number>) => {
    evalScripts.push(script)
    return originalEval(script, numKeys, ...args)
  }) as typeof valkeyStore.client.eval

  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') }, { valkeyStore })
  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const eventHandler = app.handlers.post['/api/video-sync/:sessionId/event']
  const sessionHandler = app.handlers.get['/api/video-sync/:sessionId/session']
  assert.equal(typeof eventHandler, 'function')
  assert.equal(typeof sessionHandler, 'function')

  const unsyncResponse = createResponse()
  await eventHandler?.(
    {
      params: { sessionId: 's1' },
      body: { type: 'unsync', studentId: 'student-a', driftSec: 1.2 },
    },
    unsyncResponse,
  )

  assert.equal(unsyncResponse.statusCode, 200)
  assert.equal(evalScripts.filter((script) => script.includes('video-sync-unsynced-upsert')).length, 1)
  assert.equal(evalScripts.filter((script) => script.includes('video-sync-unsynced-count')).length, 0)

  const sessionResponse = createResponse()
  await sessionHandler?.(
    {
      params: { sessionId: 's1' },
    },
    sessionResponse,
  )

  assert.equal(sessionResponse.statusCode, 200)
  assert.equal(evalScripts.filter((script) => script.includes('video-sync-unsynced-count')).length, 1)
})

void test('event route prunes stale unsynced students without a follow-up heartbeat or session read', { concurrency: false }, async () => {
  const originalDateNow = Date.now
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const timerState: { callback: (() => void) | null } = { callback: null }
  const timerToken = { id: 'unsync-prune-token' }
  let nowMs = 1_000

  Date.now = () => nowMs
  globalThis.setTimeout = (((callback: TimerHandler) => {
    timerState.callback = callback as () => void
    return timerToken as unknown as ReturnType<typeof setTimeout>
  }) as unknown) as typeof setTimeout
  globalThis.clearTimeout = (((_timer: ReturnType<typeof setTimeout> | undefined) => {
    // no-op for this test
  }) as unknown) as typeof clearTimeout

  try {
    const app = createMockApp()
    const ws = createMockWs() as unknown as WsRouter
    const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

    setupVideoSyncRoutes(app, storeState.sessions, ws)

    const handler = app.handlers.post['/api/video-sync/:sessionId/event']
    assert.equal(typeof handler, 'function')

    const unsyncResponse = createResponse()
    await handler?.(
      {
        params: { sessionId: 's1' },
        body: { type: 'unsync', studentId: 'student-a', driftSec: 1.2 },
      },
      unsyncResponse,
    )

    assert.equal(unsyncResponse.statusCode, 200)
    assert.equal((unsyncResponse.body as { telemetry: { sync: { unsyncedStudents: number } } }).telemetry.sync.unsyncedStudents, 1)
    assert.equal(typeof timerState.callback, 'function')

    nowMs += 20_001
    timerState.callback?.()
    await new Promise((resolve) => originalSetTimeout(resolve, 0))

    const persisted = storeState.store.s1?.data as {
      telemetry?: {
        sync?: {
          unsyncedStudents?: number
        }
      }
    }
    assert.equal(persisted.telemetry?.sync?.unsyncedStudents, 0)
  } finally {
    Date.now = originalDateNow
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
  }
})

void test('event route caps distinct unsynced student ids per session', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/video-sync/:sessionId/event']
  assert.equal(typeof handler, 'function')

  let lastResponse = createResponse()
  for (let index = 0; index < 205; index += 1) {
    lastResponse = createResponse()
    await handler?.(
      {
        params: { sessionId: 's1' },
        body: { type: 'unsync', studentId: `student-${index}`, driftSec: 0.5 },
      },
      lastResponse,
    )
    assert.equal(lastResponse.statusCode, 200)
  }

  const telemetry = (lastResponse.body as { telemetry: { sync: { unsyncedStudents: number } } }).telemetry
  assert.equal(telemetry.sync.unsyncedStudents, 200)
})

void test('event route ignores telemetry.error writes outside load-failure events', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/video-sync/:sessionId/event']
  assert.equal(typeof handler, 'function')

  const response = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: {
        type: 'unsync',
        studentId: 'student-a',
        errorCode: 'PLAYER_BROKEN',
        errorMessage: 'student should not be able to overwrite persisted error state',
      },
    },
    response,
  )

  assert.equal(response.statusCode, 200)
  const telemetry = (response.body as { telemetry: { error: { code: string | null; message: string | null } } }).telemetry
  assert.deepEqual(telemetry.error, { code: null, message: null })
})

void test('event route clamps load-failure telemetry.error fields before persisting', async () => {
  const app = createMockApp()
  const ws = createMockWs() as unknown as WsRouter
  const storeState = createSessionStore({ s1: createVideoSyncSession('s1') })

  setupVideoSyncRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/video-sync/:sessionId/event']
  assert.equal(typeof handler, 'function')

  const longCode = `  ${'C'.repeat(80)}  `
  const longMessage = `  ${'M'.repeat(300)}  `

  const response = createResponse()
  await handler?.(
    {
      params: { sessionId: 's1' },
      body: {
        type: 'load-failure',
        errorCode: longCode,
        errorMessage: longMessage,
      },
    },
    response,
  )

  assert.equal(response.statusCode, 200)
  const telemetry = (response.body as {
    telemetry: {
      error: { code: string | null; message: string | null }
      sync: { lastCorrectionResult: string }
    }
  }).telemetry
  assert.equal(telemetry.error.code, 'C'.repeat(64))
  assert.equal(telemetry.error.message, 'M'.repeat(256))
  assert.equal(telemetry.sync.lastCorrectionResult, 'failed')
})
