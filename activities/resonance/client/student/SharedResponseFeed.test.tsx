import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { JSDOM } from 'jsdom'
import SharedResponseFeed from './SharedResponseFeed.js'
import type { QuestionReveal, ReviewedResponse, StudentQuestion } from '../../shared/types.js'

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

const freeResponseQuestion: StudentQuestion = {
  id: 'q1',
  type: 'free-response',
  text: 'What surprised you most?',
  order: 0,
  responseTimeLimitMs: 45_000,
}

const multipleChoiceQuestion: StudentQuestion = {
  id: 'q2',
  type: 'multiple-choice',
  text: 'Choose one',
  order: 1,
  responseTimeLimitMs: 30_000,
  options: [
    { id: 'a', text: 'Option A' },
    { id: 'b', text: 'Option B' },
  ],
}

const freeResponseReveal: QuestionReveal = {
  questionId: 'q1',
  sharedAt: 1,
  correctOptionIds: null,
  sharedResponses: [
    {
      id: 'r1',
      questionId: 'q1',
      answer: { type: 'free-response', text: 'I liked the analogy.' },
      sharedAt: 1,
      instructorEmoji: '💡',
      reactions: { '👍': 2 },
      viewerReaction: '👍',
    },
  ],
}

const mcqReveal: QuestionReveal = {
  questionId: 'q2',
  sharedAt: 2,
  correctOptionIds: [],
  viewerResponse: {
    answer: { type: 'multiple-choice', selectedOptionId: 'a' },
    submittedAt: 2,
    instructorEmoji: null,
    isShared: true,
  },
  sharedResponses: [
    {
      id: 'r2',
      questionId: 'q2',
      answer: { type: 'multiple-choice', selectedOptionId: 'a' },
      sharedAt: 2,
      instructorEmoji: null,
      reactions: {},
    },
    {
      id: 'r3',
      questionId: 'q2',
      answer: { type: 'multiple-choice', selectedOptionId: 'b' },
      sharedAt: 2,
      instructorEmoji: null,
      reactions: {},
    },
  ],
}

const reviewedResponses: ReviewedResponse[] = [
  {
    question: freeResponseQuestion,
    answer: { type: 'free-response', text: 'I revised my explanation.' },
    submittedAt: 3,
    instructorEmoji: '💡',
  },
]

const correctMcqReveal: QuestionReveal = {
  questionId: 'q2',
  sharedAt: 4,
  correctOptionIds: ['a'],
  viewerResponse: {
    answer: { type: 'multiple-choice', selectedOptionId: 'a' },
    submittedAt: 4,
    instructorEmoji: null,
    isShared: true,
  },
  sharedResponses: [
    {
      id: 'r4',
      questionId: 'q2',
      answer: { type: 'multiple-choice', selectedOptionId: 'a' },
      sharedAt: 4,
      instructorEmoji: null,
      reactions: {},
    },
  ],
}

const incorrectMcqReveal: QuestionReveal = {
  questionId: 'q2',
  sharedAt: 5,
  correctOptionIds: ['a'],
  viewerResponse: {
    answer: { type: 'multiple-choice', selectedOptionId: 'b' },
    submittedAt: 5,
    instructorEmoji: null,
    isShared: true,
  },
  sharedResponses: [
    {
      id: 'r5',
      questionId: 'q2',
      answer: { type: 'multiple-choice', selectedOptionId: 'b' },
      sharedAt: 5,
      instructorEmoji: null,
      reactions: {},
    },
  ],
}

