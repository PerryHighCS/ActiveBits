import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SyncDeckManager from './SyncDeckManager.js'
import { buildInstructorRoleCommandMessage } from './SyncDeckManager.js'
import { buildForceSyncToInstructorCommandMessage } from './SyncDeckManager.js'
import { buildClearBoundaryCommandMessage } from './SyncDeckManager.js'
import { attachInstructorIndicesToBoundaryChangePayload } from './SyncDeckManager.js'
import { shouldSuppressInstructorStateBroadcast } from './SyncDeckManager.js'
import { shouldClearExplicitBoundary } from './SyncDeckManager.js'
import { buildBoundaryClearedPayload } from './SyncDeckManager.js'
import { extractSyncDeckStatePayload } from './SyncDeckManager.js'
import { includePausedInStateEnvelope } from './SyncDeckManager.js'
import { buildPausedSnapshotFromAction } from './SyncDeckManager.js'
import { toChalkboardRelayCommand } from './SyncDeckManager.js'
import { extractIndicesFromRevealPayload } from './SyncDeckManager.js'
import { buildRestoreCommandFromPayload } from './SyncDeckManager.js'
import { applyChalkboardSnapshotFallback } from './SyncDeckManager.js'
import { evaluateRestoreSuppressionForOutboundState } from './SyncDeckManager.js'
import { validatePresentationUrl } from './SyncDeckManager.js'
import { shouldReopenConfigurePanel } from './SyncDeckManager.js'
import { shouldAutoActivatePresentationUrl } from './SyncDeckManager.js'
import { resolveRecoveredPresentationUrl } from './SyncDeckManager.js'
import { normalizeStoredInstructorPasscode } from './SyncDeckManager.js'
import { resolvePersistentEntryPolicyForConfigure } from './SyncDeckManager.js'
import { resolvePersistentUrlHashForConfigure } from './SyncDeckManager.js'
import { normalizeSyncDeckEmbeddedActivities } from './SyncDeckManager.js'
import { applySyncDeckEmbeddedLifecyclePayload } from './SyncDeckManager.js'
import { resolveManagerActiveEmbeddedInstanceKey } from './SyncDeckManager.js'
import { resolveManagerEmbeddedInstanceStatus } from './SyncDeckManager.js'
import { buildManagerOverlayNavigationCommand } from './SyncDeckManager.js'
import { buildManagerOverlaySetStateCommand } from './SyncDeckManager.js'
import { buildManagerResyncCommandForInstanceKey } from './SyncDeckManager.js'
import { resolveManagerOverlayNavigationBaseIndices } from './SyncDeckManager.js'
import { resolveManagerCurrentSlideNavigationCapability } from './SyncDeckManager.js'
import { resolveNextPendingEmbeddedEndConfirmation } from './SyncDeckManager.js'
import { resolveManagerActivityRequestStartInput } from './SyncDeckManager.js'
import { resolveManagerActivityRequestBatchInputs } from './SyncDeckManager.js'
import { resolveManagerPreloadRequestBatchInputs } from './SyncDeckManager.js'
import { processManagerBundlePreloadRequests } from './SyncDeckManager.js'
import { processManagerPreloadRequests } from './SyncDeckManager.js'
import { runEmbeddedStartWithPendingRetry } from './SyncDeckManager.js'
import { extractRevealSyncActionWithoutParsing } from './SyncDeckManager.js'
import { resolveMountedEmbeddedManagerInstanceKeys } from './SyncDeckManager.js'
import { resolveEmbeddedManagerIframeAccessibilityProps } from './SyncDeckManager.js'
import { extractManagerNavigationCapabilitiesFromRevealMessage } from './SyncDeckManager.js'
import { resolveSyncDeckActivityPickerEntries } from './SyncDeckManager.js'
import { activitySupportsEmbeddedReport } from './SyncDeckManager.js'
import { parseDownloadFilenameFromContentDisposition } from './SyncDeckManager.js'

void test('SyncDeckManager renders setup copy without a session id', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/manage/syncdeck']}>
      <Routes>
        <Route path="/manage/syncdeck" element={<SyncDeckManager />} />
      </Routes>
    </MemoryRouter>,
  )

  assert.match(html, /Create a live session or a permanent link to begin/i)
})

void test('SyncDeckManager shows the active session id when provided', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/manage/syncdeck/session-123']}>
      <Routes>
        <Route path="/manage/syncdeck/:sessionId" element={<SyncDeckManager />} />
      </Routes>
    </MemoryRouter>,
  )

  assert.match(html, /Join Code:/i)
  assert.match(html, /Running activities:/i)
  assert.match(html, /session-123/i)
  assert.match(html, /Copy Join URL/i)
  assert.match(html, /Download Session Report/i)
  assert.match(html, /End Session/i)
  assert.match(html, /Force sync students to current position/i)
  assert.match(html, /Disable instructor sync/i)
  assert.match(html, /aria-pressed="true"/i)
  assert.match(html, /Pause presentation/i)
  assert.match(html, /Toggle chalkboard screen/i)
  assert.match(html, /Toggle pen overlay/i)
  assert.match(html, /Configure Presentation/i)
  assert.match(html, /Activities/i)
  assert.match(html, /aria-controls="syncdeck-activity-picker-panel"/i)
  assert.match(html, /Presentation URL/i)
  assert.match(html, /Presentation URL is required/i)
  assert.match(html, /aria-invalid="true"/i)
  assert.match(html, /aria-describedby="syncdeck-presentation-url-error"/i)
  assert.match(html, /id="syncdeck-presentation-url-error"/i)
  assert.match(html, /Start Session/i)
})

void test('SyncDeckManager pre-fills presentation URL from query params', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/manage/syncdeck/session-123?presentationUrl=https%3A%2F%2Fslides.example%2Fdeck']}>
      <Routes>
        <Route path="/manage/syncdeck/:sessionId" element={<SyncDeckManager />} />
      </Routes>
    </MemoryRouter>,
  )

  assert.match(html, /value="https:\/\/slides\.example\/deck"/i)
})

