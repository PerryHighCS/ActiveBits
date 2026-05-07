import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  getSelectedDecimalPlaceValues,
  toggleBinaryPlaceValueAnswer,
  toggleDecimalPlaceValueAnswer,
} from './placeValueInputUtils.js'

void test('adds and removes place values from decimal answers', () => {
  assert.equal(toggleDecimalPlaceValueAnswer('', 8), '8')
  assert.equal(toggleDecimalPlaceValueAnswer('8', 4), '12')
  assert.equal(toggleDecimalPlaceValueAnswer('12', 4), '8')
})

void test('starts decimal place value input from zero when the answer is not numeric', () => {
  assert.equal(toggleDecimalPlaceValueAnswer('pending', 16), '16')
})

void test('toggles binary bits by place-value chart index', () => {
  assert.equal(toggleBinaryPlaceValueAnswer('', 8, 0), '10000000')
  assert.equal(toggleBinaryPlaceValueAnswer('10000000', 8, 0), '0')
  assert.equal(toggleBinaryPlaceValueAnswer('1010', 8, 6), '1000')
})

void test('ignores non-binary characters before toggling binary bits', () => {
  assert.equal(toggleBinaryPlaceValueAnswer('10a1', 4, 1), '1')
})

void test('reports selected decimal place values from the current answer', () => {
  assert.deepEqual(getSelectedDecimalPlaceValues('13', 8), [8, 4, 1])
  assert.deepEqual(getSelectedDecimalPlaceValues('waiting', 8), [])
})
