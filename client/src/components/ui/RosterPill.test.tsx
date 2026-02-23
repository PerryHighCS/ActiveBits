import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import RosterPill from './RosterPill'

void test('RosterPill shows hostname and action labels in default view', () => {
  const html = renderToStaticMarkup(
    <RosterPill hostname="alpha-student" onRemove={() => {}} onRename={() => {}} />,
  )

  assert.match(html, /alpha-student/)
  assert.match(html, /aria-label="Edit alpha-student"/)
  assert.match(html, /aria-label="Remove alpha-student"/)
  assert.doesNotMatch(html, /save/)
  assert.doesNotMatch(html, /cancel/)
})
