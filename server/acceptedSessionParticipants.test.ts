import assert from 'node:assert/strict'
import test from 'node:test'
import { acceptEntryParticipant } from './core/acceptedEntryParticipants.js'
import { connectAcceptedSessionParticipant } from './core/acceptedSessionParticipants.js'
import type { SessionRecord } from './core/sessions.js'

interface TestParticipant {
  id?: string
  name: string
  connected?: boolean
  lastSeen?: number
}

function createSessionRecord(id: string): SessionRecord {
  return {
    id,
    type: 'java-string-practice',
    created: Date.now(),
    lastActivity: Date.now(),
    data: {},
  }
}

void test('connectAcceptedSessionParticipant uses explicit participant names when present', () => {
  const session = createSessionRecord('session-1')
  const participants: TestParticipant[] = []

  const result = connectAcceptedSessionParticipant({
    session,
    participants,
    participantId: 'participant-1',
    participantName: 'Ada',
    createParticipant: (participantId, participantName, now) => ({
      id: participantId,
      name: participantName,
      connected: true,
      lastSeen: now,
    }),
    generateParticipantId: () => 'generated-id',
  })

  assert.equal(result?.participantName, 'Ada')
  assert.equal(participants[0]?.name, 'Ada')
})

void test('connectAcceptedSessionParticipant falls back to accepted-entry display name by participantId', () => {
  const session = createSessionRecord('session-2')
  acceptEntryParticipant(session, {
    participantId: 'participant-1',
    displayName: 'Grace',
  }, 123)

  const participants: TestParticipant[] = []
  const result = connectAcceptedSessionParticipant({
    session,
    participants,
    participantId: 'participant-1',
    participantName: null,
    createParticipant: (participantId, participantName, now) => ({
      id: participantId,
      name: participantName,
      connected: true,
      lastSeen: now,
    }),
    generateParticipantId: () => 'generated-id',
  })

  assert.equal(result?.participantName, 'Grace')
  assert.equal(result?.participantId, 'participant-1')
  assert.equal(participants[0]?.id, 'participant-1')
  assert.equal(participants[0]?.name, 'Grace')
})

void test('connectAcceptedSessionParticipant returns null when neither explicit nor accepted-entry name exists', () => {
  const session = createSessionRecord('session-3')
  const participants: TestParticipant[] = []

  const result = connectAcceptedSessionParticipant({
    session,
    participants,
    participantId: 'participant-1',
    participantName: null,
    createParticipant: (participantId, participantName, now) => ({
      id: participantId,
      name: participantName,
      connected: true,
      lastSeen: now,
    }),
    generateParticipantId: () => 'generated-id',
  })

  assert.equal(result, null)
  assert.deepEqual(participants, [])
})
