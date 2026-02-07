import test from 'node:test'
import assert from 'node:assert/strict'
import { getReconnectDelay, resolveWebSocketUrl } from './useResilientWebSocket'

test('resolveWebSocketUrl resolves literal urls and builder callbacks', () => {
  assert.equal(resolveWebSocketUrl('ws://localhost:3000'), 'ws://localhost:3000')
  assert.equal(resolveWebSocketUrl(() => 'wss://example.test/socket'), 'wss://example.test/socket')
  assert.equal(resolveWebSocketUrl(() => null), null)
  assert.equal(resolveWebSocketUrl(undefined), null)
})

test('getReconnectDelay applies exponential backoff and maximum cap', () => {
  assert.equal(getReconnectDelay(0, 1000, 30000), 1000)
  assert.equal(getReconnectDelay(1, 1000, 30000), 2000)
  assert.equal(getReconnectDelay(2, 1000, 30000), 4000)
  assert.equal(getReconnectDelay(5, 1000, 30000), 30000)
})
