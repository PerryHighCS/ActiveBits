import test, { type TestContext } from 'node:test'
import assert from 'node:assert'
import http from 'node:http'
import { WebSocket } from 'ws'
import { createSessionStore, createSession, type SessionRecord } from './core/sessions.js'
import { type ValkeySessionStore } from './core/valkeyStore.js'
import { createWsRouter } from './core/wsRouter.js'
import { EMBEDDED_CHILD_SESSION_PREFIX } from '../types/session.js'
import { registerSessionNormalizer, resetSessionNormalizersForTests } from './core/sessionNormalization.js'
import { listenForTest } from './testPortBinding.js'
import { normalizeSyncDeckSessionData } from '../activities/syncdeck/server/routes.js'

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function valkeyStoreForTest(records: Map<string, SessionRecord>, touches: string[], ttlMs = 1_000): ValkeySessionStore {
  return {
    ttlMs,
    async get(id: string) {
      const session = records.get(id)
      return session ? structuredClone(session) : null
    },
    async set(id: string, session: SessionRecord) {
      records.set(id, structuredClone(session))
    },
    async delete(id: string) {
      return records.delete(id)
    },
    async touch(id: string) {
      const session = records.get(id)
      if (!session) return false
      touches.push(id)
      session.lastActivity = Date.now()
      return true
    },
    async getAll() {
      return Array.from(records.values()).map((session) => structuredClone(session))
    },
    async getAllIds() {
      return Array.from(records.keys())
    },
    async refreshSessionExpiry() {
      return null
    },
    async consumeSessionDataToken() {
      return null
    },
    async close() {},
    subscribeToBroadcast() {},
    initializePubSub() {},
    async publishBroadcast() {},
  } as unknown as ValkeySessionStore
}

void test('session-store selection is logged with stable structured fields', async (t) => {
  const previousInfo = console.info
  const logs: string[] = []
  console.info = (...args: unknown[]) => { logs.push(args.map(String).join(' ')) }
  t.after(() => {
    console.info = previousInfo
  })

  const inMemoryStore = createSessionStore(null)
  const valkeyStore = createSessionStore('redis://test', 1_000, valkeyStoreForTest(new Map(), []))
  await inMemoryStore.close()
  await valkeyStore.close()

  assert.deepEqual(logs.map((message) => JSON.parse(message)), [
    { component: 'session-store', event: 'store-selected', store: 'in-memory', reason: 'valkey-url-not-configured' },
    { component: 'session-store', event: 'store-selected', store: 'valkey', cacheEnabled: true },
  ])
})

void test('inactive sessions expire', async () => {
  const sessions = createSessionStore(null, 50)
  const session = await createSession(sessions)
  await wait(60)
  sessions.cleanup()
  assert.strictEqual(await sessions.get(session.id), null)
})

void test('active sessions persist', async () => {
  const sessions = createSessionStore(null, 50)
  const session = await createSession(sessions)
  await wait(40)
  await sessions.touch(session.id)
  await wait(40)
  sessions.cleanup()
  assert.ok(await sessions.get(session.id))
  await wait(60)
  sessions.cleanup()
  assert.strictEqual(await sessions.get(session.id), null)
})

