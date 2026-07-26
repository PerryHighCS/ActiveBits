import assert from 'node:assert/strict'
import test from 'node:test'
import { handleReturnedToWaitingRoom } from './returnedToWaitingRoomUtils'

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
