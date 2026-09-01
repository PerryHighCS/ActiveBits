import assert from 'node:assert/strict'
import test from 'node:test'
import type { VideoSyncState } from './protocol.js'
import {
  clampPositionSec,
  computeDriftSec,
  computeDesiredPositionSec,
  DEFAULT_DRIFT_TOLERANCE_SEC,
  shouldApplyIncomingVideoSyncState,
  shouldCorrectDrift,
} from './syncMath.js'

function createState(overrides: Partial<VideoSyncState> = {}): VideoSyncState {
  return {
    provider: 'youtube',
    playerHost: 'youtube-nocookie',
    videoId: 'abc123',
    startSec: 0,
    stopSec: null,
    positionSec: 10,
    isPlaying: false,
    playbackRate: 1,
    updatedBy: 'instructor',
    serverTimestampMs: 1_000,
    ...overrides,
  }
}

void test('clampPositionSec returns 0 for invalid values and clamps negatives', () => {
  assert.equal(clampPositionSec(Number.NaN), 0)
  assert.equal(clampPositionSec(Number.POSITIVE_INFINITY), 0)
  assert.equal(clampPositionSec(-5), 0)
  assert.equal(clampPositionSec(3.25), 3.25)
})

void test('computeDesiredPositionSec advances when playing', () => {
  const state = createState({ isPlaying: true, positionSec: 12, serverTimestampMs: 1_000 })
  const desired = computeDesiredPositionSec(state, 2_500)
  assert.equal(desired, 13.5)
})

void test('computeDesiredPositionSec honors stopSec cap', () => {
  const state = createState({ isPlaying: true, positionSec: 18, stopSec: 20, serverTimestampMs: 1_000 })
  const desired = computeDesiredPositionSec(state, 4_000)
  assert.equal(desired, 20)
})

void test('shouldCorrectDrift compares against tolerance threshold', () => {
  assert.equal(shouldCorrectDrift(10, 10.1, DEFAULT_DRIFT_TOLERANCE_SEC), false)
  assert.equal(shouldCorrectDrift(10, 10.3, DEFAULT_DRIFT_TOLERANCE_SEC), true)
})

void test('computeDriftSec returns a finite drift for non-finite player positions', () => {
  assert.equal(computeDriftSec(Number.NaN, 12), 12)
  assert.equal(computeDriftSec(Number.POSITIVE_INFINITY, 12), 12)
  assert.equal(computeDriftSec(8, Number.NaN), 8)
})

void test('shouldApplyIncomingVideoSyncState rejects a frame older than the applied state', () => {
  const current = createState({ serverTimestampMs: 5_000, isPlaying: false, updatedBy: 'instructor' })
  const stale = createState({ serverTimestampMs: 4_000, isPlaying: true, updatedBy: 'system' })
  assert.equal(shouldApplyIncomingVideoSyncState(current, stale), false)
})

void test('shouldApplyIncomingVideoSyncState accepts a strictly newer frame', () => {
  const current = createState({ serverTimestampMs: 5_000 })
  const next = createState({ serverTimestampMs: 5_001, isPlaying: true })
  assert.equal(shouldApplyIncomingVideoSyncState(current, next), true)
})

void test('shouldApplyIncomingVideoSyncState keeps an equal-timestamp instructor frame over a system one', () => {
  const current = createState({ serverTimestampMs: 7_000, updatedBy: 'instructor', isPlaying: false })
  const heartbeat = createState({ serverTimestampMs: 7_000, updatedBy: 'system', isPlaying: true })
  assert.equal(shouldApplyIncomingVideoSyncState(current, heartbeat), false)

  const instructorEcho = createState({ serverTimestampMs: 7_000, updatedBy: 'instructor', isPlaying: false })
  assert.equal(shouldApplyIncomingVideoSyncState(current, instructorEcho), true)
})

void test('shouldApplyIncomingVideoSyncState always applies frames while still unconfigured', () => {
  const current = createState({ videoId: '', serverTimestampMs: 9_999 })
  const olderConfigured = createState({ videoId: 'abc123', serverTimestampMs: 1 })
  assert.equal(shouldApplyIncomingVideoSyncState(current, olderConfigured), true)
})

void test('shouldApplyIncomingVideoSyncState applies a re-configure to a new video id regardless of timestamp', () => {
  const current = createState({ videoId: 'abc123', serverTimestampMs: 9_000 })
  const reconfigured = createState({ videoId: 'zzz999', serverTimestampMs: 1_000 })
  assert.equal(shouldApplyIncomingVideoSyncState(current, reconfigured), true)
})
