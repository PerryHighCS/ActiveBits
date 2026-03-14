import assert from 'node:assert/strict'
import test from 'node:test'
import type { PythonListPracticeStudent } from '../pythonListPracticeTypes.js'
import {
  connectPythonListPracticeStudent,
  disconnectPythonListPracticeStudent,
  normalizePythonListPracticeStudent,
  updatePythonListPracticeStudentStats,
} from './studentParticipants.js'

const sampleStats = {
  total: 3,
  correct: 2,
  streak: 1,
  longestStreak: 2,
}

void test('normalizePythonListPracticeStudent backfills missing ids with shared participant ids', () => {
  const student = normalizePythonListPracticeStudent({
    id: '',
    name: 'Ada',
    stats: sampleStats,
    connected: true,
  }, 10)

  assert.match(student.id, /^[a-f0-9]{16}$/)
  assert.equal(student.lastSeen, 10)
})

void test('connectPythonListPracticeStudent reconnects legacy unnamed matches and returns participantId', () => {
  const students: PythonListPracticeStudent[] = [
    { id: '', name: 'Grace', stats: sampleStats, connected: false, lastSeen: 5 },
  ]

  const result = connectPythonListPracticeStudent(students, null, 'Grace', 20)

  assert.match(result.participantId, /^[a-f0-9]{16}$/)
  assert.equal(students[0]?.id, result.participantId)
  assert.equal(students[0]?.connected, true)
  assert.equal(students[0]?.lastSeen, 20)
})

void test('updatePythonListPracticeStudentStats updates existing students or creates a named fallback record', () => {
  const students: PythonListPracticeStudent[] = [
    { id: 'student-1', name: 'Ada', stats: sampleStats, connected: false, lastSeen: 5 },
  ]

  const updated = updatePythonListPracticeStudentStats(students, {
    participantId: 'student-1',
    participantName: 'Ada',
    stats: { total: 4, correct: 3, streak: 2, longestStreak: 2 },
    now: 30,
  })

  assert.equal(updated, students[0])
  assert.equal(students[0]?.connected, true)
  assert.equal(students[0]?.lastSeen, 30)
  assert.equal(students[0]?.stats.total, 4)

  const created = updatePythonListPracticeStudentStats(students, {
    participantId: null,
    participantName: 'Lin',
    stats: sampleStats,
    now: 40,
  })

  assert.ok(created)
  assert.equal(created?.name, 'Lin')
  assert.match(String(created?.id), /^[a-f0-9]{16}$/)
  assert.equal(students.length, 2)
})

void test('disconnectPythonListPracticeStudent prefers participantId and falls back to legacy name', () => {
  const students: PythonListPracticeStudent[] = [
    { id: 'student-1', name: 'Ada', stats: sampleStats, connected: true, lastSeen: 5 },
    { id: '', name: 'Grace', stats: sampleStats, connected: true, lastSeen: 6 },
  ]

  disconnectPythonListPracticeStudent(students, 'student-1', null, 50)
  disconnectPythonListPracticeStudent(students, null, 'Grace', 60)

  assert.equal(students[0]?.connected, false)
  assert.equal(students[0]?.lastSeen, 50)
  assert.equal(students[1]?.connected, false)
  assert.equal(students[1]?.lastSeen, 60)
})
