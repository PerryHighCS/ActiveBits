import assert from 'node:assert/strict'
import test from 'node:test'
import type { BinaryBreachSettings } from '../binaryBreachTypes.js'
import {
  BINARY_BREACH_CHALLENGE_TYPES,
  createBinaryBreachChallenge,
  normalizeBinaryBreachSettings,
} from './challengeGenerator.js'
import { validateBinaryBreachAnswer } from './challengeValidation.js'
import { applyAnswerResult, applyHintUse, createInitialProgress } from './scoring.js'

const settings: BinaryBreachSettings = {
  maxBits: 4,
  challengeTypes: [...BINARY_BREACH_CHALLENGE_TYPES],
  missionLength: 5,
  timerMode: 'off',
  hintsEnabled: true,
  placeValueSupport: 'visible',
}

void test('generates deterministic challenges for the same seed and index', () => {
  assert.deepEqual(
    createBinaryBreachChallenge(settings, 'seed', 2),
    createBinaryBreachChallenge(settings, 'seed', 2),
  )
})

void test('normalizes settings into safe classroom bounds', () => {
  const normalized = normalizeBinaryBreachSettings({
    maxBits: 99,
    missionLength: 100,
    challengeTypes: ['decimal-to-binary', 'unknown'],
    timerMode: 'standard',
    hintsEnabled: false,
    placeValueSupport: 'hidden',
  })
  assert.equal(normalized.maxBits, 8)
  assert.equal(normalized.missionLength, 12)
  assert.deepEqual(normalized.challengeTypes, ['decimal-to-binary'])
  assert.equal(normalized.hintsEnabled, false)
  assert.equal(normalized.placeValueSupport, 'hidden')
})

void test('validates answers for each MVP challenge type', () => {
  const binaryToDecimal = createBinaryBreachChallenge(
    { ...settings, challengeTypes: ['binary-to-decimal'] },
    'validation',
    0,
  )
  assert.equal(binaryToDecimal.type, 'binary-to-decimal')
  assert.equal(validateBinaryBreachAnswer(binaryToDecimal, {
    type: 'binary-to-decimal',
    decimal: String(binaryToDecimal.decimal),
  }).correct, true)

  const decimalToBinary = createBinaryBreachChallenge(
    { ...settings, challengeTypes: ['decimal-to-binary'] },
    'validation',
    0,
  )
  assert.equal(decimalToBinary.type, 'decimal-to-binary')
  assert.equal(validateBinaryBreachAnswer(decimalToBinary, {
    type: 'decimal-to-binary',
    binary: decimalToBinary.binary,
  }).correct, true)

  const compare = createBinaryBreachChallenge(
    { ...settings, challengeTypes: ['compare-binary'] },
    'validation',
    0,
  )
  assert.equal(compare.type, 'compare-binary')
  assert.equal(validateBinaryBreachAnswer(compare, {
    type: 'compare-binary',
    choice: compare.answer,
  }).correct, true)

  const order = createBinaryBreachChallenge(
    { ...settings, challengeTypes: ['order-binary'] },
    'validation',
    0,
  )
  assert.equal(order.type, 'order-binary')
  assert.equal(validateBinaryBreachAnswer(order, {
    type: 'order-binary',
    values: order.answer,
  }).correct, true)
})

void test('updates progress and clamps score at zero', () => {
  const afterCorrect = applyAnswerResult(createInitialProgress(), true, 1)
  assert.equal(afterCorrect.systemsRestored, 1)
  assert.equal(afterCorrect.completed, true)
  assert.equal(afterCorrect.score, 125)

  const afterHint = applyHintUse(afterCorrect)
  assert.equal(afterHint.hintsUsed, 1)
  assert.equal(afterHint.score, 115)
})
