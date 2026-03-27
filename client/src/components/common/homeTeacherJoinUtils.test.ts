import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getTeacherJoinClosedState,
  getTeacherJoinInitialSessionId,
  normalizeTeacherJoinCode,
  normalizeTeacherJoinSessionId,
} from './homeTeacherJoinUtils'

void test('getTeacherJoinInitialSessionId normalizes the current student join code for teacher join', () => {
  assert.equal(getTeacherJoinInitialSessionId(' 35F4E '), '35f4e')
  assert.equal(getTeacherJoinInitialSessionId(''), '')
})

void test('normalizeTeacherJoinSessionId lowercases and trims session ids consistently', () => {
  assert.equal(normalizeTeacherJoinSessionId(' 35F4E '), '35f4e')
  assert.equal(normalizeTeacherJoinSessionId(' abC12 '), 'abc12')
})

void test('normalizeTeacherJoinCode trims surrounding teacher code whitespace', () => {
  assert.equal(normalizeTeacherJoinCode('  secret-code  '), 'secret-code')
  assert.equal(normalizeTeacherJoinCode(''), '')
})

void test('getTeacherJoinClosedState clears teacher join modal values for shared devices', () => {
  assert.deepEqual(getTeacherJoinClosedState(), {
    sessionId: '',
    teacherCode: '',
    error: null,
  })
})
