import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acceptEntryParticipant,
  findAcceptedEntryParticipant,
  resolveAcceptedEntryParticipantName,
} from './core/acceptedEntryParticipants.js'
import type { SessionRecord } from './core/sessions.js'

function createSessionRecord(id: string): SessionRecord {
  return {
    id,
    type: 'java-string-practice',
    created: Date.now(),
    lastActivity: Date.now(),
    data: {},
  }
}

void test('acceptEntryParticipant stores accepted participant records on the session by participantId', () => {
  const session = createSessionRecord('session-1')

  const record = acceptEntryParticipant(session, {
    participantId: 'participant-1',
    displayName: 'Ada',
  }, 123)

  assert.deepEqual(record, {
    participantId: 'participant-1',
    displayName: 'Ada',
    acceptedAt: 123,
  })
  assert.deepEqual(findAcceptedEntryParticipant(session, 'participant-1'), record)
})

void test('acceptEntryParticipant ignores missing participantId values', () => {
  const session = createSessionRecord('session-2')

  assert.equal(acceptEntryParticipant(session, { displayName: 'Ada' }, 123), null)
  assert.equal(findAcceptedEntryParticipant(session, 'participant-1'), null)
})

void test('resolveAcceptedEntryParticipantName prefers explicit fallback names before accepted-entry records', () => {
  const session = createSessionRecord('session-3')
  acceptEntryParticipant(session, {
    participantId: 'participant-1',
    displayName: 'Ada',
  }, 123)

  assert.equal(resolveAcceptedEntryParticipantName(session, 'participant-1', 'Grace'), 'Grace')
  assert.equal(resolveAcceptedEntryParticipantName(session, 'participant-1', null), 'Ada')
  assert.equal(resolveAcceptedEntryParticipantName(session, 'missing', null), null)
})
