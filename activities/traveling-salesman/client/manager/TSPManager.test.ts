import test from 'node:test'
import assert from 'node:assert/strict'
import { toUiBroadcastIds } from './TSPManager'

void test('toUiBroadcastIds maps instructor id for local highlight controls', () => {
  const result = toUiBroadcastIds(['bruteforce', 'instructor', 'student-1'])
  assert.deepEqual(result, ['bruteforce', 'instructor-local', 'student-1'])
})
