import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getPersistentSessionEntryPolicyDescription,
  getPersistentSessionEntryPolicyLabel,
  resolvePersistentSessionEntryOutcome,
} from './persistentSessionEntryPolicyUtils'

void test('entry policy labels and descriptions fall back to instructor-required defaults', () => {
  assert.equal(getPersistentSessionEntryPolicyLabel('instructor-required'), 'Live Only')
  assert.equal(getPersistentSessionEntryPolicyLabel('not-valid'), 'Live Only')
  assert.match(getPersistentSessionEntryPolicyDescription('solo-only'), /always opens solo mode/i)
  assert.match(getPersistentSessionEntryPolicyDescription(undefined), /wait for a teacher/i)
})

void test('resolvePersistentSessionEntryOutcome keeps solo-only links in solo mode even when live session or teacher auth exist', () => {
  assert.equal(
    resolvePersistentSessionEntryOutcome({
      entryPolicy: 'solo-only',
      isStarted: true,
      hasTeacherCookie: true,
      activitySupportsSolo: true,
    }),
    'continue-solo',
  )
})

void test('resolvePersistentSessionEntryOutcome uses live join for started non-solo-only sessions', () => {
  assert.equal(
    resolvePersistentSessionEntryOutcome({
      entryPolicy: 'solo-allowed',
      isStarted: true,
      hasTeacherCookie: false,
      activitySupportsSolo: true,
    }),
    'join-live',
  )
})

void test('resolvePersistentSessionEntryOutcome sends unauthenticated solo-allowed users to solo when supported', () => {
  assert.equal(
    resolvePersistentSessionEntryOutcome({
      entryPolicy: 'solo-allowed',
      isStarted: false,
      hasTeacherCookie: false,
      activitySupportsSolo: true,
    }),
    'continue-solo',
  )
})

void test('resolvePersistentSessionEntryOutcome reports solo-unavailable when policy resolves to solo but activity lacks solo mode', () => {
  assert.equal(
    resolvePersistentSessionEntryOutcome({
      entryPolicy: 'solo-only',
      isStarted: false,
      hasTeacherCookie: false,
      activitySupportsSolo: false,
    }),
    'solo-unavailable',
  )
  assert.equal(
    resolvePersistentSessionEntryOutcome({
      entryPolicy: 'solo-allowed',
      isStarted: false,
      hasTeacherCookie: false,
      activitySupportsSolo: false,
    }),
    'solo-unavailable',
  )
})

void test('resolvePersistentSessionEntryOutcome keeps teacher-authenticated but not-yet-started live links in wait state', () => {
  assert.equal(
    resolvePersistentSessionEntryOutcome({
      entryPolicy: 'solo-allowed',
      isStarted: false,
      hasTeacherCookie: true,
      activitySupportsSolo: true,
    }),
    'wait',
  )
  assert.equal(
    resolvePersistentSessionEntryOutcome({
      entryPolicy: 'instructor-required',
      isStarted: false,
      hasTeacherCookie: false,
      activitySupportsSolo: true,
    }),
    'wait',
  )
})
