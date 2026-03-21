import assert from 'node:assert/strict'
import test from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ResonanceReportView, parseResonanceReport } from './ResonanceReport.js'
import type { ResonanceReport } from '../../shared/reportTypes.js'

// ---------------------------------------------------------------------------
// parseResonanceReport
// ---------------------------------------------------------------------------

const MINIMAL_VALID: unknown = {
  version: 1,
  sessionId: 'session-1',
  exportedAt: 1000000,
  students: [],
  questions: [],
}

const MINIMAL_QUESTION: unknown = {
  question: { id: 'q1', type: 'free-response', text: 'Q?', order: 0 },
  responses: [],
  reveal: null,
  annotations: {},
}

const MCQ_QUESTION: unknown = {
  question: {
    id: 'q2',
    type: 'multiple-choice',
    text: 'Pick one',
    order: 1,
    options: [{ id: 'a', text: 'A', isCorrect: true }, { id: 'b', text: 'B' }],
  },
  responses: [],
  reveal: null,
  annotations: {},
}

void test('parseResonanceReport accepts a minimal valid report', () => {
  assert.ok(parseResonanceReport(MINIMAL_VALID) !== null)
})

void test('parseResonanceReport accepts reports with questions', () => {
  const report = { ...(MINIMAL_VALID as object), questions: [MINIMAL_QUESTION, MCQ_QUESTION] }
  assert.ok(parseResonanceReport(report) !== null)
})

void test('parseResonanceReport rejects null and non-objects', () => {
  assert.equal(parseResonanceReport(null), null)
  assert.equal(parseResonanceReport(42), null)
  assert.equal(parseResonanceReport('{}'), null)
  assert.equal(parseResonanceReport([]), null)
})

void test('parseResonanceReport rejects wrong version', () => {
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), version: 2 }), null)
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), version: '1' }), null)
})

void test('parseResonanceReport rejects missing or empty sessionId', () => {
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), sessionId: '' }), null)
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), sessionId: '   ' }), null)
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), sessionId: 123 }), null)
})

void test('parseResonanceReport rejects non-number exportedAt', () => {
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), exportedAt: '2026-01-01' }), null)
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), exportedAt: null }), null)
})

void test('parseResonanceReport rejects missing students or questions arrays', () => {
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), students: null }), null)
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), questions: {} }), null)
})

void test('parseResonanceReport rejects a question entry that is not an object', () => {
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), questions: ['bad'] }), null)
})

void test('parseResonanceReport rejects a question with invalid type', () => {
  const bad = { ...((MINIMAL_QUESTION as Record<string, unknown>)), question: { id: 'q1', type: 'essay', text: 'Q?', order: 0 } }
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), questions: [bad] }), null)
})

void test('parseResonanceReport rejects a multiple-choice question with no options array', () => {
  const bad = { ...((MINIMAL_QUESTION as Record<string, unknown>)), question: { id: 'q1', type: 'multiple-choice', text: 'Q?', order: 0 } }
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), questions: [bad] }), null)
})

void test('parseResonanceReport rejects a multiple-choice question with malformed option entries', () => {
  const bad = {
    ...((MINIMAL_QUESTION as Record<string, unknown>)),
    question: {
      id: 'q1',
      type: 'multiple-choice',
      text: 'Q?',
      order: 0,
      options: [null, 1, { id: '', text: 'A' }, { id: 'b', text: '   ' }],
    },
  }
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), questions: [bad] }), null)
})

void test('parseResonanceReport rejects a multiple-choice question with non-boolean isCorrect', () => {
  const bad = {
    ...((MINIMAL_QUESTION as Record<string, unknown>)),
    question: {
      id: 'q1',
      type: 'multiple-choice',
      text: 'Q?',
      order: 0,
      options: [{ id: 'a', text: 'A', isCorrect: 'yes' }],
    },
  }
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), questions: [bad] }), null)
})

void test('parseResonanceReport rejects a question entry with non-array responses', () => {
  const bad = { ...((MINIMAL_QUESTION as Record<string, unknown>)), responses: null }
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), questions: [bad] }), null)
})

void test('parseResonanceReport rejects response entries that are not objects', () => {
  const bad = { ...((MINIMAL_QUESTION as Record<string, unknown>)), responses: ['bad'] }
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), questions: [bad] }), null)
})

void test('parseResonanceReport rejects response entries with malformed answer payloads', () => {
  const bad = {
    ...((MINIMAL_QUESTION as Record<string, unknown>)),
    responses: [{ id: 'r1', answer: { type: 'free-response' } }],
  }
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), questions: [bad] }), null)
})

void test('parseResonanceReport rejects response entries with unsupported answer type', () => {
  const bad = {
    ...((MINIMAL_QUESTION as Record<string, unknown>)),
    responses: [{ id: 'r1', answer: { type: 'essay', text: 'x' } }],
  }
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), questions: [bad] }), null)
})

