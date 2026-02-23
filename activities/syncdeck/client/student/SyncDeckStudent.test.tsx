import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SyncDeckStudent from './SyncDeckStudent.js'
import { toRevealCommandMessage } from './SyncDeckStudent.js'
import { toRevealBoundaryCommandMessage } from './SyncDeckStudent.js'

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
        indices: { h: 3, v: 1, f: 0 },
        syncToBoundary: false,
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
  assert.deepEqual((result?.payload as { payload?: { indices?: unknown } })?.payload?.indices, { h: 7, v: 0, f: 0 })
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