void test('activitySupportsEmbeddedReport reflects shared activity config metadata', () => {
  const entries = resolveSyncDeckActivityPickerEntries([
    { id: 'gallery-walk', name: 'Gallery Walk', description: 'Peer feedback', reportEndpoint: '/api/gallery-walk/:sessionId/report' },
    { id: 'video-sync', name: 'Video Sync', description: 'Shared video' },
  ])

  assert.equal(activitySupportsEmbeddedReport('gallery-walk', entries), true)
  assert.equal(activitySupportsEmbeddedReport('video-sync', entries), false)
  assert.equal(activitySupportsEmbeddedReport('missing-activity', entries), false)
})

void test('parseDownloadFilenameFromContentDisposition handles standard and utf-8 filenames', () => {
  assert.equal(
    parseDownloadFilenameFromContentDisposition('attachment; filename="critique-day.html"'),
    'critique-day.html',
  )
  assert.equal(
    parseDownloadFilenameFromContentDisposition("attachment; filename*=UTF-8''critique%20day.html"),
    'critique day.html',
  )
  assert.equal(parseDownloadFilenameFromContentDisposition(null), null)
})

void test('validatePresentationUrl rejects empty and whitespace-only values', () => {
  assert.equal(validatePresentationUrl(''), false)
  assert.equal(validatePresentationUrl('   '), false)
  assert.equal(validatePresentationUrl('https://slides.example/deck'), true)
  assert.equal(validatePresentationUrl('http://slides.example/deck', 'https:'), false)
  assert.equal(validatePresentationUrl('http://127.0.0.1:5500/deck', 'https:'), true)
  assert.equal(
    validatePresentationUrl(
      'http://127.0.0.1:5500/deck',
      'https:',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    ),
    false,
  )
})

void test('shouldReopenConfigurePanel only reopens from the closed invalid state', () => {
  assert.equal(shouldReopenConfigurePanel(false, 'Presentation URL must use https://'), true)
  assert.equal(shouldReopenConfigurePanel(true, 'Presentation URL must use https://'), false)
  assert.equal(shouldReopenConfigurePanel(false, null), false)
})

void test('shouldAutoActivatePresentationUrl rejects incompatible stored URLs without dropping them', () => {
  assert.equal(shouldAutoActivatePresentationUrl('https://slides.example/deck', 'https:'), true)
  assert.equal(shouldAutoActivatePresentationUrl('http://slides.example/deck', 'https:'), false)
})

void test('resolveRecoveredPresentationUrl preserves incompatible recovered URLs for editing', () => {
  assert.equal(
    resolveRecoveredPresentationUrl('', 'http://slides.example/deck', 'https:'),
    'http://slides.example/deck',
  )
  assert.equal(
    resolveRecoveredPresentationUrl('', '  http://slides.example/deck  ', 'https:'),
    'http://slides.example/deck',
  )
  assert.equal(
    resolveRecoveredPresentationUrl('', '   ', 'https:'),
    '',
  )
  assert.equal(
    resolveRecoveredPresentationUrl('https://slides.example/current', 'http://slides.example/deck', 'https:'),
    'https://slides.example/current',
  )
})

void test('normalizeStoredInstructorPasscode trims and rejects empty cached values', () => {
  assert.equal(normalizeStoredInstructorPasscode(' teacher-pass '), 'teacher-pass')
  assert.equal(normalizeStoredInstructorPasscode('   '), null)
  assert.equal(normalizeStoredInstructorPasscode(null), null)
})

void test('resolvePersistentEntryPolicyForConfigure prefers recovered policy when query is absent', () => {
  assert.equal(resolvePersistentEntryPolicyForConfigure(null, null, null, 'solo-allowed'), 'solo-allowed')
  assert.equal(resolvePersistentEntryPolicyForConfigure('', '', null, 'solo-only'), 'solo-only')
  assert.equal(
    resolvePersistentEntryPolicyForConfigure(null, 'instructor-required', null, 'solo-allowed'),
    'instructor-required',
  )
})

void test('resolvePersistentEntryPolicyForConfigure keeps policy aligned with the chosen hash source', () => {
  assert.equal(
    resolvePersistentEntryPolicyForConfigure('stale-query-hash', 'instructor-required', 'verified-cookie-hash', 'solo-allowed'),
    'solo-allowed',
  )
  assert.equal(
    resolvePersistentEntryPolicyForConfigure('query-hash', 'solo-only', null, 'instructor-required'),
    'solo-only',
  )
})

void test('resolvePersistentUrlHashForConfigure prefers verified fallback hash over query hash', () => {
  assert.equal(
    resolvePersistentUrlHashForConfigure('stale-query-hash', 'verified-cookie-hash'),
    'verified-cookie-hash',
  )
  assert.equal(
    resolvePersistentUrlHashForConfigure(' query-hash ', '  '),
    'query-hash',
  )
  assert.equal(
    resolvePersistentUrlHashForConfigure('   ', ' verified-cookie-hash '),
    'verified-cookie-hash',
  )
  assert.equal(resolvePersistentUrlHashForConfigure(null, null), null)
})

void test('buildInstructorRoleCommandMessage emits setRole instructor command', () => {
  const message = buildInstructorRoleCommandMessage()

  assert.equal(message.type, 'reveal-sync')
  assert.equal(message.action, 'command')
  assert.equal(message.role, 'instructor')
  assert.equal(message.source, 'activebits-syncdeck-host')
  assert.deepEqual(message.payload, {
    name: 'setRole',
    payload: {
      role: 'instructor',
    },
  })
})

void test('buildForceSyncToInstructorCommandMessage emits syncToInstructor command', () => {
  const message = buildForceSyncToInstructorCommandMessage({ h: 5, v: 1, f: 0 })

  assert.equal(message.type, 'reveal-sync')
  assert.equal(message.action, 'command')
  assert.equal(message.role, 'instructor')
  assert.deepEqual(message.payload, {
    name: 'syncToInstructor',
    payload: {
      state: {
        indexh: 5,
        indexv: 1,
        indexf: 0,
      },
    },
  })
})

void test('evaluateRestoreSuppressionForOutboundState keeps outbound state when suppression is inactive', () => {
  const result = evaluateRestoreSuppressionForOutboundState({
    suppressOutboundUntilRestore: false,
    restoreTargetIndices: { h: 3, v: 0, f: 0 },
    instructorIndices: { h: 3, v: 0, f: 0 },
  })

  assert.deepEqual(result, { shouldDrop: false, shouldRelease: false })
})

