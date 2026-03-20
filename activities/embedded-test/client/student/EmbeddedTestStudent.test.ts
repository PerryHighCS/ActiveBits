import assert from 'node:assert/strict'
import test from 'node:test'
import { getEmbeddedTestStudentMessagePlaceholder } from './EmbeddedTestStudent.js'

void test('getEmbeddedTestStudentMessagePlaceholder reflects websocket readiness', () => {
  assert.equal(getEmbeddedTestStudentMessagePlaceholder(false), 'Connecting...')
  assert.equal(getEmbeddedTestStudentMessagePlaceholder(true), 'Reply to manager')
})
