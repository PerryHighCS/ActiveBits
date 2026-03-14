import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSessionEntryParticipantStorageKey,
  buildSoloEntryParticipantStorageKey,
  buildEntryParticipantStorageKey,
  consumeEntryParticipantDisplayName,
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

void test('buildSessionEntryParticipantStorageKey and buildSoloEntryParticipantStorageKey use stable destination namespaces', () => {
  assert.equal(
    buildSessionEntryParticipantStorageKey('java-string-practice', 'abc123'),
    'entry-participant:java-string-practice:session:abc123',
  )
  assert.equal(
    buildSoloEntryParticipantStorageKey('java-string-practice'),
    'entry-participant:java-string-practice:solo:java-string-practice',
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

void test('consumeEntryParticipantDisplayName reads the correct session or solo handoff key', () => {
  const storage = createStorage()

  persistEntryParticipantValues(
    storage,
    buildSessionEntryParticipantStorageKey('java-string-practice', 'session-1'),
    { displayName: 'Ada' },
  )
  persistEntryParticipantValues(
    storage,
    buildSoloEntryParticipantStorageKey('java-string-practice'),
    { displayName: 'Grace' },
  )

  assert.equal(
    consumeEntryParticipantDisplayName(storage, {
      activityName: 'java-string-practice',
      sessionId: 'session-1',
      isSoloSession: false,
    }),
    'Ada',
  )
  assert.equal(
    consumeEntryParticipantDisplayName(storage, {
      activityName: 'java-string-practice',
      sessionId: 'solo-java-string-practice',
      isSoloSession: true,
    }),
    'Grace',
  )
})