void test('evaluateRestoreSuppressionForOutboundState drops outbound state before reaching restore target', () => {
  const result = evaluateRestoreSuppressionForOutboundState({
    suppressOutboundUntilRestore: true,
    restoreTargetIndices: { h: 3, v: 0, f: 0 },
    instructorIndices: { h: 2, v: 0, f: 0 },
  })

  assert.deepEqual(result, { shouldDrop: true, shouldRelease: false })
})

void test('evaluateRestoreSuppressionForOutboundState drops and releases when reaching restore target', () => {
  const result = evaluateRestoreSuppressionForOutboundState({
    suppressOutboundUntilRestore: true,
    restoreTargetIndices: { h: 3, v: 0, f: 0 },
    instructorIndices: { h: 3, v: 0, f: 0 },
  })

  assert.deepEqual(result, { shouldDrop: true, shouldRelease: true })
})

void test('evaluateRestoreSuppressionForOutboundState keeps suppression armed when outbound state is ahead of target', () => {
  const result = evaluateRestoreSuppressionForOutboundState({
    suppressOutboundUntilRestore: true,
    restoreTargetIndices: { h: 2, v: 0, f: 0 },
    instructorIndices: { h: 3, v: 0, f: 0 },
  })

  assert.deepEqual(result, { shouldDrop: true, shouldRelease: false })
})

void test('buildClearBoundaryCommandMessage emits clearBoundary command', () => {
  const message = buildClearBoundaryCommandMessage()

  assert.equal(message.type, 'reveal-sync')
  assert.equal(message.action, 'command')
  assert.equal(message.role, 'instructor')
  assert.equal(message.source, 'activebits-syncdeck-host')
  assert.deepEqual(message.payload, {
    name: 'clearBoundary',
    payload: {},
  })
})

void test('attachInstructorIndicesToBoundaryChangePayload adds instructor indices to boundary change payload', () => {
  const augmented = attachInstructorIndicesToBoundaryChangePayload(
    {
      type: 'reveal-sync',
      version: '1.0.0',
      action: 'studentBoundaryChanged',
      payload: {
        reason: 'instructorSet',
        studentBoundary: null,
      },
    },
    { h: 4, v: 0, f: 0 },
  )

  assert.deepEqual(augmented, {
    type: 'reveal-sync',
    version: '1.0.0',
    action: 'studentBoundaryChanged',
    payload: {
      reason: 'instructorSet',
      studentBoundary: null,
      indices: { h: 4, v: 0, f: 0 },
    },
  })
})

void test('shouldSuppressInstructorStateBroadcast suppresses when instructor is behind explicit boundary', () => {
  const suppress = shouldSuppressInstructorStateBroadcast(
    { h: 2, v: 0, f: 0 },
    { h: 3, v: 0, f: -1 },
  )

  assert.equal(suppress, true)
})

void test('shouldSuppressInstructorStateBroadcast suppresses anywhere on canonical boundary slide', () => {
  const suppress = shouldSuppressInstructorStateBroadcast(
    { h: 3, v: 0, f: 2 },
    { h: 3, v: 0, f: -1 },
  )

  assert.equal(suppress, true)
})

void test('shouldSuppressInstructorStateBroadcast allows when instructor moves beyond explicit boundary', () => {
  const suppress = shouldSuppressInstructorStateBroadcast(
    { h: 4, v: 0, f: 0 },
    { h: 3, v: 0, f: -1 },
  )

  assert.equal(suppress, false)
})

void test('shouldSuppressInstructorStateBroadcast allows vertical movement within released stack', () => {
  const suppress = shouldSuppressInstructorStateBroadcast(
    { h: 3, v: 1, f: 0 },
    { h: 3, v: 0, f: -1 },
  )

  assert.equal(suppress, false)
})

void test('shouldClearExplicitBoundary ignores vertical movement within released stack', () => {
  const clearBoundary = shouldClearExplicitBoundary(
    { h: 3, v: 1, f: 0 },
    { h: 3, v: 0, f: -1 },
  )

  assert.equal(clearBoundary, false)
})

void test('shouldClearExplicitBoundary clears when instructor advances past released horizontal boundary', () => {
  const clearBoundary = shouldClearExplicitBoundary(
    { h: 4, v: 0, f: 0 },
    { h: 3, v: 0, f: -1 },
  )

  assert.equal(clearBoundary, true)
})

void test('buildBoundaryClearedPayload emits studentBoundaryChanged clear with instructor indices', () => {
  const payload = buildBoundaryClearedPayload({ h: 4, v: 0, f: 0 })

  assert.equal(payload.type, 'reveal-sync')
  assert.equal(payload.action, 'studentBoundaryChanged')
  assert.equal(payload.role, 'instructor')
  assert.deepEqual(payload.payload, {
    reason: 'instructorSet',
    studentBoundary: null,
    indices: { h: 4, v: 0, f: 0 },
  })
  assert.equal(typeof payload.ts, 'number')
})

void test('extractSyncDeckStatePayload returns payload for syncdeck-state message', () => {
  const payload = { type: 'reveal-sync', action: 'state', payload: { indices: { h: 2, v: 0, f: 0 } } }
  const extracted = extractSyncDeckStatePayload({
    type: 'syncdeck-state',
    payload,
  })

  assert.deepEqual(extracted, payload)
})

void test('extractSyncDeckStatePayload ignores non-syncdeck-state message', () => {
  const extracted = extractSyncDeckStatePayload({
    type: 'syncdeck-students',
    payload: { connectedCount: 1 },
  })

  assert.equal(extracted, null)
})

void test('normalizeSyncDeckEmbeddedActivities filters invalid records', () => {
  const normalized = normalizeSyncDeckEmbeddedActivities({
    'video-sync:3:0': {
      childSessionId: 'CHILD:s1:abc12:video-sync',
      activityId: 'video-sync',
      startedAt: 123,
      owner: 'syncdeck-instructor',
    },
    bad: {
      childSessionId: '',
      activityId: 'video-sync',
    },
  })

  assert.deepEqual(Object.keys(normalized), ['video-sync:3:0'])
  assert.equal(normalized['video-sync:3:0']?.activityId, 'video-sync')
})

