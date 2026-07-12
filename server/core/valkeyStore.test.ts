import assert from 'node:assert/strict'
import test from 'node:test'
import { ValkeySessionStore } from './valkeyStore.js'

void test('ValkeySessionStore consume script checks token expiry atomically', async () => {
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

  assert.match(script, /entry\.expiresAt.*<= tonumber\(now\)/)
  assert.match(script, /SET', key, updated, 'PX', tonumber\(ttl\)/)
})
