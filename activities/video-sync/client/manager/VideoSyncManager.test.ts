import assert from 'node:assert/strict'
import test from 'node:test'
import {
  consumeCreateSessionBootstrapPayload,
  storeCreateSessionBootstrapPayload,
} from '@src/components/common/manageDashboardUtils'
import {
  autoConfigureBootstrapSource,
  buildManagerWsUrl,
  clearManagerPlayerLoadError,
  createManagerWsAuthMessage,
  getManagerPlaybackIntentForStateChange,
  parseManagerStopTimeInput,
  readBootstrapInstructorPasscode,
  readBootstrapSourceUrl,
  readEmbeddedBootstrapSourceUrl,
  resolveBootstrapInstructorPasscode,
  sanitizeManagerApiErrorMessage,
  shouldRenderEmbeddedManagerHeader,
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

void test('resolveBootstrapInstructorPasscode clears history state only for navigation bootstrap payloads', () => {
  assert.deepEqual(
    resolveBootstrapInstructorPasscode({
      locationState: {
        createSessionPayload: {
          instructorPasscode: 'teacher-passcode',
        },
      },
      sessionId: 'session-123',
    }),
    {
      instructorPasscode: 'teacher-passcode',
      shouldClearLocationState: true,
    },
  )
})

void test('resolveBootstrapInstructorPasscode clears same-tab fallback cache when location state is used', () => {
  storeCreateSessionBootstrapPayload('video-sync', 'session-123', {
    instructorPasscode: 'cached-passcode',
  })

  assert.deepEqual(
    resolveBootstrapInstructorPasscode({
      locationState: {
        createSessionPayload: {
          instructorPasscode: 'teacher-passcode',
        },
      },
      sessionId: 'session-123',
    }),
    {
      instructorPasscode: 'teacher-passcode',
      shouldClearLocationState: true,
    },
  )

  assert.equal(consumeCreateSessionBootstrapPayload('video-sync', 'session-123'), null)
})

void test('resolveBootstrapInstructorPasscode preserves same-tab bootstrap payloads without navigation cleanup', () => {
  storeCreateSessionBootstrapPayload('video-sync', 'session-123', {
    instructorPasscode: 'teacher-passcode',
  })

  assert.deepEqual(
    resolveBootstrapInstructorPasscode({
      locationState: null,
      sessionId: 'session-123',
    }),
    {
      instructorPasscode: 'teacher-passcode',
      shouldClearLocationState: false,
    },
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

void test('readEmbeddedBootstrapSourceUrl returns sourceUrl from embedded launch selected options', () => {
  assert.equal(
    readEmbeddedBootstrapSourceUrl({
      sourceUrl: 'https://www.youtube.com/watch?v=mCq8-xTH7jA',
    }),
    'https://www.youtube.com/watch?v=mCq8-xTH7jA',
  )
})

void test('readEmbeddedBootstrapSourceUrl ignores missing or invalid embedded launch payloads', () => {
  assert.equal(readEmbeddedBootstrapSourceUrl(null), null)
  assert.equal(readEmbeddedBootstrapSourceUrl({}), null)
  assert.equal(readEmbeddedBootstrapSourceUrl({ sourceUrl: '' }), null)
  assert.equal(readEmbeddedBootstrapSourceUrl({ sourceUrl: 42 }), null)
})

void test('shouldRenderEmbeddedManagerHeader hides the manager header for embedded child sessions', () => {
  assert.equal(shouldRenderEmbeddedManagerHeader('session-123'), true)
  assert.equal(shouldRenderEmbeddedManagerHeader('CHILD:parent:abcde:video-sync'), false)
  assert.equal(shouldRenderEmbeddedManagerHeader(null), true)
})

void test('buildManagerWsUrl omits instructor credentials from the websocket URL', () => {
  assert.equal(
    buildManagerWsUrl({
      sessionId: 'session-123',
      location: {
        protocol: 'https:',
        host: 'bits.example.test',
      },
    }),
    'wss://bits.example.test/ws/video-sync?sessionId=session-123&role=instructor',
  )
})

void test('createManagerWsAuthMessage serializes the post-connect auth payload', () => {
  assert.equal(
    createManagerWsAuthMessage('teacher-passcode'),
    JSON.stringify({
      type: 'authenticate',
      instructorPasscode: 'teacher-passcode',
    }),
  )
  assert.equal(createManagerWsAuthMessage(''), null)
  assert.equal(createManagerWsAuthMessage(null), null)
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

void test('sanitizeManagerApiErrorMessage falls back for non-string or empty values', () => {
  assert.equal(sanitizeManagerApiErrorMessage(null, 'fallback'), 'fallback')
  assert.equal(sanitizeManagerApiErrorMessage('   ', 'fallback'), 'fallback')
})

void test('sanitizeManagerApiErrorMessage trims and truncates long server messages', () => {
  assert.equal(sanitizeManagerApiErrorMessage('  server said no  ', 'fallback'), 'server said no')
  assert.equal(
    sanitizeManagerApiErrorMessage('x'.repeat(200), 'fallback'),
    `${'x'.repeat(159)}…`,
  )
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

void test('getManagerPlaybackIntentForStateChange maps native player transitions to local playback intent', () => {
  assert.equal(
    getManagerPlaybackIntentForStateChange({
      eventState: 1,
      playingStateValue: 1,
      pausedStateValue: 2,
    }),
    'play',
  )
  assert.equal(
    getManagerPlaybackIntentForStateChange({
      eventState: 2,
      playingStateValue: 1,
      pausedStateValue: 2,
    }),
    'pause',
  )
  assert.equal(
    getManagerPlaybackIntentForStateChange({
      eventState: 99,
      playingStateValue: 1,
      pausedStateValue: 2,
    }),
    null,
  )
})

void test('parseManagerStopTimeInput rejects invalid stop values before saving config', () => {
  assert.deepEqual(
    parseManagerStopTimeInput({
      sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43',
      stopTimeEnabled: true,
      stopSecText: 'oops',
    }),
    {
      stopSecValue: null,
      errorMessage: 'End time must be a valid number of seconds or h/m/s value like 1m23s.',
    },
  )
})

void test('parseManagerStopTimeInput rejects stop values at or before the URL start time', () => {
  assert.deepEqual(
    parseManagerStopTimeInput({
      sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43',
      stopTimeEnabled: true,
      stopSecText: '43',
    }),
    {
      stopSecValue: 43,
      errorMessage: 'End time must be greater than the YouTube URL start time.',
    },
  )
})

void test('parseManagerStopTimeInput allows valid ranges and defers unsupported URLs to the server', () => {
  assert.deepEqual(
    parseManagerStopTimeInput({
      sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43',
      stopTimeEnabled: true,
      stopSecText: '44',
    }),
    {
      stopSecValue: 44,
      errorMessage: null,
    },
  )
  assert.deepEqual(
    parseManagerStopTimeInput({
      sourceUrl: 'not a url',
      stopTimeEnabled: true,
      stopSecText: '44',
    }),
    {
      stopSecValue: 44,
      errorMessage: null,
    },
  )
})
