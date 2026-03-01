import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampPositionSec,
  computeDesiredPositionSec,
  shouldCorrectDrift,
  DEFAULT_DRIFT_TOLERANCE_SEC,
} from './syncMath'
import type { VideoSyncState } from './protocol'

function createState(overrides: Partial<VideoSyncState> = {}): VideoSyncState {
  return {
    provider: 'youtube',
    videoId: 'abc123',
    startSec: 0,
    stopSec: null,
    positionSec: 10,
    isPlaying: false,
    playbackRate: 1,
    updatedBy: 'manager',
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
  assert.equal(shouldCorrectDrift(10, 10.6, DEFAULT_DRIFT_TOLERANCE_SEC), false)
  assert.equal(shouldCorrectDrift(10, 10.9, DEFAULT_DRIFT_TOLERANCE_SEC), true)
})
