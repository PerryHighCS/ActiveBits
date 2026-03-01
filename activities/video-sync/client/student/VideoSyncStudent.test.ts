import assert from 'node:assert/strict'
import test from 'node:test'
import { hasInstructorPlaybackStarted } from './VideoSyncStudent.js'
import { parseYouTubeVideoId } from './VideoSyncStudent.js'
import { shouldBlockStudentOverlayKey } from './VideoSyncStudent.js'
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

void test('parseYouTubeVideoId parses numeric start and end query params', () => {
  assert.deepEqual(
    parseYouTubeVideoId('https://www.youtube.com/watch?v=abc123&t=83&end=120'),
    { videoId: 'abc123', startSec: 83, stopSec: 120 },
  )
})

void test('parseYouTubeVideoId parses YouTube timestamp shorthand for start time', () => {
  assert.deepEqual(
    parseYouTubeVideoId('https://www.youtube.com/watch?v=abc123&t=1m23s'),
    { videoId: 'abc123', startSec: 83, stopSec: null },
  )
})

void test('parseYouTubeVideoId parses hour-minute-second timestamp shorthand', () => {
  assert.deepEqual(
    parseYouTubeVideoId('https://youtu.be/abc123?t=1h2m3s'),
    { videoId: 'abc123', startSec: 3723, stopSec: null },
  )
})

void test('parseYouTubeVideoId parses shorthand stop time', () => {
  assert.deepEqual(
    parseYouTubeVideoId('https://www.youtube.com/watch?v=abc123&start=30&end=2m10s'),
    { videoId: 'abc123', startSec: 30, stopSec: 130 },
  )
})

void test('shouldBlockStudentOverlayKey allows Tab and Escape so focus is not trapped', () => {
  assert.equal(shouldBlockStudentOverlayKey('Tab'), false)
  assert.equal(shouldBlockStudentOverlayKey('Escape'), false)
})

void test('shouldBlockStudentOverlayKey blocks other playback-related keys', () => {
  assert.equal(shouldBlockStudentOverlayKey(' '), true)
  assert.equal(shouldBlockStudentOverlayKey('ArrowRight'), true)
  assert.equal(shouldBlockStudentOverlayKey('k'), true)
})
