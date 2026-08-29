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

void test('storeEntryParticipant always mints a server-issued participantId and ignores a request-supplied one', () => {
  const forgedContainer = createContainer()
  const forged = storeEntryParticipant(forgedContainer, {
    displayName: 'Grace',
    // A caller trying to claim another participant's identity.
    participantId: 'victim-participant-id',
  })

  assert.match(forged.token, /^[a-f0-9]{16}$/)
  assert.equal(forged.values.displayName, 'Grace')
  assert.notEqual(forged.values.participantId, 'victim-participant-id')
  assert.match(String(forged.values.participantId), /^[a-f0-9]{16}$/)

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
