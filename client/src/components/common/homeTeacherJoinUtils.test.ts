import test from 'node:test'
import assert from 'node:assert/strict'
import { getTeacherJoinClosedState, getTeacherJoinInitialSessionId } from './homeTeacherJoinUtils'

void test('getTeacherJoinInitialSessionId normalizes the current student join code for teacher join', () => {
  assert.equal(getTeacherJoinInitialSessionId(' 35F4E '), '35f4e')
  assert.equal(getTeacherJoinInitialSessionId(''), '')
})

void test('getTeacherJoinClosedState clears teacher join modal values for shared devices', () => {
  assert.deepEqual(getTeacherJoinClosedState(), {
    sessionId: '',
    teacherCode: '',
    error: null,
  })
})
