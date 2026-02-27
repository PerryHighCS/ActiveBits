import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SyncDeckManager from './SyncDeckManager.js'
import { buildInstructorRoleCommandMessage } from './SyncDeckManager.js'
import { buildForceSyncBoundaryCommandMessage } from './SyncDeckManager.js'
import { buildClearBoundaryCommandMessage } from './SyncDeckManager.js'
import { attachInstructorIndicesToBoundaryChangePayload } from './SyncDeckManager.js'
import { shouldSuppressInstructorStateBroadcast } from './SyncDeckManager.js'
import { buildBoundaryClearedPayload } from './SyncDeckManager.js'
import { extractSyncDeckStatePayload } from './SyncDeckManager.js'
import { includePausedInStateEnvelope } from './SyncDeckManager.js'
import { buildPausedSnapshotFromAction } from './SyncDeckManager.js'
import { toChalkboardRelayCommand } from './SyncDeckManager.js'
import { extractIndicesFromRevealPayload } from './SyncDeckManager.js'
import { buildRestoreCommandFromPayload } from './SyncDeckManager.js'
import { applyChalkboardSnapshotFallback } from './SyncDeckManager.js'
import { buildDirectionalSlideIndices } from './SyncDeckManager.js'
import { extractNavigationCapabilities } from './SyncDeckManager.js'
import { evaluateRestoreSuppressionForOutboundState } from './SyncDeckManager.js'

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
  assert.match(html, /session-123/i)
  assert.match(html, /Copy Join URL/i)
  assert.match(html, /End Session/i)
  assert.match(html, /Force sync students to current position/i)
  assert.match(html, /Disable instructor sync/i)
  assert.match(html, /aria-pressed="true"/i)
  assert.match(html, /Pause presentation/i)
  assert.match(html, /Toggle chalkboard screen/i)
  assert.match(html, /Toggle pen overlay/i)
  assert.match(html, /Configure Presentation/i)
  assert.match(html, /Presentation URL/i)
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

void test('buildForceSyncBoundaryCommandMessage emits setStudentBoundary sync command', () => {
  const message = buildForceSyncBoundaryCommandMessage({ h: 5, v: 1, f: 0 })

  assert.equal(message.type, 'reveal-sync')
  assert.equal(message.action, 'command')
  assert.equal(message.role, 'instructor')
  assert.deepEqual(message.payload, {
    name: 'setStudentBoundary',
    payload: {
      indices: { h: 5, v: 1, f: 0 },
      syncToBoundary: true,
    },
  })
})

void test('buildDirectionalSlideIndices computes directional targets and blocks negative navigation', () => {
  assert.deepEqual(buildDirectionalSlideIndices({ h: 4, v: 2, f: 3 }, 'left'), { h: 3, v: 2, f: 0 })
  assert.deepEqual(buildDirectionalSlideIndices({ h: 4, v: 2, f: 3 }, 'right'), { h: 5, v: 2, f: 0 })
  assert.deepEqual(buildDirectionalSlideIndices({ h: 4, v: 2, f: 3 }, 'up'), { h: 4, v: 1, f: 0 })
  assert.deepEqual(buildDirectionalSlideIndices({ h: 4, v: 2, f: 3 }, 'down'), { h: 4, v: 3, f: 0 })
  assert.equal(buildDirectionalSlideIndices({ h: 0, v: 2, f: 0 }, 'left'), null)
  assert.equal(buildDirectionalSlideIndices({ h: 4, v: 0, f: 0 }, 'up'), null)
})

void test('extractNavigationCapabilities reads reveal sync navigation capabilities from state payload', () => {
  const capabilities = extractNavigationCapabilities({
    type: 'reveal-sync',
    action: 'state',
    payload: {
      capabilities: {
        canNavigateBack: true,
        canNavigateForward: false,
        canNavigateUp: true,
        canNavigateDown: false,
      },
    },
  })

  assert.deepEqual(capabilities, {
    canNavigateBack: true,
    canNavigateForward: false,
    canNavigateUp: true,
    canNavigateDown: false,
  })
})

void test('extractNavigationCapabilities reads reveal sync navigation booleans from navigation payload', () => {
  const capabilities = extractNavigationCapabilities({
    type: 'reveal-sync',
    action: 'ready',
    payload: {
      navigation: {
        canGoBack: false,
        canGoForward: true,
      },
    },
  })

  assert.deepEqual(capabilities, {
    canNavigateBack: false,
    canNavigateForward: true,
  })
})

void test('extractNavigationCapabilities reads optional vertical navigation booleans from navigation payload', () => {
  const capabilities = extractNavigationCapabilities({
    type: 'reveal-sync',
    action: 'ready',
    payload: {
      navigation: {
        canGoBack: true,
        canGoForward: true,
        canGoUp: false,
        canGoDown: true,
      },
    },
  })

  assert.deepEqual(capabilities, {
    canNavigateBack: true,
    canNavigateForward: true,
    canNavigateUp: false,
    canNavigateDown: true,
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
    { h: 3, v: 0, f: Number.MAX_SAFE_INTEGER },
  )

  assert.equal(suppress, true)
})

void test('shouldSuppressInstructorStateBroadcast suppresses when instructor is exactly at explicit boundary', () => {
  const suppress = shouldSuppressInstructorStateBroadcast(
    { h: 3, v: 0, f: Number.MAX_SAFE_INTEGER },
    { h: 3, v: 0, f: Number.MAX_SAFE_INTEGER },
  )

  assert.equal(suppress, true)
})

void test('shouldSuppressInstructorStateBroadcast allows when instructor moves beyond explicit boundary', () => {
  const suppress = shouldSuppressInstructorStateBroadcast(
    { h: 4, v: 0, f: 0 },
    { h: 3, v: 0, f: Number.MAX_SAFE_INTEGER },
  )

  assert.equal(suppress, false)
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
