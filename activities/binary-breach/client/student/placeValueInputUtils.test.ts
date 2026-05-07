import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  appendCalculatorInput,
  backspaceCalculatorInput,
  evaluateCalculatorExpression,
  toggleBinaryPlaceValueAnswer,
} from './placeValueInputUtils.js'

void test('toggles binary bits by place-value chart index', () => {
  assert.equal(toggleBinaryPlaceValueAnswer('', 8, 0), '10000000')
  assert.equal(toggleBinaryPlaceValueAnswer('10000000', 8, 0), '0')
  assert.equal(toggleBinaryPlaceValueAnswer('1010', 8, 6), '1000')
})

void test('ignores non-binary characters before toggling binary bits', () => {
  assert.equal(toggleBinaryPlaceValueAnswer('10a1', 4, 1), '1')
})

void test('appends calculator digits and operators safely', () => {
  assert.equal(appendCalculatorInput('', '4'), '4')
  assert.equal(appendCalculatorInput('0', '8'), '8')
  assert.equal(appendCalculatorInput('4', '+'), '4+')
  assert.equal(appendCalculatorInput('4+', '-'), '4-')
  assert.equal(appendCalculatorInput('', '-'), '-')
  assert.equal(appendCalculatorInput('', '+'), '')
  assert.equal(appendCalculatorInput('4', '*'), '4')
})

void test('backspaces calculator input', () => {
  assert.equal(backspaceCalculatorInput('128+'), '128')
})

void test('evaluates calculator expressions with addition and subtraction', () => {
  assert.equal(evaluateCalculatorExpression('128+16-4'), '140')
  assert.equal(evaluateCalculatorExpression('-5+9'), '4')
  assert.equal(evaluateCalculatorExpression('12+'), '12+')
})
