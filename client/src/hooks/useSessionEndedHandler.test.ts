import test from 'node:test'
import assert from 'node:assert/strict'
import { isSessionEndedMessageData } from './useSessionEndedHandler'

test('isSessionEndedMessageData returns true for session-ended payload', () => {
  assert.equal(isSessionEndedMessageData('{"type":"session-ended"}'), true)
})

test('isSessionEndedMessageData returns false for non-session-ended payload', () => {
  assert.equal(isSessionEndedMessageData('{"type":"keepalive"}'), false)
})

test('isSessionEndedMessageData returns false and reports JSON parse errors', () => {
  let parseError: unknown = null

  const result = isSessionEndedMessageData('ping', (error) => {
    parseError = error
  })

  assert.equal(result, false)
  assert.ok(parseError instanceof Error)
})
