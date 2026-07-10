import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'
import InstructorFeedbackControls from './InstructorFeedbackControls.js'

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

void test('InstructorFeedbackControls renders star, flag, and emoji controls in stack order', () => {
  const markup = renderToStaticMarkup(
    React.createElement(InstructorFeedbackControls, {
      annotation: { starred: true, flagged: false, emoji: '🔥' },
      emojiOptions: [{ emoji: '🔥', label: 'On fire' }],
      onToggleStar: () => undefined,
      onToggleFlag: () => undefined,
      onEmojiChange: () => undefined,
    }),
  )

  const actionOrder = [
    'aria-label="Unstar response"',
    'aria-label="Flag submission"',
    'aria-label="Add emoji annotation"',
  ]

  let previousIndex = -1
  for (const marker of actionOrder) {
    const markerIndex = markup.indexOf(marker)
    assert.notEqual(markerIndex, -1, `Expected ${marker} in rendered feedback controls`)
    assert.ok(markerIndex > previousIndex, `Expected ${marker} after prior feedback control`)
    previousIndex = markerIndex
  }
})

void test('InstructorFeedbackControls returns null when no callbacks are provided', () => {
  const markup = renderToStaticMarkup(
    React.createElement(InstructorFeedbackControls, {
      annotation: { starred: false, flagged: false, emoji: null },
    }),
  )

  assert.equal(markup, '')
})

void test('InstructorFeedbackControls renders disabled feedback buttons', () => {
  const markup = renderToStaticMarkup(
    React.createElement(InstructorFeedbackControls, {
      annotation: { starred: false, flagged: false, emoji: null },
      disabled: true,
      onToggleStar: () => undefined,
      onToggleFlag: () => undefined,
      onEmojiChange: () => undefined,
    }),
  )

  assert.equal((markup.match(/disabled=""/g) ?? []).length, 3)
})

void test('InstructorFeedbackControls supports add-mode flagging and emoji keyboard dismissal', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { fireEvent, render } = await import('@testing-library/react')

  try {
    const flagStates: boolean[] = []
    const emojiStates: Array<string | null> = []
    const rendered = render(
      React.createElement(
        'div',
        {},
        React.createElement(InstructorFeedbackControls, {
          annotation: { starred: false, flagged: false, emoji: null },
          emojiOptions: [{ emoji: '🔥', label: 'On fire' }],
          flagMode: 'add',
          onToggleFlag: (flagged: boolean) => {
            flagStates.push(flagged)
          },
          onEmojiChange: (emoji: string | null) => {
            emojiStates.push(emoji)
          },
        }),
        React.createElement('button', { type: 'button' }, 'Outside'),
      ),
    )

    fireEvent.click(rendered.getByRole('button', { name: 'Flag submission' }))
    assert.deepEqual(flagStates, [true])

    const emojiButton = rendered.getByRole('button', { name: 'Add emoji annotation' })
    fireEvent.click(emojiButton)
    assert.equal(emojiButton.getAttribute('aria-expanded'), 'true')
    const listbox = rendered.getByRole('listbox', { name: 'Choose emoji' })
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    const onFireOption = rendered.getByRole('option', { name: 'On fire' })
    assert.equal(globalThis.document.activeElement, onFireOption)
    fireEvent.click(onFireOption)
    assert.deepEqual(emojiStates, ['🔥'])
    assert.equal(emojiButton.getAttribute('aria-expanded'), 'false')

    fireEvent.click(emojiButton)
    fireEvent.keyDown(rendered.getByRole('listbox', { name: 'Choose emoji' }), { key: 'Escape' })
    assert.equal(globalThis.document.activeElement, emojiButton)
  } finally {
    restoreDomEnvironment()
  }
})
