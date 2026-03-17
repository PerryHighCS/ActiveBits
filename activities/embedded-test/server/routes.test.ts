import { acceptEntryParticipant } from 'activebits-server/core/acceptedEntryParticipants.js'
import type { SessionRecord, SessionStore } from 'activebits-server/core/sessions.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import type { ActiveBitsWebSocket, WsConnectionHandler, WsRouter } from '../../../types/websocket.js'
import setupEmbeddedTestRoutes from './routes.js'

interface RouteRequest {
  params: Record<string, string | undefined>
}

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): void
}

type RouteHandler = (req: RouteRequest, res: JsonResponse) => Promise<void> | void

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
  const handlers: { get: Record<string, RouteHandler>; post: Record<string, RouteHandler> } = {
    get: {},
    post: {},
  }

  return {
    handlers,
    get(path: string, handler: RouteHandler) {
      handlers.get[path] = handler
    },
    post(path: string, handler: RouteHandler) {
      handlers.post[path] = handler
    },
  }
}

function createMockWs() {
  const registered: Record<string, WsConnectionHandler> = {}
  const ws: WsRouter & { registered: Record<string, WsConnectionHandler> } = {
    registered,
    wss: {
      clients: new Set<ActiveBitsWebSocket>(),
      close() {},
    },
    register(path: string, handler: WsConnectionHandler) {
      registered[path] = handler
    },
  }
  return ws
}

function createSessionStore(initial: Record<string, SessionRecord>) {
  const store = { ...initial }
  const sessions: SessionStore = {
    async get(id: string) {
      return store[id] ?? null
    },
    async set(id: string, session: SessionRecord) {
      store[id] = session
    },
    async delete(id: string) {
      const existed = Boolean(store[id])
      delete store[id]
      return existed
    },
    async touch(id: string) {
      return Boolean(store[id])
    },
    async getAll() {
      return Object.values(store)
    },
    async getAllIds() {
      return Object.keys(store)
    },
    cleanup() {},
    async close() {},
    subscribeToBroadcast() {},
  }

  return { store, sessions }
}

class MockSocket implements ActiveBitsWebSocket {
  readyState = 1
  sessionId?: string | null
  studentId?: string | null
  sent: string[] = []
  closeCalls: Array<{ code?: number; reason?: string }> = []
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>()

  send(data: string): void {
    this.sent.push(data)
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    const existing = this.listeners.get(event) ?? []
    existing.push(listener)
    this.listeners.set(event, existing)
  }

  once(event: string, listener: (...args: unknown[]) => void): void {
    this.on(event, listener)
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason })
    this.readyState = 3
  }

  terminate(): void {
    this.readyState = 3
  }

  ping(_data?: string | Buffer | ArrayBuffer | Buffer[], _mask?: boolean, cb?: (err: Error) => void): void {
    cb?.(new Error('not implemented'))
  }

  emit(event: string, ...args: unknown[]): void {
    const handlers = this.listeners.get(event) ?? []
    for (const handler of handlers) {
      handler(...args)
    }
  }
}

function createEmbeddedTestSession(id: string): SessionRecord {
  return {
    id,
    type: 'embedded-test',
    created: Date.now(),
    lastActivity: Date.now(),
    data: {
      students: [],
      messages: [],
    },
  }
}

void test('embedded-test create route initializes empty session state', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const storeState = createSessionStore({})
  setupEmbeddedTestRoutes(app, storeState.sessions, ws)

  const handler = app.handlers.post['/api/embedded-test/create']
  assert.equal(typeof handler, 'function')

  const res = createResponse()
  await handler?.({ params: {} }, res)

  assert.equal(res.statusCode, 200)
  const body = res.body as { id?: string }
  assert.equal(typeof body.id, 'string')
  assert.deepEqual((storeState.store[body.id as string]?.data as { students: unknown[]; messages: unknown[] }), {
    students: [],
    messages: [],
  })
})

void test('embedded-test websocket connects accepted-entry student and broadcasts chat updates', async () => {
  const app = createMockApp()
  const ws = createMockWs()
  const session = createEmbeddedTestSession('s1')
  acceptEntryParticipant(session, {
    participantId: 'student-1',
    displayName: 'Ada Lovelace',
  })
  const storeState = createSessionStore({ s1: session })
  setupEmbeddedTestRoutes(app, storeState.sessions, ws)

  const handler = ws.registered['/ws/embedded-test']
  assert.equal(typeof handler, 'function')

  const managerSocket = new MockSocket()
  const studentSocket = new MockSocket()
  ws.wss.clients.add(managerSocket)
  ws.wss.clients.add(studentSocket)

  if (handler) {
    await Promise.resolve(handler(managerSocket, new URLSearchParams({ sessionId: 's1', role: 'instructor' }), ws.wss))
    await Promise.resolve(handler(studentSocket, new URLSearchParams({ sessionId: 's1', studentId: 'student-1' }), ws.wss))
  }

  studentSocket.emit('message', JSON.stringify({ type: 'chat-message', text: 'hello manager' }))
  await new Promise((resolve) => setTimeout(resolve, 0))

  const managerPayloads = managerSocket.sent.map(
    (entry) =>
      JSON.parse(entry) as {
        payload?: {
          type?: string
          participants?: Array<{
            studentId: string
            name: string
            joinedAt: number
            lastSeenAt: number
            connected: boolean
          }>
          messages?: Array<{ text: string }>
        }
      },
  )
  const latest = managerPayloads.at(-1)?.payload
  assert.equal(latest?.type, 'embedded-test-state')
  assert.equal(latest?.participants?.length, 1)
  assert.equal(latest?.participants?.[0]?.studentId, 'student-1')
  assert.equal(latest?.participants?.[0]?.name, 'Ada Lovelace')
  assert.equal(typeof latest?.participants?.[0]?.joinedAt, 'number')
  assert.equal(typeof latest?.participants?.[0]?.lastSeenAt, 'number')
  assert.equal(latest?.participants?.[0]?.connected, true)
  assert.equal(latest?.messages?.[0]?.text, 'hello manager')
})