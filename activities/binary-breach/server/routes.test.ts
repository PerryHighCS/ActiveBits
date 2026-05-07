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

void test('applies manager settings to student missions and hint availability', async () => {
  const app = new TestApp()
  const sessions = createSessionStore()
  setupBinaryBreachRoutes(app, sessions, createWsRouter())

  const createResponsePayload = createResponse()
  await app.postRoutes.get('/api/binary-breach/create')?.({ params: {} }, createResponsePayload)
  const sessionId = (createResponsePayload.payload as { id: string }).id

  const settingsResponse = createResponse()
  await app.postRoutes.get('/api/binary-breach/:sessionId/settings')?.({
    params: { sessionId },
    body: {
      maxBits: 4,
      missionLength: 3,
      challengeTypes: ['decimal-to-binary'],
      hintsEnabled: false,
      placeValueSupport: 'hidden',
    },
  }, settingsResponse)

  assert.equal(settingsResponse.statusCode, 200)
  assert.deepEqual((settingsResponse.payload as { settings: unknown }).settings, {
    maxBits: 4,
    missionLength: 3,
    challengeTypes: ['decimal-to-binary'],
    timerMode: 'off',
    hintsEnabled: false,
    placeValueSupport: 'hidden',
  })

  const registerResponse = createResponse()
  await app.postRoutes.get('/api/binary-breach/:sessionId/student/register')?.({
    params: { sessionId },
    body: { studentName: 'Grace' },
  }, registerResponse)

  assert.equal(registerResponse.statusCode, 200)
  const registered = registerResponse.payload as {
    studentId: string
    challenge: { type: string; maxBits: number }
    progress: { completed: boolean }
    settings: { missionLength: number; hintsEnabled: boolean; placeValueSupport: string }
  }
  assert.equal(registered.challenge.type, 'decimal-to-binary')
  assert.equal(registered.challenge.maxBits, 4)
  assert.equal(registered.settings.missionLength, 3)
  assert.equal(registered.settings.hintsEnabled, false)
  assert.equal(registered.settings.placeValueSupport, 'hidden')

  const hintResponse = createResponse()
  await app.postRoutes.get('/api/binary-breach/:sessionId/student/hint')?.({
    params: { sessionId },
    body: { studentName: 'Grace', studentId: registered.studentId },
  }, hintResponse)

  assert.equal(hintResponse.statusCode, 400)
})

void test('keeps a current student challenge answerable after manager settings change', async () => {
  const app = new TestApp()
  const sessions = createSessionStore()
  setupBinaryBreachRoutes(app, sessions, createWsRouter())

  const createResponsePayload = createResponse()
  await app.postRoutes.get('/api/binary-breach/create')?.({ params: {} }, createResponsePayload)
  const sessionId = (createResponsePayload.payload as { id: string }).id

  const registerResponse = createResponse()
  await app.postRoutes.get('/api/binary-breach/:sessionId/student/register')?.({
    params: { sessionId },
    body: { studentName: 'Katherine' },
  }, registerResponse)

  const registered = registerResponse.payload as {
    studentId: string
    challenge: {
      id: string
      type: string
      decimal?: number
      binary?: string
      answer?: string[] | 'left' | 'right'
    }
  }

  const settingsResponse = createResponse()
  await app.postRoutes.get('/api/binary-breach/:sessionId/settings')?.({
    params: { sessionId },
    body: {
      maxBits: 8,
      missionLength: 5,
      challengeTypes: ['binary-to-decimal'],
      hintsEnabled: true,
      placeValueSupport: 'visible',
    },
  }, settingsResponse)
  assert.equal(settingsResponse.statusCode, 200)

  const answer = registered.challenge.type === 'binary-to-decimal'
    ? { decimal: String(registered.challenge.decimal) }
    : registered.challenge.type === 'decimal-to-binary'
      ? { binary: registered.challenge.binary }
      : registered.challenge.type === 'order-binary'
        ? { values: registered.challenge.answer }
        : { choice: registered.challenge.answer }

  const answerResponse = createResponse()
  await app.postRoutes.get('/api/binary-breach/:sessionId/student/answer')?.({
    params: { sessionId },
    body: {
      studentName: 'Katherine',
      studentId: registered.studentId,
      challengeId: registered.challenge.id,
      answer,
    },
  }, answerResponse)

  assert.equal(answerResponse.statusCode, 200)
  const payload = answerResponse.payload as {
    feedback: { correct: boolean }
    challenge: { type: string; maxBits: number }
    progress: { attempts: number; incorrect: number }
  }
  assert.equal(payload.feedback.correct, true)
  assert.equal(payload.progress.attempts, 1)
  assert.equal(payload.progress.incorrect, 0)
  assert.equal(payload.challenge.type, 'binary-to-decimal')
  assert.equal(payload.challenge.maxBits, 8)
})
