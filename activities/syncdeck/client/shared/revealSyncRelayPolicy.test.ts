import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldRelayRevealSyncPayloadToSession } from './revealSyncRelayPolicy.js'

void test('shouldRelayRevealSyncPayloadToSession suppresses reveal-sync ready envelopes', () => {
  assert.equal(
    shouldRelayRevealSyncPayloadToSession({
      type: 'reveal-sync',
      action: 'ready',
      payload: {
        indices: { h: 0, v: 0, f: 0 },
      },
    }),
    false,
  )
})

void test('shouldRelayRevealSyncPayloadToSession allows reveal-sync state envelopes', () => {
  assert.equal(
    shouldRelayRevealSyncPayloadToSession({
      type: 'reveal-sync',
      action: 'state',
      payload: {
        indices: { h: 1, v: 0, f: 0 },
      },
    }),
    true,
  )
})

void test('shouldRelayRevealSyncPayloadToSession allows non-reveal-sync payloads', () => {
  assert.equal(
    shouldRelayRevealSyncPayloadToSession({
      type: 'syncdeck-tool-mode',
      mode: 'chalkboard',
    }),
    true,
  )
})
