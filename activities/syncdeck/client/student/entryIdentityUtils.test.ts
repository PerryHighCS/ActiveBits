import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveSyncDeckStudentIdentity } from './entryIdentityUtils.js'

void test('resolveSyncDeckStudentIdentity prefers stored SyncDeck identity when present', () => {
  assert.deepEqual(resolveSyncDeckStudentIdentity(
    {
      studentName: 'Ada Lovelace',
      studentId: 'student-1',
    },
    {
      displayName: 'Grace Hopper',
      participantId: 'participant-1',
    },
  ), {
    studentName: 'Ada Lovelace',
    studentId: 'student-1',
    needsWaitingRoomRestart: false,
  })
})

void test('resolveSyncDeckStudentIdentity falls back to accepted waiting-room identity', () => {
  assert.deepEqual(resolveSyncDeckStudentIdentity(
    {
      studentName: '',
      studentId: '',
    },
    {
      displayName: 'Grace Hopper',
      participantId: 'participant-1',
    },
  ), {
    studentName: 'Grace Hopper',
    studentId: 'participant-1',
    needsWaitingRoomRestart: false,
  })
})

void test('resolveSyncDeckStudentIdentity requests waiting-room restart when no usable identity exists', () => {
  assert.deepEqual(resolveSyncDeckStudentIdentity(
    {
      studentName: '',
      studentId: '',
    },
    {
      displayName: '',
      participantId: '',
    },
  ), {
    studentName: '',
    studentId: '',
    needsWaitingRoomRestart: true,
  })
})
