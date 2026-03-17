import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SyncDeckStudent from './SyncDeckStudent.js'
import { toRevealCommandMessage } from './SyncDeckStudent.js'
import { toRevealBoundaryCommandMessage } from './SyncDeckStudent.js'
import { buildStudentRoleCommandMessage } from './SyncDeckStudent.js'
import { buildStudentWebSocketUrl } from './SyncDeckStudent.js'
import { resolveConfiguredPresentationOrigin } from './SyncDeckStudent.js'
import { resolveIframePostMessageTargetOrigin } from './SyncDeckStudent.js'
import { shouldSuppressForwardInstructorSync } from './SyncDeckStudent.js'
import { shouldResetBacktrackOptOutByMaxPosition } from './SyncDeckStudent.js'
import { extractIndicesFromRevealStateMessage } from './SyncDeckStudent.js'
import { resolveInboundPayloadType } from './SyncDeckStudent.js'
import { normalizeSyncDeckEmbeddedActivities } from './SyncDeckStudent.js'
import { applySyncDeckEmbeddedLifecyclePayload } from './SyncDeckStudent.js'
import { resolveStudentActiveEmbeddedInstanceKey } from './SyncDeckStudent.js'
import { extractNavigationCapabilitiesFromStateMessage } from './SyncDeckStudent.js'
import { computeStudentEmbeddedSyncState } from './SyncDeckStudent.js'
import { buildStudentEmbeddedSyncContextMessage } from './SyncDeckStudent.js'
import { MIXED_CONTENT_PRESENTATION_ERROR } from '../shared/presentationUrlCompatibility.js'

void test('SyncDeckStudent renders join guidance copy', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/session-123']}>
      <Routes>
        <Route path="/:sessionId" element={<SyncDeckStudent />} />
      </Routes>
    </MemoryRouter>,
  )

  assert.match(html, /Loading SyncDeck session|Waiting for instructor to configure the presentation/i)
})

void test('buildStudentWebSocketUrl includes student identity query params', () => {
  const url = buildStudentWebSocketUrl({
    sessionId: 'session-123',
    presentationUrl: 'https://slides.example/deck',
    studentId: 'student-abc',
    protocol: 'https:',
    host: 'activebits.example',
  })

  assert.equal(
    url,
    'wss://activebits.example/ws/syncdeck?sessionId=session-123&studentId=student-abc',
  )
})

void test('buildStudentWebSocketUrl returns null when student id is missing', () => {
  const url = buildStudentWebSocketUrl({
    sessionId: 'session-123',
    presentationUrl: 'https://slides.example/deck',
    studentId: '',
    protocol: 'https:',
    host: 'activebits.example',
  })

  assert.equal(url, null)
})

void test('resolveIframePostMessageTargetOrigin prefers iframe runtime origin and falls back to configured origin', () => {
  assert.equal(
    resolveIframePostMessageTargetOrigin({
      observedOrigin: 'https://iframe-observed.example',
      configuredOrigin: 'https://perryhighcs.github.io',
      iframeRuntimeOrigin: 'https://stunning-cod-77vqjr9x64q2wq5r-3000.app.github.dev',
    }),
    'https://iframe-observed.example',
  )

  assert.equal(
    resolveIframePostMessageTargetOrigin({
      configuredOrigin: 'https://perryhighcs.github.io',
      iframeRuntimeOrigin: 'https://stunning-cod-77vqjr9x64q2wq5r-3000.app.github.dev',
    }),
    'https://stunning-cod-77vqjr9x64q2wq5r-3000.app.github.dev',
  )

  assert.equal(
    resolveIframePostMessageTargetOrigin({
      configuredOrigin: 'https://perryhighcs.github.io',
      iframeRuntimeOrigin: 'null',
    }),
    'https://perryhighcs.github.io',
  )

  assert.equal(
    resolveIframePostMessageTargetOrigin({
      configuredOrigin: '',
      iframeRuntimeOrigin: null,
    }),
    null,
  )
})

