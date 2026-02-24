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
