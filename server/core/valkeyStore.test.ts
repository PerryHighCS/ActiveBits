import assert from 'node:assert/strict'
import test from 'node:test'
import { ValkeySessionStore } from './valkeyStore.js'

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
