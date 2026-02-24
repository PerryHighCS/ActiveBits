import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SyncDeckManager from './SyncDeckManager.js'
import { buildInstructorRoleCommandMessage } from './SyncDeckManager.js'
import { buildForceSyncBoundaryCommandMessage } from './SyncDeckManager.js'

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
