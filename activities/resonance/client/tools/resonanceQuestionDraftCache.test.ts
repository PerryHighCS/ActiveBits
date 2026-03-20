import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import type { Question } from '../../shared/types.js'
import { cacheResonanceQuestionDraft, loadResonanceQuestionDraft } from './resonanceQuestionDraftCache.js'

function installDomEnvironment() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://activebits.local/',
  })

  const previousWindow = globalThis.window
  const previousDocument = globalThis.document

  ;(globalThis as { window?: Window & typeof globalThis }).window = dom.window as unknown as Window & typeof globalThis
  ;(globalThis as { document?: Document }).document = dom.window.document

  return () => {
    dom.window.close()
    ;(globalThis as { window?: Window & typeof globalThis }).window = previousWindow
    ;(globalThis as { document?: Document }).document = previousDocument
  }
}

const SAMPLE_QUESTIONS: Question[] = [
  {
    id: 'q1',
    type: 'free-response',
    text: 'Explain your answer.',
    order: 0,
  },
  {
    id: 'q2',
    type: 'multiple-choice',
    text: 'Pick one',
    order: 1,
    options: [
      { id: 'q2_a', text: 'A', isCorrect: true },
      { id: 'q2_b', text: 'B' },
    ],
  },
]

void test('question draft cache round-trips valid questions by hash', () => {
  const restoreDomEnvironment = installDomEnvironment()

  try {
    cacheResonanceQuestionDraft('hash123', SAMPLE_QUESTIONS)
    const loaded = loadResonanceQuestionDraft('hash123')
    assert.deepEqual(loaded, SAMPLE_QUESTIONS)
  } finally {
    restoreDomEnvironment()
  }
})

void test('question draft cache clears malformed payloads', () => {
  const restoreDomEnvironment = installDomEnvironment()

  try {
    window.localStorage.setItem('resonance-question-draft:hash-bad', '{not-json')

    const loaded = loadResonanceQuestionDraft('hash-bad')
    assert.equal(loaded, null)
    assert.equal(window.localStorage.getItem('resonance-question-draft:hash-bad'), null)
  } finally {
    restoreDomEnvironment()
  }
})

void test('question draft cache ignores invalid question sets', () => {
  const restoreDomEnvironment = installDomEnvironment()

  try {
    cacheResonanceQuestionDraft('hash-invalid', [
      {
        id: 'q1',
        type: 'free-response',
        text: 'First',
        order: 0,
      },
      {
        id: 'q1',
        type: 'free-response',
        text: 'Duplicate id',
        order: 1,
      },
    ] as Question[])

    const loaded = loadResonanceQuestionDraft('hash-invalid')
    assert.equal(loaded, null)
  } finally {
    restoreDomEnvironment()
  }
})
