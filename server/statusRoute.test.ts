import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import type http from 'node:http'
import express from 'express'
import { registerStatusRoute } from './routes/statusRoute.js'

interface WsClient {
  sessionId?: string
  readyState: number
}

interface ValkeyClientMock {
  pttl: (_key: string) => Promise<number>
  ping: () => Promise<string>
  dbsize: () => Promise<number>
  call: (_command: string, _section: string) => Promise<string>
}

interface StatusSessionsMock {
  getAll: () => Promise<Array<{ id: string; type?: string; created?: number; lastActivity?: number; data: Record<string, unknown> }>>
  ttlMs?: number
  valkeyStore?: {
    ttlMs?: number
    client: ValkeyClientMock
  }
}

interface StatusPayload {
  sessions: {
    count: number
    showSessionIds: boolean
    list: Array<{
      id?: string
      type?: string
      socketCount?: number
      ttlRemainingMs?: number
      expiresAt?: string
    }>
  }
  valkey:
    | null
    | {
        ping?: string
        dbsize?: number
        memory?: Record<string, string>
        error?: string
      }
  storage: {
    mode: string
    ttlMs: number
  }
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

function createWsMock(clients: WsClient[] = []): { wss: { clients: Set<WsClient> } } {
  return {
    wss: {
      clients: new Set(clients),
    },
  }
}

async function startStatusServer(
  t: TestContext,
  {
    sessions,
    ws,
    sessionTtl = 60 * 60 * 1000,
    valkeyUrl = null,
  }: {
    sessions: StatusSessionsMock
    ws: { wss: { clients: Set<WsClient> } }
    sessionTtl?: number
    valkeyUrl?: string | null
  },
): Promise<string> {
  const app = express()
  registerStatusRoute({ app, sessions, ws, sessionTtl, valkeyUrl })

  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })

  t.after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  })

  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Failed to determine test server address')
  }
  return `http://127.0.0.1:${address.port}`
}

void test('status endpoint returns session info in memory mode', async (t) => {
  const now = Date.now()
  const sessions: StatusSessionsMock = {
    getAll: async () => [
      {
        id: 'abc',
        type: 'raffle',
        created: now - 5000,
        lastActivity: now - 1000,
        data: {},
      },
    ],
    ttlMs: 60 * 60 * 1000,
  }
  const ws = createWsMock([{ sessionId: 'abc', readyState: 1 }])

  const baseUrl = await startStatusServer(t, { sessions, ws, sessionTtl: sessions.ttlMs, valkeyUrl: null })
  const res = await fetch(`${baseUrl}/api/status`)
  assert.equal(res.status, 200)
  const body = await readJson<StatusPayload>(res)

  assert.equal(body.sessions.count, 1)
  assert.equal(body.sessions.list.length, 1)
  const session = body.sessions.list[0]
  assert.ok(session)
  assert.equal(session.id, 'abc')
  assert.equal(session.type, 'raffle')
  assert.equal(session.socketCount, 1)
  assert.equal(body.sessions.showSessionIds, true)
  assert.equal(body.valkey, null)
})

void test('status endpoint masks session ids in production', async (t) => {
  const prevEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  t.after(() => {
    process.env.NODE_ENV = prevEnv
  })

  const sessions: StatusSessionsMock = {
    getAll: async () => [
      {
        id: 'hidden-session',
        type: 'raffle',
        created: Date.now(),
        lastActivity: Date.now(),
        data: {},
      },
    ],
    ttlMs: 1000,
  }
  const ws = createWsMock()
  const baseUrl = await startStatusServer(t, { sessions, ws, sessionTtl: sessions.ttlMs, valkeyUrl: null })
  const res = await fetch(`${baseUrl}/api/status`)
  const body = await readJson<StatusPayload>(res)
  assert.equal(body.sessions.showSessionIds, false)
  const maskedSession = body.sessions.list[0]
  assert.ok(maskedSession)
  assert.equal(maskedSession.id, undefined)
})

void test('status endpoint reports Valkey TTLs and expiry data', async (t) => {
  const now = Date.now()
  const sessions: StatusSessionsMock = {
    getAll: async () => [
      {
        id: 'ttl-session',
        type: 'python-list-practice',
        created: now - 10000,
        lastActivity: now - 5000,
        data: {},
      },
    ],
    valkeyStore: {
      ttlMs: 90_000,
      client: {
        pttl: async () => 5000,
        ping: async () => 'PONG',
        dbsize: async () => 1,
        call: async () => 'used_memory:1024\r\nused_memory_rss:2048\r\n',
      },
    },
  }
  const ws = createWsMock()
  const baseUrl = await startStatusServer(t, { sessions, ws, sessionTtl: 90_000, valkeyUrl: 'redis://valkey:6379' })
  const res = await fetch(`${baseUrl}/api/status`)
  const body = await readJson<StatusPayload>(res)
  const ttlSession = body.sessions.list[0]
  assert.ok(ttlSession)
  assert.equal(ttlSession.ttlRemainingMs, 5000)
  assert.ok(typeof ttlSession.expiresAt === 'string')
  assert.ok(Date.parse(ttlSession.expiresAt) > Date.now())
  assert.ok(body.valkey)
  assert.equal(body.valkey.dbsize, 1)
  assert.equal(body.valkey.memory?.used_memory, '1024')
  assert.equal(body.storage.mode, 'valkey')
  assert.equal(body.storage.ttlMs, 90_000)
})

void test('status endpoint falls back to sessionTtl when valkeyStore ttlMs is undefined', async (t) => {
  const sessions: StatusSessionsMock = {
    getAll: async () => [],
    valkeyStore: {
      client: {
        pttl: async () => 0,
        ping: async () => 'PONG',
        dbsize: async () => 0,
        call: async () => '',
      },
    },
  }
  const ws = createWsMock()
  const baseUrl = await startStatusServer(t, { sessions, ws, sessionTtl: 123_000, valkeyUrl: 'redis://valkey:6379' })
  const res = await fetch(`${baseUrl}/api/status`)
  const body = await readJson<StatusPayload>(res)

  assert.equal(body.storage.mode, 'valkey')
  assert.equal(body.storage.ttlMs, 123_000)
})

void test('status endpoint handles Valkey errors gracefully', async (t) => {
  const sessions: StatusSessionsMock = {
    getAll: async () => [],
    valkeyStore: {
      ttlMs: 60_000,
      client: {
        pttl: async () => {
          throw new Error('pttl failure')
        },
        ping: async () => {
          throw new Error('boom')
        },
        dbsize: async () => 0,
        call: async () => '',
      },
    },
  }
  const ws = createWsMock()
  const baseUrl = await startStatusServer(t, { sessions, ws, sessionTtl: 60_000, valkeyUrl: 'redis://valkey:6379' })
  const res = await fetch(`${baseUrl}/api/status`)
  const body = await readJson<StatusPayload>(res)
  assert.equal(body.sessions.count, 0)
  assert.ok(body.valkey)
  assert.equal(body.valkey.error, 'boom')
})
