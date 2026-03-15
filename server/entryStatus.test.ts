import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPersistentEntryStatus,
  buildSessionEntryStatus,
  getEntryPresentationMode,
} from './core/entryStatus.js'

void test('getEntryPresentationMode keeps wait outcomes in render-ui mode even without fields', () => {
  assert.equal(
    getEntryPresentationMode({
      waitingRoomFieldCount: 0,
      entryOutcome: 'wait',
    }),
    'render-ui',
  )
})

void test('buildSessionEntryStatus returns pass-through when live join needs no preflight fields', () => {
  assert.deepEqual(
    buildSessionEntryStatus({
      sessionId: 'session-1',
      activityName: 'raffle',
      waitingRoomFieldCount: 0,
      resolvedRole: 'student',
      entryOutcome: 'join-live',
    }),
    {
      sessionId: 'session-1',
      activityName: 'raffle',
      waitingRoomFieldCount: 0,
      resolvedRole: 'student',
      entryOutcome: 'join-live',
      presentationMode: 'pass-through',
    },
  )
})

void test('buildPersistentEntryStatus keeps instructor-required student entry in wait mode', () => {
  assert.deepEqual(
    buildPersistentEntryStatus({
      activityName: 'gallery-walk',
      hash: 'hash-1',
      entryPolicy: 'instructor-required',
      hasTeacherCookie: false,
      isStarted: false,
      sessionId: null,
      activitySupportsSolo: true,
      waitingRoomFieldCount: 0,
    }),
    {
      activityName: 'gallery-walk',
      hash: 'hash-1',
      entryPolicy: 'instructor-required',
      hasTeacherCookie: false,
      isStarted: false,
      sessionId: null,
      waitingRoomFieldCount: 0,
      resolvedRole: 'student',
      entryOutcome: 'wait',
      presentationMode: 'render-ui',
    },
  )
})

void test('buildPersistentEntryStatus allows solo-allowed student entry to pass straight into solo mode', () => {
  assert.deepEqual(
    buildPersistentEntryStatus({
      activityName: 'java-string-practice',
      hash: 'hash-2',
      entryPolicy: 'solo-allowed',
      hasTeacherCookie: false,
      isStarted: false,
      sessionId: null,
      activitySupportsSolo: true,
      waitingRoomFieldCount: 0,
    }),
    {
      activityName: 'java-string-practice',
      hash: 'hash-2',
      entryPolicy: 'solo-allowed',
      hasTeacherCookie: false,
      isStarted: false,
      sessionId: null,
      waitingRoomFieldCount: 0,
      resolvedRole: 'student',
      entryOutcome: 'continue-solo',
      presentationMode: 'pass-through',
    },
  )
})

void test('buildPersistentEntryStatus keeps solo-only links in solo mode even with teacher auth', () => {
  assert.deepEqual(
    buildPersistentEntryStatus({
      activityName: 'java-format-practice',
      hash: 'hash-3',
      entryPolicy: 'solo-only',
      hasTeacherCookie: true,
      isStarted: true,
      sessionId: 'live-session',
      activitySupportsSolo: true,
      waitingRoomFieldCount: 0,
    }),
    {
      activityName: 'java-format-practice',
      hash: 'hash-3',
      entryPolicy: 'solo-only',
      hasTeacherCookie: true,
      isStarted: true,
      sessionId: 'live-session',
      waitingRoomFieldCount: 0,
      resolvedRole: 'student',
      entryOutcome: 'continue-solo',
      presentationMode: 'pass-through',
    },
  )
})

void test('buildPersistentEntryStatus reports solo-unavailable when the policy resolves to solo without solo support', () => {
  assert.deepEqual(
    buildPersistentEntryStatus({
      activityName: 'gallery-walk',
      hash: 'hash-4',
      entryPolicy: 'solo-only',
      hasTeacherCookie: false,
      isStarted: false,
      sessionId: null,
      activitySupportsSolo: false,
      waitingRoomFieldCount: 0,
    }),
    {
      activityName: 'gallery-walk',
      hash: 'hash-4',
      entryPolicy: 'solo-only',
      hasTeacherCookie: false,
      isStarted: false,
      sessionId: null,
      waitingRoomFieldCount: 0,
      resolvedRole: 'student',
      entryOutcome: 'solo-unavailable',
      presentationMode: 'pass-through',
    },
  )
})
