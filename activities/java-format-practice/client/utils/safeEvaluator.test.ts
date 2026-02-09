import assert from 'node:assert/strict'
import test from 'node:test'
import { safeEvaluate } from './safeEvaluator.js'

void test('safeEvaluate allows bracket and brace characters inside string literals', () => {
  assert.equal(safeEvaluate('"[" + 1'), '[1')
  assert.equal(safeEvaluate('"{"+2'), '{2')
})

void test('safeEvaluate still rejects actual array and object literals', () => {
  assert.throws(() => safeEvaluate('[1, 2, 3]'), /Array and object literals are not allowed/)
  assert.throws(() => safeEvaluate('{ a: 1 }'))
})
