import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { JSDOM } from 'jsdom'
import FreeResponseInput from './FreeResponseInput.js'
import MCQInput from './MCQInput.js'

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

void test('FreeResponseInput syncs its text when the provided value changes', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { render, waitFor } = await import('@testing-library/react')

  try {
    const rendered = render(
      React.createElement(FreeResponseInput, {
        value: 'First answer',
        onSubmit: async () => undefined,
      }),
    )

    const textarea = rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement
    await waitFor(() => {
      assert.equal(textarea.value, 'First answer')
    })

    rendered.rerender(
      React.createElement(FreeResponseInput, {
        value: 'Updated answer',
        onSubmit: async () => undefined,
      }),
    )

    await waitFor(() => {
      assert.equal(textarea.value, 'Updated answer')
    })
  } finally {
    restoreDomEnvironment()
  }
})

void test('MCQInput syncs its selected option when the provided value changes', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { render, waitFor } = await import('@testing-library/react')

  try {
    const options = [
      { id: 'a', text: 'Option A' },
      { id: 'b', text: 'Option B' },
    ]

    const rendered = render(
      React.createElement(MCQInput, {
        options,
        value: 'a',
        onSubmit: async () => undefined,
      }),
    )

    const optionA = rendered.getByRole('radio', { name: 'Option A' }) as HTMLInputElement
    const optionB = rendered.getByRole('radio', { name: 'Option B' }) as HTMLInputElement

    await waitFor(() => {
      assert.equal(optionA.checked, true)
      assert.equal(optionB.checked, false)
    })

    rendered.rerender(
      React.createElement(MCQInput, {
        options,
        value: 'b',
        onSubmit: async () => undefined,
      }),
    )

    await waitFor(() => {
      assert.equal(optionA.checked, false)
      assert.equal(optionB.checked, true)
    })
  } finally {
    restoreDomEnvironment()
  }
})
