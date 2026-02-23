import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SyncDeckManager from './SyncDeckManager.js'

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
})
