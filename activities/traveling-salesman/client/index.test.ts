import assert from 'node:assert/strict'
import test from 'node:test'
import travelingSalesmanActivity from './index'

void test('traveling-salesman client module exports manager/student components', () => {
  assert.equal(typeof travelingSalesmanActivity.ManagerComponent, 'function')
  assert.equal(typeof travelingSalesmanActivity.StudentComponent, 'function')
  assert.equal(travelingSalesmanActivity.footerContent, null)
})
