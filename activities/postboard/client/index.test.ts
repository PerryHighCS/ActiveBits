import assert from 'node:assert/strict'
import test from 'node:test'
import postboardActivity from './index.js'

void test('postboard client entry exports manager and student components', () => {
  assert.equal(typeof postboardActivity.ManagerComponent, 'function')
  assert.equal(typeof postboardActivity.StudentComponent, 'function')
})