void test('applySyncDeckEmbeddedLifecyclePayload applies start and end lifecycle updates', () => {
  const started = applySyncDeckEmbeddedLifecyclePayload(
    {},
    {
      type: 'embedded-activity-start',
      instanceKey: 'video-sync:3:0',
      activityId: 'video-sync',
      childSessionId: 'CHILD:s1:abc12:video-sync',
    },
  )

  assert.equal(started['video-sync:3:0']?.childSessionId, 'CHILD:s1:abc12:video-sync')

  const ended = applySyncDeckEmbeddedLifecyclePayload(
    started,
    {
      type: 'embedded-activity-end',
      instanceKey: 'video-sync:3:0',
      childSessionId: 'CHILD:s1:abc12:video-sync',
    },
  )

  assert.deepEqual(ended, {})
})

void test('resolveManagerActiveEmbeddedInstanceKey picks instance anchored to current slide position', () => {
  const selected = resolveManagerActiveEmbeddedInstanceKey(
    {
      'video-sync:2:0': {
        childSessionId: 'CHILD:s1:abc12:video-sync',
        activityId: 'video-sync',
        startedAt: 100,
        owner: 'syncdeck-instructor',
      },
      'embedded-test:3:1': {
        childSessionId: 'CHILD:s1:abc13:embedded-test',
        activityId: 'embedded-test',
        startedAt: 200,
        owner: 'syncdeck-instructor',
      },
    },
    { h: 3, v: 1, f: 0 },
  )

  assert.equal(selected, 'embedded-test:3:1')
})

void test('resolveManagerEmbeddedInstanceStatus marks only selected instance as active', () => {
  assert.equal(resolveManagerEmbeddedInstanceStatus('video-sync:3:0', 'video-sync:3:0'), 'active')
  assert.equal(resolveManagerEmbeddedInstanceStatus('video-sync:3:0', 'embedded-test:3:0'), 'idle')
  assert.equal(resolveManagerEmbeddedInstanceStatus('video-sync:3:0', null), 'idle')
})

void test('buildManagerOverlayNavigationCommand builds reveal command envelopes for four directions and slide', () => {
  const left = buildManagerOverlayNavigationCommand('left') as { payload?: { name?: unknown } }
  const right = buildManagerOverlayNavigationCommand('right') as { payload?: { name?: unknown } }
  const up = buildManagerOverlayNavigationCommand('up') as { payload?: { name?: unknown } }
  const down = buildManagerOverlayNavigationCommand('down') as { payload?: { name?: unknown } }
  const slide = buildManagerOverlayNavigationCommand('slide') as { payload?: { name?: unknown } }

  assert.equal(left.payload?.name, 'left')
  assert.equal(right.payload?.name, 'right')
  assert.equal(up.payload?.name, 'up')
  assert.equal(down.payload?.name, 'down')
  assert.equal(slide.payload?.name, 'slide')
})

void test('buildManagerOverlaySetStateCommand builds a setState envelope with explicit indices', () => {
  const command = buildManagerOverlaySetStateCommand({ h: 3, v: 1, f: 0 }) as {
    payload?: { name?: unknown; payload?: { state?: { indexh?: unknown; indexv?: unknown; indexf?: unknown } } }
  }

  assert.equal(command.payload?.name, 'setState')
  assert.deepEqual(command.payload?.payload?.state, {
    indexh: 3,
    indexv: 1,
    indexf: 0,
  })
})

void test('buildManagerResyncCommandForInstanceKey builds setState for anchored instance key', () => {
  const command = buildManagerResyncCommandForInstanceKey('embedded-test:2:0') as {
    payload?: { name?: unknown; payload?: { state?: { indexh?: unknown; indexv?: unknown; indexf?: unknown } } }
  }

  assert.equal(command.payload?.name, 'setState')
  assert.deepEqual(command.payload?.payload?.state, {
    indexh: 2,
    indexv: 0,
    indexf: 0,
  })
})

void test('buildManagerResyncCommandForInstanceKey ignores non-anchored instance key', () => {
  const command = buildManagerResyncCommandForInstanceKey('embedded-test:global')
  assert.equal(command, null)
})

void test('resolveManagerOverlayNavigationBaseIndices falls back to active embedded anchor when current indices are unavailable', () => {
  assert.deepEqual(
    resolveManagerOverlayNavigationBaseIndices({
      currentIndices: null,
      activeEmbeddedInstanceKey: 'embedded-test:2:1',
    }),
    { h: 2, v: 1, f: 0 },
  )
})

void test('resolveManagerActivityRequestBatchInputs keeps current slide primary and adds sibling stack requests', () => {
  assert.deepEqual(
    resolveManagerActivityRequestBatchInputs(
      {
        activityId: 'embedded-test',
        indices: { h: 2, v: 0, f: 0 },
        activityOptions: { prompt: 'hello' },
        stackRequests: [
          {
            activityId: 'raffle',
            indices: { h: 2, v: 1, f: -1 },
            activityOptions: { title: 'raffle title' },
          },
          {
            activityId: 'algorithm-demo',
            indices: { h: 2, v: 2, f: -1 },
          },
        ],
      },
      { h: 9, v: 0, f: 0 },
    ),
    [
      { activityId: 'embedded-test', instanceKey: 'embedded-test:2:0', activityOptions: { prompt: 'hello' } },
      { activityId: 'raffle', instanceKey: 'raffle:2:1', activityOptions: { title: 'raffle title' } },
      { activityId: 'algorithm-demo', instanceKey: 'algorithm-demo:2:2' },
    ],
  )
})

