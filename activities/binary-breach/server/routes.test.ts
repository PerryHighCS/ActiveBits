import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionRecord, SessionStore } from 'activebits-server/core/sessions.js'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'
import setupBinaryBreachRoutes from './routes.js'

interface TestResponse {
  statusCode: number
  payload: unknown
  status(code: number): TestResponse
  json(payload: unknown): void
}

interface TestRequest {
  params: Record<string, string | undefined>
  body?: unknown
}

type RouteHandler = (req: TestRequest, res: TestResponse) => void | Promise<void>

class TestApp {
  readonly getRoutes = new Map<string, RouteHandler>()
  readonly postRoutes = new Map<string, RouteHandler>()

  get(path: string, handler: RouteHandler): void {
    this.getRoutes.set(path, handler)
  }

  post(path: string, handler: RouteHandler): void {
    this.postRoutes.set(path, handler)
  }
}

function createResponse(): TestResponse {
  return {
    statusCode: 200,
    payload: null,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.payload = payload
    },
  }
}

function cloneSession(session: SessionRecord): SessionRecord {
  return JSON.parse(JSON.stringify(session)) as SessionRecord
}

function createSessionStore(): SessionStore {
  const records = new Map<string, SessionRecord>()
  return {
    async get(id: string) {
      const session = records.get(id)
      return session ? cloneSession(session) : null
    },
    async set(id: string, session: SessionRecord) {
      records.set(id, cloneSession(session))
    },
    async delete(id: string) {
      return records.delete(id)
    },
    async touch() {
      return true
    },
    async getAll() {
      return Array.from(records.values()).map(cloneSession)
    },
    async getAllIds() {
      return Array.from(records.keys())
    },
    cleanup() {},
    async close() {},
  }
}

function createWsRouter(): WsRouter {
  return {
    wss: {
      clients: new Set<ActiveBitsWebSocket>(),
      close(callback?: () => void) {
        callback?.()
      },
    },
    register() {},
  }
}

void test('creates a Binary Breach session and returns manager-visible state', async () => {
  const app = new TestApp()
  const sessions = createSessionStore()
  setupBinaryBreachRoutes(app, sessions, createWsRouter())

  const createResponsePayload = createResponse()
  const createRoute = app.postRoutes.get('/api/binary-breach/create')
  assert.ok(createRoute)
  await createRoute({ params: {} }, createResponsePayload)

  const created = createResponsePayload.payload as { id: string }
  assert.equal(typeof created.id, 'string')

  const stateResponse = createResponse()
  const stateRoute = app.getRoutes.get('/api/binary-breach/:sessionId/state')
  assert.ok(stateRoute)
  await stateRoute({ params: { sessionId: created.id } }, stateResponse)

  assert.equal(stateResponse.statusCode, 200)
  assert.deepEqual((stateResponse.payload as { students: unknown[] }).students, [])
})

void test('registers a student and validates an answer against the stored challenge', async () => {
  const app = new TestApp()
  const sessions = createSessionStore()
  setupBinaryBreachRoutes(app, sessions, createWsRouter())

  const createResponsePayload = createResponse()
  await app.postRoutes.get('/api/binary-breach/create')?.({ params: {} }, createResponsePayload)
  const sessionId = (createResponsePayload.payload as { id: string }).id

  const registerResponse = createResponse()
  await app.postRoutes.get('/api/binary-breach/:sessionId/student/register')?.({
    params: { sessionId },
    body: { studentName: 'Ada' },
  }, registerResponse)

  assert.equal(registerResponse.statusCode, 200)
  const registered = registerResponse.payload as {
    studentId: string
    challenge: { type: string; decimal?: number; binary?: string; answer?: string[]; values?: string[] }
  }
  assert.equal(typeof registered.studentId, 'string')

  const answer = registered.challenge.type === 'binary-to-decimal'
    ? { decimal: String(registered.challenge.decimal) }
    : registered.challenge.type === 'decimal-to-binary'
      ? { binary: registered.challenge.binary }
      : registered.challenge.type === 'order-binary'
        ? { values: registered.challenge.answer }
        : { choice: 'left' }

  const answerResponse = createResponse()
  await app.postRoutes.get('/api/binary-breach/:sessionId/student/answer')?.({
    params: { sessionId },
    body: {
      studentName: 'Ada',
      studentId: registered.studentId,
      answer,
    },
  }, answerResponse)

  assert.equal(answerResponse.statusCode, 200)
  const payload = answerResponse.payload as { progress: { attempts: number } }
  assert.equal(payload.progress.attempts, 1)
})
