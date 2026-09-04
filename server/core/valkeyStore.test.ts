import assert from 'node:assert/strict'
import test from 'node:test'
import { ValkeySessionStore, ValkeyPersistentStore } from './valkeyStore.js'

// Faithful JS execution of the `compareAndSet` Lua body: GET -> compare the
// stored revision against ARGV[1] -> on mismatch return nil -> else SET ARGV[2]
// verbatim (the replacement JSON is fully built in JS; Lua never re-encodes it)
// and return it. Lets the tests exercise the commit / reject / conflict / no
// array-retyping semantics without a live Redis.
function compareAndSetValkeyStoreForTest(initial: Record<string, unknown> = {}) {
  const backing = new Map<string, string>()
  for (const [key, value] of Object.entries(initial)) {
    backing.set(key, JSON.stringify(value))
  }
  const scripts: string[] = []
  const store = Object.create(ValkeySessionStore.prototype) as ValkeySessionStore & {
    client: { eval: (source: string, numKeys: number, ...values: Array<string | number>) => Promise<string | null> }
  }
  Object.defineProperty(store, 'ttlMs', { value: 60_000 })
  Object.defineProperty(store, 'client', {
    value: {
      async eval(source: string, _numKeys: number, ...values: Array<string | number>): Promise<string | null> {
        scripts.push(source)
        const [key, expectedRevisionArg, replacementJson, , expectedCreatedArg] =
          values as [string, string | number, string, string | number, string | undefined]
        const currentJson = backing.get(key)
        if (currentJson == null) return null
        const current = JSON.parse(currentJson) as { mutationRevision?: number; created?: number }
        const currentRevision = Number(current.mutationRevision ?? 0)
        if (currentRevision !== Number(expectedRevisionArg)) return null
        if (
          expectedCreatedArg != null && expectedCreatedArg !== '' &&
          String(current.created) !== expectedCreatedArg
        ) {
          return null
        }
        backing.set(key, replacementJson)
        return replacementJson
      },
    },
  })
  return { store, backing, scripts }
}

