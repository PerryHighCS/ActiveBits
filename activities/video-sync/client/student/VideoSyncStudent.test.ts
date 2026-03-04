import assert from 'node:assert/strict'
import test from 'node:test'
import { clearAutoplayCheckTimer } from './VideoSyncStudent.js'
import { getStudentPlaybackSyncAction } from './VideoSyncStudent.js'
import { hasInstructorPlaybackStarted } from './VideoSyncStudent.js'
import { reportVideoSyncStudentEvent } from './VideoSyncStudent.js'
import { resetUnsyncedPlaybackTelemetry } from './VideoSyncStudent.js'
import { shouldCorrectStudentPlaybackDrift } from './VideoSyncStudent.js'
import { shouldRunAutoplayCheck } from './VideoSyncStudent.js'
import { syncLoadedVideoSource } from './VideoSyncStudent.js'
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

  assert.equal(shouldInitializeYoutubePlayer('', null, null), false)
  assert.equal(shouldInitializeYoutubePlayer('', container, null), false)
  assert.equal(shouldInitializeYoutubePlayer('abcdefghijk', container, existingPlayer), false)
  assert.equal(shouldInitializeYoutubePlayer('abcdefghijk', container, null), true)
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

void test('shouldCorrectStudentPlaybackDrift is lenient while synced playback is actively running', () => {
  assert.equal(shouldCorrectStudentPlaybackDrift(10, 10.4, true), false)
  assert.equal(shouldCorrectStudentPlaybackDrift(10, 10.6, true), true)
  assert.equal(shouldCorrectStudentPlaybackDrift(10, 10.3, false), true)
})

void test('getStudentPlaybackSyncAction uses rate correction for moderate live drift and seeking for larger misses', () => {
  assert.deepEqual(getStudentPlaybackSyncAction(10, 10.2, true), {
    type: 'none',
    playbackRate: 1,
  })
  assert.deepEqual(getStudentPlaybackSyncAction(10, 10.8, true), {
    type: 'rate',
    playbackRate: 1.25,
  })
  assert.deepEqual(getStudentPlaybackSyncAction(10.8, 10, true), {
    type: 'rate',
    playbackRate: 0.75,
  })
  assert.deepEqual(getStudentPlaybackSyncAction(10, 12, true), {
    type: 'seek',
    playbackRate: 1,
  })
  assert.deepEqual(getStudentPlaybackSyncAction(10, 10.3, false), {
    type: 'seek',
    playbackRate: 1,
  })
})

void test('syncLoadedVideoSource cues a paused synced video without autoplaying', () => {
  const loadCalls: Array<{ videoId: string; startSeconds?: number; endSeconds?: number }> = []
  const cueCalls: Array<{ videoId: string; startSeconds?: number; endSeconds?: number }> = []
  const rateCalls: number[] = []
  const player = {
    setPlaybackRate(rate: number) {
      rateCalls.push(rate)
    },
    loadVideoById(options: { videoId: string; startSeconds?: number; endSeconds?: number }) {
      loadCalls.push(options)
    },
    cueVideoById(options: { videoId: string; startSeconds?: number; endSeconds?: number }) {
      cueCalls.push(options)
    },
  } as YoutubePlayerLike

  syncLoadedVideoSource(player, {
    ...BASE_STATE,
    videoId: 'abcdefghijk',
    stopSec: 42,
    isPlaying: false,
  }, 12)

  assert.deepEqual(rateCalls, [1])
  assert.deepEqual(loadCalls, [])
  assert.deepEqual(cueCalls, [{
    videoId: 'abcdefghijk',
    startSeconds: 12,
    endSeconds: 42,
  }])
})

void test('syncLoadedVideoSource loads a playing synced video for immediate playback', () => {
  const loadCalls: Array<{ videoId: string; startSeconds?: number; endSeconds?: number }> = []
  const cueCalls: Array<{ videoId: string; startSeconds?: number; endSeconds?: number }> = []
  const rateCalls: number[] = []
  const player = {
    setPlaybackRate(rate: number) {
      rateCalls.push(rate)
    },
    loadVideoById(options: { videoId: string; startSeconds?: number; endSeconds?: number }) {
      loadCalls.push(options)
    },
    cueVideoById(options: { videoId: string; startSeconds?: number; endSeconds?: number }) {
      cueCalls.push(options)
    },
  } as YoutubePlayerLike

  syncLoadedVideoSource(player, {
    ...BASE_STATE,
    videoId: 'abcdefghijk',
    isPlaying: true,
  }, 18)

  assert.deepEqual(rateCalls, [1])
  assert.deepEqual(cueCalls, [])
  assert.deepEqual(loadCalls, [{
    videoId: 'abcdefghijk',
    startSeconds: 18,
    endSeconds: undefined,
  }])
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

void test('shouldRunAutoplayCheck only reads autoplay state for the current player instance', () => {
  const scheduledPlayer = {} as YoutubePlayerLike
  const replacementPlayer = {} as YoutubePlayerLike

  assert.equal(shouldRunAutoplayCheck(scheduledPlayer, scheduledPlayer), true)
  assert.equal(shouldRunAutoplayCheck(null, scheduledPlayer), false)
  assert.equal(shouldRunAutoplayCheck(replacementPlayer, scheduledPlayer), false)
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
