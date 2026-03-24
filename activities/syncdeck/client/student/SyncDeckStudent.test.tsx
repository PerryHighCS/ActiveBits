import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SyncDeckStudent from './SyncDeckStudent.js'
import { toRevealCommandMessage } from './SyncDeckStudent.js'
import { toRevealBoundaryCommandMessage } from './SyncDeckStudent.js'
import { buildStudentRoleCommandMessage } from './SyncDeckStudent.js'
import { buildStandaloneBootstrapCommandMessages } from './SyncDeckStudent.js'
import { applyResolvedStandaloneEntryToSoloRequest } from './SyncDeckStudent.js'
import { buildStudentOverlayNavigationKeys } from './SyncDeckStudent.js'
import { buildStudentWebSocketUrl } from './SyncDeckStudent.js'
import { getStudentOverlayBackdropClass } from './SyncDeckStudent.js'
import { resolveCurrentSlideNavigationCapability } from './SyncDeckStudent.js'
import { resolveConfiguredPresentationOrigin } from './SyncDeckStudent.js'
import { resolveIframePostMessageTargetOrigin } from './SyncDeckStudent.js'
import { shouldRenderStudentOverlayNavigation } from './SyncDeckStudent.js'
import { shouldSuppressForwardInstructorSync } from './SyncDeckStudent.js'
import { shouldResetBacktrackOptOutByMaxPosition } from './SyncDeckStudent.js'
import { shouldEnableBacktrackOptOutOnLocalMove } from './SyncDeckStudent.js'
import { isExpectedInstructorDrivenLocalMove } from './SyncDeckStudent.js'
import { shouldForceFollowInstructorSetState } from './SyncDeckStudent.js'
import { shouldSuppressInstructorVerticalSetStateSync } from './SyncDeckStudent.js'
import { shouldSuppressInstructorRevealCommandForwarding } from './SyncDeckStudent.js'
import { extractIndicesFromRevealStateMessage } from './SyncDeckStudent.js'
import { resolveInboundPayloadType } from './SyncDeckStudent.js'
import { resolveSemanticInstructorCommandName } from './SyncDeckStudent.js'
import { shouldQueuePayloadUntilIframeReady } from './SyncDeckStudent.js'
import { enqueuePendingIframePayload } from './SyncDeckStudent.js'
import { normalizeSyncDeckEmbeddedActivities } from './SyncDeckStudent.js'
import { applySyncDeckEmbeddedLifecyclePayload } from './SyncDeckStudent.js'
import { resolveStudentActiveEmbeddedInstanceKey } from './SyncDeckStudent.js'
import { resolveStudentActiveEmbeddedInstanceKeyWithFallback } from './SyncDeckStudent.js'
import { resolveStudentOverlayEmbeddedInstanceKey } from './SyncDeckStudent.js'
import { resolveStudentOverlayNavigationBaseIndices } from './SyncDeckStudent.js'
import { shouldRecoverEmbeddedEntryParticipantToken } from './SyncDeckStudent.js'
import { persistRecoveredEmbeddedEntryParticipantToken } from './SyncDeckStudent.js'
import { shouldPersistRecoveredEmbeddedEntryResponse } from './SyncDeckStudent.js'
import { extractNavigationCapabilitiesFromStateMessage } from './SyncDeckStudent.js'
import { computeStudentEmbeddedSyncState } from './SyncDeckStudent.js'
import { buildStudentLocalNavigationPayloads } from './SyncDeckStudent.js'
import { shouldPreferInstructorOverlaySelection } from './SyncDeckStudent.js'
import { buildStudentEmbeddedSyncContextMessage } from './SyncDeckStudent.js'
import { shouldShowInstructorPendingActivityNotice } from './SyncDeckStudent.js'
import { buildSyncDeckSlideKey } from './SyncDeckStudent.js'
import { hasPendingSynchronizedActivityRequestForCurrentSlide } from './SyncDeckStudent.js'
import { resolveStudentSoloActivityRequestInputs } from './SyncDeckStudent.js'
import { resolveStudentSoloActivityRequest } from './SyncDeckStudent.js'
import { applyStudentSoloActivityRequest } from './SyncDeckStudent.js'
import { MIXED_CONTENT_PRESENTATION_ERROR } from '../shared/presentationUrlCompatibility.js'
import { deriveEmbeddedOverlayVerticalNavigationCapabilities } from '../shared/embeddedOverlayNavigation.js'

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

