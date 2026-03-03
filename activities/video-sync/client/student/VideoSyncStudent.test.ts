import assert from 'node:assert/strict'
import test from 'node:test'
import { hasInstructorPlaybackStarted } from './VideoSyncStudent.js'
import { normalizeVideoSyncState } from './VideoSyncStudent.js'
import { parseYouTubeVideoId } from './VideoSyncStudent.js'
import { reportVideoSyncStudentEvent } from './VideoSyncStudent.js'
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

void test('normalizeVideoSyncState sanitizes malformed persisted solo state values', () => {
  const normalized = normalizeVideoSyncState({
    provider: 'vimeo',
    videoId: 42,
    startSec: '12',
    stopSec: '30',
    positionSec: -5,
    isPlaying: 'yes',
    playbackRate: 2,
    updatedBy: 'manager',
    serverTimestampMs: 'oops',
  }, BASE_STATE)

  assert.deepEqual(normalized, {
    provider: 'youtube',
    videoId: '',
    startSec: 0,
    stopSec: null,
    positionSec: 0,
    isPlaying: false,
    playbackRate: 1,
    updatedBy: 'manager',
    serverTimestampMs: 0,
  })
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

void test('parseYouTubeVideoId uses only the first youtu.be path segment', () => {
  assert.deepEqual(
    parseYouTubeVideoId('https://youtu.be/abc123/extra-segment?t=45'),
    { videoId: 'abc123', startSec: 45, stopSec: null },
  )
})

void test('parseYouTubeVideoId rejects malformed short-url ids with invalid characters', () => {
  assert.deepEqual(
    parseYouTubeVideoId('https://youtu.be/abc$123'),
    { videoId: null, startSec: 0, stopSec: null },
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

void test('shouldBlockStudentOverlayKey allows non-media keys to preserve keyboard navigation', () => {
  assert.equal(shouldBlockStudentOverlayKey('a'), false)
  assert.equal(shouldBlockStudentOverlayKey('Enter'), false)
  assert.equal(shouldBlockStudentOverlayKey('F6'), false)
})

void test('reportVideoSyncStudentEvent swallows fetch failures so telemetry does not reject outward', async () => {
  const originalFetch = globalThis.fetch
  let fetchCalls = 0

  globalThis.fetch = (async () => {
    fetchCalls += 1
    throw new Error('[TEST] simulated telemetry network failure')
  }) as typeof fetch

  try {
    await assert.doesNotReject(async () => {
      await reportVideoSyncStudentEvent({
        sessionId: 's1',
        isSoloMode: false,
        studentId: 'student-1',
        eventType: 'load-failure',
        errorCode: 'YT_LOAD_FAILED',
      })
    })
    assert.equal(fetchCalls, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})
