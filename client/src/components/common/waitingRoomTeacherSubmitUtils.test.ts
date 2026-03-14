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
    isWaitingForTeacher: true,
    hasOpenSocket: true,
  }), {
    navigateTo: '/manage/java-string-practice/session-1?foo=bar',
    closeSocket: true,
  })
})

void test('resolveWaitingRoomTeacherSubmitResult reports unavailable live session when not waiting', () => {
  assert.deepEqual(resolveWaitingRoomTeacherSubmitResult({
    payload: {},
    activityName: 'java-string-practice',
    queryString: '',
    normalizedTeacherCode: 'teacher-1',
    isWaitingForTeacher: false,
    hasOpenSocket: true,
  }), {
    errorMessage: 'Live session is unavailable right now. Please refresh and try again.',
    isSubmitting: false,
    clearTeacherAuthRequested: true,
  })
})

void test('resolveWaitingRoomTeacherSubmitResult sends teacher code over open websocket while waiting', () => {
  assert.deepEqual(resolveWaitingRoomTeacherSubmitResult({
    payload: {},
    activityName: 'java-string-practice',
    queryString: '',
    normalizedTeacherCode: 'teacher-1',
    isWaitingForTeacher: true,
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
    isWaitingForTeacher: true,
    hasOpenSocket: false,
  }), {
    errorMessage: 'Not connected. Please refresh the page.',
    isSubmitting: false,
    clearTeacherAuthRequested: true,
  })
})
