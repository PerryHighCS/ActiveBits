import test from 'node:test'
import assert from 'node:assert/strict'
import { getTeacherJoinInitialSessionId } from './homeTeacherJoinUtils'

void test('getTeacherJoinInitialSessionId normalizes the current student join code for teacher join', () => {
  assert.equal(getTeacherJoinInitialSessionId(' 35F4E '), '35f4e')
  assert.equal(getTeacherJoinInitialSessionId(''), '')
})
