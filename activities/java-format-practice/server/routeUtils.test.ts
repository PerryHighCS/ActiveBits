import assert from 'node:assert/strict'
import test from 'node:test'
import { validateDifficulty, validateStats, validateStudentName, validateTheme } from './routeUtils.js'

test('validateStudentName trims valid names and rejects invalid values', () => {
  assert.equal(validateStudentName('  Ada Lovelace  '), 'Ada Lovelace')
  assert.equal(validateStudentName(''), null)
  assert.equal(validateStudentName('     '), null)
  assert.equal(validateStudentName('name<script>'), null)
  assert.equal(validateStudentName(42), null)
})

test('validateStats normalizes invalid values and preserves invariants', () => {
  assert.deepEqual(
    validateStats({
      total: '12',
      correct: '20',
      streak: '-5',
      longestStreak: '2',
    }),
    {
      total: 12,
      correct: 12,
      streak: 0,
      longestStreak: 2,
    },
  )

  assert.equal(validateStats(null), null)
  assert.equal(validateStats([]), null)
})

test('validateDifficulty defaults invalid values to beginner', () => {
  assert.equal(validateDifficulty('beginner'), 'beginner')
  assert.equal(validateDifficulty('advanced'), 'advanced')
  assert.equal(validateDifficulty('expert'), 'beginner')
})

test('validateTheme defaults invalid values to all', () => {
  assert.equal(validateTheme('all'), 'all')
  assert.equal(validateTheme('spy-badge'), 'spy-badge')
  assert.equal(validateTheme('restaurant-menu'), 'all')
})
