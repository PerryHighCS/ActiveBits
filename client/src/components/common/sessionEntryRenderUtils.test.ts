import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldRenderSessionJoinPreflight } from './sessionEntryRenderUtils'

void test('shouldRenderSessionJoinPreflight returns false when sessionId is missing', () => {
  assert.equal(
    shouldRenderSessionJoinPreflight({
      sessionId: undefined,
      waitingRoomFieldCount: 2,
      completedJoinPreflightSessionId: null,
    }),
    false,
  )
})

void test('shouldRenderSessionJoinPreflight returns false when activity has no waiting-room fields', () => {
  assert.equal(
    shouldRenderSessionJoinPreflight({
      sessionId: 'abc123',
      waitingRoomFieldCount: 0,
      completedJoinPreflightSessionId: null,
    }),
    false,
  )
})

void test('shouldRenderSessionJoinPreflight returns true until current session preflight is completed', () => {
  assert.equal(
    shouldRenderSessionJoinPreflight({
      sessionId: 'abc123',
      waitingRoomFieldCount: 1,
      completedJoinPreflightSessionId: null,
    }),
    true,
  )

  assert.equal(
    shouldRenderSessionJoinPreflight({
      sessionId: 'abc123',
      waitingRoomFieldCount: 1,
      completedJoinPreflightSessionId: 'other-session',
    }),
    true,
  )
})

void test('shouldRenderSessionJoinPreflight returns false after current session preflight completes', () => {
  assert.equal(
    shouldRenderSessionJoinPreflight({
      sessionId: 'abc123',
      waitingRoomFieldCount: 1,
      completedJoinPreflightSessionId: 'abc123',
    }),
    false,
  )
})
