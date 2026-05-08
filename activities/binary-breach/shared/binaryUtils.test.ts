import assert from 'node:assert/strict'
import test from 'node:test'
import {
  binaryToDecimal,
  compareBinaryValues,
  decimalToBinary,
  maxUnsignedValueForBits,
  normalizeBinaryAnswer,
  normalizeDecimalAnswer,
  orderBinaryValues,
} from './binaryUtils.js'

void test('converts between binary and decimal values', () => {
  assert.equal(decimalToBinary(45), '101101')
  assert.equal(binaryToDecimal('101101'), 45)
  assert.equal(maxUnsignedValueForBits(4), 15)
})

void test('normalizes valid answers and rejects invalid input', () => {
  assert.equal(normalizeBinaryAnswer('001101'), '1101')
  assert.equal(normalizeBinaryAnswer('0'), '0')
  assert.equal(normalizeBinaryAnswer('102'), null)
  assert.equal(normalizeDecimalAnswer(' 26 '), 26)
  assert.equal(normalizeDecimalAnswer('2.6'), null)
})

void test('compares and orders binary values by numeric value', () => {
  assert.equal(compareBinaryValues('10111', '11001'), -1)
  assert.deepEqual(orderBinaryValues(['101', '1001', '111', '1100']), ['101', '111', '1001', '1100'])
})
