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
  const { cleanup, fireEvent, render } = await import('@testing-library/react')

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
    assert.equal(pickerButton.getAttribute('aria-expanded'), 'true')
    const lightbulbOption = rendered.getByRole('option', { name: 'React with Lightbulb' })
    assert.equal(lightbulbOption.getAttribute('aria-selected'), 'false')
    fireEvent.click(lightbulbOption)

    assert.deepEqual(reactions, ['lightbulb'])
    assert.equal(pickerButton.getAttribute('aria-expanded'), 'false')
    assert.equal(rendered.getByText('👍 2').tagName, 'SPAN')
  } finally {
    cleanup()
    restoreDomEnvironment()
  }
})

void test('ReactionSummary returns null when reactions are read-only and empty', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { cleanup, render } = await import('@testing-library/react')

  try {
    const rendered = render(
      React.createElement(ReactionSummary, {
        reactions: {},
        canReact: false,
        options: [],
      }),
    )

    assert.equal(rendered.container.firstChild, null)
  } finally {
    cleanup()
    restoreDomEnvironment()
  }
})

void test('ReactionSummary renders existing reactions without a picker in read-only mode', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { cleanup, render } = await import('@testing-library/react')

  try {
    const rendered = render(
      React.createElement(ReactionSummary, {
        reactions: { agree: 3 },
        canReact: false,
        options: [{ value: 'agree', label: 'Agree', symbol: '👍' }],
      }),
    )

    assert.equal(rendered.getByText('👍 3').tagName, 'SPAN')
    assert.throws(() => rendered.getByRole('button'))
  } finally {
    cleanup()
    restoreDomEnvironment()
  }
})

void test('ReactionSummary supports keyboard movement, Escape, and outside dismissal', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { cleanup, fireEvent, render } = await import('@testing-library/react')

  try {
    const reactions: string[] = []
    const rendered = render(
      React.createElement(
        'div',
        {},
        React.createElement(ReactionSummary, {
          reactions: {},
          canReact: true,
          options: [
            { value: 'agree', label: 'Agree', symbol: '👍' },
            { value: 'lightbulb', label: 'Lightbulb', symbol: '💡' },
          ],
          onReact: (reaction: string) => {
            reactions.push(reaction)
          },
        }),
        React.createElement('button', { type: 'button' }, 'Outside'),
      ),
    )

    const pickerButton = rendered.getByRole('button', { name: 'Choose reaction' })
    fireEvent.click(pickerButton)
    const listbox = rendered.getByRole('listbox')
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    assert.equal(globalThis.document.activeElement, rendered.getByRole('option', { name: 'React with Lightbulb' }))
    fireEvent.keyDown(listbox, { key: 'Escape' })
    assert.equal(pickerButton.getAttribute('aria-expanded'), 'false')
    assert.equal(globalThis.document.activeElement, pickerButton)

    fireEvent.click(pickerButton)
    assert.equal(pickerButton.getAttribute('aria-expanded'), 'true')
    fireEvent.mouseDown(rendered.getByRole('button', { name: 'Outside' }))
    assert.equal(pickerButton.getAttribute('aria-expanded'), 'false')
  } finally {
    cleanup()
    restoreDomEnvironment()
  }
})

void test('ReactionSummary disables the reaction picker when there are no options', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { cleanup, render } = await import('@testing-library/react')

  try {
    const rendered = render(
      React.createElement(ReactionSummary, {
        reactions: {},
        canReact: true,
        options: [],
        onReact: () => undefined,
      }),
    )

    const pickerButton = rendered.getByRole('button', { name: 'Choose reaction' })
    assert.equal((pickerButton as HTMLButtonElement).disabled, true)
    assert.equal(rendered.container.querySelector('[role="listbox"]'), null)
  } finally {
    cleanup()
    restoreDomEnvironment()
  }
})
