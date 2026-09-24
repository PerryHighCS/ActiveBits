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

    rendered.unmount()
  } finally {
    restoreDomEnvironment()
  }
})

void test('MCQInput syncs its selected options when the provided value changes', async () => {
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
        selectionMode: 'single',
        value: ['a'],
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
        selectionMode: 'single',
        value: ['b'],
        onSubmit: async () => undefined,
      }),
    )

    await waitFor(() => {
      assert.equal(optionA.checked, false)
      assert.equal(optionB.checked, true)
    })

    rendered.unmount()
  } finally {
    restoreDomEnvironment()
  }
})

void test('submitted inputs render the provided submitted message consistently', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { render } = await import('@testing-library/react')

  try {
    const freeResponse = render(
      React.createElement(FreeResponseInput, {
        value: 'Done',
        submitted: true,
        submittedMessage: 'Answer submitted. Moving to the next question.',
        onSubmit: async () => undefined,
      }),
    )
    assert.equal(
      freeResponse.getByText('Answer submitted. Moving to the next question.').textContent,
      'Answer submitted. Moving to the next question.',
    )
    freeResponse.unmount()

    const mcq = render(
      React.createElement(MCQInput, {
        options: [
          { id: 'a', text: 'Option A' },
          { id: 'b', text: 'Option B' },
        ],
        selectionMode: 'single',
        value: ['a'],
        submitted: true,
        submittedMessage: 'Answer submitted.',
        onSubmit: async () => undefined,
      }),
    )
    assert.equal(
      mcq.getByText('Answer submitted.').textContent,
      'Answer submitted.',
    )
    mcq.unmount()
  } finally {
    restoreDomEnvironment()
  }
})

void test('QuestionView submits an answer via REST and reports it to the parent', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const previousFetch = globalThis.fetch
  const { fireEvent, render, waitFor } = await import('@testing-library/react')

  try {
    let submittedBody: unknown = null
    ;(globalThis as { fetch?: typeof fetch }).fetch = (async (_input, init) => {
      submittedBody = JSON.parse(String(init?.body)) as unknown
      return { ok: true, json: async () => ({ ok: true }) } as Response
    }) as typeof fetch

    const submitted: Array<{ questionId: string; answer: { type: string; text?: string } }> = []

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
        activeQuestionRunRevision: 1,
        onSubmitted: (questionId, answer) => {
          submitted.push({ questionId, answer })
        },
      }),
    )

    const textarea = rendered.getByLabelText(/your answer/i)
    fireEvent.change(textarea, { target: { value: 'Fast path answer' } })
    fireEvent.click(rendered.getByRole('button', { name: /submit answer/i }))

    await waitFor(() => assert.equal(submitted.length, 1))

    assert.deepEqual(submittedBody, {
      studentId: 'student-1',
      questionId: 'q1',
      activeQuestionRunRevision: 1,
      editSequence: 1,
      answer: { type: 'free-response', text: 'Fast path answer' },
    })

    rendered.unmount()
  } finally {
    ;(globalThis as { fetch?: typeof fetch }).fetch = previousFetch
    restoreDomEnvironment()
  }
})

void test('QuestionView sends whatever editSequence prop it is given, rather than computing its own', async () => {
  // QuestionView is remounted by its parent on every stack-tab switch (keyed
  // by question id), so it must not own this counter itself — it has to
  // trust the value the parent computed and survived the remount with.
  // Rendering directly with editSequence=3 (simulating a parent that has
  // already recorded two prior revisits) is the regression check for that.
  const restoreDomEnvironment = installDomEnvironment()
  const previousFetch = globalThis.fetch
  const { fireEvent, render, waitFor } = await import('@testing-library/react')

  try {
    let submittedBody: unknown = null
    ;(globalThis as { fetch?: typeof fetch }).fetch = (async (_input, init) => {
      submittedBody = JSON.parse(String(init?.body)) as unknown
      return { ok: true, json: async () => ({ ok: true }) } as Response
    }) as typeof fetch

    const submitted: unknown[] = []
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
        activeQuestionRunRevision: 1,
        editSequence: 3,
        onSubmitted: (questionId, answer) => {
          submitted.push({ questionId, answer })
        },
      }),
    )

    fireEvent.change(rendered.getByLabelText(/your answer/i), {
      target: { value: 'Revisited answer' },
    })
    fireEvent.click(rendered.getByRole('button', { name: /submit answer/i }))

    await waitFor(() => assert.equal(submitted.length, 1))
    assert.deepEqual(submittedBody, {
      studentId: 'student-1',
      questionId: 'q1',
      activeQuestionRunRevision: 1,
      editSequence: 3,
      answer: { type: 'free-response', text: 'Revisited answer' },
    })

    rendered.unmount()
  } finally {
    ;(globalThis as { fetch?: typeof fetch }).fetch = previousFetch
    restoreDomEnvironment()
  }
})

