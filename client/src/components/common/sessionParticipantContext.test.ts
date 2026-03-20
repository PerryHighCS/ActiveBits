import assert from 'node:assert/strict'
import test from 'node:test'
import type { EntryParticipantStorageLike } from './entryParticipantStorage'
import {
  buildSessionParticipantContextStorageKey,
  persistSessionParticipantContext,
  readSessionParticipantContext,
} from './sessionParticipantContext'

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

void test('persistSessionParticipantContext stores normalized participant context', () => {
  const storage = createStorage()

  persistSessionParticipantContext(storage, 'session-1', {
    studentName: 'Ada',
    studentId: 'participant-1',
  })

  assert.equal(
    storage.getItem(buildSessionParticipantContextStorageKey('session-1')),
    JSON.stringify({ studentName: 'Ada', studentId: 'participant-1' }),
  )
})

void test('persistSessionParticipantContext merges later id-only updates with existing name', () => {
  const storage = createStorage()

  persistSessionParticipantContext(storage, 'session-1', {
    studentName: 'Ada',
    studentId: null,
  })
  persistSessionParticipantContext(storage, 'session-1', {
    studentName: null,
    studentId: 'participant-1',
  })

  assert.deepEqual(readSessionParticipantContext(storage, 'session-1'), {
    studentName: 'Ada',
    studentId: 'participant-1',
  })
})

void test('readSessionParticipantContext removes invalid stored payloads', () => {
  const storage = createStorage()
  storage.setItem(buildSessionParticipantContextStorageKey('session-1'), JSON.stringify({ studentName: '   ' }))

  assert.equal(readSessionParticipantContext(storage, 'session-1'), null)
  assert.equal(storage.getItem(buildSessionParticipantContextStorageKey('session-1')), null)
})
