import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseVideoSyncEnvelope,
  parseVideoSyncErrorMessagePayload,
  parseVideoSyncStateMessagePayload,
  parseVideoSyncTelemetryMessagePayload,
} from './protocol.js'

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

void test('parseVideoSyncStateMessagePayload validates nested state and telemetry payloads', () => {
  assert.deepEqual(
    parseVideoSyncStateMessagePayload({
      state: {
        provider: 'youtube',
        videoId: 'abcdefghijk',
        startSec: 12,
        stopSec: null,
        positionSec: 18,
        isPlaying: true,
        playbackRate: 1,
        updatedBy: 'manager',
        serverTimestampMs: 1234,
      },
      telemetry: {
        connections: { activeCount: 3 },
        autoplay: { blockedCount: 1 },
        sync: {
          unsyncedStudents: 2,
          lastDriftSec: 0.75,
          lastCorrectionResult: 'attempted',
        },
        error: { code: null, message: null },
      },
    }),
    {
      state: {
        provider: 'youtube',
        videoId: 'abcdefghijk',
        startSec: 12,
        stopSec: null,
        positionSec: 18,
        isPlaying: true,
        playbackRate: 1,
        updatedBy: 'manager',
        serverTimestampMs: 1234,
      },
      telemetry: {
        connections: { activeCount: 3 },
        autoplay: { blockedCount: 1 },
        sync: {
          unsyncedStudents: 2,
          lastDriftSec: 0.75,
          lastCorrectionResult: 'attempted',
        },
        error: { code: null, message: null },
      },
    },
  )

  assert.equal(
    parseVideoSyncStateMessagePayload({
      state: {
        provider: 'youtube',
        videoId: 'abcdefghijk',
        startSec: 'oops',
      },
    }),
    null,
  )
})

void test('parseVideoSyncTelemetryMessagePayload rejects malformed telemetry payloads', () => {
  assert.deepEqual(
    parseVideoSyncTelemetryMessagePayload({
      telemetry: {
        connections: { activeCount: 1 },
        autoplay: { blockedCount: 0 },
        sync: {
          unsyncedStudents: 0,
          lastDriftSec: null,
          lastCorrectionResult: 'none',
        },
        error: { code: 'ERR', message: null },
      },
    }),
    {
      telemetry: {
        connections: { activeCount: 1 },
        autoplay: { blockedCount: 0 },
        sync: {
          unsyncedStudents: 0,
          lastDriftSec: null,
          lastCorrectionResult: 'none',
        },
        error: { code: 'ERR', message: null },
      },
    },
  )

  assert.equal(
    parseVideoSyncTelemetryMessagePayload({
      telemetry: {
        connections: { activeCount: 'oops' },
      },
    }),
    null,
  )
})

void test('parseVideoSyncErrorMessagePayload only accepts string error messages', () => {
  assert.deepEqual(parseVideoSyncErrorMessagePayload({ message: 'failed' }), { message: 'failed' })
  assert.deepEqual(parseVideoSyncErrorMessagePayload({}), { message: undefined })
  assert.equal(parseVideoSyncErrorMessagePayload({ message: 42 }), null)
})
