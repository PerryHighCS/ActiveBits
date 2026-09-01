import assert from 'node:assert/strict'
import test from 'node:test'
import type { VideoSyncState } from '../protocol.js'
import {
    autoConfigureBootstrapSource,
    buildManagerWsUrl,
    clearManagerPlayerLoadError,
    getManagerPlaybackIntentForStateChange,
    parseManagerStopTimeInput,
    DEFAULT_MANAGER_ACCESS_RETRY_AFTER_MS,
    isManagerAuthorizationClose,
    isRetryableManagerAccessStatus,
    parseManagerAccessRetryAfterMs,
    readBootstrapSourceUrl,
    readEmbeddedBootstrapSourceUrl,
    readRecoveredPersistentSourceUrl,
    resolveManagerStateChangeIntent,
    sanitizeManagerApiErrorMessage,
    shouldApplyManagerStateUpdate,
    shouldAutoStartBootstrapSource,
    shouldCorrectManagerPlaybackDrift,
    shouldFetchEmbeddedBootstrapSourceUrl,
    shouldRecoverAutoStartAfterCredentialLoad,
    shouldRenderManagerHeaderForSession,
    shouldRequestEmbeddedBootstrapRefreshOnDenial,
    shouldSendManagerPlaybackPositionUpdate,
} from './VideoSyncManager.js'

const BASE_STATE: VideoSyncState = {
  provider: 'youtube',
  playerHost: 'youtube-nocookie',
  videoId: '',
  startSec: 0,
  stopSec: null,
  positionSec: 0,
  isPlaying: false,
  playbackRate: 1,
  updatedBy: 'system',
  serverTimestampMs: 0,
}

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