void test('parseResonanceReport rejects a question entry with non-null non-object reveal', () => {
  const bad = { ...((MINIMAL_QUESTION as Record<string, unknown>)), reveal: 'yes' }
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), questions: [bad] }), null)
})

void test('parseResonanceReport rejects a reveal with non-array correctOptionIds', () => {
  const bad = {
    ...((MCQ_QUESTION as Record<string, unknown>)),
    reveal: {
      questionId: 'q2',
      sharedAt: 123456,
      correctOptionIds: 123,
      sharedResponses: [],
    },
  }
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), questions: [bad] }), null)
})

void test('parseResonanceReport rejects a reveal with non-string correctOptionIds entries', () => {
  const bad = {
    ...((MCQ_QUESTION as Record<string, unknown>)),
    reveal: {
      questionId: 'q2',
      sharedAt: 123456,
      correctOptionIds: ['a', 1],
      sharedResponses: [],
    },
  }
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), questions: [bad] }), null)
})

void test('parseResonanceReport rejects a reveal with non-array sharedResponses', () => {
  const bad = {
    ...((MCQ_QUESTION as Record<string, unknown>)),
    reveal: {
      questionId: 'q2',
      sharedAt: 123456,
      correctOptionIds: ['a'],
      sharedResponses: 'x',
    },
  }
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), questions: [bad] }), null)
})

void test('parseResonanceReport rejects a reveal with non-number sharedAt', () => {
  const bad = {
    ...((MCQ_QUESTION as Record<string, unknown>)),
    reveal: {
      questionId: 'q2',
      sharedAt: 'later',
      correctOptionIds: ['a'],
      sharedResponses: [],
    },
  }
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), questions: [bad] }), null)
})

void test('parseResonanceReport normalizes missing reveal to null', () => {
  const withoutReveal = {
    question: { id: 'q1', type: 'free-response', text: 'Q?', order: 0 },
    responses: [],
    annotations: {},
  }
  const parsed = parseResonanceReport({ ...(MINIMAL_VALID as object), questions: [withoutReveal] })
  assert.ok(parsed !== null)
  assert.equal(parsed.questions[0]?.reveal, null)
})

void test('parseResonanceReport rejects a question entry with non-object annotations', () => {
  const bad = { ...((MINIMAL_QUESTION as Record<string, unknown>)), annotations: [] }
  assert.equal(parseResonanceReport({ ...(MINIMAL_VALID as object), questions: [bad] }), null)
})

// ---------------------------------------------------------------------------
// ResonanceReportView rendering
// ---------------------------------------------------------------------------

void test('ResonanceReportView derives poll-vs-graded label from question options when reveal is null', () => {
  const report: ResonanceReport = {
    version: 1,
    sessionId: 'session-1',
    exportedAt: Date.now(),
    students: [],
    questions: [
      {
        question: {
          id: 'q1',
          type: 'multiple-choice',
          text: 'Graded question',
          order: 0,
          options: [
            { id: 'a', text: 'A', isCorrect: true },
            { id: 'b', text: 'B' },
          ],
        },
        responses: [],
        reveal: null,
        annotations: {},
      },
      {
        question: {
          id: 'q2',
          type: 'multiple-choice',
          text: 'Poll question',
          order: 1,
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
        },
        responses: [],
        reveal: null,
        annotations: {},
      },
    ],
  }

  const html = renderToStaticMarkup(React.createElement(ResonanceReportView, { report }))

  assert.match(html, /Multiple choice[\s\S]*Graded question/)
  assert.match(html, /Poll[\s\S]*Poll question/)
})

void test('ResonanceReportView only shows results shared indicator when reveal exists', () => {
  const report: ResonanceReport = {
    version: 1,
    sessionId: 'session-2',
    exportedAt: Date.now(),
    students: [],
    questions: [
      {
        question: {
          id: 'q1',
          type: 'multiple-choice',
          text: 'No reveal yet',
          order: 0,
          options: [
            { id: 'a', text: 'A', isCorrect: true },
            { id: 'b', text: 'B' },
          ],
        },
        responses: [],
        reveal: null,
        annotations: {},
      },
      {
        question: {
          id: 'q2',
          type: 'multiple-choice',
          text: 'Reveal shared',
          order: 1,
          options: [
            { id: 'a', text: 'A', isCorrect: true },
            { id: 'b', text: 'B' },
          ],
        },
        responses: [],
        reveal: {
          questionId: 'q2',
          sharedAt: Date.now(),
          correctOptionIds: ['a'],
          sharedResponses: [],
        },
        annotations: {},
      },
    ],
  }

  const html = renderToStaticMarkup(React.createElement(ResonanceReportView, { report }))

  assert.equal((html.match(/Results shared/g) ?? []).length, 1)
})
