import test from 'node:test'
import assert from 'node:assert/strict'
import {
  consumeEntryParticipant,
  normalizeEntryParticipantValues,
  storeEntryParticipant,
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

void test('storeEntryParticipant trims participantId or mints one when missing', () => {
  const explicitContainer = createContainer()
  const explicit = storeEntryParticipant(explicitContainer, {
    displayName: 'Grace',
    participantId: '  participant-1  ',
  })

  assert.match(explicit.token, /^[a-f0-9]{16}$/)
  assert.deepEqual(explicit.values, {
    displayName: 'Grace',
    participantId: 'participant-1',
  })

  const generated = storeEntryParticipant(createContainer(), {
    displayName: 'Lin',
  })
  assert.match(String(generated.values.participantId), /^[a-f0-9]{16}$/)
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
