import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSessionEntryParticipantConsumeApiUrl,
  buildPersistentEntryParticipantConsumeApiUrl,
  buildPersistentEntryParticipantSubmitApiUrl,
  buildSessionEntryParticipantStorageKey,
  buildSessionEntryParticipantSubmitApiUrl,
  buildSoloEntryParticipantStorageKey,
  buildEntryParticipantStorageKey,
  consumeEntryParticipantDisplayName,
  consumeEntryParticipantParticipantId,
  consumeResolvedEntryParticipantValues,
  consumeEntryParticipantValues,
  getEntryParticipantDisplayName,
  getEntryParticipantParticipantId,
  hasEntryParticipantHandoffStorageValue,
  hasValidEntryParticipantHandoffStorageValue,
  persistEntryParticipantToken,
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

void test('buildSessionEntryParticipant submit/consume URLs encode session values', () => {
  assert.equal(
    buildSessionEntryParticipantSubmitApiUrl('session/1'),
    '/api/session/session%2F1/entry-participant',
  )
  assert.equal(
    buildSessionEntryParticipantConsumeApiUrl('session/1'),
    '/api/session/session%2F1/entry-participant/consume',
  )
})

void test('buildPersistentEntryParticipant submit/consume URLs encode hash and preserve activity context', () => {
  assert.equal(
    buildPersistentEntryParticipantSubmitApiUrl('hash/1', 'java-string-practice'),
    '/api/persistent-session/hash%2F1/entry-participant?activityName=java-string-practice',
  )
  assert.equal(
    buildPersistentEntryParticipantConsumeApiUrl('hash/1', 'java-string-practice'),
    '/api/persistent-session/hash%2F1/entry-participant/consume?activityName=java-string-practice',
  )
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

void test('hasEntryParticipantHandoffStorageValue is a pure presence check and does not clean malformed storage', () => {
  const storage = createStorage()
  const storageKey = buildEntryParticipantStorageKey('java-string-practice', 'session', 'session-presence')

  storage.setItem(storageKey, '{not-json')

  assert.equal(hasEntryParticipantHandoffStorageValue(storage, storageKey), true)
  assert.equal(storage.getItem(storageKey), '{not-json')
})

void test('hasValidEntryParticipantHandoffStorageValue returns false for malformed or invalid payloads without cleaning storage', () => {
  const storage = createStorage()
  const malformedKey = buildEntryParticipantStorageKey('java-string-practice', 'session', 'session-invalid-json')
  const wrongShapeKey = buildEntryParticipantStorageKey('java-string-practice', 'session', 'session-wrong-shape')

  storage.setItem(malformedKey, '{not-json')
  storage.setItem(wrongShapeKey, JSON.stringify({ nope: true }))

  assert.equal(hasValidEntryParticipantHandoffStorageValue(storage, malformedKey), false)
  assert.equal(hasValidEntryParticipantHandoffStorageValue(storage, wrongShapeKey), false)
  assert.equal(storage.getItem(malformedKey), '{not-json')
  assert.equal(storage.getItem(wrongShapeKey), JSON.stringify({ nope: true }))
})

void test('hasValidEntryParticipantHandoffStorageValue returns true for valid handoff payloads', () => {
  const storage = createStorage()
  const valuesKey = buildEntryParticipantStorageKey('java-string-practice', 'session', 'session-values')
  const tokenKey = buildEntryParticipantStorageKey('java-string-practice', 'session', 'session-token')

  storage.setItem(valuesKey, JSON.stringify({
    kind: 'values',
    values: { displayName: 'Ada' },
  }))
  storage.setItem(tokenKey, JSON.stringify({
    kind: 'token',
    token: 'token-123',
  }))

  assert.equal(hasValidEntryParticipantHandoffStorageValue(storage, valuesKey), true)
  assert.equal(hasValidEntryParticipantHandoffStorageValue(storage, tokenKey), true)
})

void test('getEntryParticipantDisplayName returns trimmed display names only', () => {
  assert.equal(getEntryParticipantDisplayName({ displayName: '  Grace Hopper  ' }), 'Grace Hopper')
  assert.equal(getEntryParticipantDisplayName({ displayName: '   ' }), null)
  assert.equal(getEntryParticipantDisplayName({ team: 'blue' }), null)
})

void test('getEntryParticipantParticipantId returns trimmed participant IDs only', () => {
  assert.equal(getEntryParticipantParticipantId({ participantId: '  abc123  ' }), 'abc123')
  assert.equal(getEntryParticipantParticipantId({ participantId: '   ' }), null)
  assert.equal(getEntryParticipantParticipantId({ displayName: 'Ada' }), null)
})

void test('consumeEntryParticipantDisplayName reads local session or solo handoff values', async () => {
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
    await consumeEntryParticipantDisplayName(storage, {
      activityName: 'java-string-practice',
      sessionId: 'session-1',
      isSoloSession: false,
    }),
    'Ada',
  )
  assert.equal(
    await consumeEntryParticipantDisplayName(storage, {
      activityName: 'java-string-practice',
      sessionId: 'solo-java-string-practice',
      isSoloSession: true,
    }),
    'Grace',
  )
})

void test('consumeEntryParticipantDisplayName can resolve a server-backed token handoff for solo entry', async () => {
  const storage = createStorage()
  const storageKey = buildSoloEntryParticipantStorageKey('java-string-practice')
  persistEntryParticipantToken(storage, storageKey, 'token-solo', { persistentHash: 'hash-123' })

  const requests: Array<{ input: string; init?: RequestInit }> = []
  const fetchImpl = async (input: string, init?: RequestInit) => {
    requests.push({ input, init })
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          values: {
            displayName: 'Solo Ada',
          },
        }
      },
    }
  }

  assert.equal(
    await consumeEntryParticipantDisplayName(storage, {
      activityName: 'java-string-practice',
      sessionId: undefined,
      isSoloSession: true,
    }, fetchImpl),
    'Solo Ada',
  )
  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.input, '/api/persistent-session/hash-123/entry-participant/consume?activityName=java-string-practice')
  assert.equal(requests[0]?.init?.method, 'POST')
  assert.equal(requests[0]?.init?.credentials, 'include')
  assert.equal(requests[0]?.init?.body, JSON.stringify({ token: 'token-solo' }))
  assert.equal(storage.getItem(storageKey), null)
})

