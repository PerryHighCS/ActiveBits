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

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function valkeyStoreForTest(records: Map<string, SessionRecord>, touches: string[], ttlMs = 1_000, gets: string[] = []): ValkeySessionStore {
  return {
    ttlMs,
    async get(id: string) {
      gets.push(id)
      const session = records.get(id)
      return session ? structuredClone(session) : null
    },
    async getStrict(id: string) {
      gets.push(id)
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

void test('session-store selection is logged with stable structured fields', async () => {
  const previousInfo = console.info
  const logs: string[] = []
  try {
    console.info = (...args: unknown[]) => { logs.push(args.map(String).join(' ')) }

    const inMemoryStore = createSessionStore(null)
    const valkeyStore = createSessionStore('redis://test', 1_000, valkeyStoreForTest(new Map(), []))
    await inMemoryStore.close()
    await valkeyStore.close()

    assert.deepEqual(logs.map((message) => JSON.parse(message)), [
      { component: 'session-store', event: 'store-selected', store: 'in-memory', reason: 'valkey-url-not-configured' },
      { component: 'session-store', event: 'store-selected', store: 'valkey', cacheEnabled: true },
    ])
  } finally {
    console.info = previousInfo
  }
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
  const { normalizeSyncDeckSessionData } = await import('../activities/syncdeck/server/routes.js')
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

void test('normalization re-attaches platform-owned auth state a normalizer would drop', async (t) => {
  const { normalizeSyncDeckSessionData } = await import('../activities/syncdeck/server/routes.js')
  resetSessionNormalizersForTests()
  registerSessionNormalizer('syncdeck', (session) => {
    // The real SyncDeck normalizer rebuilds `data` from an explicit key list and
    // does not carry `participantAuthTokens` / `activityCapabilities` forward.
    session.data = normalizeSyncDeckSessionData(session.data)
  })
  const sessions = createSessionStore(null, 1_000)
  t.after(async () => {
    await sessions.close()
    resetSessionNormalizersForTests()
  })

  const session = await createSession(sessions)
  session.type = 'syncdeck'
  session.data = {
    participantAuthTokens: { 'hash-1': 'student-1' },
    activityCapabilities: { 'cap-1': { id: 'cap-1', tokenHash: 'h', principalKind: 'manager', issuedAt: 1, expiresAt: 2 } },
    acceptedEntryParticipants: { 'student-1': { participantId: 'student-1' } },
  }
  await sessions.set(session.id, session)

  const loaded = await sessions.get(session.id)
  assert.ok(loaded)
  const data = loaded.data as {
    participantAuthTokens?: Record<string, string>
    activityCapabilities?: Record<string, { id?: string }>
    acceptedEntryParticipants?: Record<string, unknown>
  }
  assert.deepEqual(data.participantAuthTokens, { 'hash-1': 'student-1' })
  assert.equal(data.activityCapabilities?.['cap-1']?.id, 'cap-1')
  assert.ok(data.acceptedEntryParticipants && 'student-1' in data.acceptedEntryParticipants)
})

void test('normalization keeps a normalizer-provided platform key (even emptied) rather than restoring the old one', async (t) => {
  resetSessionNormalizersForTests()
  registerSessionNormalizer('reset-activity', (session) => {
    session.data = { acceptedEntryParticipants: {} }
  })
  const sessions = createSessionStore(null, 1_000)
  t.after(async () => {
    await sessions.close()
    resetSessionNormalizersForTests()
  })

  const session = await createSession(sessions)
  session.type = 'reset-activity'
  session.data = { acceptedEntryParticipants: { 'student-1': { participantId: 'student-1' } } }
  await sessions.set(session.id, session)

  const data = (await sessions.get(session.id))?.data as { acceptedEntryParticipants?: Record<string, unknown> }
  assert.deepEqual(data.acceptedEntryParticipants, {})
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

void test('a Valkey-backed cached touch observes a remote linked-session unlink', async (t) => {
  const records = new Map<string, SessionRecord>()
  const firstTouches: string[] = []
  const secondTouches: string[] = []
  const secondGets: string[] = []
  const firstStore = createSessionStore('redis://first', 1_000, valkeyStoreForTest(records, firstTouches))
  const secondStore = createSessionStore('redis://second', 1_000, valkeyStoreForTest(records, secondTouches, 1_000, secondGets))
  t.after(async () => {
    await firstStore.close()
    await secondStore.close()
  })

  const linkedSession = await createSession(firstStore)
  await firstStore.set(linkedSession.id, linkedSession)
  const liveSession = await createSession(firstStore)
  liveSession.data = { linkedSessionId: linkedSession.id }
  await firstStore.set(liveSession.id, liveSession)
  await secondStore.get(liveSession.id)

  liveSession.data = {}
  await firstStore.set(liveSession.id, liveSession)

  secondGets.length = 0
  assert.equal(await secondStore.touch(liveSession.id), true)
  await secondStore.flushCache!()
  assert.deepEqual(secondTouches, [liveSession.id], 'a cached touch must not use a link cleared by another Valkey-backed process')
  assert.deepEqual(secondGets, [liveSession.id], 'the first cached touch revalidates its source record')

  secondGets.length = 0
  assert.equal(await secondStore.touch(liveSession.id), true)
  assert.deepEqual(secondGets, [], 'subsequent cached touches reuse bounded source-data freshness instead of reading Valkey per event')
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

void test('a strict miss drops the cached copy so a later get() cannot resurrect a remotely deleted session', async (t) => {
  const records = new Map<string, SessionRecord>()
  const sessions = createSessionStore('redis://test', 1_000, valkeyStoreForTest(records, []))
  t.after(async () => { await sessions.close() })

  const live = await createSession(sessions)
  // Populate the read cache.
  assert.ok(await sessions.get(live.id))

  // Another instance deletes the record out from under this one.
  records.delete(live.id)

  // The strict read reports the miss and must also evict the stale cache entry.
  assert.equal(await sessions.getStrict!(live.id), null)
  assert.equal(await sessions.get(live.id), null, 'the deleted session is not resurrected from cache by a later get()')
})
