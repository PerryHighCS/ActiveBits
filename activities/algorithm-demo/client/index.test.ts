import test from 'node:test'
import assert from 'node:assert/strict'
import algorithmDemoActivity from './index'

test('algorithm-demo activity client module exports manager/student components', () => {
  assert.equal(typeof algorithmDemoActivity.ManagerComponent, 'function')
  assert.equal(typeof algorithmDemoActivity.StudentComponent, 'function')
  assert.equal(algorithmDemoActivity.footerContent, null)
})
