import test from 'node:test'
import assert from 'node:assert/strict'
import { isMobCodeJsonRoute } from './jsonBodyParsing.js'

void test('isMobCodeJsonRoute scopes elevated JSON parsing to MobCode API routes', () => {
  assert.equal(isMobCodeJsonRoute('/api/mobcode'), true)
  assert.equal(isMobCodeJsonRoute('/api/mobcode/session-1/state'), true)
  assert.equal(isMobCodeJsonRoute('/api/session/abc'), false)
  assert.equal(isMobCodeJsonRoute('/health-check'), false)
})
