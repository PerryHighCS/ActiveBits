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

void test('storeSessionEntryParticipant prunes oldest tokens when session storage exceeds the limit', () => {
  const session = createSession()
  const tokens: string[] = []

  for (let index = 0; index < 101; index += 1) {
    const { token } = storeSessionEntryParticipant(session, {
      displayName: `Student-${index}`,
    })
    tokens.push(token)
  }

  const container = session.data.entryParticipants as Record<string, unknown>
  assert.equal(Object.keys(container).length, 100)
  assert.equal(container[tokens[0] as string], undefined)
  assert.notEqual(container[tokens[100] as string], undefined)
})

void test('storeSessionEntryParticipant rejects oversized payloads without storing a token', () => {
  const session = createSession()
  const oversized = 'x'.repeat(9000)

  assert.throws(
    () => storeSessionEntryParticipant(session, { displayName: oversized }),
    /entry participant payload too large/,
  )

  const container = session.data.entryParticipants as Record<string, unknown> | undefined
  assert.equal(container == null ? 0 : Object.keys(container).length, 0)
})
