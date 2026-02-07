import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanExpiredSessions, getPersistentQuerySuffix, getSoloActivities, isJoinSessionId, readCachedSession } from './sessionRouterUtils'

interface MockStorage {
  length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function createMockStorage(initial: Record<string, string>): MockStorage {
  const data = new Map(Object.entries(initial))

  return {
    get length() {
      return data.size
    },
    key(index: number): string | null {
      const entries = [...data.keys()]
      return entries[index] ?? null
    },
    getItem(key: string): string | null {
      return data.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      data.set(key, value)
    },
    removeItem(key: string): void {
      data.delete(key)
    },
  }
}

test('cleanExpiredSessions removes stale and malformed session-* entries only', () => {
  const now = 2_000
  const logs: string[] = []
  const storage = createMockStorage({
    'session-valid': JSON.stringify({ timestamp: now - 100 }),
    'session-expired': JSON.stringify({ timestamp: now - 50_000 }),
    'session-invalid': 'not-json',
    other: JSON.stringify({ timestamp: 1 }),
  })

  cleanExpiredSessions(storage, now, 1_000, (message) => logs.push(message))

  assert.equal(storage.getItem('session-valid') !== null, true)
  assert.equal(storage.getItem('session-expired'), null)
  assert.equal(storage.getItem('session-invalid'), null)
  assert.equal(storage.getItem('other') !== null, true)
  assert.ok(logs.some((entry) => entry.includes('Expiring session-expired')))
  assert.ok(logs.some((entry) => entry.includes('Removing invalid entry session-invalid')))
})

test('readCachedSession returns valid entries and clears invalid/expired values', () => {
  const now = 10_000
  const logs: string[] = []
  const storage = createMockStorage({
    'session-valid': JSON.stringify({ timestamp: now - 200, type: 'raffle' }),
    'session-expired': JSON.stringify({ timestamp: now - 5_000 }),
    'session-invalid': '{',
  })

  const valid = readCachedSession(storage, 'session-valid', now, 1_000, (message) => logs.push(message))
  const expired = readCachedSession(storage, 'session-expired', now, 1_000, (message) => logs.push(message))
  const invalid = readCachedSession(storage, 'session-invalid', now, 1_000, (message) => logs.push(message))

  assert.equal(valid?.type, 'raffle')
  assert.equal(expired, null)
  assert.equal(invalid, null)
  assert.equal(storage.getItem('session-expired'), null)
  assert.equal(storage.getItem('session-invalid'), null)
  assert.ok(logs.some((entry) => entry.includes('removing session-expired')))
  assert.ok(logs.some((entry) => entry.includes('removing invalid session-invalid')))
})

test('getPersistentQuerySuffix preserves query params for persistent-session fetches', () => {
  assert.equal(getPersistentQuerySuffix('?algorithm=merge-sort'), '&algorithm=merge-sort')
  assert.equal(getPersistentQuerySuffix(''), '')
})

test('isJoinSessionId matches legacy hex parsing behavior', () => {
  assert.equal(isJoinSessionId('abc123'), true)
  assert.equal(isJoinSessionId('0'), false)
  assert.equal(isJoinSessionId(''), false)
})

test('getSoloActivities filters activity list to solo-mode entries', () => {
  const result = getSoloActivities([
    { id: 'a', name: 'A', description: 'A', color: 'blue', soloMode: true },
    { id: 'b', name: 'B', description: 'B', color: 'green', soloMode: false },
  ])

  assert.deepEqual(result.map((activity) => activity.id), ['a'])
})
