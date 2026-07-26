import test from 'node:test'
import assert from 'node:assert/strict'
import { closeDuplicateParticipantSockets, closeParticipantSockets, type ParticipantSocketLike } from './core/participantSockets.js'

interface TestSocket extends ParticipantSocketLike {
  closeCalls: Array<{ code?: number; reason?: string }>
}

function createSocket(overrides: Partial<TestSocket> = {}): TestSocket {
  return {
    readyState: 1,
    sessionId: 'session-1',
    studentId: 'student-1',
    ignoreDisconnect: false,
    closeCalls: [],
    close(code?: number, reason?: string) {
      this.closeCalls.push({ code, reason })
    },
    ...overrides,
  }
}

void test('closeDuplicateParticipantSockets closes matching sockets in the same session', () => {
  const current = createSocket()
  const duplicate = createSocket()
  const differentSession = createSocket({ sessionId: 'session-2' })
  const differentStudent = createSocket({ studentId: 'student-2' })

  closeDuplicateParticipantSockets([current, duplicate, differentSession, differentStudent], current)

  assert.equal(duplicate.ignoreDisconnect, true)
  assert.deepEqual(duplicate.closeCalls, [{ code: 4000, reason: 'Replaced by new connection' }])
  assert.deepEqual(differentSession.closeCalls, [])
  assert.deepEqual(differentStudent.closeCalls, [])
})

void test('closeDuplicateParticipantSockets ignores sockets without a resolved current participant identity', () => {
  const current = createSocket({ studentId: null })
  const duplicate = createSocket()

  closeDuplicateParticipantSockets([current, duplicate], current)

  assert.equal(duplicate.ignoreDisconnect, false)
  assert.deepEqual(duplicate.closeCalls, [])
})

void test('closeParticipantSockets closes every active target socket only', () => {
  const first = createSocket()
  const second = createSocket()
  const differentSession = createSocket({ sessionId: 'session-2' })
  const differentStudent = createSocket({ studentId: 'student-2' })
  const closed = createSocket({ readyState: 3 })

  closeParticipantSockets([first, second, differentSession, differentStudent, closed], 'session-1', 'student-1')

  assert.deepEqual(first.closeCalls, [{ code: 4001, reason: 'Returned to waiting room' }])
  assert.deepEqual(second.closeCalls, [{ code: 4001, reason: 'Returned to waiting room' }])
  assert.equal(first.ignoreDisconnect, true)
  assert.deepEqual(differentSession.closeCalls, [])
  assert.deepEqual(differentStudent.closeCalls, [])
  assert.deepEqual(closed.closeCalls, [])
})
