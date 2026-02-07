import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import TicketsList, { isTicketToggleKey } from './TicketsList'

test('isTicketToggleKey accepts keyboard activation keys only', () => {
  assert.equal(isTicketToggleKey('Enter'), true)
  assert.equal(isTicketToggleKey(' '), true)
  assert.equal(isTicketToggleKey('Spacebar'), false)
  assert.equal(isTicketToggleKey('Escape'), false)
})

test('ticket items expose button semantics for keyboard and assistive technologies', () => {
  const markup = renderToStaticMarkup(<TicketsList tickets={[7, 2, 5]} />)

  assert.equal((markup.match(/role="button"/g) ?? []).length, 3)
  assert.equal((markup.match(/tabindex="0"/g) ?? []).length, 3)
  assert.equal((markup.match(/aria-pressed="false"/g) ?? []).length, 3)
})
