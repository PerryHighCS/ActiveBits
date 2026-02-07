import assert from 'node:assert/strict'
import test from 'node:test'
import javaStringPracticeActivity from './index.js'

test('java-string-practice client module exports manager/student components', () => {
  assert.equal(typeof javaStringPracticeActivity.ManagerComponent, 'function')
  assert.equal(typeof javaStringPracticeActivity.StudentComponent, 'function')
  assert.equal(javaStringPracticeActivity.footerContent, null)
})
