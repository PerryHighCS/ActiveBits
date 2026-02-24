import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SyncDeckStudent from './SyncDeckStudent.js'
import { toRevealCommandMessage } from './SyncDeckStudent.js'
import { toRevealBoundaryCommandMessage } from './SyncDeckStudent.js'
import { buildStudentRoleCommandMessage } from './SyncDeckStudent.js'
import { shouldSuppressForwardInstructorSync } from './SyncDeckStudent.js'
import { shouldResetBacktrackOptOutByMaxPosition } from './SyncDeckStudent.js'

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
        indices: { h: 3, v: 1, f: Number.MAX_SAFE_INTEGER },
        syncToBoundary: true,
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
    f: Number.MAX_SAFE_INTEGER,
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

void test('toRevealBoundaryCommandMessage sets syncToBoundary when student is beyond new max boundary', () => {
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
    { h: 4, v: 0, f: 0 },
  )

  assert.deepEqual((result?.payload as { payload?: { indices?: unknown; syncToBoundary?: unknown } })?.payload, {
    indices: { h: 2, v: 0, f: 0 },
    syncToBoundary: true,
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

void test('toRevealBoundaryCommandMessage maps state payload with null boundary to instructor-position setStudentBoundary', () => {
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

  assert.equal((result?.payload as { name?: string })?.name, 'setStudentBoundary')
  assert.deepEqual((result?.payload as { payload?: { indices?: unknown; syncToBoundary?: unknown } })?.payload, {
    indices: { h: 2, v: 0, f: 0 },
    syncToBoundary: true,
  })
})

void test('toRevealBoundaryCommandMessage maps studentBoundaryChanged null payload to fallback instructor boundary', () => {
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
    { h: 3, v: 0, f: 0 },
    { h: 2, v: 0, f: 0 },
  )

  assert.equal((result?.payload as { name?: string })?.name, 'setStudentBoundary')
  assert.deepEqual((result?.payload as { payload?: { indices?: unknown; syncToBoundary?: unknown } })?.payload, {
    indices: { h: 2, v: 0, f: 0 },
    syncToBoundary: true,
  })
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