void test('resolveManagerPreloadRequestBatchInputs flattens grouped requests and deduplicates by instance key', () => {
  assert.deepEqual(
    resolveManagerPreloadRequestBatchInputs(
      {
        requests: [
          {
            activityId: 'video-sync',
            indices: { h: 1, v: 0, f: -1 },
            activityOptions: { mode: 'alpha' },
            stackRequests: [
              {
                activityId: 'raffle',
                indices: { h: 1, v: 1, f: -1 },
              },
            ],
          },
          {
            activityId: 'video-sync',
            indices: { h: 1, v: 0, f: 0 },
            activityOptions: { mode: 'beta' },
          },
          {
            activityId: 'algorithm-demo',
            indices: { h: 2, v: 0, f: -1 },
          },
        ],
      },
      { h: 9, v: 0, f: 0 },
    ),
    [
      { activityId: 'video-sync', instanceKey: 'video-sync:1:0', activityOptions: { mode: 'beta' } },
      { activityId: 'raffle', instanceKey: 'raffle:1:1' },
      { activityId: 'algorithm-demo', instanceKey: 'algorithm-demo:2:0' },
    ],
  )
})

void test('resolveManagerPreloadRequestBatchInputs ignores malformed grouped preload entries', () => {
  assert.deepEqual(
    resolveManagerPreloadRequestBatchInputs(
      {
        requests: [
          null,
          { activityId: '', indices: { h: 1, v: 0, f: 0 } },
          { activityId: 'video-sync', indices: { h: 1, v: 0, f: 0 } },
        ],
      },
      null,
    ),
    [
      { activityId: 'video-sync', instanceKey: 'video-sync:1:0' },
    ],
  )
})

void test('extractRevealSyncActionWithoutParsing avoids string parsing and only trusts object envelopes', () => {
  assert.equal(
    extractRevealSyncActionWithoutParsing({
      type: 'reveal-sync',
      action: 'activityPreloadRequest',
      payload: {},
    }),
    'activityPreloadRequest',
  )
  assert.equal(
    extractRevealSyncActionWithoutParsing('{"type":"reveal-sync","action":"activityPreloadRequest"}'),
    null,
  )
  assert.equal(
    extractRevealSyncActionWithoutParsing({
      type: 'not-reveal-sync',
      action: 'activityPreloadRequest',
    }),
    null,
  )
})

void test('processManagerPreloadRequests does not trigger duplicate starts for repeated preload messages', async () => {
  const pendingInstanceKeys = new Set<string>()
  const preloadCalls: string[][] = []
  const startedRequests: string[] = []

  let releaseFirstStart: () => void = () => {}
  const firstStartGate = new Promise<void>((resolve) => {
    releaseFirstStart = resolve
  })

  const firstRun = processManagerPreloadRequests({
    requests: [
      { activityId: 'resonance', instanceKey: 'resonance:1:0' },
    ],
    existingInstanceKeys: new Set(),
    pendingInstanceKeys,
    preloadBundles: async (requests) => {
      preloadCalls.push(requests.map((request) => request.instanceKey))
    },
    startRequest: async (request) => {
      startedRequests.push(request.instanceKey)
      await firstStartGate
    },
  })

  await Promise.resolve()

  const secondRun = processManagerPreloadRequests({
    requests: [
      { activityId: 'resonance', instanceKey: 'resonance:1:0' },
    ],
    existingInstanceKeys: new Set(),
    pendingInstanceKeys,
    preloadBundles: async (requests) => {
      preloadCalls.push(requests.map((request) => request.instanceKey))
    },
    startRequest: async (request) => {
      startedRequests.push(`duplicate:${request.instanceKey}`)
    },
  })

  releaseFirstStart()
  await Promise.all([firstRun, secondRun])

  assert.deepEqual(preloadCalls, [['resonance:1:0'], ['resonance:1:0']])
  assert.deepEqual(startedRequests, ['resonance:1:0'])
  assert.deepEqual([...pendingInstanceKeys], [])
})

void test('resolveMountedEmbeddedManagerInstanceKeys keeps the active iframe and caps warm cache size', () => {
  assert.deepEqual(
    resolveMountedEmbeddedManagerInstanceKeys({
      current: ['resonance:0:1', 'gallery-walk:0:0', 'video-sync:0:2'],
      existingInstanceKeys: ['resonance:0:1', 'gallery-walk:0:0', 'video-sync:0:2'],
      activeInstanceKey: 'video-sync:0:2',
      promotedInstanceKey: 'resonance:0:1',
      limit: 2,
    }),
    ['video-sync:0:2', 'resonance:0:1'],
  )
})

void test('resolveMountedEmbeddedManagerInstanceKeys drops stale warm entries', () => {
  assert.deepEqual(
    resolveMountedEmbeddedManagerInstanceKeys({
      current: ['resonance:0:1', 'gallery-walk:0:0'],
      existingInstanceKeys: ['gallery-walk:0:0'],
      activeInstanceKey: null,
      promotedInstanceKey: null,
      limit: 2,
    }),
    ['gallery-walk:0:0'],
  )
})

void test('resolveEmbeddedManagerIframeAccessibilityProps hides inactive embedded managers from focus and assistive tech', () => {
  assert.deepEqual(resolveEmbeddedManagerIframeAccessibilityProps(true), {})
  assert.deepEqual(resolveEmbeddedManagerIframeAccessibilityProps(false), {
    'aria-hidden': 'true',
    tabIndex: -1,
    inert: true,
  })
})

void test('bundle-only preload path does not trigger session creation side effects', async () => {
  const preloadCalls: string[][] = []

  const requests = resolveManagerPreloadRequestBatchInputs(
    {
      requests: [
        {
          activityId: 'resonance',
          indices: { h: 1, v: 0, f: -1 },
        },
      ],
    },
    null,
  )

  await processManagerBundlePreloadRequests({
    requests,
    preloadBundles: async (bundleRequests) => {
      preloadCalls.push(bundleRequests.map((request) => request.instanceKey))
    },
  })

  assert.deepEqual(preloadCalls, [['resonance:1:0']])
})

void test('bundle-only preload path swallows best-effort preload failures', async () => {
  const requests = resolveManagerPreloadRequestBatchInputs(
    {
      requests: [
        {
          activityId: 'resonance',
          indices: { h: 1, v: 0, f: -1 },
        },
      ],
    },
    null,
  )

  await assert.doesNotReject(async () => {
    await processManagerBundlePreloadRequests({
      requests,
      preloadBundles: async () => {
        throw new Error('preload failed')
      },
    })
  })
})