void test('resolveConfiguredPresentationOrigin returns null when compatibility validation already failed', () => {
  assert.equal(
    resolveConfiguredPresentationOrigin({
      presentationUrl: 'http://slides.example/deck',
      presentationUrlError: MIXED_CONTENT_PRESENTATION_ERROR,
    }),
    null,
  )

  assert.equal(
    resolveConfiguredPresentationOrigin({
      presentationUrl: 'https://slides.example/deck',
      presentationUrlError: null,
    }),
    'https://slides.example',
  )
})

void test('mixed-content presentation warning explains blocked http student iframe on https hosts', () => {
  assert.match(MIXED_CONTENT_PRESENTATION_ERROR, /https/i)
  assert.match(MIXED_CONTENT_PRESENTATION_ERROR, /http:\/\//i)
  assert.match(MIXED_CONTENT_PRESENTATION_ERROR, /SyncDeck presentation iframes/i)
})

void test('toRevealCommandMessage ignores studentBoundaryChanged messages', () => {
  const result = toRevealCommandMessage({
    type: 'reveal-sync',
    version: '1.0.0',
    action: 'studentBoundaryChanged',
    payload: {
      reason: 'instructorSet',
      studentBoundary: { h: 3, v: 1, f: 0 },
    },
  })

  assert.equal(result, null)
})

void test('toRevealCommandMessage ignores invalid studentBoundaryChanged payload', () => {
  const result = toRevealCommandMessage({
    type: 'reveal-sync',
    action: 'studentBoundaryChanged',
    payload: {
      reason: 'instructorSet',
      studentBoundary: { h: '3', v: 1 },
    },
  })

  assert.equal(result, null)
})

void test('toRevealCommandMessage merges indices into revealState to preserve fragment index', () => {
  const result = toRevealCommandMessage({
    type: 'reveal-sync',
    version: '1.0.0',
    action: 'state',
    payload: {
      revealState: { indexh: 1, indexv: 0 },
      indices: { h: 1, v: 0, f: 2 },
    },
  })

  assert.equal((result?.payload as { name?: string })?.name, 'setState')
  assert.deepEqual((result?.payload as { payload?: { state?: unknown } })?.payload?.state, {
    indexh: 1,
    indexv: 0,
    indexf: 2,
  })
})

void test('toRevealCommandMessage preserves paused state from payload', () => {
  const result = toRevealCommandMessage({
    type: 'reveal-sync',
    version: '1.0.0',
    action: 'state',
    payload: {
      paused: true,
      revealState: { indexh: 1, indexv: 0 },
      indices: { h: 1, v: 0, f: 2 },
    },
  })

  assert.equal((result?.payload as { name?: string })?.name, 'setState')
  assert.deepEqual((result?.payload as { payload?: { state?: unknown } })?.payload?.state, {
    indexh: 1,
    indexv: 0,
    indexf: 2,
    paused: true,
  })
})

void test('toRevealCommandMessage accepts revealState indexh/indexv/indexf without payload.indices', () => {
  const result = toRevealCommandMessage({
    type: 'reveal-sync',
    version: '1.0.0',
    action: 'state',
    payload: {
      revealState: { indexh: 6, indexv: 2, indexf: 1 },
    },
  })

  assert.equal((result?.payload as { name?: string })?.name, 'setState')
  assert.deepEqual((result?.payload as { payload?: { state?: unknown } })?.payload?.state, {
    indexh: 6,
    indexv: 2,
    indexf: 1,
  })
})

void test('toRevealCommandMessage accepts top-level indexh/indexv/indexf without payload.indices', () => {
  const result = toRevealCommandMessage({
    type: 'reveal-sync',
    version: '1.0.0',
    action: 'state',
    payload: {
      indexh: 5,
      indexv: 1,
      indexf: 3,
    },
  })

  assert.equal((result?.payload as { name?: string })?.name, 'setState')
  assert.deepEqual((result?.payload as { payload?: { state?: unknown } })?.payload?.state, {
    indexh: 5,
    indexv: 1,
    indexf: 3,
  })
})

void test('toRevealCommandMessage accepts navigation.current indices without payload.indices', () => {
  const result = toRevealCommandMessage({
    type: 'reveal-sync',
    version: '1.0.0',
    action: 'state',
    payload: {
      navigation: {
        current: { h: 8, v: 2, f: 1 },
      },
    },
  })

  assert.equal((result?.payload as { name?: string })?.name, 'setState')
  assert.deepEqual((result?.payload as { payload?: { state?: unknown } })?.payload?.state, {
    indexh: 8,
    indexv: 2,
    indexf: 1,
  })
})

void test('toRevealCommandMessage maps paused action to setState paused command', () => {
  const result = toRevealCommandMessage({
    type: 'reveal-sync',
    version: '1.0.0',
    action: 'paused',
    deckId: 'deck-123',
    role: 'instructor',
    source: 'reveal-iframe-sync',
    payload: {},
  })

  assert.deepEqual(result, {
    type: 'reveal-sync',
    version: '1.0.0',
    action: 'command',
    deckId: 'deck-123',
    role: 'instructor',
    source: 'reveal-iframe-sync',
    ts: (result as { ts?: unknown })?.ts,
    payload: {
      name: 'setState',
      payload: {
        state: {
          paused: true,
        },
      },
    },
  })
  assert.equal(typeof (result as { ts?: unknown })?.ts, 'number')
})

void test('toRevealCommandMessage maps resumed action to setState unpaused command', () => {
  const result = toRevealCommandMessage({
    type: 'reveal-sync',
    version: '1.0.0',
    action: 'resumed',
    deckId: 'deck-123',
    role: 'instructor',
    source: 'reveal-iframe-sync',
    payload: {},
  })

  assert.deepEqual(result, {
    type: 'reveal-sync',
    version: '1.0.0',
    action: 'command',
    deckId: 'deck-123',
    role: 'instructor',
    source: 'reveal-iframe-sync',
    ts: (result as { ts?: unknown })?.ts,
    payload: {
      name: 'setState',
      payload: {
        state: {
          paused: false,
        },
      },
    },
  })
  assert.equal(typeof (result as { ts?: unknown })?.ts, 'number')
})

void test('resolveInboundPayloadType combines payload type and action when both exist', () => {
  assert.equal(
    resolveInboundPayloadType({
      type: 'reveal-sync',
      action: 'state',
      payload: {},
    }),
    'reveal-sync:state',
  )
})

void test('resolveInboundPayloadType falls back to action/type or runtime shape', () => {
  assert.equal(resolveInboundPayloadType({ action: 'state' }), 'state')
  assert.equal(resolveInboundPayloadType({ type: 'custom' }), 'custom')
  assert.equal(resolveInboundPayloadType({ payload: {} }), 'object')
  assert.equal(resolveInboundPayloadType(['state']), 'array')
  assert.equal(resolveInboundPayloadType(null), 'null')
  assert.equal(resolveInboundPayloadType('state'), 'string')
})

void test('toRevealCommandMessage maps chalkboardStroke action to command envelope', () => {
  const result = toRevealCommandMessage({
    type: 'reveal-sync',
    version: '1.1.0',
    action: 'chalkboardStroke',
    payload: {
      mode: 1,
      event: { type: 'draw', x1: 10, y1: 11, x2: 12, y2: 13, board: 0 },
    },
  }) as { action?: unknown; payload?: { name?: unknown; payload?: unknown }; ts?: unknown }

  assert.equal(result.action, 'command')
  assert.equal(result.payload?.name, 'chalkboardStroke')
  assert.deepEqual(result.payload?.payload, {
    mode: 1,
    event: { type: 'draw', x1: 10, y1: 11, x2: 12, y2: 13, board: 0 },
  })
  assert.equal(typeof result.ts, 'number')
})

void test('toRevealCommandMessage maps chalkboardState action to command envelope', () => {
  const result = toRevealCommandMessage({
    type: 'reveal-sync',
    version: '1.1.0',
    action: 'chalkboardState',
    payload: {
      storage: '[{"width":960,"height":700,"data":[]}]',
    },
  }) as { action?: unknown; payload?: { name?: unknown; payload?: unknown }; ts?: unknown }

  assert.equal(result.action, 'command')
  assert.equal(result.payload?.name, 'chalkboardState')
  assert.deepEqual(result.payload?.payload, {
    storage: '[{"width":960,"height":700,"data":[]}]',
  })
  assert.equal(typeof result.ts, 'number')
})

void test('toRevealCommandMessage maps top-level chalkboard action without reveal-sync type', () => {
  const result = toRevealCommandMessage({
    action: 'chalkboardStroke',
    payload: {
      mode: 1,
      event: { type: 'draw', x1: 1, y1: 2, x2: 3, y2: 4, board: 0 },
    },
  }) as { type?: unknown; action?: unknown; payload?: { name?: unknown; payload?: unknown } }

  assert.equal(result.type, 'reveal-sync')
  assert.equal(result.action, 'command')
  assert.equal(result.payload?.name, 'chalkboardStroke')
  assert.deepEqual(result.payload?.payload, {
    mode: 1,
    event: { type: 'draw', x1: 1, y1: 2, x2: 3, y2: 4, board: 0 },
  })
})

void test('toRevealBoundaryCommandMessage maps studentBoundaryChanged to setStudentBoundary command', () => {
  const result = toRevealBoundaryCommandMessage({
    type: 'reveal-sync',
    version: '1.0.0',
    action: 'studentBoundaryChanged',
    payload: {
      reason: 'instructorSet',
      studentBoundary: { h: 3, v: 1, f: 0 },
    },
  })

  assert.deepEqual(result, {
    type: 'reveal-sync',
    version: '1.0.0',
    action: 'command',
    deckId: null,
    role: 'instructor',
    source: 'reveal-iframe-sync',
    ts: result?.ts,
    payload: {
      name: 'setStudentBoundary',
      payload: {
        indices: { h: 3, v: 1, f: -1 },
      },
    },
  })
  assert.equal(typeof result?.ts, 'number')
})

void test('toRevealBoundaryCommandMessage maps state payload studentBoundary to setStudentBoundary command', () => {
  const result = toRevealBoundaryCommandMessage({
    type: 'reveal-sync',
    version: '1.0.0',
    action: 'state',
    role: 'instructor',
    payload: {
      studentBoundary: { h: 7, v: 0, f: 0 },
      indices: { h: 2, v: 0, f: 0 },
    },
  })

  assert.equal((result?.payload as { name?: string })?.name, 'setStudentBoundary')
  assert.deepEqual((result?.payload as { payload?: { indices?: unknown } })?.payload?.indices, {
    h: 7,
    v: 0,
    f: -1,
  })
})

void test('toRevealBoundaryCommandMessage keeps released stack boundary canonical during same-h vertical movement', () => {
  const result = toRevealBoundaryCommandMessage({
    type: 'reveal-sync',
    version: '1.0.0',
    action: 'state',
    role: 'instructor',
    payload: {
      studentBoundary: { h: 7, v: 0, f: 0 },
      indices: { h: 7, v: 1, f: 0 },
    },
  })

  assert.deepEqual((result?.payload as { payload?: { indices?: unknown } })?.payload?.indices, {
    h: 7,
    v: 0,
    f: -1,
  })
})

void test('toRevealBoundaryCommandMessage uses instructor indices when set boundary is behind', () => {
  const result = toRevealBoundaryCommandMessage({
    type: 'reveal-sync',
    version: '1.0.0',
    action: 'state',
    role: 'instructor',
    payload: {
      studentBoundary: { h: 2, v: 0, f: 0 },
      indices: { h: 3, v: 1, f: 2 },
    },
  })

  assert.deepEqual((result?.payload as { payload?: { indices?: unknown } })?.payload?.indices, {
    h: 3,
    v: 1,
    f: 2,
  })
})

void test('toRevealBoundaryCommandMessage ignores state payload with cleared boundary so setState can preserve same-stack student position', () => {
  const result = toRevealBoundaryCommandMessage(
    {
      type: 'reveal-sync',
      version: '1.0.0',
      action: 'state',
      role: 'instructor',
      payload: {
        studentBoundary: null,
        indices: { h: 2, v: 0, f: 0 },
      },
    },
  )

  assert.equal(result, null)
})

void test('toRevealBoundaryCommandMessage does not snap lower child slide back to top of released stack', () => {
  const result = toRevealBoundaryCommandMessage(
    {
      type: 'reveal-sync',
      version: '1.0.0',
      action: 'state',
      role: 'instructor',
      payload: {
        studentBoundary: { h: 4, v: 0, f: 0 },
        indices: { h: 4, v: 0, f: 0 },
      },
    },
    { h: 4, v: 1, f: 0 },
  )

  assert.deepEqual((result?.payload as { payload?: { indices?: unknown } })?.payload, {
    indices: { h: 4, v: 0, f: -1 },
  })
})

void test('toRevealBoundaryCommandMessage ignores non-instructor role payloads', () => {
  const result = toRevealBoundaryCommandMessage({
    type: 'reveal-sync',
    action: 'state',
    role: 'student',
    payload: {
      studentBoundary: { h: 2, v: 0, f: 0 },
    },
  })

  assert.equal(result, null)
})

void test('toRevealBoundaryCommandMessage ignores state payload with null boundary', () => {
  const result = toRevealBoundaryCommandMessage({
    type: 'reveal-sync',
    version: '1.0.0',
    action: 'state',
    role: 'instructor',
    payload: {
      studentBoundary: null,
      indices: { h: 2, v: 0, f: 0 },
    },
  })

  assert.equal(result, null)
})

void test('toRevealBoundaryCommandMessage maps studentBoundaryChanged null payload to clearBoundary', () => {
  const result = toRevealBoundaryCommandMessage(
    {
      type: 'reveal-sync',
      version: '1.0.0',
      action: 'studentBoundaryChanged',
      role: 'instructor',
      payload: {
        reason: 'instructorSet',
        studentBoundary: null,
      },
    },
    { h: 2, v: 0, f: 0 },
  )

  assert.equal((result?.payload as { name?: string })?.name, 'clearBoundary')
  assert.equal((result?.payload as { payload?: unknown })?.payload, undefined)
})

void test('toRevealBoundaryCommandMessage clears boundary without instructor indices when studentBoundaryChanged payload is null', () => {
  const result = toRevealBoundaryCommandMessage({
    type: 'reveal-sync',
    version: '1.0.0',
    action: 'studentBoundaryChanged',
    role: 'instructor',
    payload: {
      reason: 'instructorSet',
      studentBoundary: null,
    },
  })

  assert.equal((result?.payload as { name?: string })?.name, 'clearBoundary')
  assert.equal((result?.payload as { payload?: unknown })?.payload, undefined)
})

void test('extractIndicesFromRevealStateMessage reads indices from ready payload', () => {
  const indices = extractIndicesFromRevealStateMessage({
    type: 'reveal-sync',
    action: 'ready',
    payload: {
      indices: { h: 4, v: 2, f: 1 },
    },
  })

  assert.deepEqual(indices, { h: 4, v: 2, f: 1 })
})

void test('extractIndicesFromRevealStateMessage reads indices from ready navigation.current payload', () => {
  const indices = extractIndicesFromRevealStateMessage({
    type: 'reveal-sync',
    action: 'ready',
    payload: {
      navigation: {
        current: { h: 5, v: 3, f: 0 },
      },
    },
  })

  assert.deepEqual(indices, { h: 5, v: 3, f: 0 })
})

void test('buildStudentRoleCommandMessage emits setRole student command', () => {
  const message = buildStudentRoleCommandMessage()

  assert.equal(message.type, 'reveal-sync')
  assert.equal(message.action, 'command')
  assert.equal(message.role, 'student')
  assert.equal(message.source, 'activebits-syncdeck-host')
  assert.deepEqual(message.payload, {
    name: 'setRole',
    payload: {
      role: 'student',
    },
  })
})

void test('shouldSuppressForwardInstructorSync suppresses when opted-out student is behind instructor', () => {
  const result = shouldSuppressForwardInstructorSync(
    true,
    { h: 2, v: 0, f: 0 },
    { h: 3, v: 0, f: 0 },
  )

  assert.equal(result, true)
})

void test('shouldSuppressForwardInstructorSync allows sync when student has caught up', () => {
  const result = shouldSuppressForwardInstructorSync(
    true,
    { h: 3, v: 0, f: 0 },
    { h: 3, v: 0, f: 0 },
  )

  assert.equal(result, false)
})

void test('shouldResetBacktrackOptOutByMaxPosition resets when student reaches max position', () => {
  const result = shouldResetBacktrackOptOutByMaxPosition(
    true,
    { h: 3, v: 0, f: 0 },
    { h: 3, v: 0, f: 0 },
  )

  assert.equal(result, true)
})

void test('shouldResetBacktrackOptOutByMaxPosition does not reset when student remains behind max position', () => {
  const result = shouldResetBacktrackOptOutByMaxPosition(
    true,
    { h: 2, v: 0, f: 0 },
    { h: 3, v: 0, f: 0 },
  )

  assert.equal(result, false)
})

void test('normalizeSyncDeckEmbeddedActivities filters invalid records', () => {
  const normalized = normalizeSyncDeckEmbeddedActivities({
    'video-sync:3:0': {
      childSessionId: 'CHILD:parent:child1:video-sync',
      activityId: 'video-sync',
      startedAt: 42,
      owner: 'inst-a',
    },
    'invalid:1:0': {
      childSessionId: '',
      activityId: 'video-sync',
    },
  })

  assert.deepEqual(Object.keys(normalized), ['video-sync:3:0'])
})

void test('applySyncDeckEmbeddedLifecyclePayload applies start and end updates', () => {
  const started = applySyncDeckEmbeddedLifecyclePayload({}, {
    type: 'embedded-activity-start',
    instanceKey: 'video-sync:3:0',
    childSessionId: 'CHILD:parent:child1:video-sync',
    activityId: 'video-sync',
  })
  assert.equal(started['video-sync:3:0']?.childSessionId, 'CHILD:parent:child1:video-sync')

  const ended = applySyncDeckEmbeddedLifecyclePayload(started, {
    type: 'embedded-activity-end',
    instanceKey: 'video-sync:3:0',
    childSessionId: 'CHILD:parent:child1:video-sync',
  })

  assert.equal(ended['video-sync:3:0'], undefined)
})

void test('resolveStudentActiveEmbeddedInstanceKey selects activity for student h:v position', () => {
  const map = {
    'raffle:2:0': {
      childSessionId: 'CHILD:parent:a:raffle',
      activityId: 'raffle',
      startedAt: 10,
      owner: 'inst',
    },
    'video-sync:3:1': {
      childSessionId: 'CHILD:parent:b:video-sync',
      activityId: 'video-sync',
      startedAt: 20,
      owner: 'inst',
    },
  }

  assert.equal(
    resolveStudentActiveEmbeddedInstanceKey(map, { h: 3, v: 1, f: 0 }),
    'video-sync:3:1',
  )
  assert.equal(resolveStudentActiveEmbeddedInstanceKey(map, { h: 5, v: 0, f: 0 }), null)
})

void test('extractNavigationCapabilitiesFromStateMessage reads canGoBack/canGoForward from state payload', () => {
  const capabilities = extractNavigationCapabilitiesFromStateMessage({
    type: 'reveal-sync',
    action: 'state',
    payload: {
      navigation: {
        canGoBack: false,
        canGoForward: true,
      },
    },
  })

  assert.deepEqual(capabilities, {
    canGoBack: false,
    canGoForward: true,
  })
})

void test('computeStudentEmbeddedSyncState resolves synchronized, vertical, behind, ahead, and solo', () => {
  assert.equal(computeStudentEmbeddedSyncState({ h: 3, v: 0 }, { h: 3, v: 0 }), 'synchronized')
  assert.equal(computeStudentEmbeddedSyncState({ h: 3, v: 1 }, { h: 3, v: 0 }), 'vertical')
  assert.equal(computeStudentEmbeddedSyncState({ h: 2, v: 0 }, { h: 3, v: 0 }), 'behind')
  assert.equal(computeStudentEmbeddedSyncState({ h: 4, v: 0 }, { h: 3, v: 0 }), 'ahead')
  assert.equal(computeStudentEmbeddedSyncState({ h: 4, v: 0 }, null), 'solo')
})

void test('buildStudentEmbeddedSyncContextMessage emits expected activebits-embedded syncContext payload', () => {
  const message = buildStudentEmbeddedSyncContextMessage(
    'vertical',
    { h: 3, v: 1, f: 0 },
    { h: 3, v: 0, f: 0 },
  )

  assert.deepEqual(message, {
    type: 'activebits-embedded',
    action: 'syncContext',
    payload: {
      syncState: 'vertical',
      studentIndices: { h: 3, v: 1, f: 0 },
      instructorIndices: { h: 3, v: 0, f: 0 },
      role: 'student',
    },
  })
})
