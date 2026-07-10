import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { JSDOM } from 'jsdom'
import ReactionSummary from './ReactionSummary.js'

;(globalThis as { React?: typeof React }).React = React

function installDomEnvironment() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://activebits.local/',
  })

  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

  ;(globalThis as { window: Window & typeof globalThis }).window = dom.window as unknown as Window & typeof globalThis
  ;(globalThis as { document: Document }).document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: dom.window.navigator,
  })

  return () => {
    const documentBody = globalThis.document?.body
    if (documentBody != null) {
      documentBody.innerHTML = ''
    }
    dom.window.close()
    ;(globalThis as { window?: Window & typeof globalThis }).window = previousWindow
    ;(globalThis as { document?: Document }).document = previousDocument
    if (previousNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', previousNavigatorDescriptor)
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator
    }
  }
}

void test('ReactionSummary opens a reaction picker and emits selected values', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { fireEvent, render } = await import('@testing-library/react')

  try {
    const reactions: string[] = []
    const rendered = render(
      React.createElement(ReactionSummary, {
        reactions: { agree: 2 },
        viewerReaction: 'agree',
        canReact: true,
        options: [
          { value: 'agree', label: 'Agree', symbol: '👍' },
          { value: 'lightbulb', label: 'Lightbulb', symbol: '💡' },
        ],
        onReact: (reaction: string) => {
          reactions.push(reaction)
        },
      }),
    )

    const pickerButton = rendered.getByRole('button', { name: 'Choose reaction' })
    assert.equal(pickerButton.textContent, '👍')
    fireEvent.click(pickerButton)
    fireEvent.click(rendered.getByRole('option', { name: 'React with Lightbulb' }))

    assert.deepEqual(reactions, ['lightbulb'])
    assert.equal(rendered.getByText('👍 2').tagName, 'SPAN')
  } finally {
    restoreDomEnvironment()
  }
})
