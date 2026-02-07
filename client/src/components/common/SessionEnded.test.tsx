import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import SessionEnded from './SessionEnded'

test('SessionEnded renders end-of-session messaging and return action', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <SessionEnded />
    </MemoryRouter>,
  )

  assert.match(html, /Session Ended/)
  assert.match(html, /ended by your teacher/)
  assert.match(html, /Thank you for participating!/)
  assert.match(html, /Return to Home/)
})
