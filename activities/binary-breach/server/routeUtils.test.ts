import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_BINARY_BREACH_SETTINGS } from '../shared/challengeGenerator.js'
import {
  normalizeBinaryBreachStudent,
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

void test('drops malformed student records during normalization', () => {
  assert.equal(normalizeBinaryBreachStudent({ id: 'abc', name: '<bad>' }, DEFAULT_BINARY_BREACH_SETTINGS), null)
  const student = normalizeBinaryBreachStudent({
    id: 'abc',
    name: 'Grace',
    connected: true,
    progress: {},
  }, DEFAULT_BINARY_BREACH_SETTINGS)
  assert.equal(student?.id, 'abc')
  assert.equal(student?.name, 'Grace')
  assert.equal(student?.connected, true)
})
