import assert from 'node:assert/strict'
import test from 'node:test'
import { clearSyncDeckStoredStudentIdentity, handleReturnedToWaitingRoom } from './returnedToWaitingRoomUtils'

void test('handleReturnedToWaitingRoom clears identity and redirects only the targeted student', () => {
  const removed: string[] = []; const sessionRemoved: string[] = []; let destination = ''
  const storage = { removeItem(key: string) { removed.push(key) } } as unknown as Storage
  const sessionStorage = { removeItem(key: string) { sessionRemoved.push(key) } } as unknown as Storage
  assert.equal(handleReturnedToWaitingRoom({ participantId: 'ada', registeredStudentId: 'ada', sessionId: 's1', storage, sessionStorage, redirect: (url) => { destination = url } }), true)
  assert.equal(destination, '/s1'); assert.ok(removed.includes('session-participant:s1'))
  assert.ok(sessionRemoved.includes('session-participant:s1'))
  const before = [...removed, ...sessionRemoved]
  assert.equal(handleReturnedToWaitingRoom({ participantId: 'lin', registeredStudentId: 'ada', sessionId: 's1', storage, sessionStorage, redirect: () => {} }), false)
  assert.deepEqual([...removed, ...sessionRemoved], before)
})

void test('clearSyncDeckStoredStudentIdentity removes every stored identity key from both storages', () => {
  const removed: string[] = []; const sessionRemoved: string[] = []
  clearSyncDeckStoredStudentIdentity('s1', { removeItem(key: string) { removed.push(key) } }, { removeItem(key: string) { sessionRemoved.push(key) } })
  assert.deepEqual(removed.sort(), [
    'session-participant:s1', 'student-id-s1', 'student-name-s1', 'syncdeck_student_id_s1', 'syncdeck_student_name_s1',
  ])
  assert.deepEqual(sessionRemoved.sort(), ['session-participant:s1', 'syncdeck_student_id_s1', 'syncdeck_student_name_s1'])
})