void test('consumeEntryParticipantDisplayName can resolve a server-backed token handoff for session entry', async () => {
  const storage = createStorage()
  const storageKey = buildSessionEntryParticipantStorageKey('java-string-practice', 'session-2')
  persistEntryParticipantToken(storage, storageKey, 'token-123')

  const requests: Array<{ input: string; init?: RequestInit }> = []
  const fetchImpl = async (input: string, init?: RequestInit) => {
    requests.push({ input, init })
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          values: {
            displayName: 'Ada Lovelace',
          },
        }
      },
    }
  }

  assert.equal(
    await consumeEntryParticipantDisplayName(storage, {
      activityName: 'java-string-practice',
      sessionId: 'session-2',
      isSoloSession: false,
    }, fetchImpl),
    'Ada Lovelace',
  )
  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.input, '/api/session/session-2/entry-participant/consume')
  assert.equal(requests[0]?.init?.method, 'POST')
  assert.equal(requests[0]?.init?.credentials, 'include')
  assert.equal(requests[0]?.init?.body, JSON.stringify({ token: 'token-123' }))
  assert.equal(storage.getItem(storageKey), null)
})

void test('consumeResolvedEntryParticipantValues returns the full server-backed handoff payload', async () => {
  const storage = createStorage()
  const storageKey = buildSessionEntryParticipantStorageKey('java-string-practice', 'session-3')
  persistEntryParticipantToken(storage, storageKey, 'token-xyz')

  const values = await consumeResolvedEntryParticipantValues(
    storage,
    {
      activityName: 'java-string-practice',
      sessionId: 'session-3',
      isSoloSession: false,
    },
    async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          values: {
            displayName: 'Grace',
            participantId: 'pid-1',
          },
        }
      },
    }),
  )

  assert.deepEqual(values, {
    displayName: 'Grace',
    participantId: 'pid-1',
  })
})

