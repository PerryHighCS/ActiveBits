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
        playerHost: 'youtube-education',
        videoId: 'abcdefghijk',
        startSec: 12,
        stopSec: null,
        positionSec: 18,
        isPlaying: true,
        playbackRate: 1,
        updatedBy: 'instructor',
        controllerId: null,
        playbackRevision: 0,
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
        playerHost: 'youtube-education',
        videoId: 'abcdefghijk',
        startSec: 12,
        stopSec: null,
        positionSec: 18,
        isPlaying: true,
        playbackRate: 1,
        updatedBy: 'instructor',
        controllerId: null,
        playbackRevision: 0,
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
        playerHost: 'youtube-nocookie',
        videoId: 'abcdefghijk',
        startSec: 'oops',
      },
    }),
    null,
  )
})

void test('parseVideoSyncStateMessagePayload coerces an over-long controllerId to null', () => {
  const base = {
    provider: 'youtube',
    playerHost: 'youtube-nocookie',
    videoId: 'abcdefghijk',
    startSec: 0,
    stopSec: null,
    positionSec: 0,
    isPlaying: false,
    playbackRate: 1,
    updatedBy: 'instructor',
    playbackRevision: 3,
    serverTimestampMs: 1234,
  }

  const oversized = parseVideoSyncStateMessagePayload({ state: { ...base, controllerId: 'x'.repeat(129) } })
  assert.equal(oversized?.state?.controllerId, null, 'a >128-char controllerId is dropped, not kept in state')

  const atLimit = parseVideoSyncStateMessagePayload({ state: { ...base, controllerId: 'y'.repeat(128) } })
  assert.equal(atLimit?.state?.controllerId, 'y'.repeat(128), 'a 128-char controllerId is still accepted')
})

void test('parseVideoSyncStateMessagePayload normalizes legacy manager updates to instructor', () => {
  assert.deepEqual(
    parseVideoSyncStateMessagePayload({
      state: {
        provider: 'youtube',
        playerHost: 'youtube-nocookie',
        videoId: 'abcdefghijk',
        startSec: 12,
        stopSec: null,
        positionSec: 18,
        isPlaying: true,
        playbackRate: 1,
        updatedBy: 'manager',
        serverTimestampMs: 1234,
      },
    }),
    {
      state: {
        provider: 'youtube',
        playerHost: 'youtube-nocookie',
        videoId: 'abcdefghijk',
        startSec: 12,
        stopSec: null,
        positionSec: 18,
        isPlaying: true,
        playbackRate: 1,
        updatedBy: 'instructor',
        controllerId: null,
        playbackRevision: 0,
        serverTimestampMs: 1234,
      },
      telemetry: undefined,
    },
  )
})

void test('parseVideoSyncStateMessagePayload defaults missing playerHost for legacy payloads', () => {
  assert.deepEqual(
    parseVideoSyncStateMessagePayload({
      state: {
        provider: 'youtube',
        videoId: 'abcdefghijk',
        startSec: 12,
        stopSec: null,
        positionSec: 18,
        isPlaying: false,
        playbackRate: 1,
        updatedBy: 'system',
        serverTimestampMs: 1234,
      },
    })?.state?.playerHost,
    'youtube-nocookie',
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
