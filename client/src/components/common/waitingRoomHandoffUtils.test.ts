import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildEntryParticipantStorageKey,
  type EntryParticipantStorageLike,
} from './entryParticipantStorage'
import { persistWaitingRoomServerBackedHandoff } from './waitingRoomHandoffUtils'
import { readSessionParticipantContext } from './sessionParticipantContext'

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

void test('persistWaitingRoomServerBackedHandoff stores an opaque token on success', async () => {
  const storage = createStorage()
  const storageKey = buildEntryParticipantStorageKey('java-string-practice', 'session', 'session-1')

  await persistWaitingRoomServerBackedHandoff({
    storage,
    storageKey,
    values: { displayName: 'Ada' },
    submitApiUrl: '/api/session/session-1/entry-participant',
    sessionParticipantContextSessionId: 'session-1',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          entryParticipantToken: ' token-123 ',
          values: { displayName: 'Ada', participantId: 'participant-1' },
        }
      },
    }),
  })

  assert.deepEqual(JSON.parse(String(storage.getItem(storageKey))), {
    kind: 'token',
    token: 'token-123',
  })
  assert.deepEqual(readSessionParticipantContext(storage, 'session-1'), {
    studentName: 'Ada',
    studentId: 'participant-1',
  })
})

void test('persistWaitingRoomServerBackedHandoff stores persistent hash with solo token handoff', async () => {
  const storage = createStorage()
  const storageKey = buildEntryParticipantStorageKey('java-string-practice', 'solo', 'java-string-practice')

  await persistWaitingRoomServerBackedHandoff({
    storage,
    storageKey,
    values: { displayName: 'Ada' },
    submitApiUrl: '/api/persistent-session/hash-1/entry-participant?activityName=java-string-practice',
    persistentHash: 'hash-1',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { entryParticipantToken: 'token-solo' }
      },
    }),
  })

  assert.deepEqual(JSON.parse(String(storage.getItem(storageKey))), {
    kind: 'token',
    token: 'token-solo',
    persistentHash: 'hash-1',
  })
})

void test('persistWaitingRoomServerBackedHandoff falls back to local values when server write fails', async () => {
  const storage = createStorage()
  const storageKey = buildEntryParticipantStorageKey('java-string-practice', 'session', 'session-2')
  const warnings: string[] = []

  await persistWaitingRoomServerBackedHandoff({
    storage,
    storageKey,
    values: { displayName: 'Grace' },
    submitApiUrl: '/api/session/session-2/entry-participant',
    sessionParticipantContextSessionId: 'session-2',
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      async json() {
        return {}
      },
    }),
    onWarn: (message) => warnings.push(message),
  })

  assert.deepEqual(JSON.parse(String(storage.getItem(storageKey))), {
    kind: 'values',
    values: { displayName: 'Grace' },
  })
  assert.deepEqual(readSessionParticipantContext(storage, 'session-2'), {
    studentName: 'Grace',
    studentId: null,
  })
  assert.equal(warnings[0], '[WaitingRoom] Failed to store entry participant on server, falling back to client handoff:')
})

void test('persistWaitingRoomServerBackedHandoff falls back to local values when token is missing', async () => {
  const storage = createStorage()
  const storageKey = buildEntryParticipantStorageKey('java-string-practice', 'session', 'session-3')

  await persistWaitingRoomServerBackedHandoff({
    storage,
    storageKey,
    values: { displayName: 'Lin' },
    submitApiUrl: '/api/session/session-3/entry-participant',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {}
      },
    }),
  })

  assert.deepEqual(JSON.parse(String(storage.getItem(storageKey))), {
    kind: 'values',
    values: { displayName: 'Lin' },
  })
})
