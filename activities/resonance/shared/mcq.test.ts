import assert from 'node:assert/strict'
import test from 'node:test'
import { areMcqSelectionsEqual } from './mcq.js'

void test('areMcqSelectionsEqual treats reordered multi-select answers as equal', () => {
  assert.equal(areMcqSelectionsEqual(['a', 'b'], ['b', 'a']), true)
})

void test('areMcqSelectionsEqual rejects duplicate or mismatched selections', () => {
  assert.equal(areMcqSelectionsEqual(['a', 'a'], ['a']), false)
  assert.equal(areMcqSelectionsEqual(['a', 'b'], ['a']), false)
  assert.equal(areMcqSelectionsEqual(['a', 'b'], ['a', 'a']), false)
})
