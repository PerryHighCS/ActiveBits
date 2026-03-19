import test from 'node:test'
import assert from 'node:assert/strict'
import { setupPersistentSessionWs } from './core/persistentSessionWs.js'
import type { SessionRecord } from './core/sessions.js'
import {
  cleanupPersistentSession,
  generatePersistentHash,
  getOrCreateActivePersistentSession,
  initializePersistentStorage,
  updatePersistentSessionUrlState,
} from './core/persistentSessions.js'

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

void test('persistent session websocket bootstraps started sessions with canonical selected options', async (t) => {
  const originalSetTimeout = global.setTimeout
  global.setTimeout = (((handler: Parameters<typeof setTimeout>[0]) => {
    if (typeof handler === 'function') {
      handler()
    }
    return 0 as unknown as NodeJS.Timeout
  }) as typeof setTimeout)
  t.after(() => {
    global.setTimeout = originalSetTimeout
  })

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