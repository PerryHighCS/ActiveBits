import assert from 'node:assert/strict'
import test from 'node:test'
import { connectSyncDeckStudent, registerSyncDeckStudent } from './studentParticipants.js'

void test('registerSyncDeckStudent creates a new syncdeck student record', () => {
  const students = []

  const result = registerSyncDeckStudent(students, 'Ada Lovelace', 123)

  assert.equal(result.student.name, 'Ada Lovelace')
  assert.equal(result.student.joinedAt, 123)
  assert.equal(result.student.lastSeenAt, 123)
  assert.equal(typeof result.participantId, 'string')
  assert.equal(result.participantId.length, 16)
  assert.equal(result.isNew, true)
  assert.deepEqual(students, [result.student])
})

void test('registerSyncDeckStudent reuses a provided participantId when present', () => {
  const students = []

  const result = registerSyncDeckStudent(students, 'Ada Lovelace', 123, 'participant-1')

  assert.equal(result.participantId, 'participant-1')
  assert.equal(result.student.studentId, 'participant-1')
  assert.equal(result.isNew, true)
})

void test('registerSyncDeckStudent updates an existing record when provided participantId is already registered', () => {
  const students = [{
    studentId: 'participant-1',
    name: 'Old Name',
    joinedAt: 100,
    lastSeenAt: 110,
    lastIndices: null,
    lastStudentStateAt: null,
  }]

  const result = registerSyncDeckStudent(students, 'Ada Lovelace', 220, 'participant-1')

  assert.equal(result.participantId, 'participant-1')
  assert.equal(result.student.name, 'Ada Lovelace')
  assert.equal(result.student.joinedAt, 100)
  assert.equal(result.student.lastSeenAt, 220)
  assert.equal(result.isNew, false)
})

void test('connectSyncDeckStudent updates an existing student by participantId', () => {
  const students = [{
    studentId: 'student-1',
    name: 'Old Name',
    joinedAt: 100,
    lastSeenAt: 110,
    lastIndices: null,
    lastStudentStateAt: null,
  }]

  const result = connectSyncDeckStudent(students, 'student-1', 'New Name', 220)

  assert.equal(result.isNew, false)
  assert.equal(result.participantId, 'student-1')
  assert.equal(students[0]?.name, 'New Name')
  assert.equal(students[0]?.joinedAt, 100)
  assert.equal(students[0]?.lastSeenAt, 220)
})

void test('connectSyncDeckStudent creates a new student when participantId is unknown', () => {
  const students = []

  const result = connectSyncDeckStudent(students, 'missing-student', 'Ada Lovelace', 456)

  assert.equal(result, null)
  assert.equal(students.length, 0)
})

void test('connectSyncDeckStudent returns null when participantId is missing', () => {
  const students = []

  const result = connectSyncDeckStudent(students, null, 'Ada Lovelace', 456)

  assert.equal(result, null)
  assert.equal(students.length, 0)
})