void test('processManagerPreloadRequests swallows preload bundle failures', async () => {
  const requests = resolveManagerPreloadRequestBatchInputs(
    {
      requests: [
        {
          activityId: 'resonance',
          indices: { h: 1, v: 0, f: -1 },
        },
      ],
    },
    null,
  )

  await assert.doesNotReject(async () => {
    await processManagerPreloadRequests({
      requests,
      existingInstanceKeys: new Set(),
      pendingInstanceKeys: new Set(),
      preloadBundles: async () => {
        throw new Error('preload failed')
      },
      startRequest: async () => {},
    })
  })
})

void test('processManagerPreloadRequests swallows start request failures and clears pending keys', async () => {
  const requests = resolveManagerPreloadRequestBatchInputs(
    {
      requests: [
        {
          activityId: 'resonance',
          indices: { h: 1, v: 0, f: -1 },
        },
      ],
    },
    null,
  )
  const pendingInstanceKeys = new Set<string>()

  await assert.doesNotReject(async () => {
    await processManagerPreloadRequests({
      requests,
      existingInstanceKeys: new Set(),
      pendingInstanceKeys,
      preloadBundles: async () => {},
      startRequest: async () => {
        throw new Error('start failed')
      },
    })
  })

  assert.deepEqual([...pendingInstanceKeys], [])
})

void test('processManagerPreloadRequests continues starting later requests after one start failure', async () => {
  const requests = resolveManagerPreloadRequestBatchInputs(
    {
      requests: [
        {
          activityId: 'resonance',
          indices: { h: 1, v: 0, f: -1 },
        },
        {
          activityId: 'gallery-walk',
          indices: { h: 2, v: 0, f: -1 },
        },
      ],
    },
    null,
  )
  const pendingInstanceKeys = new Set<string>()
  const attemptedStarts: string[] = []

  await assert.doesNotReject(async () => {
    await processManagerPreloadRequests({
      requests,
      existingInstanceKeys: new Set(),
      pendingInstanceKeys,
      preloadBundles: async () => {},
      startRequest: async (request) => {
        attemptedStarts.push(request.instanceKey)
        if (request.instanceKey === 'resonance:1:0') {
          throw new Error('start failed')
        }
      },
    })
  })

  assert.deepEqual(attemptedStarts, ['resonance:1:0', 'gallery-walk:2:0'])
  assert.deepEqual([...pendingInstanceKeys], [])
})

void test('runEmbeddedStartWithPendingRetry skips duplicate background starts while one is pending', async () => {
  const pendingStarts = new Map<string, Promise<boolean>>()
  let started = false
  const pending = new Promise<boolean>(() => {})
  pendingStarts.set('resonance:1:0', pending)

  const result = await runEmbeddedStartWithPendingRetry({
    instanceKey: 'resonance:1:0',
    background: true,
    pendingStarts,
    start: async () => {
      started = true
      return true
    },
  })

  assert.equal(result, false)
  assert.equal(started, false)
})

void test('runEmbeddedStartWithPendingRetry returns existing successful foreground start result without retrying', async () => {
  const pendingStarts = new Map<string, Promise<boolean>>()
  let started = false
  pendingStarts.set('resonance:1:0', Promise.resolve(true))

  const result = await runEmbeddedStartWithPendingRetry({
    instanceKey: 'resonance:1:0',
    background: false,
    pendingStarts,
    start: async () => {
      started = true
      return true
    },
  })

  assert.equal(result, true)
  assert.equal(started, false)
})

void test('runEmbeddedStartWithPendingRetry retries foreground starts after a pending attempt fails', async () => {
  const pendingStarts = new Map<string, Promise<boolean>>()
  let started = 0
  pendingStarts.set('resonance:1:0', Promise.resolve(false))

  const result = await runEmbeddedStartWithPendingRetry({
    instanceKey: 'resonance:1:0',
    background: false,
    pendingStarts,
    start: async () => {
      started += 1
      return true
    },
  })

  assert.equal(result, true)
  assert.equal(started, 1)
  assert.equal(pendingStarts.has('resonance:1:0'), false)
})

void test('resolveSyncDeckActivityPickerEntries excludes SyncDeck and sorts entries by label', () => {
  assert.deepEqual(
    resolveSyncDeckActivityPickerEntries([
      { id: 'video-sync', name: 'Video Sync', description: 'Watch together' },
      { id: 'syncdeck', name: 'SyncDeck', description: 'Host slides' },
      { id: 'algorithm-demo', name: 'Algorithm Demo', description: 'Visualize algorithms' },
    ]),
    [
      { activityId: 'algorithm-demo', name: 'Algorithm Demo', description: 'Visualize algorithms', supportsReport: false },
      { activityId: 'video-sync', name: 'Video Sync', description: 'Watch together', supportsReport: false },
    ],
  )
})

void test('extractManagerNavigationCapabilitiesFromRevealMessage reads four-direction navigation capabilities', () => {
  const capabilities = extractManagerNavigationCapabilitiesFromRevealMessage({
    type: 'reveal-sync',
    action: 'state',
    payload: {
      navigation: {
        canGoLeft: false,
        canGoRight: true,
        canGoUp: false,
        canGoDown: true,
      },
    },
  })

  assert.deepEqual(capabilities, {
    canGoBack: false,
    canGoForward: true,
    canGoUp: false,
    canGoDown: true,
  })
})

void test('resolveManagerCurrentSlideNavigationCapability only trusts iframe capability for the active slide', () => {
  assert.equal(
    resolveManagerCurrentSlideNavigationCapability({
      iframeCapability: false,
      capabilityIndices: { h: 2, v: 0, f: 0 },
      currentIndices: { h: 2, v: 0, f: 0 },
    }),
    false,
  )

  assert.equal(
    resolveManagerCurrentSlideNavigationCapability({
      iframeCapability: false,
      capabilityIndices: { h: 2, v: 0, f: 0 },
      currentIndices: { h: 2, v: 1, f: 0 },
    }),
    null,
  )

  assert.equal(
    resolveManagerCurrentSlideNavigationCapability({
      iframeCapability: true,
      capabilityIndices: { h: 2, v: 2, f: 0 },
      currentIndices: { h: 2, v: 2, f: 0 },
    }),
    true,
  )

  assert.equal(
    resolveManagerCurrentSlideNavigationCapability({
      iframeCapability: true,
      capabilityIndices: null,
      currentIndices: { h: 2, v: 2, f: 0 },
    }),
    null,
  )
})