void test('QuestionView does not duplicate a manual submission when the question becomes disabled', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const previousFetch = globalThis.fetch
  const { fireEvent, render, waitFor } = await import('@testing-library/react')

  try {
    const deferredFetch: { resolve: ((response: Response) => void) | null } = { resolve: null }
    let fetchCount = 0
    const submitted: unknown[] = []
    ;(globalThis as { fetch?: typeof fetch }).fetch = (() => {
      fetchCount += 1
      return new Promise<Response>((resolve) => {
        deferredFetch.resolve = resolve
      })
    }) as typeof fetch

    const question = { id: 'q1', type: 'free-response' as const, text: 'Explain.', order: 0 }
    const renderQuestion = (disabled: boolean) => React.createElement(QuestionView, {
      question,
      sessionId: 'session-1',
      studentId: 'student-1',
      activeQuestionRunRevision: 1,
      disabled,
      onSubmitted: (_questionId, answer) => submitted.push(answer),
    })
    const rendered = render(renderQuestion(false))
    fireEvent.change(rendered.getByLabelText(/your answer/i), { target: { value: 'Manual answer' } })
    fireEvent.click(rendered.getByRole('button', { name: /submit answer/i }))

    await waitFor(() => assert.equal(fetchCount, 1))
    await waitFor(() => assert.equal(rendered.getByRole('button').getAttribute('aria-busy'), 'true'))
    rendered.rerender(renderQuestion(true))
    assert.equal(fetchCount, 1)

    assert.ok(deferredFetch.resolve)
    deferredFetch.resolve({ ok: true, json: async () => ({ ok: true }) } as Response)
    await waitFor(() => assert.equal(submitted.length, 1))
    assert.equal(fetchCount, 1)
    rendered.unmount()
  } finally {
    ;(globalThis as { fetch?: typeof fetch }).fetch = previousFetch
    restoreDomEnvironment()
  }
})

void test('QuestionView ignores a stale REST submission after a new run starts', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const previousFetch = globalThis.fetch
  const { fireEvent, render, waitFor } = await import('@testing-library/react')

  try {
    const deferredFetch: { resolve: ((response: Response) => void) | null } = { resolve: null }
    const submitted: unknown[] = []
    ;(globalThis as { fetch?: typeof fetch }).fetch = (() => new Promise<Response>((resolve) => {
      deferredFetch.resolve = resolve
    })) as typeof fetch

    const question = { id: 'q1', type: 'free-response' as const, text: 'Explain.', order: 0 }
    const renderQuestion = (activeQuestionRunRevision: number) => React.createElement(QuestionView, {
      question,
      sessionId: 'session-1',
      studentId: 'student-1',
      activeQuestionRunRevision,
      onSubmitted: (_questionId, answer) => submitted.push(answer),
    })
    const rendered = render(renderQuestion(1))
    fireEvent.change(rendered.getByLabelText(/your answer/i), { target: { value: 'Earlier run answer' } })
    fireEvent.click(rendered.getByRole('button', { name: /submit answer/i }))
    await waitFor(() => assert.ok(deferredFetch.resolve))

    rendered.rerender(renderQuestion(2))
    deferredFetch.resolve?.({ ok: true, json: async () => ({ ok: true }) } as Response)
    await waitFor(() => assert.deepEqual(submitted, []))
    rendered.unmount()
  } finally {
    ;(globalThis as { fetch?: typeof fetch }).fetch = previousFetch
    restoreDomEnvironment()
  }
})