void test('ValkeySessionStore compareAndSet commits and advances the revision on a match, preserving all field updates', async () => {
  const { store, backing, scripts } = compareAndSetValkeyStoreForTest({
    'session:s1': { id: 's1', mutationRevision: 7, data: { a: 'old', b: 'old' } },
  })

  const updated = await store.compareAndSet('s1', 7, {
    id: 's1',
    mutationRevision: 7,
    data: { a: 'new-a', b: 'new-b' },
  })

  assert.equal(updated?.mutationRevision, 8)
  assert.deepEqual((updated?.data as Record<string, unknown>), { a: 'new-a', b: 'new-b' })
  assert.equal((JSON.parse(backing.get('session:s1') as string) as { mutationRevision: number }).mutationRevision, 8)
  assert.match(scripts[0] ?? '', /currentRevision ~= tonumber\(ARGV\[1\]\)/)
  // The script must SET the replacement verbatim, never re-encode a table:
  // Redis Lua `cjson` turns an empty array `[]` into `{}`, so any
  // `cjson.encode(...)` on `current`/`session`/`replacement` would corrupt
  // fields like `processedCommandIds: []`.
  assert.match(scripts[0] ?? '', /redis\.call\('SET', key, ARGV\[2\]/)
  assert.doesNotMatch(scripts[0] ?? '', /cjson\.encode\s*\(/)
  // The incarnation identity is part of the atomic comparison so a same-id
  // delete+recreate at a matching revision cannot ABA past the CAS.
  assert.match(scripts[0] ?? '', /tostring\(current\.created\) ~= ARGV\[4\]/)
})

void test('ValkeySessionStore compareAndSet rejects a revision-matching write when the stored incarnation was recreated', async () => {
  const { store, backing } = compareAndSetValkeyStoreForTest({
    // The record this caller read (created 1_000) has been replaced in place by
    // a fresh incarnation (created 5_000) whose revision also restarted at 0.
    'session:s1': { id: 's1', created: 5_000, mutationRevision: 0, data: { gen: 'B' } },
  })

  const result = await store.compareAndSet(
    's1',
    0,
    { id: 's1', created: 1_000, mutationRevision: 0, data: { gen: 'mutated-A' } },
    null,
    1_000,
  )

  assert.equal(result, null, 'the CAS must not commit a mutation derived from the gone incarnation')
  assert.deepEqual(
    JSON.parse(backing.get('session:s1') as string),
    { id: 's1', created: 5_000, mutationRevision: 0, data: { gen: 'B' } },
    'the recreated incarnation is left intact',
  )
})

void test('ValkeySessionStore compareAndSet fails closed when an expected incarnation is missing from storage', async () => {
  const { store, backing } = compareAndSetValkeyStoreForTest({
    'session:s1': { id: 's1', mutationRevision: 0, data: { gen: 'unidentified-replacement' } },
  })

  const result = await store.compareAndSet(
    's1',
    0,
    { id: 's1', created: 1_000, mutationRevision: 0, data: { gen: 'mutated-identified-session' } },
    null,
    1_000,
  )

  assert.equal(result, null)
  assert.deepEqual(
    JSON.parse(backing.get('session:s1') as string),
    { id: 's1', mutationRevision: 0, data: { gen: 'unidentified-replacement' } },
  )
})

void test('ValkeySessionStore compareAndSet still commits when expectedCreated matches the stored incarnation', async () => {
  const { store } = compareAndSetValkeyStoreForTest({
    'session:s1': { id: 's1', created: 1_000, mutationRevision: 4, data: { v: 'old' } },
  })

  const updated = await store.compareAndSet(
    's1',
    4,
    { id: 's1', created: 1_000, mutationRevision: 4, data: { v: 'new' } },
    null,
    1_000,
  )

  assert.equal(updated?.mutationRevision, 5)
  assert.deepEqual(updated?.data as Record<string, unknown>, { v: 'new' })
})

void test('ValkeySessionStore compareAndSet preserves empty arrays across an atomic write', async () => {
  const { store, backing } = compareAndSetValkeyStoreForTest({
    'session:s1': {
      id: 's1',
      mutationRevision: 3,
      data: { processedCommandIds: ['x'], students: [] },
    },
  })

  const updated = await store.compareAndSet('s1', 3, {
    id: 's1',
    data: { processedCommandIds: [], students: [] },
  })

  // Redis Lua cjson would turn `[]` into `{}`; building the JSON in JS keeps it.
  assert.deepEqual((updated?.data as { processedCommandIds: unknown; students: unknown }), {
    processedCommandIds: [],
    students: [],
  })
  const persisted = JSON.parse(backing.get('session:s1') as string) as { data: { processedCommandIds: unknown; students: unknown } }
  assert.ok(Array.isArray(persisted.data.processedCommandIds))
  assert.ok(Array.isArray(persisted.data.students))
  assert.equal(updated?.mutationRevision, 4)
})

void test('ValkeySessionStore compareAndSet rejects a stale expected revision and leaves the record untouched', async () => {
  const { store, backing } = compareAndSetValkeyStoreForTest({
    'session:s1': { id: 's1', mutationRevision: 9, data: { value: 'committed' } },
  })

  const result = await store.compareAndSet('s1', 7, {
    id: 's1',
    mutationRevision: 7,
    data: { value: 'stale' },
  })

  assert.equal(result, null)
  assert.deepEqual(
    JSON.parse(backing.get('session:s1') as string),
    { id: 's1', mutationRevision: 9, data: { value: 'committed' } },
  )
})

void test('ValkeySessionStore compareAndSet returns null for a missing key', async () => {
  const { store } = compareAndSetValkeyStoreForTest()
  assert.equal(await store.compareAndSet('gone', 0, { id: 'gone', data: {} }), null)
})

void test('ValkeySessionStore compareAndSet serializes two writers racing the same revision', async () => {
  const { store, backing } = compareAndSetValkeyStoreForTest({
    'session:s1': { id: 's1', mutationRevision: 7, data: { owner: null } },
  })

  // Both read revision 7. Writer A commits first.
  const a = await store.compareAndSet('s1', 7, { id: 's1', data: { owner: 'A' } })
  assert.equal(a?.mutationRevision, 8)

  // Writer B's compare-and-set against the now-stale revision 7 is rejected...
  assert.equal(await store.compareAndSet('s1', 7, { id: 's1', data: { owner: 'B' } }), null)

  // ...and only succeeds after re-reading the current revision (what
  // updateAtomic's retry loop does), without clobbering A's commit history.
  const b = await store.compareAndSet('s1', 8, { id: 's1', data: { owner: 'B' } })
  assert.equal(b?.mutationRevision, 9)
  assert.equal((JSON.parse(backing.get('session:s1') as string) as { data: { owner: string } }).data.owner, 'B')
})

void test('ValkeySessionStore consume script rejects malformed and expired token expiries atomically', async () => {
  let script = ''
  const store = Object.create(ValkeySessionStore.prototype) as ValkeySessionStore & {
    client: { eval: (source: string) => Promise<null> }
  }
  Object.defineProperty(store, 'client', {
    value: {
      async eval(source: string): Promise<null> {
        script = source
        return null
      },
    },
  })
  Object.defineProperty(store, 'ttlMs', { value: 60_000 })

  await store.consumeSessionDataToken('session-1', 'embeddedManagerEntryToken', 'token-value')

  assert.match(script, /entry\.expiresAt ~= nil/)
  assert.match(script, /type\(expiresAt\) ~= 'number'/)
  assert.match(script, /expiresAt ~= expiresAt/)
  assert.match(script, /expiresAt == math\.huge/)
  assert.match(script, /expiresAt == -math\.huge/)
  assert.match(script, /expiresAt <= tonumber\(now\)/)
  assert.match(script, /SET', key, updated, 'PX', tonumber\(ttl\)/)
})

void test('ValkeySessionStore refreshes matching expiry atomically and returns the refreshed session', async () => {
  let script = ''
  let args: Array<string | number> = []
  const store = Object.create(ValkeySessionStore.prototype) as ValkeySessionStore & {
    client: { eval: (source: string, numKeys: number, ...values: Array<string | number>) => Promise<string> }
  }
  Object.defineProperty(store, 'client', {
    value: {
      async eval(source: string, _numKeys: number, ...values: Array<string | number>): Promise<string> {
        script = source
        args = values
        return JSON.stringify({ id: 'session-1', lastActivity: 123, data: { expiresAt: 200 } })
      },
    },
  })

  const refreshed = await store.refreshSessionExpiry('session-1', 100, 200, 45_000)

  assert.deepEqual(refreshed, { id: 'session-1', lastActivity: 123, data: { expiresAt: 200 } })
  assert.match(script, /session\.data\.expiresAt ~= tonumber\(ARGV\[1\]\)/)
  assert.match(script, /session\.data\.expiresAt = tonumber\(ARGV\[2\]\)/)
  assert.match(script, /SET', KEYS\[1\], updated, 'PX', tonumber\(ARGV\[4\]\)/)
  assert.deepEqual(args.slice(0, 3), ['session:session-1', 100, 200])
  assert.equal(args.at(-1), 45_000)
})

void test('ValkeySessionStore refresh failure returns null without logging the session identifier', async () => {
  console.info('[TEST] Expected Valkey session-expiry refresh failure.')
  const store = Object.create(ValkeySessionStore.prototype) as ValkeySessionStore & {
    client: { eval: () => Promise<never> }
  }
  Object.defineProperty(store, 'client', {
    value: { async eval(): Promise<never> { throw new Error('test refresh outage') } },
  })
  const errorLogs: string[] = []
  const originalError = console.error
  console.error = (...values: unknown[]) => { errorLogs.push(values.map(String).join(' ')) }
  try {
    assert.equal(await store.refreshSessionExpiry('bearer-session-id', 100, 200, 45_000), null)
  } finally {
    console.error = originalError
  }

  assert.ok(errorLogs.some((message) => message.includes('refresh-session-expiry-failed') && message.includes('test refresh outage')))
  assert.ok(errorLogs.every((message) => !message.includes('bearer-session-id')))
})

void test('ValkeyPersistentStore compareAndClearSessionId script clears only on a matching session id and drops the reverse index', async () => {
  let script = ''
  let args: Array<string | number> = []
  const store = Object.create(ValkeyPersistentStore.prototype) as ValkeyPersistentStore & {
    client: { eval: (source: string, numKeys: number, ...values: Array<string | number>) => Promise<number> }
  }
  Object.defineProperty(store, 'client', {
    value: {
      async eval(source: string, _numKeys: number, ...values: Array<string | number>): Promise<number> {
        script = source
        args = values
        return 1
      },
    },
  })
  Object.defineProperty(store, 'ttlMs', { value: 86_400_000 })

  const cleared = await store.compareAndClearSessionId('hash-1', 'sess-A')

  assert.equal(cleared, true)
  // Unconditionally drops the failed attempt's own reverse-index entry...
  assert.match(script, /redis\.call\('DEL', KEYS\[2\]\)/)
  // ...then resets the record only while it still points at the expected id.
  assert.match(script, /record\.sessionId ~= ARGV\[1\]/)
  assert.match(script, /record\.sessionId = cjson\.null/)
  assert.match(script, /record\.teacherSocketId = cjson\.null/)
  assert.match(script, /SET', KEYS\[1\], cjson\.encode\(record\), 'PX', tonumber\(ARGV\[2\]\)/)
  assert.deepEqual(args, ['persistent:hash-1', 'persistent-session-by-session:sess-A', 'sess-A', 86_400_000])
})

void test('ValkeyPersistentStore compareAndClearSessionId reports not-cleared when the script returns 0', async () => {
  const store = Object.create(ValkeyPersistentStore.prototype) as ValkeyPersistentStore & {
    client: { eval: () => Promise<number> }
  }
  Object.defineProperty(store, 'client', { value: { async eval(): Promise<number> { return 0 } } })
  Object.defineProperty(store, 'ttlMs', { value: 86_400_000 })

  assert.equal(await store.compareAndClearSessionId('hash-1', 'sess-A'), false)
})

void test('ValkeyPersistentStore incrementAttempts fails open to 0 but incrementAttemptsStrict rethrows', async () => {
  console.info('[TEST] Expected Valkey rate-limit increment failure.')
  const store = Object.create(ValkeyPersistentStore.prototype) as ValkeyPersistentStore & {
    client: { eval: () => Promise<never> }
  }
  Object.defineProperty(store, 'client', {
    value: { async eval(): Promise<never> { throw new Error('test limiter outage') } },
  })
  const errorLogs: string[] = []
  const originalError = console.error
  console.error = (...values: unknown[]) => { errorLogs.push(values.map(String).join(' ')) }
  try {
    // Non-strict path: swallows the outage so legitimate auth can proceed.
    assert.equal(await store.incrementAttempts('ip:hash'), 0)
    // Strict path: a brute-force guard needs the outage to surface, not to
    // report "0 attempts -> allowed".
    await assert.rejects(store.incrementAttemptsStrict('ip:hash'), /test limiter outage/)
  } finally {
    console.error = originalError
  }
  assert.ok(errorLogs.some((m) => m.includes('increment-attempts-failed')))
  // The fail-open path still emits a structured event (distinct from the strict
  // one) so operators can see the limiter is degraded and under-counting.
  const degraded = errorLogs.find((m) => m.includes('increment-attempts-degraded'))
  assert.ok(degraded, 'expected a structured increment-attempts-degraded event')
  const degradedEvent = JSON.parse(degraded as string) as { event: string; key: string; error: string }
  assert.equal(degradedEvent.event, 'valkey.increment-attempts-degraded')
  assert.equal(degradedEvent.key, 'ip:hash')
})

void test('ValkeyPersistentStore incrementAttemptsStrict returns the script count on success', async () => {
  const store = Object.create(ValkeyPersistentStore.prototype) as ValkeyPersistentStore & {
    client: { eval: () => Promise<number> }
  }
  Object.defineProperty(store, 'client', { value: { async eval(): Promise<number> { return 3 } } })
  assert.equal(await store.incrementAttemptsStrict('ip:hash'), 3)
})