void test('resolveNextPendingEmbeddedEndConfirmation requires two clicks before ending', () => {
  const first = resolveNextPendingEmbeddedEndConfirmation(null, 'video-sync:3:0')
  assert.deepEqual(first, { nextPending: 'video-sync:3:0', shouldEnd: false })

  const second = resolveNextPendingEmbeddedEndConfirmation(first.nextPending, 'video-sync:3:0')
  assert.deepEqual(second, { nextPending: null, shouldEnd: true })

  const switchTarget = resolveNextPendingEmbeddedEndConfirmation('video-sync:3:0', 'embedded-test:5:0')
  assert.deepEqual(switchTarget, { nextPending: 'embedded-test:5:0', shouldEnd: false })
})

void test('extractIndicesFromRevealPayload reads indices from state payload top-level index fields', () => {
  const indices = extractIndicesFromRevealPayload({
    type: 'reveal-sync',
    action: 'state',
    payload: {
      indexh: 7,
      indexv: 2,
      indexf: 1,
    },
  })

  assert.deepEqual(indices, { h: 7, v: 2, f: 1 })
})

void test('extractIndicesFromRevealPayload reads indices from setState command payload', () => {
  const indices = extractIndicesFromRevealPayload({
    type: 'reveal-sync',
    action: 'command',
    payload: {
      name: 'setState',
      payload: {
        state: {
          indexh: 5,
          indexv: 0,
          indexf: 0,
        },
      },
    },
  })

  assert.deepEqual(indices, { h: 5, v: 0, f: 0 })
})

void test('extractIndicesFromRevealPayload reads indices from ready payload', () => {
  const indices = extractIndicesFromRevealPayload({
    type: 'reveal-sync',
    action: 'ready',
    payload: {
      indices: { h: 2, v: 1, f: 0 },
    },
  })

  assert.deepEqual(indices, { h: 2, v: 1, f: 0 })
})

void test('extractIndicesFromRevealPayload reads indices from ready navigation.current payload', () => {
  const indices = extractIndicesFromRevealPayload({
    type: 'reveal-sync',
    action: 'ready',
    payload: {
      navigation: {
        current: { h: 6, v: 2, f: 0 },
      },
    },
  })

  assert.deepEqual(indices, { h: 6, v: 2, f: 0 })
})

void test('buildRestoreCommandFromPayload converts legacy slidechanged payload into setState command', () => {
  const restored = buildRestoreCommandFromPayload({
    type: 'slidechanged',
    payload: {
      h: 3,
      v: 1,
      f: 0,
    },
  }) as { action?: unknown; payload?: { name?: unknown; payload?: { state?: unknown } } }

  assert.equal(restored.action, 'command')
  assert.equal(restored.payload?.name, 'setState')
  assert.deepEqual(restored.payload?.payload?.state, {
    indexh: 3,
    indexv: 1,
    indexf: 0,
  })
})

void test('buildRestoreCommandFromPayload preserves state indices from top-level state payload fields', () => {
  const restored = buildRestoreCommandFromPayload({
    type: 'reveal-sync',
    action: 'state',
    payload: {
      indexh: 4,
      indexv: 2,
      indexf: 0,
      paused: true,
    },
  }) as { payload?: { name?: unknown; payload?: { state?: unknown } } }

  assert.equal(restored.payload?.name, 'setState')
  assert.deepEqual(restored.payload?.payload?.state, {
    indexh: 4,
    indexv: 2,
    indexf: 0,
    paused: true,
  })
})

void test('buildRestoreCommandFromPayload converts ready navigation.current payload into setState command', () => {
  const restored = buildRestoreCommandFromPayload({
    type: 'reveal-sync',
    version: '1.1.0',
    action: 'ready',
    payload: {
      navigation: {
        current: { h: 6, v: 2, f: 0 },
      },
    },
  }) as {
    version?: unknown
    action?: unknown
    payload?: { name?: unknown; payload?: { state?: unknown } }
  }

  assert.equal(restored.version, '1.1.0')
  assert.equal(restored.action, 'command')
  assert.equal(restored.payload?.name, 'setState')
  assert.deepEqual(restored.payload?.payload?.state, {
    indexh: 6,
    indexv: 2,
    indexf: 0,
  })
})

void test('includePausedInStateEnvelope prefers explicit fallback over stale payload paused value', () => {
  const updated = includePausedInStateEnvelope(
    {
      type: 'reveal-sync',
      action: 'state',
      payload: {
        paused: false,
        revealState: { paused: false, indexh: 2, indexv: 0, indexf: 0 },
        indices: { h: 2, v: 0, f: 0 },
      },
    },
    true,
  ) as { payload?: { paused?: unknown; revealState?: { paused?: unknown } } }

  assert.equal(updated.payload?.paused, true)
  assert.equal(updated.payload?.revealState?.paused, true)
})

void test('buildPausedSnapshotFromAction synthesizes paused state snapshot from paused action', () => {
  const snapshot = buildPausedSnapshotFromAction(
    {
      type: 'reveal-sync',
      action: 'paused',
    },
    {
      type: 'reveal-sync',
      action: 'state',
      payload: {
        paused: false,
        revealState: { paused: false, indexh: 3, indexv: 1, indexf: 0 },
        indices: { h: 3, v: 1, f: 0 },
      },
    },
  ) as { payload?: { paused?: unknown; revealState?: { paused?: unknown } } }

  assert.equal(snapshot.payload?.paused, true)
  assert.equal(snapshot.payload?.revealState?.paused, true)
})

void test('buildPausedSnapshotFromAction synthesizes resumed state snapshot from resumed action', () => {
  const snapshot = buildPausedSnapshotFromAction(
    {
      type: 'reveal-sync',
      action: 'resumed',
    },
    {
      type: 'reveal-sync',
      action: 'state',
      payload: {
        paused: true,
        revealState: { paused: true, indexh: 3, indexv: 1, indexf: 0 },
        indices: { h: 3, v: 1, f: 0 },
      },
    },
  ) as { payload?: { paused?: unknown; revealState?: { paused?: unknown } } }

  assert.equal(snapshot.payload?.paused, false)
  assert.equal(snapshot.payload?.revealState?.paused, false)
})

