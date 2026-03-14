import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSessionEntryParticipantStorageKey,
  buildSoloEntryParticipantStorageKey,
  persistEntryParticipantToken,
  persistEntryParticipantValues,
  type EntryParticipantStorageLike,
} from './entryParticipantStorage'
import {
  persistSessionParticipantIdentity,
  resolveInitialEntryParticipantIdentity,
} from './entryParticipantIdentityUtils'

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

void test('persistSessionParticipantIdentity stores session participant name and optional id', () => {
  const storage = createStorage()

  persistSessionParticipantIdentity(storage, 'session-1', 'Ada', 'participant-1')

  assert.equal(storage.getItem('student-name-session-1'), 'Ada')
  assert.equal(storage.getItem('student-id-session-1'), 'participant-1')
})

void test('resolveInitialEntryParticipantIdentity prefers stored live-session identity', async () => {
  const localStorage = createStorage()
  const sessionStorage = createStorage()
  persistSessionParticipantIdentity(localStorage, 'session-1', 'Grace', 'participant-1')
  persistEntryParticipantValues(
    sessionStorage,
    buildSessionEntryParticipantStorageKey('java-string-practice', 'session-1'),
    { displayName: 'Ignored', participantId: 'participant-2' },
  )

  const identity = await resolveInitialEntryParticipantIdentity({
    activityName: 'java-string-practice',
    sessionId: 'session-1',
    isSoloSession: false,
    localStorage,
    sessionStorage,
  })

  assert.deepEqual(identity, {
    studentName: 'Grace',
    studentId: 'participant-1',
    nameSubmitted: true,
  })
})

void test('resolveInitialEntryParticipantIdentity promotes preflight values into stored live-session identity', async () => {
  const localStorage = createStorage()
  const sessionStorage = createStorage()
  persistEntryParticipantValues(
    sessionStorage,
    buildSessionEntryParticipantStorageKey('java-string-practice', 'session-2'),
    { displayName: 'Ada', participantId: 'participant-2' },
  )

  const identity = await resolveInitialEntryParticipantIdentity({
    activityName: 'java-string-practice',
    sessionId: 'session-2',
    isSoloSession: false,
    localStorage,
    sessionStorage,
  })

  assert.deepEqual(identity, {
    studentName: 'Ada',
    studentId: 'participant-2',
    nameSubmitted: true,
  })
  assert.equal(localStorage.getItem('student-name-session-2'), 'Ada')
  assert.equal(localStorage.getItem('student-id-session-2'), 'participant-2')
})

void test('resolveInitialEntryParticipantIdentity resolves solo identity from preflight token', async () => {
  const sessionStorage = createStorage()
  persistEntryParticipantToken(
    sessionStorage,
    buildSoloEntryParticipantStorageKey('java-string-practice'),
    'token-solo',
    { persistentHash: 'hash-1' },
  )

  const identity = await resolveInitialEntryParticipantIdentity(
    {
      activityName: 'java-string-practice',
      sessionId: undefined,
      isSoloSession: true,
      localStorage: createStorage(),
      sessionStorage,
    },
    async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          values: {
            displayName: 'Solo Ada',
            participantId: 'participant-solo',
          },
        }
      },
    }),
  )

  assert.deepEqual(identity, {
    studentName: 'Solo Ada',
    studentId: 'participant-solo',
    nameSubmitted: true,
  })
})

void test('resolveInitialEntryParticipantIdentity returns unsubmited live identity when no saved or preflight values exist', async () => {
  const identity = await resolveInitialEntryParticipantIdentity({
    activityName: 'java-string-practice',
    sessionId: 'session-3',
    isSoloSession: false,
    localStorage: createStorage(),
    sessionStorage: createStorage(),
  })

  assert.deepEqual(identity, {
    studentName: '',
    studentId: null,
    nameSubmitted: false,
  })
})
