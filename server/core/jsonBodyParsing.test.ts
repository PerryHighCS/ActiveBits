import test from 'node:test'
import assert from 'node:assert/strict'
import { isMobCodeJsonRoute, MOB_CODE_JSON_BODY_LIMIT } from './jsonBodyParsing.js'

void test('MobCode JSON parser budget leaves headroom above the 4 MiB post-parse workspace cap', () => {
  assert.equal(MOB_CODE_JSON_BODY_LIMIT, '8mb')
})

void test('isMobCodeJsonRoute scopes elevated JSON parsing to MobCode API routes', () => {
  assert.equal(isMobCodeJsonRoute('/api/mobcode'), true)
  assert.equal(isMobCodeJsonRoute('/api/mobcode/session-1/state'), true)
  assert.equal(isMobCodeJsonRoute('/api/session/abc'), false)
  assert.equal(isMobCodeJsonRoute('/health-check'), false)
})
