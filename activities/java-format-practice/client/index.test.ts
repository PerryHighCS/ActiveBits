import assert from 'node:assert/strict'
import test from 'node:test'
import javaFormatPracticeActivity from './index'

test('java-format-practice client module exports manager/student components', () => {
  assert.equal(typeof javaFormatPracticeActivity.ManagerComponent, 'function')
  assert.equal(typeof javaFormatPracticeActivity.StudentComponent, 'function')
  assert.equal(javaFormatPracticeActivity.footerContent, null)
})
