import assert from 'node:assert/strict'
import test from 'node:test'
import { parseVideoSyncEnvelope } from './protocol.js'

void test('parseVideoSyncEnvelope accepts valid video-sync envelopes', () => {
  const envelope = parseVideoSyncEnvelope(JSON.stringify({
    version: '1',
    activity: 'video-sync',
    sessionId: 'session-1',
    type: 'heartbeat',
    timestamp: 1_234,
    payload: { ok: true },
  }))

  assert.deepEqual(envelope, {
    version: '1',
    activity: 'video-sync',
    sessionId: 'session-1',
    type: 'heartbeat',
    timestamp: 1_234,
    payload: { ok: true },
  })
})

void test('parseVideoSyncEnvelope rejects unknown message types', () => {
  const envelope = parseVideoSyncEnvelope(JSON.stringify({
    version: '1',
    activity: 'video-sync',
    sessionId: 'session-1',
    type: 'totally-unknown',
    timestamp: 1_234,
    payload: {},
  }))

  assert.equal(envelope, null)
})

void test('parseVideoSyncEnvelope rejects non-finite timestamps', () => {
  const envelope = parseVideoSyncEnvelope(JSON.stringify({
    version: '1',
    activity: 'video-sync',
    sessionId: 'session-1',
    type: 'state-update',
    timestamp: Number.POSITIVE_INFINITY,
    payload: {},
  }))

  assert.equal(envelope, null)
})
