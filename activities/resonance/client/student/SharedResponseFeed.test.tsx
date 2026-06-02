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

function getMcqOptionRow(container: HTMLElement, optionId: string): HTMLElement {
  const row = container.querySelector(`[data-option-id="${optionId}"]`)
  assert.notEqual(row, null, `Expected MCQ option row ${optionId}`)
  return row as HTMLElement
}

function getViewerResponseCard(labelElement: HTMLElement): HTMLElement {
  const card = labelElement.closest('div')
  assert.notEqual(card, null, 'Expected viewer response card')
  return card as HTMLElement
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
  selectionMode: 'single',
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
    answer: { type: 'multiple-choice', selectedOptionIds: ['a'] },
    submittedAt: 2,
    instructorEmoji: null,
    isShared: true,
  },
  sharedResponses: [
    {
      id: 'r2',
      questionId: 'q2',
      answer: { type: 'multiple-choice', selectedOptionIds: ['a'] },
      sharedAt: 2,
      instructorEmoji: null,
      reactions: {},
    },
    {
      id: 'r3',
      questionId: 'q2',
      answer: { type: 'multiple-choice', selectedOptionIds: ['b'] },
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
    answer: { type: 'multiple-choice', selectedOptionIds: ['a'] },
    submittedAt: 4,
    instructorEmoji: null,
    isShared: true,
  },
  sharedResponses: [
    {
      id: 'r4',
      questionId: 'q2',
      answer: { type: 'multiple-choice', selectedOptionIds: ['a'] },
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
    answer: { type: 'multiple-choice', selectedOptionIds: ['b'] },
    submittedAt: 5,
    instructorEmoji: null,
    isShared: true,
  },
  sharedResponses: [
    {
      id: 'r5',
      questionId: 'q2',
      answer: { type: 'multiple-choice', selectedOptionIds: ['b'] },
      sharedAt: 5,
      instructorEmoji: null,
      reactions: {},
    },
  ],
}

const selfPacedMcqReveal: QuestionReveal = {
  questionId: 'q2',
  sharedAt: 6,
  correctOptionIds: ['a'],
  viewerResponse: {
    answer: { type: 'multiple-choice', selectedOptionIds: ['b'] },
    submittedAt: 6,
    instructorEmoji: null,
    isShared: false,
  },
  sharedResponses: [],
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

    const selectedOptionRow = getMcqOptionRow(rendered.container, 'a')
    assert.match(selectedOptionRow.className, /grid grid-cols-\[minmax\(0,2fr\)_minmax\(0,3fr\)_auto\]/)
    assert.match(selectedOptionRow.className, /border-indigo-200/)
    assert.match(selectedOptionRow.className, /bg-indigo-50/)
    assert.match(selectedOptionRow.className, /ring-2/)
    assert.match(selectedOptionRow.className, /ring-indigo-400/)
    assert.match(selectedOptionRow.className, /ring-offset-2/)
    assert.match(selectedOptionRow.className, /ring-offset-white/)
    assert.equal(selectedOptionRow.textContent?.includes('Option A'), true)
    assert.equal(selectedOptionRow.textContent?.includes('50%'), true)
  } finally {
    restoreDomEnvironment()
  }
})

