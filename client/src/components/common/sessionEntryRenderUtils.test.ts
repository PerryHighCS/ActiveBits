import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldRenderSessionJoinPreflight } from './sessionEntryRenderUtils'

void test('shouldRenderSessionJoinPreflight returns false when sessionId is missing', () => {
  assert.equal(
    shouldRenderSessionJoinPreflight({
      sessionId: undefined,
      presentationMode: 'render-ui',
      completedJoinPreflightSessionId: null,
    }),
    false,
  )
})

void test('shouldRenderSessionJoinPreflight returns false when entry status is pass-through', () => {
  assert.equal(
    shouldRenderSessionJoinPreflight({
      sessionId: 'abc123',
      presentationMode: 'pass-through',
      completedJoinPreflightSessionId: null,
    }),
    false,
  )
})

void test('shouldRenderSessionJoinPreflight returns true until current session preflight is completed', () => {
  assert.equal(
    shouldRenderSessionJoinPreflight({
      sessionId: 'abc123',
      presentationMode: 'render-ui',
      completedJoinPreflightSessionId: null,
    }),
    true,
  )

  assert.equal(
    shouldRenderSessionJoinPreflight({
      sessionId: 'abc123',
      presentationMode: 'render-ui',
      completedJoinPreflightSessionId: 'other-session',
    }),
    true,
  )
})

void test('shouldRenderSessionJoinPreflight returns false after current session preflight completes', () => {
  assert.equal(
    shouldRenderSessionJoinPreflight({
      sessionId: 'abc123',
      presentationMode: 'render-ui',
      completedJoinPreflightSessionId: 'abc123',
    }),
    false,
  )
})

void test('shouldRenderSessionJoinPreflight returns false when stored participant context already exists', () => {
  assert.equal(
    shouldRenderSessionJoinPreflight({
      sessionId: 'abc123',
      presentationMode: 'render-ui',
      completedJoinPreflightSessionId: null,
      hasStoredParticipantContext: true,
    }),
    false,
  )
})

void test('shouldRenderSessionJoinPreflight can still render when stored participant context is allowed', () => {
  assert.equal(
    shouldRenderSessionJoinPreflight({
      sessionId: 'abc123',
      presentationMode: 'render-ui',
      completedJoinPreflightSessionId: null,
      hasStoredParticipantContext: true,
      allowStoredParticipantContext: true,
    }),
    true,
  )
})
