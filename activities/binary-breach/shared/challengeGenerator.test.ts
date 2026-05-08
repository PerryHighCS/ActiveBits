import assert from 'node:assert/strict'
import test from 'node:test'
import type { BinaryBreachSettings } from '../binaryBreachTypes.js'
import {
  BINARY_BREACH_CHALLENGE_TYPES,
  DEFAULT_BINARY_BREACH_SETTINGS,
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

void test('defaults new missions to eight-bit challenges', () => {
  assert.equal(DEFAULT_BINARY_BREACH_SETTINGS.maxBits, 8)
})

void test('adds story context to challenge transmissions', () => {
  const challenge = createBinaryBreachChallenge(
    { ...settings, challengeTypes: ['binary-to-decimal'] },
    'story',
    0,
  )
  assert.match(challenge.prompt, /Security door motors/)
  assert.match(challenge.prompt, /Decode [01]+ to restore Door Lock/)
  assert.match(challenge.prompt, new RegExp(challenge.promptEmphasis.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

void test('order challenges can ask for least-to-greatest or greatest-to-least order', () => {
  const seenDirections = new Set<string>()
  for (let index = 0; index < 30; index += 1) {
    const challenge = createBinaryBreachChallenge(
      { ...settings, challengeTypes: ['order-binary'] },
      `direction-${index}`,
      0,
    )
    assert.equal(challenge.type, 'order-binary')
    seenDirections.add(challenge.direction)
    assert.equal(challenge.promptEmphasis, challenge.direction === 'least-to-greatest' ? 'least to greatest' : 'greatest to least')
    const ascending = [...challenge.answer].sort((left, right) => parseInt(left, 2) - parseInt(right, 2))
    if (challenge.direction === 'least-to-greatest') {
      assert.deepEqual(challenge.answer, ascending)
    } else {
      assert.deepEqual(challenge.answer, [...ascending].reverse())
    }
  }

  assert.deepEqual([...seenDirections].sort(), ['greatest-to-least', 'least-to-greatest'])
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

void test('accepts 100 as decimal 4 for binary-to-decimal challenges', () => {
  const feedback = validateBinaryBreachAnswer({
    id: 'regression-100',
    type: 'binary-to-decimal',
    systemName: 'Door Lock',
    prompt: 'Decode 100.',
    promptEmphasis: 'Decode 100',
    maxBits: 8,
    hintLevel: 0,
    binary: '100',
    decimal: 4,
  }, {
    type: 'binary-to-decimal',
    decimal: '4',
  })

  assert.equal(feedback.correct, true)
})

void test('explains incorrect answers with challenge-specific feedback', () => {
  const conversionFeedback = validateBinaryBreachAnswer({
    id: 'c1',
    type: 'binary-to-decimal',
    systemName: 'Door Lock',
    prompt: 'Decode the packet.',
    promptEmphasis: 'Decode the packet',
    maxBits: 8,
    hintLevel: 0,
    binary: '101101',
    decimal: 45,
  }, {
    type: 'binary-to-decimal',
    decimal: '44',
  })
  assert.equal(conversionFeedback.correct, false)
  assert.match(conversionFeedback.message, /You entered 44/)
  assert.match(conversionFeedback.message, /too low/)
  assert.match(conversionFeedback.message, /32 \+ 8 \+ 4 \+ 1/)

  const compareFeedback = validateBinaryBreachAnswer({
    id: 'c2',
    type: 'compare-binary',
    systemName: 'Signal Router',
    prompt: 'Choose the stronger signal.',
    promptEmphasis: 'stronger signal',
    maxBits: 8,
    hintLevel: 0,
    left: '10111',
    right: '11001',
    target: 'larger',
    answer: 'right',
  }, {
    type: 'compare-binary',
    choice: 'left',
  })
  assert.match(compareFeedback.message, /You chose 10111 \(23\)/)
  assert.match(compareFeedback.message, /stronger signal is 11001 \(25\)/)

  const descendingOrderFeedback = validateBinaryBreachAnswer({
    id: 'c3',
    type: 'order-binary',
    systemName: 'Sorting Core',
    prompt: 'Arrange the queue from greatest to least.',
    promptEmphasis: 'greatest to least',
    maxBits: 8,
    hintLevel: 0,
    values: ['1', '10', '11'],
    direction: 'greatest-to-least',
    answer: ['11', '10', '1'],
  }, {
    type: 'order-binary',
    values: ['1', '10', '11'],
  })
  assert.equal(descendingOrderFeedback.correct, false)
  assert.match(descendingOrderFeedback.message, /Correct greatest-to-least order is 11, 10, 1/)
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
