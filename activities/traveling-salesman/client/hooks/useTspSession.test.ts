import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldRefreshForMessageType } from './useTspSession'

void test('shouldRefreshForMessageType matches configured types', () => {
  assert.equal(shouldRefreshForMessageType('problemUpdate', ['problemUpdate', 'studentsUpdate']), true)
  assert.equal(shouldRefreshForMessageType('noop', ['problemUpdate']), false)
  assert.equal(shouldRefreshForMessageType(42, ['problemUpdate']), false)
})