void test('SharedResponseFeed keeps released questions in authored question order instead of reverse reveal time', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { render } = await import('@testing-library/react')

  try {
    const laterFreeResponseReveal: QuestionReveal = {
      ...freeResponseReveal,
      sharedAt: 20,
    }
    const earlierMcqReveal: QuestionReveal = {
      ...mcqReveal,
      sharedAt: 10,
    }

    const rendered = render(
      React.createElement(SharedResponseFeed, {
        reveals: [laterFreeResponseReveal, earlierMcqReveal],
        revealedQuestions: [freeResponseQuestion, multipleChoiceQuestion],
      }),
    )

    const questionHeadings = Array.from(
      rendered.container.querySelectorAll('section[aria-label="Shared responses"] > div > p'),
    ).map((element) => element.textContent)

    assert.deepEqual(questionHeadings, [
      'What surprised you most?',
      'Choose one',
    ])
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
    const correctViewerLabel = correctRendered.getByText('Your response: Correct')
    const correctViewerCard = getViewerResponseCard(correctViewerLabel)
    assert.match(correctViewerCard.className, /border-emerald-300/)
    assert.match(correctViewerCard.className, /bg-emerald-50/)
    assert.equal(correctRendered.getAllByText('Option A').length, 2)
    const correctOptionRow = getMcqOptionRow(correctRendered.container, 'a')
    assert.match(correctOptionRow.className, /border-emerald-200/)
    assert.match(correctOptionRow.className, /bg-emerald-50/)
    assert.match(correctOptionRow.className, /ring-2/)
    assert.match(correctOptionRow.className, /ring-indigo-400/)
    assert.match(correctOptionRow.className, /ring-offset-2/)
    assert.match(correctOptionRow.className, /ring-offset-white/)
    assert.equal(correctOptionRow.textContent?.includes('100%'), true)
    const distractorRow = getMcqOptionRow(correctRendered.container, 'b')
    assert.match(distractorRow.className, /border-red-200/)
    assert.match(distractorRow.className, /bg-red-50\/70/)

    correctRendered.unmount()

    const incorrectRendered = render(
      React.createElement(SharedResponseFeed, {
        reveals: [incorrectMcqReveal],
        revealedQuestions: [multipleChoiceQuestion],
      }),
    )
    const incorrectViewerLabel = incorrectRendered.getByText('Your response: Incorrect')
    const incorrectViewerCard = getViewerResponseCard(incorrectViewerLabel)
    assert.match(incorrectViewerCard.className, /border-red-300/)
    assert.match(incorrectViewerCard.className, /bg-red-50/)
    assert.equal(incorrectRendered.getAllByText('Option B').length, 2)
    const incorrectOptionRow = getMcqOptionRow(incorrectRendered.container, 'b')
    assert.match(incorrectOptionRow.className, /border-red-200/)
    assert.match(incorrectOptionRow.className, /bg-red-50\/70/)
    assert.match(incorrectOptionRow.className, /ring-2/)
    assert.match(incorrectOptionRow.className, /ring-indigo-400/)
    assert.match(incorrectOptionRow.className, /ring-offset-2/)
    assert.match(incorrectOptionRow.className, /ring-offset-white/)
  } finally {
    restoreDomEnvironment()
  }
})

void test('SharedResponseFeed shows viewer-only MCQ results without empty percentage bars', async () => {
  const restoreDomEnvironment = installDomEnvironment()
  const { render } = await import('@testing-library/react')

  try {
    const rendered = render(
      React.createElement(SharedResponseFeed, {
        reveals: [selfPacedMcqReveal],
        revealedQuestions: [multipleChoiceQuestion],
      }),
    )

    assert.notEqual(rendered.getByText('Your response: Incorrect'), null)
    assert.notEqual(rendered.getByText('Correct'), null)
    assert.notEqual(rendered.getByText('Your choice'), null)
    assert.equal(rendered.queryByText('0%'), null)
    const correctOptionRow = getMcqOptionRow(rendered.container, 'a')
    assert.match(correctOptionRow.className, /border-emerald-200/)
    assert.match(correctOptionRow.className, /bg-emerald-50/)
    const selectedIncorrectOptionRow = getMcqOptionRow(rendered.container, 'b')
    assert.match(selectedIncorrectOptionRow.className, /border-red-200/)
    assert.match(selectedIncorrectOptionRow.className, /bg-red-50\/70/)
    assert.match(selectedIncorrectOptionRow.className, /ring-2/)
    assert.match(selectedIncorrectOptionRow.className, /ring-indigo-400/)
    assert.match(selectedIncorrectOptionRow.className, /ring-offset-2/)
    assert.match(selectedIncorrectOptionRow.className, /ring-offset-white/)
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
