import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldResetTeacherEntryMode, shouldShowTeacherEntryToggle } from './waitingRoomTeacherEntryUtils'

void test('shouldShowTeacherEntryToggle matches teacher-section availability for live join entry', () => {
  assert.equal(shouldShowTeacherEntryToggle({
    allowTeacherSection: true,
    hasTeacherCookie: false,
    effectiveEntryOutcome: 'join-live',
    entryPolicy: 'solo-allowed',
  }), true)

  assert.equal(shouldShowTeacherEntryToggle({
    allowTeacherSection: false,
    hasTeacherCookie: false,
    effectiveEntryOutcome: 'join-live',
    entryPolicy: 'solo-allowed',
  }), false)

  assert.equal(shouldShowTeacherEntryToggle({
    allowTeacherSection: true,
    hasTeacherCookie: false,
    effectiveEntryOutcome: 'join-live',
    entryPolicy: 'solo-only',
  }), false)
})

void test('shouldResetTeacherEntryMode keeps teacher entry active only while live join toggle remains available', () => {
  assert.equal(shouldResetTeacherEntryMode({
    hasTeacherCookie: false,
    effectiveEntryOutcome: 'join-live',
    shouldShowTeacherEntryToggle: true,
  }), false)

  assert.equal(shouldResetTeacherEntryMode({
    hasTeacherCookie: true,
    effectiveEntryOutcome: 'join-live',
    shouldShowTeacherEntryToggle: false,
  }), true)

  assert.equal(shouldResetTeacherEntryMode({
    hasTeacherCookie: false,
    effectiveEntryOutcome: 'continue-solo',
    shouldShowTeacherEntryToggle: false,
  }), true)
})
