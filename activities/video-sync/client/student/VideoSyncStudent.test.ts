import assert from 'node:assert/strict'
import test from 'node:test'
import { clearAutoplayCheckTimer } from './VideoSyncStudent.js'
import { hasInstructorPlaybackStarted } from './VideoSyncStudent.js'
import { reportVideoSyncStudentEvent } from './VideoSyncStudent.js'
import { resetUnsyncedPlaybackTelemetry } from './VideoSyncStudent.js'
import { shouldInitializeYoutubePlayer } from './VideoSyncStudent.js'
import { shouldBlockStudentOverlayKey } from './VideoSyncStudent.js'
import type { VideoSyncState } from '../protocol.js'
import type { YoutubePlayerLike } from '../youtubeIframeApi.js'

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

void test('shouldInitializeYoutubePlayer only allows first-time setup when a container exists', () => {
  const container = {} as HTMLDivElement
  const existingPlayer = {} as YoutubePlayerLike

  assert.equal(shouldInitializeYoutubePlayer(null, null), false)
  assert.equal(shouldInitializeYoutubePlayer(container, existingPlayer), false)
  assert.equal(shouldInitializeYoutubePlayer(container, null), true)
})

void test('resetUnsyncedPlaybackTelemetry clears local unsync tracking state', () => {
  const isLocallyUnsyncedRef = { current: true }
  const lastUnsyncReportAtRef = { current: 12_345 }

  resetUnsyncedPlaybackTelemetry({
    isLocallyUnsyncedRef,
    lastUnsyncReportAtRef,
  })

  assert.equal(isLocallyUnsyncedRef.current, false)
  assert.equal(lastUnsyncReportAtRef.current, 0)
})

void test('clearAutoplayCheckTimer clears the pending autoplay timeout ref', () => {
  const originalWindow = globalThis.window
  const clearedTimeouts: number[] = []

  Object.assign(globalThis, {
    window: {
      clearTimeout(timeoutId: number) {
        clearedTimeouts.push(timeoutId)
      },
    },
  })

  try {
    const autoplayCheckTimerRef = { current: 42 }
    clearAutoplayCheckTimer(autoplayCheckTimerRef)

    assert.deepEqual(clearedTimeouts, [42])
    assert.equal(autoplayCheckTimerRef.current, null)
  } finally {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window')
    } else {
      Object.assign(globalThis, { window: originalWindow })
    }
  }
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

void test('reportVideoSyncStudentEvent returns early when sessionId is missing', async () => {
  const originalFetch = globalThis.fetch
  let fetchCalls = 0

  globalThis.fetch = (async () => {
    fetchCalls += 1
    return new Response(null, { status: 204 })
  }) as typeof fetch

  try {
    await reportVideoSyncStudentEvent({
      sessionId: null,
      studentId: 'student-1',
      eventType: 'autoplay-blocked',
    })
    assert.equal(fetchCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
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