void test('toRevealCommandMessage converts legacy slidechanged snapshots into setState commands', () => {
  const result = toRevealCommandMessage({
    type: 'slidechanged',
    payload: { h: 6, v: 0, f: 0 },
  })

  assert.equal((result as { role?: string } | null)?.role, 'instructor')
  assert.equal((result as { source?: string } | null)?.source, 'activebits-syncdeck-host')
  assert.equal((result?.payload as { name?: string })?.name, 'setState')
  assert.deepEqual((result?.payload as { payload?: { state?: unknown } })?.payload?.state, {
    indexh: 6,
    indexv: 0,
    indexf: 0,
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

void test('resolveSemanticInstructorCommandName treats legacy slidechanged snapshots as authoritative setState', () => {
  assert.equal(
    resolveSemanticInstructorCommandName({
      type: 'slidechanged',
      payload: { h: 4, v: 0, f: 0 },
    }),
    'setState',
  )
})

void test('shouldQueuePayloadUntilIframeReady queues reveal commands but not the bootstrap role command', () => {
  assert.equal(
    shouldQueuePayloadUntilIframeReady(buildStudentRoleCommandMessage()),
    false,
  )

  assert.equal(
    shouldQueuePayloadUntilIframeReady(toRevealCommandMessage({
      type: 'slidechanged',
      payload: { h: 4, v: 0, f: 0 },
    })),
    true,
  )
})

void test('enqueuePendingIframePayload coalesces repeated setState updates and caps queue length', () => {
  const firstSetState = toRevealCommandMessage({
    type: 'slidechanged',
    payload: { h: 1, v: 0, f: 0 },
  })
  const secondSetState = toRevealCommandMessage({
    type: 'slidechanged',
    payload: { h: 2, v: 0, f: 0 },
  })
  const boundaryPayload = toRevealBoundaryCommandMessage({
    type: 'reveal-sync',
    action: 'studentBoundaryChanged',
    payload: {
      studentBoundary: { h: 2, v: 0, f: 0 },
      indices: { h: 2, v: 0, f: 0 },
    },
  })

  const afterFirst = enqueuePendingIframePayload([], firstSetState, 2)
  assert.equal(afterFirst.coalesced, false)
  assert.equal(afterFirst.droppedCount, 0)
  assert.equal(afterFirst.queue.length, 1)

  const afterSecond = enqueuePendingIframePayload(afterFirst.queue, secondSetState, 2)
  assert.equal(afterSecond.coalesced, true)
  assert.equal(afterSecond.droppedCount, 0)
  assert.equal(afterSecond.queue.length, 1)
  assert.deepEqual(
    (afterSecond.queue[0] as { payload?: { payload?: { state?: unknown } } }).payload?.payload?.state,
    { indexh: 2, indexv: 0, indexf: 0 },
  )

  const afterBoundary = enqueuePendingIframePayload(afterSecond.queue, boundaryPayload, 2)
  assert.equal(afterBoundary.queue.length, 2)

  const capped = enqueuePendingIframePayload(afterBoundary.queue, { type: 'custom-non-coalesced' }, 2)
  assert.equal(capped.coalesced, false)
  assert.equal(capped.droppedCount, 1)
  assert.equal(capped.queue.length, 2)
})

void test('buildStudentRoleCommandMessage emits setRole student command by default', () => {
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

void test('buildStudentRoleCommandMessage can emit standalone role command', () => {
  const message = buildStudentRoleCommandMessage('standalone')

  assert.deepEqual(message.payload, {
    name: 'setRole',
    payload: {
      role: 'standalone',
    },
  })
})

void test('buildStandaloneBootstrapCommandMessages sets standalone role and clears boundary', () => {
  const messages = buildStandaloneBootstrapCommandMessages() as Array<{
    payload?: {
      name?: unknown
      payload?: {
        role?: unknown
      }
    }
  }>

  assert.equal(messages.length, 2)
  assert.deepEqual(messages[0]?.payload, {
    name: 'setRole',
    payload: {
      role: 'standalone',
    },
  })
  assert.deepEqual(messages[1]?.payload, {
    name: 'clearBoundary',
    payload: {},
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

void test('shouldEnableBacktrackOptOutOnLocalMove enables opt-out for local backtrack behind instructor max position', () => {
  const result = shouldEnableBacktrackOptOutOnLocalMove({
    studentHasBacktrackOptOut: false,
    previousLocalPosition: { h: 2, v: 0, f: 0 },
    nextLocalPosition: { h: 1, v: 0, f: 0 },
    maxPosition: { h: 2, v: 0, f: 0 },
    instructorPosition: { h: 2, v: 0, f: 0 },
  })

  assert.equal(result, true)
})

void test('shouldEnableBacktrackOptOutOnLocalMove does not enable opt-out when backward movement matches instructor-driven sync', () => {
  const result = shouldEnableBacktrackOptOutOnLocalMove({
    studentHasBacktrackOptOut: false,
    previousLocalPosition: { h: 2, v: 0, f: 0 },
    nextLocalPosition: { h: 1, v: 0, f: 0 },
    maxPosition: { h: 2, v: 0, f: 0 },
    instructorPosition: { h: 1, v: 0, f: 0 },
  })

  assert.equal(result, false)
})

void test('isExpectedInstructorDrivenLocalMove matches exact instructor-targeted iframe echoes only', () => {
  assert.equal(
    isExpectedInstructorDrivenLocalMove(
      { h: 1, v: 0, f: 0 },
      { h: 1, v: 0, f: 0 },
    ),
    true,
  )

  assert.equal(
    isExpectedInstructorDrivenLocalMove(
      { h: 1, v: 0, f: 0 },
      { h: 2, v: 0, f: 0 },
    ),
    false,
  )
})

void test('shouldSuppressInstructorVerticalSetStateSync suppresses setState vertical movement in same horizontal stack', () => {
  const result = shouldSuppressInstructorVerticalSetStateSync(
    'setState',
    { h: 2, v: 0, f: 0 },
    { h: 2, v: 1, f: 0 },
  )

  assert.equal(result, true)
})

void test('shouldSuppressInstructorVerticalSetStateSync suppresses semantic setState from state envelopes in same stack', () => {
  const result = shouldSuppressInstructorVerticalSetStateSync(
    'setState',
    { h: 2, v: 1, f: 0 },
    { h: 2, v: 2, f: 0 },
  )

  assert.equal(result, true)
})

void test('shouldSuppressInstructorVerticalSetStateSync does not suppress horizontal or explicit sync commands', () => {
  assert.equal(
    shouldSuppressInstructorVerticalSetStateSync(
      'setState',
      { h: 2, v: 0, f: 0 },
      { h: 3, v: 0, f: 0 },
    ),
    false,
  )

  assert.equal(
    shouldSuppressInstructorVerticalSetStateSync(
      'syncToInstructor',
      { h: 2, v: 0, f: 0 },
      { h: 2, v: 1, f: 0 },
    ),
    false,
  )

  assert.equal(
    shouldSuppressInstructorVerticalSetStateSync(
      'left',
      { h: 2, v: 0, f: 0 },
      { h: 2, v: 1, f: 0 },
    ),
    false,
  )
})

void test('shouldSuppressInstructorVerticalSetStateSync suppresses raw up/down instructor commands', () => {
  assert.equal(
    shouldSuppressInstructorVerticalSetStateSync(
      'up',
      null,
      null,
    ),
    true,
  )

  assert.equal(
    shouldSuppressInstructorVerticalSetStateSync(
      'down',
      null,
      null,
    ),
    true,
  )
})

void test('shouldSuppressInstructorRevealCommandForwarding suppresses vertical down command forwarding', () => {
  const result = shouldSuppressInstructorRevealCommandForwarding({
    semanticInstructorCommandName: 'down',
    studentHasBacktrackOptOut: false,
    localStudentPosition: { h: 2, v: 0, f: 0 },
    incomingInstructorIndices: { h: 2, v: 1, f: 0 },
  })

  assert.equal(result.suppressForwardSync, true)
  assert.equal(result.suppressForwardSyncByBacktrack, false)
  assert.equal(result.suppressForwardSyncByVerticalIndependence, true)
})

void test('shouldSuppressInstructorRevealCommandForwarding suppresses forward setState while opted-out', () => {
  const result = shouldSuppressInstructorRevealCommandForwarding({
    semanticInstructorCommandName: 'setState',
    studentHasBacktrackOptOut: true,
    localStudentPosition: { h: 2, v: 0, f: 0 },
    incomingInstructorIndices: { h: 3, v: 0, f: 0 },
  })

  assert.equal(result.suppressForwardSync, true)
  assert.equal(result.suppressForwardSyncByBacktrack, true)
  assert.equal(result.suppressForwardSyncByVerticalIndependence, false)
})

void test('shouldForceFollowInstructorSetState follows setState to anchored embedded slide even when opted out', () => {
  const result = shouldForceFollowInstructorSetState({
    semanticInstructorCommandName: 'setState',
    studentHasBacktrackOptOut: true,
    localStudentPosition: { h: 3, v: 0, f: 0 },
    previousInstructorPosition: { h: 1, v: 0, f: 0 },
    instructorPosition: { h: 2, v: 1, f: 0 },
    embeddedActivities: {
      'raffle:2:1': {
        childSessionId: 'CHILD:parent:c:raffle',
        activityId: 'raffle',
        startedAt: 10,
        owner: 'syncdeck-instructor',
      },
    },
  })

  assert.equal(result, true)
})

void test('shouldForceFollowInstructorSetState keeps opt-out for forward non-anchored setState', () => {
  const result = shouldForceFollowInstructorSetState({
    semanticInstructorCommandName: 'setState',
    studentHasBacktrackOptOut: true,
    localStudentPosition: { h: 2, v: 0, f: 0 },
    previousInstructorPosition: { h: 2, v: 0, f: 0 },
    instructorPosition: { h: 3, v: 0, f: 0 },
    embeddedActivities: {},
  })

  assert.equal(result, false)
})

void test('shouldForceFollowInstructorSetState does not force-follow vertical setState in same stack', () => {
  const result = shouldForceFollowInstructorSetState({
    semanticInstructorCommandName: 'setState',
    studentHasBacktrackOptOut: false,
    localStudentPosition: { h: 2, v: 0, f: 0 },
    previousInstructorPosition: { h: 2, v: 0, f: 0 },
    instructorPosition: { h: 2, v: 1, f: 0 },
    embeddedActivities: {
      'embedded-test:2:0': {
        childSessionId: 'CHILD:parent:c:embedded-test',
        activityId: 'embedded-test',
        startedAt: 10,
        owner: 'syncdeck-instructor',
      },
      'raffle:2:1': {
        childSessionId: 'CHILD:parent:c:raffle',
        activityId: 'raffle',
        startedAt: 20,
        owner: 'syncdeck-instructor',
      },
    },
  })

  assert.equal(result, false)
})

void test('shouldForceFollowInstructorSetState does not force-follow same-stack vertical move after rejoining anchor', () => {
  const result = shouldForceFollowInstructorSetState({
    semanticInstructorCommandName: 'setState',
    studentHasBacktrackOptOut: false,
    localStudentPosition: null,
    previousInstructorPosition: { h: 2, v: 0, f: 0 },
    instructorPosition: { h: 2, v: 1, f: 0 },
    embeddedActivities: {
      'embedded-test:2:0': {
        childSessionId: 'CHILD:parent:c:embedded-test',
        activityId: 'embedded-test',
        startedAt: 10,
        owner: 'syncdeck-instructor',
      },
      'raffle:2:1': {
        childSessionId: 'CHILD:parent:c:raffle',
        activityId: 'raffle',
        startedAt: 20,
        owner: 'syncdeck-instructor',
      },
    },
  })

  assert.equal(result, false)
})

void test('shouldForceFollowInstructorSetState treats authoritative state envelopes like setState for anchored rejoin', () => {
  const result = shouldForceFollowInstructorSetState({
    semanticInstructorCommandName: 'setState',
    studentHasBacktrackOptOut: true,
    localStudentPosition: { h: 1, v: 0, f: 0 },
    previousInstructorPosition: { h: 1, v: 0, f: 0 },
    instructorPosition: { h: 2, v: 0, f: 0 },
    embeddedActivities: {
      'embedded-test:2:0': {
        childSessionId: 'CHILD:parent:c:embedded-test',
        activityId: 'embedded-test',
        startedAt: 10,
        owner: 'syncdeck-instructor',
      },
    },
  })

  assert.equal(result, true)
})

void test('shouldForceFollowInstructorSetState treats late-join snapshots like setState when student has no local position yet', () => {
  const result = shouldForceFollowInstructorSetState({
    semanticInstructorCommandName: 'setState',
    studentHasBacktrackOptOut: false,
    localStudentPosition: null,
    previousInstructorPosition: null,
    instructorPosition: { h: 5, v: 0, f: 0 },
    embeddedActivities: {},
  })

  assert.equal(result, true)
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

void test('normalizeSyncDeckEmbeddedActivities preserves multiple valid late-join snapshot records', () => {
  const normalized = normalizeSyncDeckEmbeddedActivities({
    'raffle:2:0': {
      childSessionId: 'CHILD:parent:r1:raffle',
      activityId: 'raffle',
      startedAt: 10,
      owner: 'inst-a',
    },
    'video-sync:2:1': {
      childSessionId: 'CHILD:parent:v1:video-sync',
      activityId: 'video-sync',
      startedAt: 20,
      owner: 'inst-a',
    },
  })

  assert.deepEqual(Object.keys(normalized).sort(), ['raffle:2:0', 'video-sync:2:1'])
  assert.equal(normalized['raffle:2:0']?.activityId, 'raffle')
  assert.equal(normalized['video-sync:2:1']?.activityId, 'video-sync')
})

void test('shouldRecoverEmbeddedEntryParticipantToken requests a fresh child handoff for late-join embedded activity sessions', () => {
  const sessionStorage = {
    getItem() {
      return null
    },
  }
  const localStorage = {
    getItem() {
      return null
    },
    setItem() {},
    removeItem() {},
  }

  assert.equal(
    shouldRecoverEmbeddedEntryParticipantToken({
      sessionId: 'syncdeck-parent',
      childSessionId: 'CHILD:syncdeck-parent:abcde:resonance',
      studentId: 'student-1',
      activityId: 'resonance',
      sessionStorage,
      localStorage,
    }),
    true,
  )
})

void test('shouldRecoverEmbeddedEntryParticipantToken skips refresh when the child identity already exists locally', () => {
  const sessionStorage = {
    getItem() {
      return null
    },
  }
  const localStorage = {
    getItem(key: string) {
      if (key === 'session-participant:CHILD:syncdeck-parent:abcde:resonance') {
        return JSON.stringify({ studentName: 'Ada Lovelace', studentId: 'student-1' })
      }
      return null
    },
    setItem() {},
    removeItem() {},
  }

  assert.equal(
    shouldRecoverEmbeddedEntryParticipantToken({
      sessionId: 'syncdeck-parent',
      childSessionId: 'CHILD:syncdeck-parent:abcde:resonance',
      studentId: 'student-1',
      activityId: 'resonance',
      sessionStorage,
      localStorage,
    }),
    false,
  )
})

void test('shouldRecoverEmbeddedEntryParticipantToken clears malformed shared context and still recovers', () => {
  const removedKeys: string[] = []
  const sessionStorage = {
    getItem() {
      return null
    },
  }
  const localStorage = {
    getItem(key: string) {
      if (key === 'session-participant:CHILD:syncdeck-parent:abcde:resonance') {
        return '{not-json'
      }
      return null
    },
    setItem() {},
    removeItem(key: string) {
      removedKeys.push(key)
    },
  }

  assert.equal(
    shouldRecoverEmbeddedEntryParticipantToken({
      sessionId: 'syncdeck-parent',
      childSessionId: 'CHILD:syncdeck-parent:abcde:resonance',
      studentId: 'student-1',
      activityId: 'resonance',
      sessionStorage,
      localStorage,
    }),
    true,
  )

  assert.deepEqual(removedKeys, ['session-participant:CHILD:syncdeck-parent:abcde:resonance'])
})

void test('shouldRecoverEmbeddedEntryParticipantToken ignores empty shared context but still honors valid legacy identity', () => {
  const persistedLegacyContexts: Array<{ key: string; value: string }> = []
  const sessionStorage = {
    getItem() {
      return null
    },
  }
  const localStorage = {
    getItem(key: string) {
      if (key === 'session-participant:CHILD:syncdeck-parent:abcde:resonance') {
        return '{}'
      }
      if (key === 'student-name-CHILD:syncdeck-parent:abcde:resonance') {
        return 'Ada Lovelace'
      }
      if (key === 'student-id-CHILD:syncdeck-parent:abcde:resonance') {
        return 'student-1'
      }
      return null
    },
    setItem(key: string, value: string) {
      persistedLegacyContexts.push({ key, value })
    },
    removeItem() {},
  }

  assert.equal(
    shouldRecoverEmbeddedEntryParticipantToken({
      sessionId: 'syncdeck-parent',
      childSessionId: 'CHILD:syncdeck-parent:abcde:resonance',
      studentId: 'student-1',
      activityId: 'resonance',
      sessionStorage,
      localStorage,
    }),
    false,
  )

  assert.deepEqual(persistedLegacyContexts, [
    {
      key: 'session-participant:CHILD:syncdeck-parent:abcde:resonance',
      value: JSON.stringify({ studentName: 'Ada Lovelace', studentId: 'student-1' }),
    },
  ])
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

void test('applySyncDeckEmbeddedLifecyclePayload ignores start payload missing activityId', () => {
  const existing = {
    'raffle:2:0': {
      childSessionId: 'CHILD:parent:r1:raffle',
      activityId: 'raffle',
      startedAt: 10,
      owner: 'syncdeck-instructor',
    },
  }

  const next = applySyncDeckEmbeddedLifecyclePayload(existing, {
    type: 'embedded-activity-start',
    instanceKey: 'video-sync:3:0',
    childSessionId: 'CHILD:parent:v1:video-sync',
  })

  assert.deepEqual(next, existing)
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

void test('resolveStudentActiveEmbeddedInstanceKey prefers latest started overlay when multiple records share slide anchor', () => {
  const map = {
    'raffle:2:0': {
      childSessionId: 'CHILD:parent:r1:raffle',
      activityId: 'raffle',
      startedAt: 10,
      owner: 'inst',
    },
    'embedded-test:2:0': {
      childSessionId: 'CHILD:parent:e1:embedded-test',
      activityId: 'embedded-test',
      startedAt: 30,
      owner: 'inst',
    },
  }

  assert.equal(
    resolveStudentActiveEmbeddedInstanceKey(map, { h: 2, v: 0, f: 0 }),
    'embedded-test:2:0',
  )
})

void test('resolveStudentActiveEmbeddedInstanceKeyWithFallback uses fallback indices when local student indices are unavailable', () => {
  const map = {
    'embedded-test:2:0': {
      childSessionId: 'CHILD:parent:c:embedded-test',
      activityId: 'embedded-test',
      startedAt: 30,
      owner: 'inst',
    },
  }

  assert.equal(
    resolveStudentActiveEmbeddedInstanceKeyWithFallback(
      map,
      null,
      { h: 2, v: 0, f: 0 },
    ),
    'embedded-test:2:0',
  )
})

void test('resolveStudentActiveEmbeddedInstanceKeyWithFallback uses fallback indices when local student indices are stale and fallback is allowed', () => {
  const map = {
    'embedded-test:2:0': {
      childSessionId: 'CHILD:parent:c:embedded-test',
      activityId: 'embedded-test',
      startedAt: 30,
      owner: 'inst',
    },
  }

  assert.equal(
    resolveStudentActiveEmbeddedInstanceKeyWithFallback(
      map,
      { h: 1, v: 0, f: 0 },
      { h: 2, v: 0, f: 0 },
    ),
    'embedded-test:2:0',
  )
})

void test('resolveStudentActiveEmbeddedInstanceKeyWithFallback does not reuse instructor fallback after local student navigation leaves the embedded slide', () => {
  const map = {
    'embedded-test:2:0': {
      childSessionId: 'CHILD:parent:c:embedded-test',
      activityId: 'embedded-test',
      startedAt: 30,
      owner: 'inst',
    },
  }

  assert.equal(
    resolveStudentActiveEmbeddedInstanceKeyWithFallback(
      map,
      { h: 1, v: 0, f: 0 },
      { h: 2, v: 0, f: 0 },
      false,
    ),
    null,
  )
})

void test('resolveStudentOverlayEmbeddedInstanceKey prefers instructor indices while student is following sync', () => {
  const map = {
    'embedded-test:2:0': {
      childSessionId: 'CHILD:parent:c:embedded-test',
      activityId: 'embedded-test',
      startedAt: 30,
      owner: 'inst',
    },
  }

  assert.equal(
    resolveStudentOverlayEmbeddedInstanceKey(
      map,
      { h: 2, v: 0, f: 0 },
      { h: 1, v: 0, f: 0 },
      {
        preferInstructor: true,
        fallbackOnMismatch: false,
      },
    ),
    null,
  )
})

void test('resolveStudentOverlayEmbeddedInstanceKey prefers local indices after student intentionally diverges', () => {
  const map = {
    'embedded-test:2:0': {
      childSessionId: 'CHILD:parent:c:embedded-test',
      activityId: 'embedded-test',
      startedAt: 30,
      owner: 'inst',
    },
  }

  assert.equal(
    resolveStudentOverlayEmbeddedInstanceKey(
      map,
      { h: 2, v: 0, f: 0 },
      { h: 1, v: 0, f: 0 },
      {
        preferInstructor: false,
        fallbackOnMismatch: false,
      },
    ),
    'embedded-test:2:0',
  )
})

void test('resolveStudentOverlayEmbeddedInstanceKey reuses same-stack fallback overlay when local vertical sibling is not started yet', () => {
  const map = {
    'embedded-test:2:0': {
      childSessionId: 'CHILD:parent:c:embedded-test',
      activityId: 'embedded-test',
      startedAt: 30,
      owner: 'inst',
    },
  }

  assert.equal(
    resolveStudentOverlayEmbeddedInstanceKey(
      map,
      { h: 2, v: 1, f: 0 },
      { h: 2, v: 0, f: 0 },
      {
        preferInstructor: false,
        fallbackOnMismatch: false,
      },
    ),
    'embedded-test:2:0',
  )
})

void test('resolveStudentOverlayEmbeddedInstanceKey switches overlays as local navigation moves across anchored slides', () => {
  const map = {
    'raffle:2:0': {
      childSessionId: 'CHILD:parent:r1:raffle',
      activityId: 'raffle',
      startedAt: 10,
      owner: 'inst',
    },
    'video-sync:3:0': {
      childSessionId: 'CHILD:parent:v1:video-sync',
      activityId: 'video-sync',
      startedAt: 20,
      owner: 'inst',
    },
  }

  assert.equal(
    resolveStudentOverlayEmbeddedInstanceKey(
      map,
      { h: 2, v: 0, f: 0 },
      { h: 2, v: 0, f: 0 },
      {
        preferInstructor: false,
        fallbackOnMismatch: false,
      },
    ),
    'raffle:2:0',
  )

  assert.equal(
    resolveStudentOverlayEmbeddedInstanceKey(
      map,
      { h: 3, v: 0, f: 0 },
      { h: 2, v: 0, f: 0 },
      {
        preferInstructor: false,
        fallbackOnMismatch: false,
      },
    ),
    'video-sync:3:0',
  )
})

void test('resolveStudentOverlayEmbeddedInstanceKey falls back to instructor anchor on mismatch when fallback is enabled', () => {
  const map = {
    'embedded-test:4:0': {
      childSessionId: 'CHILD:parent:e1:embedded-test',
      activityId: 'embedded-test',
      startedAt: 30,
      owner: 'inst',
    },
  }

  assert.equal(
    resolveStudentOverlayEmbeddedInstanceKey(
      map,
      { h: 1, v: 0, f: 0 },
      { h: 4, v: 0, f: 0 },
      {
        preferInstructor: false,
        fallbackOnMismatch: true,
      },
    ),
    'embedded-test:4:0',
  )
})

void test('resolveStudentOverlayNavigationBaseIndices uses active embedded anchor when student is on fallback overlay', () => {
  const base = resolveStudentOverlayNavigationBaseIndices({
    studentIndices: { h: 0, v: 0, f: 0 },
    studentAnchoredInstanceKey: null,
    activeEmbeddedInstanceKey: 'embedded-test:2:0',
  })

  assert.deepEqual(base, { h: 2, v: 0, f: 0 })
})

void test('resolveStudentOverlayNavigationBaseIndices preserves local indices when student is anchored', () => {
  const base = resolveStudentOverlayNavigationBaseIndices({
    studentIndices: { h: 2, v: 1, f: 0 },
    studentAnchoredInstanceKey: 'raffle:2:1',
    activeEmbeddedInstanceKey: 'raffle:2:1',
  })

  assert.deepEqual(base, { h: 2, v: 1, f: 0 })
})

void test('fallback overlay navigation base preserves vertical capabilities on reload-driven instructor fallback', () => {
  const base = resolveStudentOverlayNavigationBaseIndices({
    studentIndices: null,
    studentAnchoredInstanceKey: null,
    activeEmbeddedInstanceKey: 'raffle:2:1',
  })

  assert.deepEqual(base, { h: 2, v: 1, f: 0 })
  assert.deepEqual(
    deriveEmbeddedOverlayVerticalNavigationCapabilities(
      ['embedded-test:2:0', 'raffle:2:1', 'algorithm-demo:2:2'],
      base,
    ),
    { canGoUp: true, canGoDown: true },
  )
})

void test('extractNavigationCapabilitiesFromStateMessage reads four-direction navigation capabilities from state payload', () => {
  const capabilities = extractNavigationCapabilitiesFromStateMessage({
    type: 'reveal-sync',
    action: 'state',
    payload: {
      navigation: {
        canGoBack: false,
        canGoForward: true,
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

void test('persistRecoveredEmbeddedEntryParticipantToken returns true when handoff is persisted', () => {
  const storage = new Map<string, string>()
  const sessionStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value)
    },
    removeItem: (key: string) => {
      storage.delete(key)
    },
  }

  const persisted = persistRecoveredEmbeddedEntryParticipantToken({
    sessionStorage,
    activityId: 'resonance',
    childSessionId: 'child-1',
    entryParticipantToken: 'entry-token-1',
  })

  assert.equal(persisted, true)
})

void test('persistRecoveredEmbeddedEntryParticipantToken returns false when storage write fails', () => {
  const sessionStorage = {
    getItem: (_key: string) => null,
    setItem: (_key: string, _value: string) => {
      throw new Error('quota exceeded')
    },
    removeItem: (_key: string) => {
      // no-op
    },
  }

  const persisted = persistRecoveredEmbeddedEntryParticipantToken({
    sessionStorage,
    activityId: 'resonance',
    childSessionId: 'child-1',
    entryParticipantToken: 'entry-token-1',
  })

  assert.equal(persisted, false)
})

void test('shouldPersistRecoveredEmbeddedEntryResponse returns trimmed values for matching child session ids', () => {
  assert.deepEqual(
    shouldPersistRecoveredEmbeddedEntryResponse({
      response: {
        childSessionId: ' child-1 ',
        entryParticipantToken: ' token-1 ',
      },
      activeEmbeddedChildSessionId: 'child-1',
    }),
    {
      childSessionId: 'child-1',
      entryParticipantToken: 'token-1',
    },
  )
})

void test('shouldPersistRecoveredEmbeddedEntryResponse rejects mismatched child session ids', () => {
  assert.equal(
    shouldPersistRecoveredEmbeddedEntryResponse({
      response: {
        childSessionId: 'child-stale',
        entryParticipantToken: 'token-1',
      },
      activeEmbeddedChildSessionId: 'child-active',
    }),
    null,
  )
})

void test('extractNavigationCapabilitiesFromStateMessage normalizes canGoLeft/canGoRight aliases from ready payload', () => {
  const capabilities = extractNavigationCapabilitiesFromStateMessage({
    type: 'reveal-sync',
    action: 'ready',
    payload: {
      navigation: {
        canGoLeft: false,
        canGoRight: true,
      },
    },
  })

  assert.deepEqual(capabilities, {
    canGoBack: false,
    canGoForward: true,
    canGoUp: true,
    canGoDown: true,
  })
})

void test('computeStudentEmbeddedSyncState resolves synchronized, vertical, behind, ahead, and solo', () => {
  assert.equal(computeStudentEmbeddedSyncState({ h: 3, v: 0 }, { h: 3, v: 0 }), 'synchronized')
  assert.equal(computeStudentEmbeddedSyncState({ h: 3, v: 1 }, { h: 3, v: 0 }), 'vertical')
  assert.equal(computeStudentEmbeddedSyncState({ h: 2, v: 0 }, { h: 3, v: 0 }), 'behind')
  assert.equal(computeStudentEmbeddedSyncState({ h: 4, v: 0 }, { h: 3, v: 0 }), 'ahead')
  assert.equal(computeStudentEmbeddedSyncState({ h: 4, v: 0 }, null), 'solo')
})

void test('buildStudentLocalNavigationPayloads restores released boundary after local backtrack move', () => {
  const payloads = buildStudentLocalNavigationPayloads({
    optimisticIndices: { h: 1, v: 0, f: 0 },
    maxPosition: { h: 2, v: 1, f: 0 },
  }) as Array<{
    payload?: {
      name?: unknown
      payload?: {
        state?: { indexh?: unknown; indexv?: unknown; indexf?: unknown }
        indices?: { h?: unknown; v?: unknown; f?: unknown }
      }
    }
  }>

  assert.equal(payloads.length, 2)
  assert.equal(payloads[0]?.payload?.name, 'setState')
  assert.deepEqual(payloads[0]?.payload?.payload?.state, {
    indexh: 1,
    indexv: 0,
    indexf: 0,
  })
  assert.equal(payloads[1]?.payload?.name, 'setStudentBoundary')
  assert.deepEqual(payloads[1]?.payload?.payload?.indices, {
    h: 2,
    v: 0,
    f: -1,
  })
})

void test('shouldPreferInstructorOverlaySelection disables instructor preference for vertical divergence', () => {
  assert.equal(
    shouldPreferInstructorOverlaySelection({
      syncState: 'vertical',
      isBacktrackOptOut: false,
      suppressFallbackToInstructor: false,
    }),
    false,
  )
})

void test('shouldPreferInstructorOverlaySelection prefers instructor only while synchronized and following', () => {
  assert.equal(
    shouldPreferInstructorOverlaySelection({
      syncState: 'synchronized',
      isBacktrackOptOut: false,
      suppressFallbackToInstructor: false,
    }),
    true,
  )

  assert.equal(
    shouldPreferInstructorOverlaySelection({
      syncState: 'synchronized',
      isBacktrackOptOut: true,
      suppressFallbackToInstructor: false,
    }),
    false,
  )

  assert.equal(
    shouldPreferInstructorOverlaySelection({
      syncState: 'synchronized',
      isBacktrackOptOut: false,
      suppressFallbackToInstructor: true,
    }),
    false,
  )
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

void test('buildStudentEmbeddedSyncContextMessage emits solo payload when instructor indices are absent', () => {
  const message = buildStudentEmbeddedSyncContextMessage(
    'solo',
    { h: 4, v: 0, f: 0 },
    null,
  )

  assert.deepEqual(message, {
    type: 'activebits-embedded',
    action: 'syncContext',
    payload: {
      syncState: 'solo',
      studentIndices: { h: 4, v: 0, f: 0 },
      instructorIndices: null,
      role: 'student',
    },
  })
})

void test('shouldShowInstructorPendingActivityNotice only shows when student shares instructor horizontal position without an active overlay', () => {
  assert.equal(
    shouldShowInstructorPendingActivityNotice({
      hasActiveEmbeddedActivity: false,
      hasActiveSoloOverlay: false,
      instructorAnchoredInstanceKey: 'raffle:3:0',
      hasPendingSynchronizedActivityRequest: false,
      studentIndices: { h: 3, v: 1, f: 0 },
      instructorIndices: { h: 3, v: 0, f: 0 },
      isBacktrackOptOut: false,
    }),
    true,
  )

  assert.equal(
    shouldShowInstructorPendingActivityNotice({
      hasActiveEmbeddedActivity: true,
      hasActiveSoloOverlay: false,
      instructorAnchoredInstanceKey: 'raffle:3:0',
      hasPendingSynchronizedActivityRequest: false,
      studentIndices: { h: 3, v: 1, f: 0 },
      instructorIndices: { h: 3, v: 0, f: 0 },
      isBacktrackOptOut: false,
    }),
    false,
  )

  assert.equal(
    shouldShowInstructorPendingActivityNotice({
      hasActiveEmbeddedActivity: false,
      hasActiveSoloOverlay: false,
      instructorAnchoredInstanceKey: 'raffle:4:0',
      hasPendingSynchronizedActivityRequest: false,
      studentIndices: { h: 3, v: 1, f: 0 },
      instructorIndices: { h: 4, v: 0, f: 0 },
      isBacktrackOptOut: false,
    }),
    false,
  )

  assert.equal(
    shouldShowInstructorPendingActivityNotice({
      hasActiveEmbeddedActivity: false,
      hasActiveSoloOverlay: false,
      instructorAnchoredInstanceKey: 'raffle:3:0',
      hasPendingSynchronizedActivityRequest: false,
      studentIndices: { h: 3, v: 1, f: 0 },
      instructorIndices: { h: 3, v: 0, f: 0 },
      isBacktrackOptOut: true,
    }),
    false,
  )
})

void test('shouldShowInstructorPendingActivityNotice also uses pending synchronized activity requests when the child session has not been created yet', () => {
  assert.equal(
    shouldShowInstructorPendingActivityNotice({
      hasActiveEmbeddedActivity: false,
      hasActiveSoloOverlay: false,
      instructorAnchoredInstanceKey: null,
      hasPendingSynchronizedActivityRequest: true,
      studentIndices: { h: 4, v: 0, f: 0 },
      instructorIndices: { h: 4, v: 0, f: 0 },
      isBacktrackOptOut: false,
    }),
    true,
  )
})

void test('hasPendingSynchronizedActivityRequestForCurrentSlide only matches the current slide while the request is fresh', () => {
  const pendingRequest = {
    slideKey: '4:0',
    observedAt: 10_000,
  }

  assert.equal(buildSyncDeckSlideKey({ h: 4, v: 0, f: 0 }), '4:0')
  assert.equal(
    hasPendingSynchronizedActivityRequestForCurrentSlide({
      pendingRequest,
      studentIndices: { h: 4, v: 0, f: 0 },
      now: 12_000,
    }),
    true,
  )
  assert.equal(
    hasPendingSynchronizedActivityRequestForCurrentSlide({
      pendingRequest,
      studentIndices: { h: 5, v: 0, f: 0 },
      now: 12_000,
    }),
    false,
  )
  assert.equal(
    hasPendingSynchronizedActivityRequestForCurrentSlide({
      pendingRequest,
      studentIndices: { h: 4, v: 0, f: 0 },
      now: 19_500,
      maxAgeMs: 8_000,
    }),
    false,
  )
})

void test('resolveStudentSoloActivityRequestInputs parses primary and stack slide requests with de-duped slide keys', () => {
  const requests = resolveStudentSoloActivityRequestInputs(
    {
      activityId: 'raffle',
      indices: { h: 2, v: 0, f: 0 },
      standaloneEntry: { enabled: true, supportsDirectPath: true, supportsPermalink: false },
      stackRequests: [
        {
          activityId: 'video-sync',
          indices: { h: 2, v: 1, f: 0 },
          standaloneEntry: { enabled: false, supportsDirectPath: false, supportsPermalink: false },
        },
        {
          activityId: 'embedded-test',
          indices: { h: 2, v: 1, f: 0 },
          standaloneEntry: { enabled: true, supportsDirectPath: true, supportsPermalink: false },
        },
      ],
    },
    null,
  )

  assert.deepEqual(requests, [
    {
      activityId: 'raffle',
      indices: { h: 2, v: 0, f: 0 },
      standaloneEntry: { enabled: true, supportsDirectPath: true, supportsPermalink: false },
    },
    {
      activityId: 'embedded-test',
      indices: { h: 2, v: 1, f: 0 },
      standaloneEntry: { enabled: true, supportsDirectPath: true, supportsPermalink: false },
    },
  ])
})

void test('resolveStudentSoloActivityRequest prefers request matching current student slide', () => {
  const request = resolveStudentSoloActivityRequest(
    {
      activityId: 'raffle',
      indices: { h: 2, v: 0, f: 0 },
      stackRequests: [
        {
          activityId: 'embedded-test',
          indices: { h: 2, v: 1, f: 0 },
          standaloneEntry: { enabled: true, supportsDirectPath: true, supportsPermalink: false },
        },
      ],
    },
    { h: 2, v: 1, f: 0 },
  )

  assert.deepEqual(request, {
    activityId: 'embedded-test',
    indices: { h: 2, v: 1, f: 0 },
    standaloneEntry: { enabled: true, supportsDirectPath: true, supportsPermalink: false },
  })
})

void test('resolveStudentSoloActivityRequestInputs falls back to provided student indices when request omits indices', () => {
  const requests = resolveStudentSoloActivityRequestInputs(
    {
      activityId: 'embedded-test',
      standaloneEntry: { enabled: true, supportsDirectPath: true, supportsPermalink: false },
    },
    { h: 6, v: 0, f: 0 },
  )

  assert.deepEqual(requests, [
    {
      activityId: 'embedded-test',
      indices: { h: 6, v: 0, f: 0 },
      standaloneEntry: { enabled: true, supportsDirectPath: true, supportsPermalink: false },
    },
  ])
})

void test('applyStudentSoloActivityRequest creates direct standalone overlay when request metadata supports direct solo path', () => {
  const overlays = applyStudentSoloActivityRequest(
    {},
    {
      activityId: 'embedded-test',
      indices: { h: 4, v: 0, f: 0 },
      standaloneEntry: { enabled: true, supportsDirectPath: true, supportsPermalink: false },
    },
  )

  assert.deepEqual(overlays, {
    '4:0': {
      activityId: 'embedded-test',
      src: '/solo/embedded-test',
    },
  })
})

void test('applyStudentSoloActivityRequest keeps selectedOptions for permalink-capable standalone launch', () => {
  const overlays = applyStudentSoloActivityRequest(
    {},
    {
      activityId: 'video-sync',
      indices: { h: 5, v: 0, f: 0 },
      standaloneEntry: { enabled: true, supportsDirectPath: false, supportsPermalink: true },
      selectedOptions: {
        sourceUrl: 'https://www.youtube.com/watch?v=mCq8-xTH7jA',
      },
    },
  )

  assert.deepEqual(overlays, {
    '5:0': {
      activityId: 'video-sync',
      notice: 'Launching solo activity…',
      selectedOptions: {
        sourceUrl: 'https://www.youtube.com/watch?v=mCq8-xTH7jA',
      },
    },
  })
})

void test('applyStudentSoloActivityRequest preserves an existing launched child session for the same activity-owned standalone request', () => {
  const current = {
    '5:0': {
      activityId: 'resonance',
      src: '/CHILD:syncdeck-parent:solo:resonance',
      selectedOptionsComparisonKey: '{"questions":[{"id":"q1","type":"free-response","text":"What is still unclear?","order":0}]}',
    },
  }

  const next = applyStudentSoloActivityRequest(
    current,
    {
      activityId: 'resonance',
      indices: { h: 5, v: 0, f: 0 },
      standaloneEntry: { enabled: true, supportsDirectPath: false, supportsPermalink: true },
      selectedOptions: {
        questions: [
          {
            id: 'q1',
            type: 'free-response',
            text: 'What is still unclear?',
            order: 0,
          },
        ],
      },
    },
  )

  assert.equal(next, current)
})

void test('resolveStudentSoloActivityRequestInputs keeps non-string activity options for standalone activity-owned launches', () => {
  const requests = resolveStudentSoloActivityRequestInputs(
    {
      activityId: 'resonance',
      indices: { h: 2, v: 0, f: 0 },
      standaloneEntry: { enabled: true, supportsDirectPath: false, supportsPermalink: true },
      activityOptions: {
        questions: [
          {
            id: 'q1',
            type: 'free-response',
            text: 'What is still unclear?',
            order: 0,
          },
        ],
      },
    },
    { h: 2, v: 0, f: 0 },
  )

  assert.deepEqual(requests, [
    {
      activityId: 'resonance',
      indices: { h: 2, v: 0, f: 0 },
      standaloneEntry: { enabled: true, supportsDirectPath: false, supportsPermalink: true },
      selectedOptions: {
        questions: [
          {
            id: 'q1',
            type: 'free-response',
            text: 'What is still unclear?',
            order: 0,
          },
        ],
      },
    },
  ])
})

void test('applyResolvedStandaloneEntryToSoloRequest fills missing slide metadata from activity registry config', () => {
  const resolved = applyResolvedStandaloneEntryToSoloRequest(
    {
      activityId: 'video-sync',
      indices: { h: 5, v: 0, f: 0 },
      selectedOptions: {
        sourceUrl: 'https://www.youtube.com/watch?v=mCq8-xTH7jA',
      },
    },
    {
      enabled: true,
      supportsDirectPath: false,
      supportsPermalink: true,
    },
  )

  assert.deepEqual(resolved, {
    activityId: 'video-sync',
    indices: { h: 5, v: 0, f: 0 },
    selectedOptions: {
      sourceUrl: 'https://www.youtube.com/watch?v=mCq8-xTH7jA',
    },
    standaloneEntry: {
      enabled: true,
      supportsDirectPath: false,
      supportsPermalink: true,
    },
  })
})

void test('applyStudentSoloActivityRequest falls back to live-session notice when request metadata does not support standalone launch', () => {
  const overlays = applyStudentSoloActivityRequest(
    {},
    {
      activityId: 'video-sync',
      indices: { h: 5, v: 1, f: 0 },
      standaloneEntry: { enabled: false, supportsDirectPath: false, supportsPermalink: false },
    },
  )

  assert.deepEqual(overlays, {
    '5:1': {
      activityId: 'video-sync',
      notice: 'This activity requires a live session.',
    },
  })
})

void test('applyStudentSoloActivityRequest returns same map reference when overlay content is unchanged', () => {
  const current = {
    '5:0': {
      activityId: 'video-sync',
      notice: 'Launching solo activity…',
      selectedOptions: {
        sourceUrl: 'https://www.youtube.com/watch?v=mCq8-xTH7jA',
      },
    },
  }

  const next = applyStudentSoloActivityRequest(
    current,
    {
      activityId: 'video-sync',
      indices: { h: 5, v: 0, f: 0 },
      standaloneEntry: { enabled: true, supportsDirectPath: false, supportsPermalink: true },
      selectedOptions: {
        sourceUrl: 'https://www.youtube.com/watch?v=mCq8-xTH7jA',
      },
    },
  )

  assert.equal(next, current)
})

void test('shouldRenderStudentOverlayNavigation keeps controls available for notice-only solo overlays', () => {
  assert.equal(
    shouldRenderStudentOverlayNavigation({
      activeEmbeddedActivity: null,
      activeSoloOverlay: {
        activityId: 'video-sync',
        notice: 'This activity requires a live session.',
      },
    }),
    true,
  )

  assert.equal(
    shouldRenderStudentOverlayNavigation({
      activeEmbeddedActivity: null,
      activeSoloOverlay: null,
    }),
    false,
  )
})

void test('getStudentOverlayBackdropClass keeps fullscreen overlays opaque', () => {
  assert.equal(getStudentOverlayBackdropClass(), 'bg-white')
})

void test('buildStudentOverlayNavigationKeys includes solo-overlay slide anchors for vertical stacks', () => {
  assert.deepEqual(
    buildStudentOverlayNavigationKeys({
      embeddedActivities: {},
      soloOverlays: {
        '2:0': { activityId: 'embedded-test', src: '/solo/embedded-test' },
        '2:1': { activityId: 'raffle', notice: 'Launching solo activity…' },
        '2:2': { activityId: 'algorithm-demo', notice: 'This activity requires a live session.' },
      },
    }),
    [
      'embedded-test:2:0',
      'raffle:2:1',
      'algorithm-demo:2:2',
    ],
  )
})

void test('resolveCurrentSlideNavigationCapability ignores stale iframe navigation from a different slide', () => {
  assert.equal(
    resolveCurrentSlideNavigationCapability({
      iframeCapability: false,
      capabilityIndices: { h: 2, v: 0, f: 0 },
      currentIndices: { h: 2, v: 1, f: 0 },
    }),
    null,
  )

  assert.equal(
    resolveCurrentSlideNavigationCapability({
      iframeCapability: true,
      capabilityIndices: { h: 2, v: 1, f: 0 },
      currentIndices: { h: 2, v: 1, f: 0 },
    }),
    true,
  )
})
