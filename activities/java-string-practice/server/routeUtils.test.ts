import assert from 'node:assert/strict'
import test from 'node:test'
import { validateMethods, validateStats, validateStudentName } from './routeUtils.js'

void test('validateStudentName trims and enforces allowed characters', () => {
  assert.equal(validateStudentName('  Alice Smith  '), 'Alice Smith')
  const longName = validateStudentName('A'.repeat(80))
  assert.ok(longName)
  assert.equal(longName.length, 50)
  assert.equal(validateStudentName('Invalid<script>'), null)
})

void test('validateStats clamps invalid fields and preserves invariants', () => {
  const stats = validateStats({
    total: 10,
    correct: 99,
    streak: 3,
    longestStreak: 1,
  })

  assert.deepEqual(stats, {
    total: 10,
    correct: 10,
    streak: 3,
    longestStreak: 3,
  })
})

void test('validateMethods returns defaults for empty/invalid lists', () => {
  assert.equal(validateMethods('invalid'), null)
  assert.deepEqual(validateMethods(['bogus']), ['all'])
  assert.deepEqual(validateMethods(['all', 'equals', 'unknown']), ['all', 'equals'])
})