void test('QuestionView ignores a REST submission after its session identity changes', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const previousFetch = globalThis.fetch
  const { fireEvent, render, waitFor } = await import('@testing-library/react')

  try {
    const deferredFetch: { resolve: ((response: Response) => void) | null } = { resolve: null }
    const submitted: unknown[] = []
    ;(globalThis as { fetch?: typeof fetch }).fetch = (() => new Promise<Response>((resolve) => {
      deferredFetch.resolve = resolve
    })) as typeof fetch

    const question = { id: 'q1', type: 'free-response' as const, text: 'Explain.', order: 0 }
    const renderQuestion = (sessionId: string, studentId: string) => React.createElement(QuestionView, {
      question,
      sessionId,
      studentId,
      activeQuestionRunRevision: null,
      onSubmitted: (_questionId, answer) => submitted.push(answer),
    })
    const rendered = render(renderQuestion('session-1', 'student-1'))
    fireEvent.change(rendered.getByLabelText(/your answer/i), { target: { value: 'Earlier session answer' } })
    fireEvent.click(rendered.getByRole('button', { name: /submit answer/i }))
    await waitFor(() => assert.ok(deferredFetch.resolve))

    rendered.rerender(renderQuestion('session-2', 'student-2'))
    deferredFetch.resolve?.({ ok: true, json: async () => ({ ok: true }) } as Response)
    await waitFor(() => assert.deepEqual(submitted, []))
    rendered.unmount()
  } finally {
    ;(globalThis as { fetch?: typeof fetch }).fetch = previousFetch
    restoreDomEnvironment()
  }
})

void test('QuestionView preserves a student draft when a same-run session update contains an older answer', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { fireEvent, render, waitFor } = await import('@testing-library/react')

  try {
    const question = {
      id: 'q1',
      type: 'free-response' as const,
      text: 'Explain your reasoning.',
      order: 0,
    }
    const rendered = render(
      React.createElement(QuestionView, {
        question,
        sessionId: 'session-1',
        studentId: 'student-1',
        activeQuestionRunRevision: 2,
        initialAnswer: null,
      }),
    )

    const textarea = rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'New work that must remain' } })

    rendered.rerender(
      React.createElement(QuestionView, {
        question,
        sessionId: 'session-1',
        studentId: 'student-1',
        activeQuestionRunRevision: 2,
        initialAnswer: { type: 'free-response', text: 'Earlier run answer' },
      }),
    )

    await waitFor(() => {
      assert.equal(textarea.value, 'New work that must remain')
    })

    rendered.unmount()
  } finally {
    restoreDomEnvironment()
  }
})

void test('QuestionView syncs a same-run session answer when the local draft is unchanged', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { render, waitFor } = await import('@testing-library/react')

  try {
    const question = {
      id: 'q1',
      type: 'free-response' as const,
      text: 'Explain your reasoning.',
      order: 0,
    }
    const rendered = render(
      React.createElement(QuestionView, {
        question,
        sessionId: 'session-1',
        studentId: 'student-1',
        activeQuestionRunRevision: 2,
        initialAnswer: null,
      }),
    )

    rendered.rerender(
      React.createElement(QuestionView, {
        question,
        sessionId: 'session-1',
        studentId: 'student-1',
        activeQuestionRunRevision: 2,
        initialAnswer: { type: 'free-response', text: 'Submitted from another device' },
      }),
    )

    await waitFor(() => {
      assert.equal(
        (rendered.getByLabelText(/your answer/i) as HTMLTextAreaElement).value,
        'Submitted from another device',
      )
    })

    rendered.unmount()
  } finally {
    restoreDomEnvironment()
  }
})

void test('QuestionView shows only the stem for staged MCQs before choices are revealed', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { render } = await import('@testing-library/react')

  try {
    const rendered = render(
      React.createElement(QuestionView, {
        question: {
          id: 'q1',
          type: 'multiple-choice',
          text: 'This function creates a sequence of numbers.',
          order: 0,
          options: [],
          selectionMode: 'single',
          choicesRevealed: false,
        },
        sessionId: 'session-1',
        studentId: 'student-1',
      }),
    )

    assert.equal(rendered.getByText('This function creates a sequence of numbers.').textContent, 'This function creates a sequence of numbers.')
    assert.equal(rendered.queryByRole('radio'), null)
    assert.equal(rendered.queryByRole('button', { name: /submit/i }), null)

    rendered.unmount()
  } finally {
    restoreDomEnvironment()
  }
})