void test('toChalkboardRelayCommand maps chalkboardStroke action to command envelope', () => {
  const relayCommand = toChalkboardRelayCommand({
    type: 'reveal-sync',
    version: '1.1.0',
    action: 'chalkboardStroke',
    payload: {
      mode: 1,
      event: { type: 'draw', x1: 1, y1: 2, x2: 3, y2: 4, board: 0 },
    },
  })

  assert.equal(relayCommand?.type, 'reveal-sync')
  assert.equal(relayCommand?.action, 'command')
  assert.equal((relayCommand?.payload as { name?: unknown })?.name, 'chalkboardStroke')
  assert.deepEqual((relayCommand?.payload as { payload?: unknown })?.payload, {
    mode: 1,
    event: { type: 'draw', x1: 1, y1: 2, x2: 3, y2: 4, board: 0 },
  })
})

void test('toChalkboardRelayCommand maps chalkboardState action to command envelope', () => {
  const relayCommand = toChalkboardRelayCommand({
    type: 'reveal-sync',
    action: 'chalkboardState',
    payload: {
      storage: '[{"width":960,"height":700,"data":[]}]',
    },
  })

  assert.equal(relayCommand?.type, 'reveal-sync')
  assert.equal(relayCommand?.action, 'command')
  assert.equal((relayCommand?.payload as { name?: unknown })?.name, 'chalkboardState')
  assert.deepEqual((relayCommand?.payload as { payload?: unknown })?.payload, {
    storage: '[{"width":960,"height":700,"data":[]}]',
  })
})

void test('toChalkboardRelayCommand maps chalkboard command envelope payload name', () => {
  const relayCommand = toChalkboardRelayCommand({
    type: 'reveal-sync',
    action: 'command',
    payload: {
      name: 'chalkboardStroke',
      payload: {
        mode: 1,
        event: { type: 'erase', x: 12, y: 18, board: 0 },
      },
    },
  })

  assert.equal(relayCommand?.action, 'command')
  assert.equal((relayCommand?.payload as { name?: unknown })?.name, 'chalkboardStroke')
  assert.deepEqual((relayCommand?.payload as { payload?: unknown })?.payload, {
    mode: 1,
    event: { type: 'erase', x: 12, y: 18, board: 0 },
  })
})

void test('applyChalkboardSnapshotFallback replaces empty chalkboardState storage with cached snapshot', () => {
  const result = applyChalkboardSnapshotFallback(
    {
      type: 'reveal-sync',
      action: 'command',
      payload: {
        name: 'chalkboardState',
        payload: {
          storage: '',
        },
      },
    },
    '[{"width":960,"height":700,"data":[{"x":1,"y":2}]}]',
  ) as {
    relayPayload: { payload?: { payload?: { storage?: unknown } } }
    restoredSnapshotStorage: string | null
  }

  assert.equal(result.restoredSnapshotStorage, '[{"width":960,"height":700,"data":[{"x":1,"y":2}]}]')
  assert.equal(result.relayPayload.payload?.payload?.storage, '[{"width":960,"height":700,"data":[{"x":1,"y":2}]}]')
})

void test('applyChalkboardSnapshotFallback does not replace non-empty chalkboardState storage', () => {
  const result = applyChalkboardSnapshotFallback(
    {
      type: 'reveal-sync',
      action: 'command',
      payload: {
        name: 'chalkboardState',
        payload: {
          storage: '[{"width":960,"height":700,"data":[]}]',
        },
      },
    },
    '[{"width":960,"height":700,"data":[{"x":1,"y":2}]}]',
  ) as {
    relayPayload: { payload?: { payload?: { storage?: unknown } } }
    restoredSnapshotStorage: string | null
  }

  assert.equal(result.restoredSnapshotStorage, null)
  assert.equal(result.relayPayload.payload?.payload?.storage, '[{"width":960,"height":700,"data":[]}]')
})

void test('resolveManagerActivityRequestStartInput resolves anchored and global instance keys', () => {
  assert.deepEqual(
    resolveManagerActivityRequestStartInput(
      {
        activityId: 'embedded-test',
        indices: { h: 2, v: 1, f: 0 },
      },
      null,
    ),
    {
      activityId: 'embedded-test',
      instanceKey: 'embedded-test:2:1',
    },
  )

  assert.deepEqual(
    resolveManagerActivityRequestStartInput(
      {
        activityId: 'raffle',
      },
      null,
    ),
    {
      activityId: 'raffle',
      instanceKey: 'raffle:global',
    },
  )
})

void test('resolveManagerActivityRequestStartInput prefers explicit instanceKey and falls back to instructor indices', () => {
  assert.deepEqual(
    resolveManagerActivityRequestStartInput(
      {
        activityId: 'video-sync',
        instanceKey: 'video-sync:global',
      },
      { h: 6, v: 2, f: 0 },
    ),
    {
      activityId: 'video-sync',
      instanceKey: 'video-sync:global',
    },
  )

  assert.deepEqual(
    resolveManagerActivityRequestStartInput(
      {
        activityId: 'algorithm-demo',
      },
      { h: 6, v: 2, f: 0 },
    ),
    {
      activityId: 'algorithm-demo',
      instanceKey: 'algorithm-demo:6:2',
    },
  )

  assert.equal(resolveManagerActivityRequestStartInput({ activityId: '' }, { h: 1, v: 0, f: 0 }), null)
})

void test('resolveManagerActivityRequestStartInput preserves activity options when present', () => {
  assert.deepEqual(
    resolveManagerActivityRequestStartInput(
      {
        activityId: 'video-sync',
        indices: { h: 3, v: 0, f: 0 },
        activityOptions: { sourceUrl: 'https://www.youtube.com/watch?v=mCq8-xTH7jA' },
      },
      null,
    ),
    {
      activityId: 'video-sync',
      instanceKey: 'video-sync:3:0',
      activityOptions: { sourceUrl: 'https://www.youtube.com/watch?v=mCq8-xTH7jA' },
    },
  )
})