void test('readRecoveredPersistentSourceUrl returns canonical sourceUrl from recovery payload', () => {
  assert.equal(
    readRecoveredPersistentSourceUrl({ persistentSourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43' }),
    'https://youtu.be/dQw4w9WgXcQ?t=43',
  )
})

void test('readRecoveredPersistentSourceUrl ignores missing or invalid recovery payload values', () => {
  assert.equal(readRecoveredPersistentSourceUrl(null), null)
  assert.equal(readRecoveredPersistentSourceUrl({}), null)
  assert.equal(readRecoveredPersistentSourceUrl({ persistentSourceUrl: '' }), null)
  assert.equal(readRecoveredPersistentSourceUrl({ persistentSourceUrl: 42 as unknown as string }), null)
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

void test('shouldRenderManagerHeaderForSession hides the manager header for embedded child sessions', () => {
  assert.equal(shouldRenderManagerHeaderForSession('session-123'), true)
  assert.equal(shouldRenderManagerHeaderForSession('CHILD:parent:abcde:video-sync'), false)
  assert.equal(shouldRenderManagerHeaderForSession(null), true)
})

void test('isRetryableManagerAccessStatus retries 5xx and network-shaped failures but not definitive denials', () => {
  // Definitive denials latch the read-only state immediately.
  assert.equal(isRetryableManagerAccessStatus(400), false)
  assert.equal(isRetryableManagerAccessStatus(401), false)
  assert.equal(isRetryableManagerAccessStatus(403), false)
  assert.equal(isRetryableManagerAccessStatus(404), false)
  // 429 is transient but handled on its own longer, Retry-After-honoring path,
  // so the short-backoff predicate deliberately excludes it.
  assert.equal(isRetryableManagerAccessStatus(429), false)
  // The route's explicitly temporary store failures are retried with backoff.
  assert.equal(isRetryableManagerAccessStatus(500), true)
  assert.equal(isRetryableManagerAccessStatus(502), true)
  assert.equal(isRetryableManagerAccessStatus(503), true)
})

void test('parseManagerAccessRetryAfterMs parses delta-seconds and rejects unusable values', () => {
  assert.equal(parseManagerAccessRetryAfterMs('60'), 60_000)
  assert.equal(parseManagerAccessRetryAfterMs(' 5 '), 5_000)
  // Clamped to a 5 minute ceiling so a hostile/absurd header cannot stall the manager.
  assert.equal(parseManagerAccessRetryAfterMs('99999'), 5 * 60_000)
  // Absent / non-numeric (HTTP-date form) / non-positive -> caller uses the default.
  assert.equal(parseManagerAccessRetryAfterMs(null), null)
  assert.equal(parseManagerAccessRetryAfterMs(undefined), null)
  assert.equal(parseManagerAccessRetryAfterMs('Wed, 21 Oct 2026 07:28:00 GMT'), null)
  assert.equal(parseManagerAccessRetryAfterMs('0'), null)
  assert.equal(parseManagerAccessRetryAfterMs('-3'), null)
  assert.equal(DEFAULT_MANAGER_ACCESS_RETRY_AFTER_MS, 60_000)
})

void test('isManagerAuthorizationClose only matches the policy-violation close the manager socket uses for Forbidden', () => {
  assert.equal(isManagerAuthorizationClose(1008), true)
  assert.equal(isManagerAuthorizationClose(1000), false)
  assert.equal(isManagerAuthorizationClose(1006), false)
  assert.equal(isManagerAuthorizationClose(1001), false)
})

void test('shouldRequestEmbeddedBootstrapRefreshOnDenial only fires for an embedded child on a 401/403', () => {
  // Embedded child + auth denial -> ask the parent for a fresh token.
  assert.equal(
    shouldRequestEmbeddedBootstrapRefreshOnDenial({ sessionId: 'CHILD:parent:abcde:video-sync', status: 403 }),
    true,
  )
  assert.equal(
    shouldRequestEmbeddedBootstrapRefreshOnDenial({ sessionId: 'CHILD:parent:abcde:video-sync', status: 401 }),
    true,
  )
  // Standalone manager cannot redeem a parent token; it just latches read-only.
  assert.equal(
    shouldRequestEmbeddedBootstrapRefreshOnDenial({ sessionId: 'session-123', status: 403 }),
    false,
  )
  // Non-denial statuses are handled by the retry/deny paths, not a refresh.
  assert.equal(
    shouldRequestEmbeddedBootstrapRefreshOnDenial({ sessionId: 'CHILD:parent:abcde:video-sync', status: 404 }),
    false,
  )
  assert.equal(
    shouldRequestEmbeddedBootstrapRefreshOnDenial({ sessionId: 'CHILD:parent:abcde:video-sync', status: 500 }),
    false,
  )
  assert.equal(
    shouldRequestEmbeddedBootstrapRefreshOnDenial({ sessionId: null, status: 403 }),
    false,
  )
})

void test('shouldFetchEmbeddedBootstrapSourceUrl only fetches for embedded child sessions without query bootstrap', () => {
  assert.equal(
    shouldFetchEmbeddedBootstrapSourceUrl({
      sessionId: 'CHILD:parent:abcde:video-sync',
      queryBootstrapSourceUrl: null,
    }),
    true,
  )
  assert.equal(
    shouldFetchEmbeddedBootstrapSourceUrl({
      sessionId: 'session-123',
      queryBootstrapSourceUrl: null,
    }),
    false,
  )
  assert.equal(
    shouldFetchEmbeddedBootstrapSourceUrl({
      sessionId: 'CHILD:parent:abcde:video-sync',
      queryBootstrapSourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43',
    }),
    false,
  )
  assert.equal(
    shouldFetchEmbeddedBootstrapSourceUrl({
      sessionId: null,
      queryBootstrapSourceUrl: null,
    }),
    false,
  )
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

void test('getManagerPlaybackIntentForStateChange treats natural video completion as a pause', () => {
  assert.equal(
    getManagerPlaybackIntentForStateChange({
      eventState: 0,
      endedStateValue: 0,
      playingStateValue: 1,
      pausedStateValue: 2,
    }),
    'pause',
  )
})

void test('getManagerPlaybackIntentForStateChange preserves ordinary play and pause events', () => {
  assert.equal(
    getManagerPlaybackIntentForStateChange({
      eventState: 1,
      endedStateValue: 0,
      playingStateValue: 1,
      pausedStateValue: 2,
    }),
    'play',
  )
  assert.equal(
    getManagerPlaybackIntentForStateChange({
      eventState: 2,
      endedStateValue: 0,
      playingStateValue: 1,
      pausedStateValue: 2,
    }),
    'pause',
  )
  assert.equal(
    getManagerPlaybackIntentForStateChange({
      eventState: 3,
      endedStateValue: 0,
      playingStateValue: 1,
      pausedStateValue: 2,
    }),
    null,
  )
})

void test('shouldAutoStartBootstrapSource requires setup mode, source url, and ready credentials', () => {
  assert.equal(
    shouldAutoStartBootstrapSource({
      setupMode: true,
      bootstrapSourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43',
      isManagerAccessReady: true,
      hasManagerAccess: true,
      autoStartStatus: 'idle',
    }),
    true,
  )

  assert.equal(
    shouldAutoStartBootstrapSource({
      setupMode: false,
      bootstrapSourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43',
      isManagerAccessReady: true,
      hasManagerAccess: true,
      autoStartStatus: 'idle',
    }),
    false,
  )

  assert.equal(
    shouldAutoStartBootstrapSource({
      setupMode: true,
      bootstrapSourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43',
      isManagerAccessReady: false,
      hasManagerAccess: true,
      autoStartStatus: 'idle',
    }),
    false,
  )

  assert.equal(
    shouldAutoStartBootstrapSource({
      setupMode: true,
      bootstrapSourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43',
      isManagerAccessReady: true,
      hasManagerAccess: true,
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

void test('shouldRecoverAutoStartAfterCredentialLoad retries failed bootstrap once credentials arrive', () => {
  assert.equal(
    shouldRecoverAutoStartAfterCredentialLoad({
      setupMode: true,
      bootstrapSourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43',
      hasManagerAccess: true,
      autoStartStatus: 'failed',
      errorMessage: 'Manager access is unavailable. Open this session from the dashboard or authenticated permalink.',
    }),
    true,
  )
  assert.equal(
    shouldRecoverAutoStartAfterCredentialLoad({
      setupMode: true,
      bootstrapSourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43',
      hasManagerAccess: false,
      autoStartStatus: 'failed',
      errorMessage: 'Manager access is unavailable. Open this session from the dashboard or authenticated permalink.',
    }),
    false,
  )
  assert.equal(
    shouldRecoverAutoStartAfterCredentialLoad({
      setupMode: true,
      bootstrapSourceUrl: null,
      hasManagerAccess: true,
      autoStartStatus: 'failed',
      errorMessage: 'Manager access is unavailable. Open this session from the dashboard or authenticated permalink.',
    }),
    false,
  )
  assert.equal(
    shouldRecoverAutoStartAfterCredentialLoad({
      setupMode: true,
      bootstrapSourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=43',
      hasManagerAccess: true,
      autoStartStatus: 'failed',
      errorMessage: 'Could not save video configuration. Please try again.',
    }),
    false,
  )
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

void test('resolveManagerStateChangeIntent records a real gesture but drops its own programmatic echo', () => {
  // Not suppressed: any resolved intent is a genuine instructor gesture.
  assert.deepEqual(
    resolveManagerStateChangeIntent({ suppressed: false, nextIntent: 'play', programmaticTarget: 'pause' }),
    { record: true },
  )

  // Suppressed echo of the transition applyStateToPlayer just requested: drop it.
  assert.deepEqual(
    resolveManagerStateChangeIntent({ suppressed: true, nextIntent: 'play', programmaticTarget: 'play' }),
    { record: false },
  )

  // Suppressed but opposite to the programmatic target: a real click made inside
  // the window - this is the dropped-click defect. It must still be recorded.
  assert.deepEqual(
    resolveManagerStateChangeIntent({ suppressed: true, nextIntent: 'pause', programmaticTarget: 'play' }),
    { record: true },
  )

  // Buffering / cued / unstarted transitions carry no intent.
  assert.deepEqual(
    resolveManagerStateChangeIntent({ suppressed: false, nextIntent: null, programmaticTarget: 'play' }),
    { record: false },
  )
})

void test('a consumed programmatic target does not swallow a later same-direction instructor click', () => {
  // Mirrors the onStateChange sequence: the ref absorbs exactly one echo, then
  // is cleared, so play -> pause -> play inside one suppression window all land.
  let programmaticTarget: 'play' | 'pause' | null = 'play'
  const step = (nextIntent: 'play' | 'pause' | null) => {
    const result = resolveManagerStateChangeIntent({ suppressed: true, nextIntent, programmaticTarget })
    if (nextIntent != null) {
      programmaticTarget = null
    }
    return result.record
  }

  assert.equal(step('play'), false) // programmatic echo, dropped
  assert.equal(step('pause'), true) // instructor pause inside the window
  assert.equal(step('play'), true) // instructor re-play, same direction as the echo
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
      endedStateValue: 0,
      playingStateValue: 1,
      pausedStateValue: 2,
    }),
    'play',
  )
  assert.equal(
    getManagerPlaybackIntentForStateChange({
      eventState: 2,
      endedStateValue: 0,
      playingStateValue: 1,
      pausedStateValue: 2,
    }),
    'pause',
  )
  assert.equal(
    getManagerPlaybackIntentForStateChange({
      eventState: 99,
      endedStateValue: 0,
      playingStateValue: 1,
      pausedStateValue: 2,
    }),
    null,
  )
})

void test('shouldSendManagerPlaybackPositionUpdate catches iframe seeks without play state changes', () => {
  assert.equal(
    shouldSendManagerPlaybackPositionUpdate({
      authoritativeState: {
        ...BASE_STATE,
        videoId: 'abcdefghijk',
        positionSec: 10,
        isPlaying: false,
      },
      desiredPositionSec: 45,
    }),
    true,
  )

  assert.equal(
    shouldSendManagerPlaybackPositionUpdate({
      authoritativeState: {
        ...BASE_STATE,
        videoId: 'abcdefghijk',
        positionSec: 10,
        isPlaying: true,
        serverTimestampMs: Date.now(),
      },
      desiredPositionSec: 45,
    }),
    true,
  )
})

void test('shouldSendManagerPlaybackPositionUpdate ignores missing or in-tolerance positions', () => {
  assert.equal(
    shouldSendManagerPlaybackPositionUpdate({
      authoritativeState: {
        ...BASE_STATE,
        videoId: 'abcdefghijk',
        positionSec: 10,
        isPlaying: false,
      },
      desiredPositionSec: null,
    }),
    false,
  )

  assert.equal(
    shouldSendManagerPlaybackPositionUpdate({
      authoritativeState: {
        ...BASE_STATE,
        videoId: 'abcdefghijk',
        positionSec: 10,
        isPlaying: false,
      },
      desiredPositionSec: 10.1,
    }),
    false,
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