void test('keepalive refreshes session activity', async (t: TestContext) => {
  const sessions = createSessionStore(null, 50)
  const session = await createSession(sessions)
  const server = http.createServer()
  const router = createWsRouter(server, sessions)
  router.register('/ws', (socket, query) => {
    socket.sessionId = query.get('sessionId')
  })

  if (!await listenForTest(t, server)) return
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Failed to bind test server')
  }
  const ws = new WebSocket(`ws://localhost:${address.port}/ws?sessionId=${session.id}`)
  await new Promise<void>((resolve) => ws.once('open', () => resolve()))

  await wait(40)
  await new Promise<void>((resolve) => {
    ws.once('pong', () => resolve())
    ws.ping()
  })
  await wait(20)
  sessions.cleanup()
  assert.ok(await sessions.get(session.id))

  await wait(60)
  sessions.cleanup()
  assert.strictEqual(await sessions.get(session.id), null)

  ws.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

void test('registered session normalizers populate activity defaults', async (t) => {
  resetSessionNormalizersForTests()
  registerSessionNormalizer('test-activity', (session) => {
    const typedSession = session as { data: { items?: unknown } }
    typedSession.data.items = Array.isArray(typedSession.data.items) ? typedSession.data.items : []
  })

  const sessions = createSessionStore(null, 100)
  t.after(async () => {
    await sessions.close()
    resetSessionNormalizersForTests()
  })

  const session = await createSession(sessions)
  session.type = 'test-activity'
  await sessions.set(session.id, session)

  const loaded = await sessions.get(session.id)
  assert.ok(loaded)
  const loadedItems = (loaded.data as { items?: unknown }).items
  assert.ok(Array.isArray(loadedItems))
  assert.equal(loadedItems.length, 0)
})

void test('SyncDeck normalization preserves linked-session keepalive records', async (t) => {
  resetSessionNormalizersForTests()
  registerSessionNormalizer('syncdeck', (session) => {
    session.data = normalizeSyncDeckSessionData(session.data)
  })
  const sessions = createSessionStore(null, 1_000)
  t.after(async () => {
    await sessions.close()
    resetSessionNormalizersForTests()
  })

  const linkedSession = await createSession(sessions)
  linkedSession.lastActivity = 1
  await sessions.set(linkedSession.id, linkedSession)

  const liveSession = await createSession(sessions)
  liveSession.type = 'syncdeck'
  liveSession.lastActivity = 1
  liveSession.data = { linkedSessionId: linkedSession.id }
  await sessions.set(liveSession.id, liveSession)

  assert.equal((await sessions.get(liveSession.id))?.data.linkedSessionId, linkedSession.id)
  assert.equal(await sessions.touch(liveSession.id), true)
  assert.ok((await sessions.get(linkedSession.id))!.lastActivity! > 1)
})

void test('embedded child session reads refresh the parent session activity timestamp', async (t) => {
  const sessions = createSessionStore(null, 1_000)
  t.after(async () => {
    await sessions.close()
  })

  const parentSession = await createSession(sessions)
  parentSession.type = 'syncdeck'
  parentSession.data = { embeddedActivities: {} }
  parentSession.lastActivity = 1
  await sessions.set(parentSession.id, parentSession)

  const childSession: SessionRecord = {
    id: `${EMBEDDED_CHILD_SESSION_PREFIX}${parentSession.id}:abc12:embedded-test`,
    type: 'embedded-test',
    created: 1,
    lastActivity: 1,
    data: {
      embeddedParentSessionId: parentSession.id,
    },
  }
  await sessions.set(childSession.id, childSession)

  const originalLastActivity = parentSession.lastActivity ?? 0
  const loadedChild = await sessions.get(childSession.id)
  assert.ok(loadedChild)
  assert.ok((parentSession.lastActivity ?? 0) > originalLastActivity)
})

void test('refreshing an embedded child session refreshes its parent activity and only accepts matching expiry', async (t) => {
  const sessions = createSessionStore(null, 1_000)
  t.after(async () => {
    await sessions.close()
  })
  const refreshSessionExpiry = sessions.refreshSessionExpiry
  assert.ok(refreshSessionExpiry)

  const parentSession = await createSession(sessions)
  parentSession.lastActivity = 1
  await sessions.set(parentSession.id, parentSession)
  const childSession: SessionRecord = {
    id: `${EMBEDDED_CHILD_SESSION_PREFIX}${parentSession.id}:abc12:embedded-test`,
    type: 'embedded-test',
    created: 1,
    lastActivity: 1,
    data: { embeddedParentSessionId: parentSession.id, expiresAt: 100 },
  }
  await sessions.set(childSession.id, childSession)

  assert.equal(await refreshSessionExpiry.call(sessions, 'missing-session', 100, 200, 1_000), null)
  assert.equal(await refreshSessionExpiry.call(sessions, childSession.id, 99, 200, 1_000), null)

  const refreshed = await refreshSessionExpiry.call(sessions, childSession.id, 100, 200, 1_000)
  assert.equal(refreshed?.data.expiresAt, 200)
  assert.ok((refreshed?.lastActivity ?? 0) > 1)
  const refreshedParent = await sessions.get(parentSession.id)
  assert.ok((refreshedParent?.lastActivity ?? 0) > 1)
})

void test('touching a session refreshes a linked session declared via data.linkedSessionId', async (t) => {
  const sessions = createSessionStore(null, 1_000)
  t.after(async () => {
    await sessions.close()
  })

  const linkedSession = await createSession(sessions)
  linkedSession.lastActivity = 1
  await sessions.set(linkedSession.id, linkedSession)

  const liveSession = await createSession(sessions)
  liveSession.lastActivity = 1
  liveSession.data = { linkedSessionId: linkedSession.id }
  await sessions.set(liveSession.id, liveSession)

  assert.equal(await sessions.touch(liveSession.id), true)

  const refreshedLinked = await sessions.get(linkedSession.id)
  assert.ok((refreshedLinked?.lastActivity ?? 0) > 1)
})

void test('touching a linked session refreshes exactly one hop', async (t) => {
  const sessions = createSessionStore(null, 1_000)
  t.after(async () => {
    await sessions.close()
  })

  const terminalSession = await createSession(sessions)
  terminalSession.lastActivity = 1
  await sessions.set(terminalSession.id, terminalSession)

  const linkedSession = await createSession(sessions)
  linkedSession.lastActivity = 1
  linkedSession.data = { linkedSessionId: terminalSession.id }
  await sessions.set(linkedSession.id, linkedSession)

  const liveSession = await createSession(sessions)
  liveSession.lastActivity = 1
  liveSession.data = { linkedSessionId: linkedSession.id }
  await sessions.set(liveSession.id, liveSession)

  assert.equal(await sessions.touch(liveSession.id), true)
  assert.ok(liveSession.lastActivity! > 1)
  assert.ok(linkedSession.lastActivity! > 1)
  assert.equal(terminalSession.lastActivity, 1)
})

void test('touching a two-record linked-session cycle completes', async (t) => {
  const sessions = createSessionStore(null, 1_000)
  t.after(async () => {
    await sessions.close()
  })

  const firstSession = await createSession(sessions)
  const secondSession = await createSession(sessions)
  firstSession.lastActivity = 1
  firstSession.data = { linkedSessionId: secondSession.id }
  secondSession.lastActivity = 1
  secondSession.data = { linkedSessionId: firstSession.id }
  await sessions.set(firstSession.id, firstSession)
  await sessions.set(secondSession.id, secondSession)

  assert.equal(await sessions.touch(firstSession.id), true)
  assert.ok(firstSession.lastActivity! > 1)
  assert.ok(secondSession.lastActivity! > 1)
})

void test('Valkey-backed linked touches refresh cached and uncached records exactly one hop', async (t) => {
  const records = new Map<string, SessionRecord>()
  const touches: string[] = []
  const sessions = createSessionStore('redis://test', 1_000, valkeyStoreForTest(records, touches))
  t.after(async () => {
    await sessions.close()
  })

  const terminalSession = await createSession(sessions)
  terminalSession.lastActivity = 1
  await sessions.set(terminalSession.id, terminalSession)
  const linkedSession = await createSession(sessions)
  linkedSession.lastActivity = 1
  linkedSession.data = { linkedSessionId: terminalSession.id }
  await sessions.set(linkedSession.id, linkedSession)
  const liveSession = await createSession(sessions)
  liveSession.lastActivity = 1
  liveSession.data = { linkedSessionId: linkedSession.id }
  await sessions.set(liveSession.id, liveSession)

  assert.equal(await sessions.touch(liveSession.id), true)
  await sessions.flushCache!()
  assert.deepEqual(touches.sort(), [linkedSession.id, liveSession.id].sort(), 'cached touches should flush the live and direct linked records to Valkey only')
  assert.ok((records.get(linkedSession.id)?.lastActivity ?? 0) > 1)
  assert.equal(records.get(terminalSession.id)?.lastActivity, 1)

  touches.length = 0
  sessions.cache!.invalidate(liveSession.id)
  sessions.cache!.invalidate(linkedSession.id)
  assert.equal(await sessions.touch(liveSession.id), true)
  assert.deepEqual(touches.sort(), [linkedSession.id, liveSession.id].sort(), 'uncached touches should directly refresh the live and direct linked records in Valkey only')
  assert.equal(records.get(terminalSession.id)?.lastActivity, 1)
})

void test('a linked session survives past its own ttl as long as the session pointing at it keeps getting touched', async (t) => {
  const sessions = createSessionStore(null, 200)
  t.after(async () => {
    await sessions.close()
  })

  const linkedSession = await createSession(sessions)
  const unlinkedControlSession = await createSession(sessions)
  const liveSession = await createSession(sessions)
  liveSession.data = { linkedSessionId: linkedSession.id }
  await sessions.set(liveSession.id, liveSession)

  await wait(125)
  await sessions.touch(liveSession.id)
  await wait(125)
  sessions.cleanup()

  const survivingIds = await sessions.getAllIds()
  assert.ok(survivingIds.includes(linkedSession.id), 'linked session should survive because the session pointing at it was touched')
  assert.ok(!survivingIds.includes(unlinkedControlSession.id), 'an untouched, unlinked session should not survive the same window')

  await wait(250)
  sessions.cleanup()
  assert.ok(!(await sessions.getAllIds()).includes(linkedSession.id))
})
