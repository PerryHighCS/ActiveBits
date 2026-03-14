import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveWaitingRoomMessageTransition } from './waitingRoomTransitionUtils'

void test('resolveWaitingRoomMessageTransition returns waiter count updates', () => {
  assert.deepEqual(resolveWaitingRoomMessageTransition({
    message: { type: 'waiter-count', count: 4 },
    teacherAuthRequested: false,
    activityName: 'java-string-practice',
    queryString: '?foo=bar',
    currentEntryOutcome: 'wait',
    currentEntryPolicy: 'instructor-required',
  }), {
    waiterCount: 4,
  })
})

void test('resolveWaitingRoomMessageTransition keeps live-only permalink students on the waiting room when session starts', () => {
  assert.deepEqual(resolveWaitingRoomMessageTransition({
    message: { type: 'session-started', sessionId: 'session-1' },
    teacherAuthRequested: false,
    activityName: 'java-string-practice',
    queryString: '?foo=bar',
    currentEntryOutcome: 'wait',
    currentEntryPolicy: 'instructor-required',
  }), {
    error: null,
    isSubmitting: false,
    clearTeacherAuthRequested: true,
    nextEntryOutcome: 'join-live',
    nextStartedSessionId: 'session-1',
  })
})

void test('resolveWaitingRoomMessageTransition promotes live-or-solo students to join-live when session starts', () => {
  assert.deepEqual(resolveWaitingRoomMessageTransition({
    message: { type: 'session-started', sessionId: 'session-1' },
    teacherAuthRequested: false,
    activityName: 'java-string-practice',
    queryString: '?foo=bar',
    currentEntryOutcome: 'continue-solo',
    currentEntryPolicy: 'solo-allowed',
  }), {
    error: null,
    isSubmitting: false,
    clearTeacherAuthRequested: true,
    nextEntryOutcome: 'join-live',
    nextStartedSessionId: 'session-1',
  })
})

void test('resolveWaitingRoomMessageTransition does not promote to join-live without a session-started message', () => {
  assert.deepEqual(resolveWaitingRoomMessageTransition({
    message: { type: 'waiter-count', count: 2 },
    teacherAuthRequested: false,
    activityName: 'java-string-practice',
    queryString: '?foo=bar',
    currentEntryOutcome: 'continue-solo',
    currentEntryPolicy: 'solo-allowed',
  }), {
    waiterCount: 2,
  })
})

void test('resolveWaitingRoomMessageTransition routes teachers to manage when requested auth started the session', () => {
  assert.deepEqual(resolveWaitingRoomMessageTransition({
    message: { type: 'session-started', sessionId: 'session-1' },
    teacherAuthRequested: true,
    activityName: 'java-string-practice',
    queryString: '?foo=bar',
    currentEntryOutcome: 'wait',
    currentEntryPolicy: 'instructor-required',
  }), {
    navigateTo: '/manage/java-string-practice/session-1?foo=bar',
  })
})

void test('resolveWaitingRoomMessageTransition routes teacher-authenticated messages to manage', () => {
  assert.deepEqual(resolveWaitingRoomMessageTransition({
    message: { type: 'teacher-authenticated', sessionId: 'session-2' },
    teacherAuthRequested: false,
    activityName: 'java-format-practice',
    queryString: '',
    currentEntryOutcome: 'wait',
    currentEntryPolicy: 'instructor-required',
  }), {
    navigateTo: '/manage/java-format-practice/session-2',
  })
})

void test('resolveWaitingRoomMessageTransition routes session-ended messages to session-ended page', () => {
  assert.deepEqual(resolveWaitingRoomMessageTransition({
    message: { type: 'session-ended' },
    teacherAuthRequested: false,
    activityName: 'java-format-practice',
    queryString: '',
    currentEntryOutcome: 'wait',
    currentEntryPolicy: 'instructor-required',
  }), {
    navigateTo: '/session-ended',
  })
})

void test('resolveWaitingRoomMessageTransition returns live-or-solo students to solo waiting state when session ends', () => {
  assert.deepEqual(resolveWaitingRoomMessageTransition({
    message: { type: 'session-ended' },
    teacherAuthRequested: false,
    activityName: 'java-string-practice',
    queryString: '',
    currentEntryOutcome: 'join-live',
    currentEntryPolicy: 'solo-allowed',
  }), {
    error: null,
    isSubmitting: false,
    clearTeacherAuthRequested: true,
    nextEntryOutcome: 'continue-solo',
    nextStartedSessionId: null,
  })
})

void test('resolveWaitingRoomMessageTransition surfaces teacher code errors and clears submitting auth state', () => {
  assert.deepEqual(resolveWaitingRoomMessageTransition({
    message: {
      type: 'teacher-code-error',
      error: 'This link only supports solo entry.',
      code: 'entry-policy-rejected',
      entryPolicy: 'solo-only',
    },
    teacherAuthRequested: true,
    activityName: 'java-format-practice',
    queryString: '',
    currentEntryOutcome: 'wait',
    currentEntryPolicy: 'solo-only',
  }), {
    error: 'This link only supports solo entry.',
    isSubmitting: false,
    clearTeacherAuthRequested: true,
  })
})
