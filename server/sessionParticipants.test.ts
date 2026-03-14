import test from 'node:test'
import assert from 'node:assert/strict'
import {
  connectSessionParticipant,
  disconnectSessionParticipant,
  findSessionParticipant,
  updateSessionParticipant,
} from './core/sessionParticipants.js'

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

void test('findSessionParticipant prefers participantId and can fall back to unnamed legacy match by name', () => {
  const participants: TestParticipant[] = [
    { id: 'student-1', name: 'Ada', connected: true, joined: 10, lastSeen: 10 },
    { name: 'Grace', connected: false, joined: 12, lastSeen: 12 },
  ]

  assert.equal(
    findSessionParticipant({
      participants,
      participantId: 'student-1',
      participantName: 'Wrong Name',
    }),
    participants[0],
  )

  assert.equal(
    findSessionParticipant({
      participants,
      participantId: null,
      participantName: 'Grace',
      allowLegacyUnnamedMatch: true,
    }),
    participants[1],
  )

  assert.equal(
    findSessionParticipant({
      participants,
      participantId: null,
      participantName: 'Ada',
      allowLegacyUnnamedMatch: true,
    }),
    undefined,
  )
})

void test('updateSessionParticipant touches lastSeen and updates a matched participant', () => {
  const participants: TestParticipant[] = [
    { id: 'student-1', name: 'Ada', connected: true, joined: 10, lastSeen: 10 },
  ]

  const updated = updateSessionParticipant({
    participants,
    participantId: 'student-1',
    now: 25,
    update: (participant) => {
      participant.connected = false
    },
  })

  assert.equal(updated, participants[0])
  assert.equal(participants[0]?.connected, false)
  assert.equal(participants[0]?.lastSeen, 25)
})

void test('disconnectSessionParticipant marks a matched participant disconnected and updates lastSeen', () => {
  const participants: TestParticipant[] = [
    { id: 'student-2', name: 'Grace', connected: true, joined: 10, lastSeen: 10 },
  ]

  const disconnected = disconnectSessionParticipant({
    participants,
    participantId: 'student-2',
    now: 35,
  })

  assert.equal(disconnected, participants[0])
  assert.equal(participants[0]?.connected, false)
  assert.equal(participants[0]?.lastSeen, 35)
})
