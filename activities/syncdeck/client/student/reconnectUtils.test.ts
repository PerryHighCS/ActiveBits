import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveSyncDeckStudentCloseDecision } from './reconnectUtils.js'

void test('resolveSyncDeckStudentCloseDecision requires rejoin for missing student identity', () => {
  const decision = resolveSyncDeckStudentCloseDecision({ code: 1008, reason: 'missing studentId' })

  assert.deepEqual(decision, {
    clearCachedIdentity: true,
    joinError: 'Please re-enter your name to rejoin this presentation.',
    statusMessage: 'Reconnect required before instructor sync can resume.',
  })
})

void test('resolveSyncDeckStudentCloseDecision requires rejoin for unknown student identity', () => {
  const decision = resolveSyncDeckStudentCloseDecision({ code: 1008, reason: 'unregistered student' })

  assert.deepEqual(decision, {
    clearCachedIdentity: true,
    joinError: 'Please re-enter your name to rejoin this presentation.',
    statusMessage: 'Reconnect required before instructor sync can resume.',
  })
})

void test('resolveSyncDeckStudentCloseDecision keeps default reconnect behavior for other closes', () => {
  const decision = resolveSyncDeckStudentCloseDecision({ code: 1006, reason: 'socket lost' })

  assert.deepEqual(decision, {
    clearCachedIdentity: false,
    joinError: null,
    statusMessage: 'Reconnecting to instructor sync…',
  })
})
