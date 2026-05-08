import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_BINARY_BREACH_SETTINGS } from '../shared/challengeGenerator.js'
import {
  normalizeBinaryBreachStudent,
  normalizeBinaryBreachSettingsFromLaunchOptions,
  normalizeBinaryBreachSettingsFromSessionData,
  normalizeProgress,
  validateStudentId,
  validateStudentName,
} from './routeUtils.js'

void test('validates student names and ids conservatively', () => {
  assert.equal(validateStudentName(' Ada-1 '), 'Ada-1')
  assert.equal(validateStudentName('<script>'), null)
  assert.equal(validateStudentId('student_1:/ok'), 'student_1:/ok')
  assert.equal(validateStudentId('bad id!'), null)
})

void test('normalizes progress into bounded mission stats', () => {
  const progress = normalizeProgress({
    systemsRestored: 99,
    attempts: 2,
    correct: 5,
    incorrect: 7,
    streak: 3,
    bestStreak: 1,
  }, DEFAULT_BINARY_BREACH_SETTINGS)

  assert.equal(progress.systemsRestored, DEFAULT_BINARY_BREACH_SETTINGS.missionLength)
  assert.equal(progress.correct, 2)
  assert.equal(progress.incorrect, 0)
  assert.equal(progress.bestStreak, 3)
  assert.equal(progress.completed, true)
})

void test('normalizes progress completion from strict booleans only', () => {
  assert.equal(normalizeProgress({
    completed: 'false',
    systemsRestored: 1,
  }, DEFAULT_BINARY_BREACH_SETTINGS).completed, false)

  assert.equal(normalizeProgress({
    completed: true,
    systemsRestored: 1,
  }, DEFAULT_BINARY_BREACH_SETTINGS).completed, true)
})

void test('drops malformed student records during normalization', () => {
  assert.equal(normalizeBinaryBreachStudent({ id: 'abc', name: '<bad>' }, DEFAULT_BINARY_BREACH_SETTINGS), null)
  const student = normalizeBinaryBreachStudent({
    id: 'abc',
    name: 'Grace',
    connected: 'false',
    progress: {},
    currentChallenge: {
      id: 'legacy-order',
      type: 'order-binary',
      systemName: 'Sorting Core',
      prompt: 'Arrange the queue from least to greatest.',
      maxBits: 8,
      hintLevel: 0,
      values: ['10', '1'],
      answer: ['1', '10'],
    },
  }, DEFAULT_BINARY_BREACH_SETTINGS)
  assert.equal(student?.id, 'abc')
  assert.equal(student?.name, 'Grace')
  assert.equal(student?.connected, false)
  assert.equal(student?.currentChallenge?.type, 'order-binary')
  if (student?.currentChallenge?.type === 'order-binary') {
    assert.equal(student.currentChallenge.direction, 'least-to-greatest')
    assert.equal(student.currentChallenge.promptEmphasis, 'least to greatest')
  }

  const malformedChallengeStudent = normalizeBinaryBreachStudent({
    id: 'abc',
    name: 'Grace',
    progress: {},
    currentChallenge: {
      id: 'bad-order',
      type: 'order-binary',
      systemName: 'Sorting Core',
      prompt: 'Arrange the queue from least to greatest.',
      promptEmphasis: 'least to greatest',
      maxBits: 8,
      hintLevel: 0,
      values: ['10', '1'],
      answer: 'not-an-array',
    },
  }, DEFAULT_BINARY_BREACH_SETTINGS)
  assert.equal(malformedChallengeStudent?.currentChallenge, null)

  const unsupportedChallengeStudent = normalizeBinaryBreachStudent({
    id: 'abc',
    name: 'Grace',
    progress: {},
    currentChallenge: {
      id: 'bad-type',
      type: 'unknown-challenge',
      systemName: 'Sorting Core',
      prompt: 'Do something unexpected.',
      promptEmphasis: 'unexpected',
      maxBits: 8,
      hintLevel: 0,
    },
  }, DEFAULT_BINARY_BREACH_SETTINGS)
  assert.equal(unsupportedChallengeStudent?.currentChallenge, null)
})

void test('normalizes Binary Breach launch options from permalink and embedded selections', () => {
  assert.deepEqual(normalizeBinaryBreachSettingsFromLaunchOptions({
    maxBits: '4',
    missionLength: '3',
    challengeTypes: 'decimal-to-binary,order-binary',
    hintsEnabled: 'false',
    placeValueSupport: 'hidden',
  }), {
    maxBits: 4,
    missionLength: 3,
    challengeTypes: ['decimal-to-binary', 'order-binary'],
    timerMode: 'off',
    hintsEnabled: false,
    placeValueSupport: 'hidden',
  })
})

void test('session settings prefer stored settings and fall back to embedded launch options', () => {
  assert.equal(normalizeBinaryBreachSettingsFromSessionData({
    settings: { maxBits: 5 },
    embeddedLaunch: {
      selectedOptions: { maxBits: '4' },
    },
  }).maxBits, 5)

  assert.deepEqual(normalizeBinaryBreachSettingsFromSessionData({
    embeddedLaunch: {
      selectedOptions: {
        maxBits: '6',
        missionLength: '9',
        challengeTypes: 'compare-binary',
        hintsEnabled: 'true',
        placeValueSupport: 'optional',
      },
    },
  }), {
    maxBits: 6,
    missionLength: 9,
    challengeTypes: ['compare-binary'],
    timerMode: 'off',
    hintsEnabled: true,
    placeValueSupport: 'optional',
  })
})
