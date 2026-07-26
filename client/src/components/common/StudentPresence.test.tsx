import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { StudentPresencePanel, StudentPresenceToggleButton } from './StudentPresence'

void React

function installDomEnvironment() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const previousHTMLElement = globalThis.HTMLElement

  ;(globalThis as { window?: Window & typeof globalThis }).window = dom.window as unknown as Window & typeof globalThis
  ;(globalThis as { document?: Document }).document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: dom.window.navigator })
  globalThis.HTMLElement = dom.window.HTMLElement

  return () => {
    dom.window.close()
    ;(globalThis as { window?: Window & typeof globalThis }).window = previousWindow
    ;(globalThis as { document?: Document }).document = previousDocument
    globalThis.HTMLElement = previousHTMLElement
    if (previousNavigatorDescriptor) Object.defineProperty(globalThis, 'navigator', previousNavigatorDescriptor)
    else delete (globalThis as { navigator?: Navigator }).navigator
  }
}

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
  assert.match(panel, /aria-labelledby="students-title"/)
  assert.match(panel, /id="students-title"/)
  assert.match(panel, /Ada/)
  assert.doesNotMatch(panel, />Lin</)
})

void test('StudentPresencePanel restores focus to search when a focused row is removed', async () => {
  const restoreDom = installDomEnvironment()
  const { cleanup, render, waitFor } = await import('@testing-library/react')

  try {
    const rendered = render(
      <StudentPresencePanel
        isOpen
        onClose={() => {}}
        controlsId="students"
        entries={[{ participantId: 'ada', displayName: 'Ada', connected: true }]}
        renderRowActions={() => <button type="button">Return Ada</button>}
      />,
    )
    rendered.getByRole('button', { name: 'Return Ada' }).focus()

    rendered.rerender(
      <StudentPresencePanel
        isOpen
        onClose={() => {}}
        controlsId="students"
        entries={[]}
        renderRowActions={() => <button type="button">Return Ada</button>}
      />,
    )

    await waitFor(() => assert.equal(document.activeElement, rendered.getByRole('textbox', { name: 'Search students' })) )
  } finally {
    cleanup()
    restoreDom()
  }
})
