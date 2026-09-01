import assert from 'node:assert/strict'
import test from 'node:test'
import { ValkeySessionStore, ValkeyPersistentStore } from './valkeyStore.js'

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
