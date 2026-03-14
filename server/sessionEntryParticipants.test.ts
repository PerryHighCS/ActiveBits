import test from 'node:test'
import assert from 'node:assert/strict'
import { consumeSessionEntryParticipant, storeSessionEntryParticipant } from './core/sessionEntryParticipants.js'
import type { SessionRecord } from './core/sessions.js'

function createSession(): SessionRecord {
  return {
    id: 'session-1',
    type: 'java-string-practice',
    created: 1,
    lastActivity: 1,
    data: {},
  }
}

void test('storeSessionEntryParticipant filters unsupported values and normalizes participantId', () => {
  const session = createSession()

  const { token, values } = storeSessionEntryParticipant(session, {
    displayName: 'Ada',
    participantId: '  participant-1  ',
    nested: { team: 'red' },
    ignored: () => 'not-serializable',
  })

  assert.match(token, /^[a-f0-9]{16}$/)
  assert.deepEqual(values, {
    displayName: 'Ada',
    participantId: 'participant-1',
    nested: { team: 'red' },
  })
})

void test('consumeSessionEntryParticipant trims tokens and only allows one successful consume', () => {
  const session = createSession()
  const { token, values } = storeSessionEntryParticipant(session, {
    displayName: 'Grace',
  })

  assert.deepEqual(consumeSessionEntryParticipant(session, `  ${token}  `), values)
  assert.equal(consumeSessionEntryParticipant(session, token), null)
})

void test('consumeSessionEntryParticipant returns null for missing or blank tokens', () => {
  const session = createSession()
  const { token, values } = storeSessionEntryParticipant(session, {
    displayName: 'Lin',
  })

  assert.equal(consumeSessionEntryParticipant(session, '   '), null)
  assert.deepEqual(consumeSessionEntryParticipant(session, token), values)
  assert.equal(consumeSessionEntryParticipant(session, token), null)
})
