import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveWaitingRoomTeacherSubmitResult } from './waitingRoomTeacherSubmitUtils'

void test('resolveWaitingRoomTeacherSubmitResult redirects to manage when auth response says session is started', () => {
  assert.deepEqual(resolveWaitingRoomTeacherSubmitResult({
    payload: {
      isStarted: true,
      sessionId: 'session-1',
    },
    activityName: 'java-string-practice',
    queryString: '?foo=bar',
    normalizedTeacherCode: 'teacher-1',
    hasOpenSocket: true,
  }), {
    navigateTo: '/manage/java-string-practice/session-1?foo=bar',
    closeSocket: true,
  })
})

void test('resolveWaitingRoomTeacherSubmitResult sends teacher code over open websocket even outside pure wait state', () => {
  assert.deepEqual(resolveWaitingRoomTeacherSubmitResult({
    payload: {},
    activityName: 'java-string-practice',
    queryString: '',
    normalizedTeacherCode: 'teacher-1',
    hasOpenSocket: true,
  }), {
    sendVerifyTeacherCode: 'teacher-1',
  })
})

void test('resolveWaitingRoomTeacherSubmitResult reports disconnected socket while waiting', () => {
  assert.deepEqual(resolveWaitingRoomTeacherSubmitResult({
    payload: {},
    activityName: 'java-string-practice',
    queryString: '',
    normalizedTeacherCode: 'teacher-1',
    hasOpenSocket: false,
  }), {
    errorMessage: 'Not connected. Please refresh the page.',
    isSubmitting: false,
    clearTeacherAuthRequested: true,
  })
})
