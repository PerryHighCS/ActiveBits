import test from 'node:test'
import assert from 'node:assert/strict'
import { connectSessionParticipant } from './core/sessionParticipants.js'

interface TestParticipant {
  id?: string
  name: string
  connected?: boolean
  joined?: number
  lastSeen?: number
}

void test('connectSessionParticipant reconnects by participantId when present', () => {
  const participants: TestParticipant[] = [
    { id: 'student-1', name: 'Ada', connected: false, joined: 10, lastSeen: 10 },
  ]

  const result = connectSessionParticipant({
    participants,
    participantId: 'student-1',
    participantName: 'Ada',
    now: 20,
    createParticipant: (id, name, now) => ({ id, name, connected: true, joined: now, lastSeen: now }),
    generateParticipantId: () => 'generated-id',
  })

  assert.equal(result.isNew, false)
  assert.equal(result.participantId, 'student-1')
  assert.equal(participants[0]?.connected, true)
  assert.equal(participants[0]?.lastSeen, 20)
})

void test('connectSessionParticipant can reconnect unnamed legacy participants by name', () => {
  const participants: TestParticipant[] = [
    { name: 'Grace', connected: false, joined: 10, lastSeen: 10 },
  ]

  const result = connectSessionParticipant({
    participants,
    participantId: null,
    participantName: 'Grace',
    now: 30,
    allowLegacyUnnamedMatch: true,
    createParticipant: (id, name, now) => ({ id, name, connected: true, joined: now, lastSeen: now }),
    generateParticipantId: () => 'generated-id',
  })

  assert.equal(result.isNew, false)
  assert.equal(result.participantId, 'generated-id')
  assert.equal(participants[0]?.id, 'generated-id')
  assert.equal(participants[0]?.connected, true)
})

void test('connectSessionParticipant creates a new participant when none match', () => {
  const participants: TestParticipant[] = []

  const result = connectSessionParticipant({
    participants,
    participantId: null,
    participantName: 'Lin',
    now: 40,
    createParticipant: (id, name, now) => ({ id, name, connected: true, joined: now, lastSeen: now }),
    generateParticipantId: () => 'generated-id',
  })

  assert.equal(result.isNew, true)
  assert.equal(result.participantId, 'generated-id')
  assert.equal(participants.length, 1)
  assert.deepEqual(participants[0], {
    id: 'generated-id',
    name: 'Lin',
    connected: true,
    joined: 40,
    lastSeen: 40,
  })
})
