import assert from 'node:assert/strict'
import test from 'node:test'
import pythonListPracticeActivity from './index'

void test('python-list-practice client module exports manager/student components', () => {
  assert.equal(typeof pythonListPracticeActivity.ManagerComponent, 'function')
  assert.equal(typeof pythonListPracticeActivity.StudentComponent, 'function')
  assert.equal(pythonListPracticeActivity.footerContent, null)
})
