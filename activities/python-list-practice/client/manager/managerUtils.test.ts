import assert from 'node:assert/strict'
import test from 'node:test'
import { computeManagerStats, sortStudents, QUESTION_TYPES } from './managerUtils.js'
import type { PythonListPracticeStudent } from '../../pythonListPracticeTypes.js'

void test('computeManagerStats counts connected and total students', () => {
  const students: PythonListPracticeStudent[] = [
    { id: '1', name: 'Alice', stats: { total: 10, correct: 8, streak: 2, longestStreak: 3 }, connected: true },
    { id: '2', name: 'Bob', stats: { total: 5, correct: 3, streak: 0, longestStreak: 2 }, connected: false },
    { id: '3', name: 'Charlie', stats: { total: 15, correct: 12, streak: 3, longestStreak: 5 }, connected: true },
  ]
  const stats = computeManagerStats(students)
  assert.equal(stats.totalStudents, 3)
  assert.equal(stats.connected, 2)
})

void test('computeManagerStats handles empty list', () => {
  const stats = computeManagerStats([])
  assert.equal(stats.totalStudents, 0)
  assert.equal(stats.connected, 0)
})

void test('sortStudents sorts by name ascending by default', () => {
  const students: PythonListPracticeStudent[] = [
    { id: '1', name: 'Charlie', stats: { total: 1, correct: 1, streak: 0, longestStreak: 0 }, connected: true },
    { id: '2', name: 'Alice', stats: { total: 1, correct: 1, streak: 0, longestStreak: 0 }, connected: true },
    { id: '3', name: 'Bob', stats: { total: 1, correct: 1, streak: 0, longestStreak: 0 }, connected: true },
  ]
  const sorted = sortStudents(students, 'name', 'asc')
  assert.equal(sorted[0]?.name, 'Alice')
  assert.equal(sorted[1]?.name, 'Bob')
  assert.equal(sorted[2]?.name, 'Charlie')
})

void test('sortStudents sorts by accuracy descending', () => {
  const students: PythonListPracticeStudent[] = [
    { id: '1', name: 'Alice', stats: { total: 10, correct: 8, streak: 0, longestStreak: 0 }, connected: true },
    { id: '2', name: 'Bob', stats: { total: 10, correct: 5, streak: 0, longestStreak: 0 }, connected: true },
    { id: '3', name: 'Charlie', stats: { total: 10, correct: 9, streak: 0, longestStreak: 0 }, connected: true },
  ]
  const sorted = sortStudents(students, 'accuracy', 'desc')
  assert.equal(sorted[0]?.name, 'Charlie')
  assert.equal(sorted[1]?.name, 'Alice')
  assert.equal(sorted[2]?.name, 'Bob')
})

void test('QUESTION_TYPES has expected entries', () => {
  assert.equal(QUESTION_TYPES.length, 11)
  assert.equal(QUESTION_TYPES[0]?.id, 'all')
  assert.equal(QUESTION_TYPES[1]?.id, 'index-get')
})