void test('SharedResponseFeed lets students react to shared free-response cards', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { fireEvent, render } = await import('@testing-library/react')

  try {
    const reactions: Array<{ questionId: string; sharedResponseId: string; emoji: string }> = []
    const rendered = render(
      React.createElement(SharedResponseFeed, {
        reveals: [freeResponseReveal],
        revealedQuestions: [freeResponseQuestion],
        onReactToSharedResponse: (questionId: string, sharedResponseId: string, emoji: string) => {
          reactions.push({ questionId, sharedResponseId, emoji })
        },
      }),
    )

    const pickerButton = rendered.getByRole('button', { name: 'Choose reaction' })
    assert.equal(pickerButton.getAttribute('aria-expanded'), 'false')
    fireEvent.click(pickerButton)
    assert.equal(pickerButton.getAttribute('aria-expanded'), 'true')

    const reactButton = rendered.getByRole('option', { name: 'React with Agree' })
    fireEvent.click(reactButton)

    assert.deepEqual(reactions, [
      { questionId: 'q1', sharedResponseId: 'r1', emoji: '👍' },
    ])
    assert.notEqual(rendered.getByText('👍 2'), null)
    assert.equal(rendered.getByText('👍 2').tagName, 'SPAN')
    assert.equal(rendered.getByRole('button', { name: 'Choose reaction' }).textContent, '👍')
  } finally {
    restoreDomEnvironment()
  }
})

void test('SharedResponseFeed highlights the student-selected option in the shared multiple-choice percentage display', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { queryByRole, render } = await import('@testing-library/react')

  try {
    const rendered = render(
      React.createElement(SharedResponseFeed, {
        reveals: [mcqReveal],
        revealedQuestions: [multipleChoiceQuestion],
        onReactToSharedResponse: () => undefined,
      }),
    )

    assert.equal(queryByRole(document.body, 'button', { name: 'React with Agree' }), null)
    assert.equal(rendered.queryByText('This is the response currently being shared.'), null)
    assert.match(rendered.container.innerHTML, /border-blue-300 bg-blue-50 ring-2 ring-blue-400 ring-offset-2 ring-offset-white/)
    assert.match(rendered.container.innerHTML, /Option A/)
    assert.match(rendered.container.innerHTML, /50%/)
    assert.match(rendered.container.innerHTML, /grid grid-cols-\[minmax\(0,2fr\)_minmax\(0,3fr\)_auto\] items-center gap-2 rounded-lg border px-3 py-2 text-sm border-blue-300 bg-blue-50 ring-2 ring-blue-400 ring-offset-2 ring-offset-white/)
  } finally {
    restoreDomEnvironment()
  }
})

void test('SharedResponseFeed colors the student multiple-choice reveal green when correct and red when incorrect', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { render } = await import('@testing-library/react')

  try {
    const correctRendered = render(
      React.createElement(SharedResponseFeed, {
        reveals: [correctMcqReveal],
        revealedQuestions: [multipleChoiceQuestion],
      }),
    )
    assert.equal(correctRendered.queryByText('Your response was shared'), null)
    assert.notEqual(correctRendered.getByText('Your response: Correct'), null)
    assert.equal(correctRendered.getAllByText('Option A').length, 2)
    assert.match(correctRendered.container.innerHTML, /border-green-300 bg-green-50/)
    assert.match(correctRendered.container.innerHTML, /border-green-300 bg-green-50 ring-2 ring-blue-400 ring-offset-2 ring-offset-white/)
    assert.match(correctRendered.container.innerHTML, /border-red-200 bg-red-50\/70/)
    assert.match(correctRendered.container.innerHTML, /100%/)

    correctRendered.unmount()

    const incorrectRendered = render(
      React.createElement(SharedResponseFeed, {
        reveals: [incorrectMcqReveal],
        revealedQuestions: [multipleChoiceQuestion],
      }),
    )
    assert.notEqual(incorrectRendered.getByText('Your response: Incorrect'), null)
    assert.equal(incorrectRendered.getAllByText('Option B').length, 2)
    assert.match(incorrectRendered.container.innerHTML, /border-red-300 bg-red-50/)
    assert.match(incorrectRendered.container.innerHTML, /border-red-200 bg-red-50\/70 ring-2 ring-blue-400 ring-offset-2 ring-offset-white/)
  } finally {
    restoreDomEnvironment()
  }
})

void test('SharedResponseFeed renders private reviewed responses even when nothing is shared publicly', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { render } = await import('@testing-library/react')

  try {
    const rendered = render(
      React.createElement(SharedResponseFeed, {
        reveals: [],
        reviewedResponses,
        revealedQuestions: [],
      }),
    )

    assert.notEqual(rendered.getByText('What surprised you most?'), null)
    assert.notEqual(rendered.getByText('I revised my explanation.'), null)
  } finally {
    restoreDomEnvironment()
  }
})
