import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import SessionHeader from './SessionHeader'

void test('SessionHeader simple mode renders only the activity title', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <SessionHeader activityName="Raffle" simple />
    </MemoryRouter>,
  )

  assert.match(html, /Raffle/)
  assert.doesNotMatch(html, /Join Code:/)
})

void test('SessionHeader full mode renders join controls and action buttons', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <SessionHeader activityName="Gallery Walk" sessionId="abc123" />
    </MemoryRouter>,
  )

  assert.match(html, /Gallery Walk/)
  assert.match(html, /Join Code:/)
  assert.match(html, /abc123/)
  assert.match(html, /Copy Join URL/)
  assert.match(html, /End Session/)
})

void test('SessionHeader hides join and end controls for embedded child sessions', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <SessionHeader activityName="Embedded Test" sessionId="CHILD:parent:abc12:embedded-test" />
    </MemoryRouter>,
  )

  assert.match(html, /Embedded session managed by parent SyncDeck session/i)
  assert.doesNotMatch(html, /Join Code:/)
  assert.doesNotMatch(html, /End Session/)
})
