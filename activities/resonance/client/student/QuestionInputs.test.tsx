import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { JSDOM } from 'jsdom'
import FreeResponseInput from './FreeResponseInput.js'
import MCQInput from './MCQInput.js'
import QuestionView from './QuestionView.js'

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

void test('QuestionView submits over websocket first when sendMessage is available', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const previousFetch = globalThis.fetch
  const { fireEvent, render, waitFor } = await import('@testing-library/react')

  try {
    let fetchCalled = false
    ;(globalThis as { fetch?: typeof fetch }).fetch = (async () => {
      fetchCalled = true
      throw new Error('fetch should not be called when websocket submit succeeds')
    }) as typeof fetch

    const submitted: Array<{ questionId: string; answer: { type: string; text?: string } }> = []
    const wsMessages: Array<{ type: string; payload: unknown }> = []

    const rendered = render(
      React.createElement(QuestionView, {
        question: {
          id: 'q1',
          type: 'free-response',
          text: 'Explain your reasoning.',
          order: 0,
        },
        sessionId: 'session-1',
        studentId: 'student-1',
        sendMessage: (type: string, payload: unknown) => {
          wsMessages.push({ type, payload })
          return true
        },
        onSubmitted: (questionId, answer) => {
          submitted.push({ questionId, answer })
        },
      }),
    )

    const textarea = rendered.getByLabelText(/your answer/i)
    fireEvent.change(textarea, { target: { value: 'Fast path answer' } })
    fireEvent.click(rendered.getByRole('button', { name: 'Submit answer' }))

    await waitFor(() => {
      assert.equal(wsMessages.length > 0, true)
    })

    assert.equal(fetchCalled, false)
    assert.deepEqual(wsMessages[0], {
      type: 'resonance:submit-answer',
      payload: {
        studentId: 'student-1',
        questionId: 'q1',
        answer: {
          type: 'free-response',
          text: 'Fast path answer',
        },
      },
    })
    assert.deepEqual(submitted, [
      {
        questionId: 'q1',
        answer: {
          type: 'free-response',
          text: 'Fast path answer',
        },
      },
    ])
  } finally {
    ;(globalThis as { fetch?: typeof fetch }).fetch = previousFetch
    restoreDomEnvironment()
  }
})
