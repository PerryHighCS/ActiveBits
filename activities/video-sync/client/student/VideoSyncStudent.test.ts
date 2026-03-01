import assert from 'node:assert/strict'
import test from 'node:test'
import { hasInstructorPlaybackStarted } from './VideoSyncStudent.js'
import type { VideoSyncState } from '../protocol.js'

const BASE_STATE: VideoSyncState = {
  provider: 'youtube',
  videoId: '',
  startSec: 0,
  stopSec: null,
  positionSec: 0,
  isPlaying: false,
  playbackRate: 1,
  updatedBy: 'system',
  serverTimestampMs: 0,
}

void test('hasInstructorPlaybackStarted is false without configured video', () => {
  assert.equal(hasInstructorPlaybackStarted(BASE_STATE), false)
})

void test('hasInstructorPlaybackStarted is true when instructor is actively playing', () => {
  assert.equal(
    hasInstructorPlaybackStarted({
      ...BASE_STATE,
      videoId: 'abc123',
      isPlaying: true,
    }),
    true,
  )
})

void test('hasInstructorPlaybackStarted is true when playback has progressed past start', () => {
  assert.equal(
    hasInstructorPlaybackStarted({
      ...BASE_STATE,
      videoId: 'abc123',
      startSec: 10,
      positionSec: 12,
      isPlaying: false,
    }),
    true,
  )
})

void test('hasInstructorPlaybackStarted is false before playback begins', () => {
  assert.equal(
    hasInstructorPlaybackStarted({
      ...BASE_STATE,
      videoId: 'abc123',
      startSec: 10,
      positionSec: 10,
      isPlaying: false,
    }),
    false,
  )
})
