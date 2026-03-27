import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldResetTeacherEntryMode } from './waitingRoomTeacherEntryUtils'

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
