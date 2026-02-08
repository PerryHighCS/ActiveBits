import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeQuestionTypes, validateName, validateStats, validateStudentId } from './routeUtils.js'

test('sanitizeQuestionTypes returns defaults for invalid input', () => {
  assert.deepEqual(sanitizeQuestionTypes(null), ['all'])
  assert.deepEqual(sanitizeQuestionTypes(undefined), ['all'])
  assert.deepEqual(sanitizeQuestionTypes('not-an-array'), ['all'])
  assert.deepEqual(sanitizeQuestionTypes([]), ['all'])
})

test('sanitizeQuestionTypes filters valid types and removes duplicates', () => {
  assert.deepEqual(sanitizeQuestionTypes(['index-get', 'len', 'append']), ['index-get', 'len', 'append'])
  assert.deepEqual(sanitizeQuestionTypes(['index-get', 'invalid', 'len']), ['index-get', 'len'])
})

test('sanitizeQuestionTypes normalizes all mode', () => {
  assert.deepEqual(sanitizeQuestionTypes(['all']), ['all'])
  assert.deepEqual(sanitizeQuestionTypes(['all', 'index-get', 'len']), ['all'])
})

test('validateName accepts valid names', () => {
  assert.equal(validateName('Alice'), 'Alice')
  assert.equal(validateName('  Bob  '), 'Bob')
  assert.equal(validateName("O'Brien"), "O'Brien")
  assert.equal(validateName('John-Paul'), 'John-Paul')
})

test('validateName rejects invalid names', () => {
  assert.equal(validateName(null), null)
  assert.equal(validateName(undefined), null)
  assert.equal(validateName(''), null)
  assert.equal(validateName('   '), null)
  assert.equal(validateName(123), null)
  assert.equal(validateName('Alice@123'), null)
})

test('validateName enforces length limit', () => {
  const longName = 'a'.repeat(51)
  assert.equal(validateName(longName)?.length, 50)
})

test('validateStats accepts valid stats and normalizes defaults', () => {
  const result = validateStats({ total: 10, correct: 5, streak: 2, longestStreak: 3 })
  assert.deepEqual(result, { total: 10, correct: 5, streak: 2, longestStreak: 3 })
})

test('validateStats rejects invalid stats', () => {
  assert.equal(validateStats(null), null)
  assert.equal(validateStats(undefined), null)
  assert.equal(validateStats('not-an-object'), null)
})

test('validateStats clamps values and preserves invariants', () => {
  const result = validateStats({ total: -5, correct: 100, streak: 'abc', longestStreak: 5 })
  assert.deepEqual(result, { total: 0, correct: 0, streak: 0, longestStreak: 5 })

  const result2 = validateStats({ total: 10, correct: 20, streak: 8, longestStreak: 4 })
  assert.equal(result2?.correct, 10)
  assert.equal(result2?.longestStreak, 8)
})

test('validateStudentId accepts valid IDs', () => {
  assert.equal(validateStudentId('student-123'), 'student-123')
  assert.equal(validateStudentId('  alice_99  '), 'alice_99')
  assert.equal(validateStudentId('user:grade/a'), 'user:grade/a')
})

test('validateStudentId rejects invalid IDs', () => {
  assert.equal(validateStudentId(null), null)
  assert.equal(validateStudentId(undefined), null)
  assert.equal(validateStudentId(''), null)
  assert.equal(validateStudentId('   '), null)
  assert.equal(validateStudentId('user@example'), null)
})

test('validateStudentId enforces length limit', () => {
  const longId = 'a'.repeat(81)
  assert.equal(validateStudentId(longId)?.length, 80)
})
