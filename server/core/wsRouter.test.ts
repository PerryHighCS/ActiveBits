import assert from 'node:assert/strict'
import test from 'node:test'
import { isActivityWebSocketPath } from './wsRouter.js'

void test('activity WebSocket routing does not claim unrelated upgrade paths', () => {
  assert.equal(isActivityWebSocketPath('/ws'), true)
  assert.equal(isActivityWebSocketPath('/ws/java-format-practice'), true)
  assert.equal(isActivityWebSocketPath('/vite-hmr'), false)
  assert.equal(isActivityWebSocketPath('/socket.io'), false)
})
