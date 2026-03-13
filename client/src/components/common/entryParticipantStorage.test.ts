import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildEntryParticipantStorageKey,
  consumeEntryParticipantValues,
  getEntryParticipantDisplayName,
  persistEntryParticipantValues,
  type EntryParticipantStorageLike,
} from './entryParticipantStorage'

function createStorage(): EntryParticipantStorageLike {
  const values = new Map<string, string>()

  return {
    getItem(key) {
      return values.get(key) ?? null
    },
    setItem(key, value) {
      values.set(key, value)
    },
    removeItem(key) {
      values.delete(key)
    },
  }
}

void test('buildEntryParticipantStorageKey namespaces by activity and destination', () => {
  assert.equal(
    buildEntryParticipantStorageKey('java-string-practice', 'session', 'abc123'),
    'entry-participant:java-string-practice:session:abc123',
  )
})

void test('persistEntryParticipantValues and consumeEntryParticipantValues round-trip serializable values', () => {
  const storage = createStorage()
  const storageKey = buildEntryParticipantStorageKey('java-string-practice', 'session', 'session-1')

  persistEntryParticipantValues(storage, storageKey, {
    displayName: 'Ada',
    team: 'red',
  })

  assert.deepEqual(consumeEntryParticipantValues(storage, storageKey), {
    displayName: 'Ada',
    team: 'red',
  })
  assert.equal(storage.getItem(storageKey), null)
})

void test('consumeEntryParticipantValues drops malformed payloads after removing them from storage', () => {
  const storage = createStorage()
  const storageKey = buildEntryParticipantStorageKey('java-string-practice', 'session', 'session-2')
  const warnings: string[] = []

  storage.setItem(storageKey, '{not-json')

  assert.equal(
    consumeEntryParticipantValues(storage, storageKey, (message) => warnings.push(message)),
    null,
  )
  assert.equal(storage.getItem(storageKey), null)
  assert.equal(warnings.length, 1)
})

void test('getEntryParticipantDisplayName returns trimmed display names only', () => {
  assert.equal(getEntryParticipantDisplayName({ displayName: '  Grace Hopper  ' }), 'Grace Hopper')
  assert.equal(getEntryParticipantDisplayName({ displayName: '   ' }), null)
  assert.equal(getEntryParticipantDisplayName({ team: 'blue' }), null)
})
