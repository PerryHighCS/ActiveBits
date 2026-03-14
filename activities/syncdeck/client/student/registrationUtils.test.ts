import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSyncDeckRegistrationRequest,
  resolveSyncDeckInitialRegistrationState,
  shouldAutoRegisterSyncDeckStudent,
} from './registrationUtils.js'

void test('resolveSyncDeckInitialRegistrationState prefers stored registration when present', () => {
  assert.deepEqual(resolveSyncDeckInitialRegistrationState(
    {
      studentName: 'Ada Lovelace',
      studentId: 'student-1',
    },
    {
      displayName: 'Grace Hopper',
      participantId: 'participant-1',
    },
  ), {
    studentNameInput: 'Ada Lovelace',
    registeredStudentName: 'Ada Lovelace',
    registeredStudentId: 'student-1',
    pendingAcceptedParticipantId: '',
  })
})

void test('resolveSyncDeckInitialRegistrationState falls back to accepted-entry identity when no stored registration exists', () => {
  assert.deepEqual(resolveSyncDeckInitialRegistrationState(
    {
      studentName: '',
      studentId: '',
    },
    {
      displayName: 'Grace Hopper',
      participantId: 'participant-1',
    },
  ), {
    studentNameInput: 'Grace Hopper',
    registeredStudentName: '',
    registeredStudentId: '',
    pendingAcceptedParticipantId: 'participant-1',
  })
})

void test('buildSyncDeckRegistrationRequest includes participantId only when present', () => {
  assert.deepEqual(buildSyncDeckRegistrationRequest('  Ada Lovelace  ', '  participant-1  '), {
    name: 'Ada Lovelace',
    participantId: 'participant-1',
  })

  assert.deepEqual(buildSyncDeckRegistrationRequest('Ada Lovelace', ''), {
    name: 'Ada Lovelace',
  })
})

void test('shouldAutoRegisterSyncDeckStudent only when accepted entry identity still needs registration', () => {
  assert.equal(shouldAutoRegisterSyncDeckStudent({
    isRegisteringStudent: false,
    pendingAcceptedParticipantId: 'participant-1',
    registeredStudentId: '',
    registeredStudentName: '',
    studentNameInput: 'Ada Lovelace',
  }), true)

  assert.equal(shouldAutoRegisterSyncDeckStudent({
    isRegisteringStudent: false,
    pendingAcceptedParticipantId: '',
    registeredStudentId: '',
    registeredStudentName: '',
    studentNameInput: 'Ada Lovelace',
  }), false)

  assert.equal(shouldAutoRegisterSyncDeckStudent({
    isRegisteringStudent: false,
    pendingAcceptedParticipantId: 'participant-1',
    registeredStudentId: 'participant-1',
    registeredStudentName: 'Ada Lovelace',
    studentNameInput: 'Ada Lovelace',
  }), false)
})
