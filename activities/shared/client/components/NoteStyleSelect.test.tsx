import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { JSDOM } from 'jsdom'
import NoteStyleSelect from './NoteStyleSelect.js'

;(globalThis as { React?: typeof React }).React = React

function installDomEnvironment() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://activebits.local/',
    pretendToBeVisual: true,
  })

  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame

  ;(globalThis as { window: Window & typeof globalThis }).window = dom.window as unknown as Window & typeof globalThis
  ;(globalThis as { document: Document }).document = dom.window.document
  ;(globalThis as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
  dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {}
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
    ;(globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame = previousRequestAnimationFrame
    if (previousNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', previousNavigatorDescriptor)
    } else {
      delete (globalThis as { navigator?: Navigator }).navigator
    }
  }
}

void test('NoteStyleSelect opens and selects an option with the pointer', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { fireEvent, render } = await import('@testing-library/react')
  let rendered: ReturnType<typeof render> | undefined

  try {
    const selected: string[] = []
    rendered = render(
      React.createElement(NoteStyleSelect, {
        value: 'lemon',
        onChange: (value: string) => {
          selected.push(value)
        },
      }),
    )

    const trigger = rendered.getByRole('button', { name: 'Note style' })
    fireEvent.click(trigger)
    assert.equal(trigger.getAttribute('aria-expanded'), 'true')
    fireEvent.click(rendered.getByRole('option', { name: 'Peach' }))

    assert.deepEqual(selected, ['peach'])
    assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  } finally {
    rendered?.unmount()
    restoreDomEnvironment()
  }
})

void test('NoteStyleSelect supports keyboard selection and Escape close', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { fireEvent, render } = await import('@testing-library/react')
  let rendered: ReturnType<typeof render> | undefined

  try {
    const selected: string[] = []
    rendered = render(
      React.createElement(NoteStyleSelect, {
        value: 'lemon',
        onChange: (value: string) => {
          selected.push(value)
        },
      }),
    )

    const trigger = rendered.getByRole('button', { name: 'Note style' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const listbox = rendered.getByRole('listbox', { name: 'Note style' })
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    fireEvent.keyDown(listbox, { key: 'Enter' })
    assert.deepEqual(selected, ['peach'])

    fireEvent.click(trigger)
    assert.equal(trigger.getAttribute('aria-expanded'), 'true')
    fireEvent.keyDown(rendered.getByRole('listbox', { name: 'Note style' }), { key: 'Escape' })
    assert.equal(trigger.getAttribute('aria-expanded'), 'false')
    assert.equal(globalThis.document.activeElement, trigger)
  } finally {
    rendered?.unmount()
    restoreDomEnvironment()
  }
})

void test('NoteStyleSelect closes on outside click', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { fireEvent, render } = await import('@testing-library/react')
  let rendered: ReturnType<typeof render> | undefined

  try {
    rendered = render(
      React.createElement(
        'div',
        {},
        React.createElement(NoteStyleSelect, {
          value: 'lemon',
          onChange: () => undefined,
        }),
        React.createElement('button', { type: 'button' }, 'Outside'),
      ),
    )

    const trigger = rendered.getByRole('button', { name: 'Note style' })
    fireEvent.click(trigger)
    assert.equal(trigger.getAttribute('aria-expanded'), 'true')
    fireEvent.mouseDown(rendered.getByRole('button', { name: 'Outside' }))
    assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  } finally {
    rendered?.unmount()
    restoreDomEnvironment()
  }
})
