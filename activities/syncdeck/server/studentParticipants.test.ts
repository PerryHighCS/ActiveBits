import { acceptEntryParticipant } from 'activebits-server/core/acceptedEntryParticipants.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { connectSyncDeckStudent } from './studentParticipants.js'

void test('connectSyncDeckStudent updates an existing student by participantId', () => {
  const session = {
    data: {
      students: [{
        studentId: 'student-1',
        name: 'Old Name',
        joinedAt: 100,
        lastSeenAt: 110,
        lastIndices: null,
        lastStudentStateAt: null,
      }],
    },
  }

  const result = connectSyncDeckStudent(session, 'student-1', 220)

  assert.equal(result?.isNew, false)
  assert.equal(result?.participantId, 'student-1')
  assert.equal(session.data.students[0]?.name, 'Old Name')
  assert.equal(session.data.students[0]?.joinedAt, 100)
  assert.equal(session.data.students[0]?.lastSeenAt, 220)
})

void test('connectSyncDeckStudent creates a new student from accepted entry when participantId is unknown to the student list', () => {
  const session: {
    data: {
      students: Array<{
        studentId: string
        name: string
        joinedAt: number
        lastSeenAt: number
        lastIndices: { h: number; v: number; f: number } | null
        lastStudentStateAt: number | null
      }>
    }
  } = {
    data: {
      students: [],
    },
  }
  acceptEntryParticipant(session as never, {
    participantId: 'participant-1',
    displayName: 'Ada Lovelace',
  }, 123)

  const result = connectSyncDeckStudent(session, 'participant-1', 456)

  assert.equal(result?.isNew, true)
  assert.equal(result?.participantId, 'participant-1')
  assert.equal(session.data.students.length, 1)
  assert.equal(session.data.students[0]?.name ?? null, 'Ada Lovelace')
})

void test('connectSyncDeckStudent returns null when participantId is missing', () => {
  const session = {
    data: {
      students: [],
    },
  }

  const result = connectSyncDeckStudent(session, null, 456)

  assert.equal(result, null)
  assert.equal(session.data.students.length, 0)
})

void test('connectSyncDeckStudent returns null when participantId has no accepted-entry record and no existing student', () => {
  const session = {
    data: {
      students: [],
    },
  }

  const result = connectSyncDeckStudent(session, 'missing-student', 456)

  assert.equal(result, null)
  assert.equal(session.data.students.length, 0)
})
