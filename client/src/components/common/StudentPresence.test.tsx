import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StudentPresencePanel, StudentPresenceToggleButton } from './StudentPresence'

void React

void test('StudentPresencePanel omits interactive controls while closed', () => {
  const html = renderToStaticMarkup(<StudentPresencePanel isOpen={false} onClose={() => {}} controlsId="students" entries={[]} />)
  assert.match(html, /aria-hidden="true"/)
  assert.doesNotMatch(html, /<input/)
  assert.doesNotMatch(html, /Close/)
})

void test('StudentPresence components expose accessible open controls and connected search results', () => {
  const toggle = renderToStaticMarkup(<StudentPresenceToggleButton connectedCount={2} isOpen={true} onToggle={() => {}} controlsId="students" />)
  const panel = renderToStaticMarkup(<StudentPresencePanel isOpen onClose={() => {}} controlsId="students" entries={[{ participantId: 'ada', displayName: 'Ada', connected: true }, { participantId: 'lin', displayName: 'Lin', connected: false }]} />)
  assert.match(toggle, /id="students-toggle"/)
  assert.match(toggle, /aria-expanded="true"/)
  assert.match(panel, /Search students/)
  assert.match(panel, /Ada/)
  assert.doesNotMatch(panel, />Lin</)
})
