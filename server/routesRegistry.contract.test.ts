import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function importTsModule<T>(relativePath: string): Promise<T> {
  const moduleUrl = pathToFileURL(join(__dirname, relativePath)).href
  return (await import(moduleUrl)) as T
}

void test('status route registers and serves a status payload', async () => {
  const module = await importTsModule<{ registerStatusRoute: (options: {
    app: { get(path: string, handler: (_req: unknown, res: MockResponse) => void | Promise<void>): void }
    sessions: {
      getAll(): Promise<Array<{ id: string; type: string; created: number; lastActivity: number; data: Record<string, unknown> }>>
      ttlMs?: number
    }
    ws: { wss: { clients: Set<{ sessionId?: string; readyState: number }> } }
    sessionTtl: number
    valkeyUrl: string | null
  }) => void }>('routes/statusRoute.ts')

  const handlers = new Map<string, (_req: unknown, res: MockResponse) => void | Promise<void>>()
  const app = {
    get(path: string, handler: (_req: unknown, res: MockResponse) => void | Promise<void>) {
      handlers.set(path, handler)
    },
  }

  module.registerStatusRoute({
    app,
    sessions: {
      async getAll() {
        return []
      },
      ttlMs: 60_000,
    },
    ws: { wss: { clients: new Set() } },
    sessionTtl: 60_000,
    valkeyUrl: null,
  })

  const handler = handlers.get('/api/status')
  assert.ok(handler, 'Expected /api/status to be registered')

  const res = createMockResponse()
  await handler?.({}, res)
  assert.equal(res.statusCode, 200)
  const payload = res.jsonBody as { sessions?: { count?: number } } | null
  assert.equal(payload?.sessions?.count, 0)
})

void test('persistent routes register expected endpoints and cookie parser', async () => {
  const module = await importTsModule<{
    registerPersistentSessionRoutes: (options: {
      app: {
        get(path: string, handler: unknown): void
        post(path: string, handler: unknown): void
      }
      sessions: { get(id: string): Promise<unknown | null> }
    }) => void
    parsePersistentSessionsCookie: (cookieValue: unknown, context?: string) => {
      sessions: Array<{ key: string; teacherCode: unknown }>
      corrupted: boolean
      error: string | null
    }
  }>('routes/persistentSessionRoutes.ts')

  const parsed = module.parsePersistentSessionsCookie(JSON.stringify([{ key: 'raffle:abc', teacherCode: 'secret' }]))
  assert.equal(parsed.corrupted, false)
  assert.equal(parsed.sessions.length, 1)
  assert.equal(parsed.sessions[0]?.key, 'raffle:abc')

  const getPaths: string[] = []
  const postPaths: string[] = []
  const app = {
    get(path: string) {
      getPaths.push(path)
    },
    post(path: string) {
      postPaths.push(path)
    },
  }

  module.registerPersistentSessionRoutes({
    app,
    sessions: {
      async get() {
        return null
      },
    },
  })

  assert.ok(getPaths.includes('/api/persistent-session/list'))
  assert.ok(getPaths.includes('/api/persistent-session/:hash'))
  assert.ok(getPaths.includes('/api/persistent-session/:hash/teacher-code'))
  assert.ok(postPaths.includes('/api/persistent-session/create'))
  assert.ok(postPaths.includes('/api/persistent-session/authenticate'))
})

void test('activity registry exports expected API surface', async () => {
  const module = await importTsModule<{
    getAllowedActivities: () => string[]
    isValidActivity: (activityName: string) => boolean
    initializeActivityRegistry: () => Promise<void>
    registerActivityRoutes: (app: unknown, sessions: unknown, ws: unknown) => Promise<void>
  }>('activities/activityRegistry.ts')

  assert.equal(typeof module.getAllowedActivities, 'function')
  assert.equal(typeof module.isValidActivity, 'function')
  assert.equal(typeof module.initializeActivityRegistry, 'function')
  assert.equal(typeof module.registerActivityRoutes, 'function')

  await module.registerActivityRoutes({}, {}, {})
  const activities = module.getAllowedActivities()
  assert.ok(Array.isArray(activities))
  assert.equal(typeof module.isValidActivity('raffle'), 'boolean')
})

interface MockResponse {
  statusCode: number
  jsonBody: Record<string, unknown> | null
  status(code: number): MockResponse
  json(payload: Record<string, unknown>): void
}

function createMockResponse(): MockResponse {
  return {
    statusCode: 200,
    jsonBody: null,
    status(code: number): MockResponse {
      this.statusCode = code
      return this
    },
    json(payload: Record<string, unknown>): void {
      this.jsonBody = payload
    },
  }
}
