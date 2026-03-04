import assert from 'node:assert/strict'
import test from 'node:test'
import {
  consumeCreateSessionBootstrapPayload,
  storeCreateSessionBootstrapPayload,
} from '@src/components/common/manageDashboardUtils'
import {
  autoConfigureBootstrapSource,
  clearManagerPlayerLoadError,
  readBootstrapInstructorPasscode,
  readBootstrapSourceUrl,
  shouldCorrectManagerPlaybackDrift,
  shouldApplyManagerStateUpdate,
  shouldAutoStartBootstrapSource,
} from './VideoSyncManager.js'
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

void test('readBootstrapInstructorPasscode returns passcode from create-session navigation state', () => {
  assert.equal(
    readBootstrapInstructorPasscode({
      createSessionPayload: {
        instructorPasscode: 'teacher-passcode',
      },
    }),
    'teacher-passcode',
  )
})

void test('readBootstrapInstructorPasscode ignores missing or invalid state payloads', () => {
  assert.equal(readBootstrapInstructorPasscode(null), null)
  assert.equal(readBootstrapInstructorPasscode({}), null)
  assert.equal(readBootstrapInstructorPasscode({ createSessionPayload: {} }), null)
  assert.equal(readBootstrapInstructorPasscode({ createSessionPayload: { instructorPasscode: 42 } }), null)
})

void test('readBootstrapInstructorPasscode works with consumed same-tab bootstrap payloads', () => {
  storeCreateSessionBootstrapPayload('video-sync', 'session-123', {
    instructorPasscode: 'teacher-passcode',
  })

  assert.equal(
    readBootstrapInstructorPasscode({
      createSessionPayload: consumeCreateSessionBootstrapPayload('video-sync', 'session-123') ?? undefined,
    }),
    'teacher-passcode',
  )
})

void test('readBootstrapSourceUrl returns sourceUrl from query string', () => {
  assert.equal(
    readBootstrapSourceUrl('?sourceUrl=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ%3Ft%3D43'),
    'https://youtu.be/dQw4w9WgXcQ?t=43',
  )
})

void test('readBootstrapSourceUrl ignores missing or empty query params', () => {
  assert.equal(readBootstrapSourceUrl(''), null)
  assert.equal(readBootstrapSourceUrl('?sourceUrl='), null)
  assert.equal(readBootstrapSourceUrl('?other=value'), null)
})

void test('shouldAutoStartBootstrapSource requires setup mode, source url, and ready credentials', () => {
  assert.equal(
    shouldAutoStartBootstrapSource({
      setupMode: true,
      bootstrapSourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43',
      isPasscodeReady: true,
      instructorPasscode: 'teacher-passcode',
      autoStartStatus: 'idle',
    }),
    true,
  )

  assert.equal(
    shouldAutoStartBootstrapSource({
      setupMode: false,
      bootstrapSourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43',
      isPasscodeReady: true,
      instructorPasscode: 'teacher-passcode',
      autoStartStatus: 'idle',
    }),
    false,
  )

  assert.equal(
    shouldAutoStartBootstrapSource({
      setupMode: true,
      bootstrapSourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43',
      isPasscodeReady: false,
      instructorPasscode: 'teacher-passcode',
      autoStartStatus: 'idle',
    }),
    false,
  )

  assert.equal(
    shouldAutoStartBootstrapSource({
      setupMode: true,
      bootstrapSourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43',
      isPasscodeReady: true,
      instructorPasscode: 'teacher-passcode',
      autoStartStatus: 'failed',
    }),
    false,
  )
})

void test('autoConfigureBootstrapSource only saves the configured source', async () => {
  const calls: string[] = []

  const configured = await autoConfigureBootstrapSource({
    bootstrapSourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43',
    saveConfig: async (sourceUrl) => {
      calls.push(`save:${sourceUrl}`)
      return true
    },
  })

  assert.equal(configured, true)
  assert.deepEqual(calls, ['save:https://youtu.be/dQw4w9WgXcQ?t=43'])
})

void test('autoConfigureBootstrapSource returns false when config save fails', async () => {
  const calls: string[] = []

  const configured = await autoConfigureBootstrapSource({
    bootstrapSourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43',
    saveConfig: async () => {
      calls.push('save')
      return false
    },
  })

  assert.equal(configured, false)
  assert.deepEqual(calls, ['save'])
})

void test('clearManagerPlayerLoadError only dismisses the transient YouTube load banner', () => {
  assert.equal(
    clearManagerPlayerLoadError('YouTube player failed to load. Try a different video URL.'),
    null,
  )
  assert.equal(
    clearManagerPlayerLoadError('Instructor credentials missing. Open this session from the dashboard or authenticated permalink.'),
    'Instructor credentials missing. Open this session from the dashboard or authenticated permalink.',
  )
  assert.equal(clearManagerPlayerLoadError(null), null)
})

void test('shouldApplyManagerStateUpdate ignores empty late updates after a video is configured', () => {
  assert.equal(
    shouldApplyManagerStateUpdate(
      {
        ...BASE_STATE,
        videoId: 'abcdefghijk',
        startSec: 43,
      },
      BASE_STATE,
    ),
    false,
  )

  assert.equal(
    shouldApplyManagerStateUpdate(
      BASE_STATE,
      {
        ...BASE_STATE,
        videoId: 'abcdefghijk',
        startSec: 43,
      },
    ),
    true,
  )
})

void test('shouldCorrectManagerPlaybackDrift is lenient while instructor playback is actively running', () => {
  assert.equal(shouldCorrectManagerPlaybackDrift(10, 10.6, true), false)
  assert.equal(shouldCorrectManagerPlaybackDrift(10, 11.2, true), false)
  assert.equal(shouldCorrectManagerPlaybackDrift(10, 12.3, true), true)
  assert.equal(shouldCorrectManagerPlaybackDrift(10, 10.3, false), true)
})