void test('consumeResolvedEntryParticipantValues only calls the server consume endpoint once per token-backed handoff', async () => {
  const storage = createStorage()
  const storageKey = buildSessionEntryParticipantStorageKey('java-string-practice', 'session-5')
  persistEntryParticipantToken(storage, storageKey, 'token-once')

  let requestCount = 0
  const values = await consumeResolvedEntryParticipantValues(
    storage,
    {
      activityName: 'java-string-practice',
      sessionId: 'session-5',
      isSoloSession: false,
    },
    async () => {
      requestCount += 1
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            values: {
              displayName: 'Ada',
              participantId: 'participant-1',
            },
          }
        },
      }
    },
  )

  assert.equal(requestCount, 1)
  assert.deepEqual(values, {
    displayName: 'Ada',
    participantId: 'participant-1',
  })
  assert.equal(storage.getItem(storageKey), null)
})

void test('consumeResolvedEntryParticipantValues deduplicates concurrent token consume requests', async () => {
  const storage = createStorage()
  const storageKey = buildSessionEntryParticipantStorageKey('java-string-practice', 'session-5b')
  persistEntryParticipantToken(storage, storageKey, 'token-concurrent')

  let requestCount = 0
  let releaseFetchGate: () => void = () => {}
  const fetchGate = new Promise<void>((resolve) => {
    releaseFetchGate = () => {
      resolve()
    }
  })

  const consumeA = consumeResolvedEntryParticipantValues(
    storage,
    {
      activityName: 'java-string-practice',
      sessionId: 'session-5b',
      isSoloSession: false,
    },
    async () => {
      requestCount += 1
      await fetchGate
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            values: {
              displayName: 'Ada',
              participantId: 'participant-1',
            },
          }
        },
      }
    },
  )

  const consumeB = consumeResolvedEntryParticipantValues(
    storage,
    {
      activityName: 'java-string-practice',
      sessionId: 'session-5b',
      isSoloSession: false,
    },
    async () => {
      requestCount += 1
      return {
        ok: false,
        status: 404,
        async json() {
          return {}
        },
      }
    },
  )

  releaseFetchGate()

  const [valuesA, valuesB] = await Promise.all([consumeA, consumeB])

  assert.equal(requestCount, 1)
  assert.deepEqual(valuesA, {
    displayName: 'Ada',
    participantId: 'participant-1',
  })
  assert.deepEqual(valuesB, {
    displayName: 'Ada',
    participantId: 'participant-1',
  })
  assert.equal(storage.getItem(storageKey), null)
})

void test('consumeResolvedEntryParticipantValues clears token handoff after a 404 consume response', async () => {
  const storage = createStorage()
  const storageKey = buildSessionEntryParticipantStorageKey('java-string-practice', 'session-6')
  persistEntryParticipantToken(storage, storageKey, 'token-missing')

  const values = await consumeResolvedEntryParticipantValues(
    storage,
    {
      activityName: 'java-string-practice',
      sessionId: 'session-6',
      isSoloSession: false,
    },
    async () => ({
      ok: false,
      status: 404,
      async json() {
        return {}
      },
    }),
  )

  assert.equal(values, null)
  assert.equal(storage.getItem(storageKey), null)
})

void test('consumeResolvedEntryParticipantValues preserves token handoff after a transient server failure', async () => {
  const storage = createStorage()
  const storageKey = buildSessionEntryParticipantStorageKey('java-string-practice', 'session-7')
  persistEntryParticipantToken(storage, storageKey, 'token-retry')

  const values = await consumeResolvedEntryParticipantValues(
    storage,
    {
      activityName: 'java-string-practice',
      sessionId: 'session-7',
      isSoloSession: false,
    },
    async () => ({
      ok: false,
      status: 500,
      async json() {
        return {}
      },
    }),
  )

  assert.equal(values, null)
  assert.equal(storage.getItem(storageKey), JSON.stringify({
    kind: 'token',
    token: 'token-retry',
  }))
})

void test('consumeEntryParticipantParticipantId reads a server-backed participant ID handoff', async () => {
  const storage = createStorage()
  const storageKey = buildSessionEntryParticipantStorageKey('java-string-practice', 'session-4')
  persistEntryParticipantToken(storage, storageKey, 'token-pid')

  assert.equal(
    await consumeEntryParticipantParticipantId(
      storage,
      {
        activityName: 'java-string-practice',
        sessionId: 'session-4',
        isSoloSession: false,
      },
      async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            values: {
              participantId: 'participant-42',
            },
          }
        },
      }),
    ),
    'participant-42',
  )
})
