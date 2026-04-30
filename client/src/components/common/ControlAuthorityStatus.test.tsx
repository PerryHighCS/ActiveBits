import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import ControlAuthorityStatus from './ControlAuthorityStatus'

void test('ControlAuthorityStatus renders current control state and disables owner button', () => {
  const html = renderToStaticMarkup(
    <ControlAuthorityStatus
      statusLabel="You have control"
      hasControl={true}
      canTakeControl={true}
      onTakeControl={() => {}}
    />,
  )

  assert.match(html, /aria-live="polite"/)
  assert.match(html, /You have control/)
  assert.match(html, /Instructor control is active in this view/)
  assert.match(html, /disabled/)
  assert.match(html, /In Control/)
})

void test('ControlAuthorityStatus can hide the action when the current instructor owns control', () => {
  const html = renderToStaticMarkup(
    <ControlAuthorityStatus
      statusLabel="You have control"
      hasControl={true}
      canTakeControl={true}
      hideButtonWhenOwner={true}
      onTakeControl={() => {}}
    />,
  )

  assert.match(html, /You have control/)
  assert.doesNotMatch(html, /In Control/)
})
