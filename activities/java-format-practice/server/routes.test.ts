import assert from 'node:assert/strict'
import test from 'node:test'
import setupJavaFormatPracticeRoutes from './routes.js'
import type { SessionRecord } from 'activebits-server/core/sessions.js'

type Handler = (req: { params: Record<string, string>; body?: unknown; cookies?: Record<string, unknown> }, res: MockResponse) => void | Promise<void>

class MockResponse {
  statusCode = 200
  body: unknown = null
  cookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = []
  status(code: number): this { this.statusCode = code; return this }
  cookie(name: string, value: string, options: Record<string, unknown>): void { this.cookies.push({ name, value, options }) }
  json(body: unknown): void { this.body = body }
}

void test('Java Format creation issues a manager cookie and manager routes reject a missing or wrong-session cookie', async () => {
  const routes = new Map<string, Handler>()
  const records = new Map<string, SessionRecord>()
  const app = {
    post(path: string, handler: Handler) { routes.set(`POST ${path}`, handler) },
    get(path: string, handler: Handler) { routes.set(`GET ${path}`, handler) },
  }
  const sessions = {
    get: async (id: string) => records.get(id) ?? null,
    set: async (id: string, record: SessionRecord) => { records.set(id, record) },
  }
  const ws = { wss: { clients: new Set(), close() {} }, register() {} }
  setupJavaFormatPracticeRoutes(app, sessions as never, ws as never)

  const create = routes.get('POST /api/java-format-practice/create')
  const difficulty = routes.get('POST /api/java-format-practice/:sessionId/difficulty')
  assert.ok(create)
  assert.ok(difficulty)
  const created = new MockResponse()
  await create({ params: {} }, created)
  const sessionId = (created.body as { id: string }).id
  const managerCookie = created.cookies[0]
  assert.ok(managerCookie)
  assert.equal(managerCookie.options.httpOnly, true)

  const denied = new MockResponse()
  await difficulty({ params: { sessionId }, body: { difficulty: 'advanced' } }, denied)
  assert.equal(denied.statusCode, 403)

  const allowed = new MockResponse()
  await difficulty({ params: { sessionId }, body: { difficulty: 'advanced' }, cookies: { [managerCookie.name]: managerCookie.value } }, allowed)
  assert.equal(allowed.statusCode, 200)
  assert.deepEqual(allowed.body, { success: true, difficulty: 'advanced' })

  const wrongSession = new MockResponse()
  await difficulty({ params: { sessionId: 'wrong-session' }, body: { difficulty: 'advanced' }, cookies: { [managerCookie.name]: managerCookie.value } }, wrongSession)
  assert.equal(wrongSession.statusCode, 404)
})
