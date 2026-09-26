import test from 'node:test'
import assert from 'node:assert/strict'
import {
  consumeEntryParticipant,
  normalizeEntryParticipantValues,
  storeEntryParticipant,
  storeTrustedEntryParticipant,
  type EntryParticipantContainer,
} from './core/entryParticipants.js'

function createContainer(): EntryParticipantContainer {
  return {}
}

void test('normalizeEntryParticipantValues keeps only serializable values', () => {
  assert.deepEqual(normalizeEntryParticipantValues({
    displayName: 'Ada',
    nested: { team: 'red' },
    ignored: () => 'x',
  }), {
    displayName: 'Ada',
    nested: { team: 'red' },
  })
})

void test('public entry store mints an id even when the request supplies one', () => {
  const explicitContainer = createContainer()
  const explicit = storeEntryParticipant(explicitContainer, {
    displayName: 'Grace',
    participantId: '  participant-1  ',
  })

  assert.match(explicit.token, /^[a-f0-9]{16}$/)
  assert.equal(explicit.values.displayName, 'Grace')
  assert.match(String(explicit.values.participantId), /^[a-f0-9]{16}$/)
  assert.notEqual(explicit.values.participantId, 'participant-1')

  const generated = storeEntryParticipant(createContainer(), {
    displayName: 'Lin',
  })
  assert.match(String(generated.values.participantId), /^[a-f0-9]{16}$/)
})

void test('server-authorized entry store preserves its explicit parent participant id', () => {
  const stored = storeTrustedEntryParticipant(createContainer(), {
    displayName: 'Ada', participantId: 'untrusted-value',
  }, '  parent-student-1  ')
  assert.deepEqual(stored.values, { displayName: 'Ada', participantId: 'parent-student-1' })
})

void test('consumeEntryParticipant trims token and only succeeds once', () => {
  const container = createContainer()
  const stored = storeEntryParticipant(container, {
    displayName: 'Ada',
  })

  assert.deepEqual(consumeEntryParticipant(container, `  ${stored.token}  `), stored.values)
  assert.equal(consumeEntryParticipant(container, stored.token), null)
  assert.equal(consumeEntryParticipant(container, '   '), null)
})
