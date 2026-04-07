import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeStudentSessionSnapshot } from './useResonanceSession.js'
import type { StudentSessionSnapshot } from '../../shared/types.js'

void test('normalizeStudentSessionSnapshot rejects array submittedAnswers payloads', () => {
  const result = normalizeStudentSessionSnapshot(({
    sessionId: 'session-1',
    submittedAnswers: ['not', 'a', 'record'],
  }) as unknown as Partial<StudentSessionSnapshot>)

  assert.ok(result)
  assert.deepEqual(result.submittedAnswers, {})
})

void test('normalizeStudentSessionSnapshot keeps object submittedAnswers payloads', () => {
  const result = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    submittedAnswers: {
      q1: {
        type: 'free-response',
        text: 'answer',
      },
    },
  })

  assert.ok(result)
  assert.deepEqual(result.submittedAnswers, {
    q1: {
      type: 'free-response',
      text: 'answer',
    },
  })
  assert.equal(result.selfPacedMode, false)
})

void test('normalizeStudentSessionSnapshot keeps selfPacedMode when provided', () => {
  const result = normalizeStudentSessionSnapshot({
    sessionId: 'session-1',
    selfPacedMode: true,
  })

  assert.ok(result)
  assert.equal(result.selfPacedMode, true)
})

void test('normalizeStudentSessionSnapshot filters malformed activeQuestions and revealedQuestions entries', () => {
  const result = normalizeStudentSessionSnapshot(({
    sessionId: 'session-1',
    activeQuestions: [
      null,
      { id: 'q1', type: 'free-response', text: 'Prompt', order: 0 },
      { id: 123, type: 'free-response', text: 'Bad', order: 1 },
    ],
    revealedQuestions: [
      { id: 'q2', type: 'multiple-choice', text: 'Pick one', order: 1, options: [{ id: 'a', text: 'A' }] },
      { id: 'q3', type: 'multiple-choice', text: 'Broken', order: 2, options: [null] },
    ],
  }) as unknown as Partial<StudentSessionSnapshot>)

  assert.ok(result)
  assert.deepEqual(result.activeQuestions.map((question) => question.id), ['q1'])
  assert.equal(result.activeQuestion?.id, 'q1')
  assert.deepEqual(result.activeQuestionIds, ['q1'])
  assert.deepEqual(result.revealedQuestions.map((question) => question.id), ['q2'])
  assert.equal(result.revealedQuestions[0]?.type, 'multiple-choice')
  assert.equal(result.revealedQuestions[0]?.type === 'multiple-choice' ? result.revealedQuestions[0].selectionMode : null, 'single')
})

void test('normalizeStudentSessionSnapshot ignores malformed fallback activeQuestion payloads', () => {
  const result = normalizeStudentSessionSnapshot(({
    sessionId: 'session-1',
    activeQuestion: { id: null, type: 'free-response', text: 'Prompt', order: 0 },
  }) as unknown as Partial<StudentSessionSnapshot>)

  assert.ok(result)
  assert.equal(result.activeQuestion, null)
  assert.deepEqual(result.activeQuestions, [])
  assert.deepEqual(result.activeQuestionIds, [])
})

void test('normalizeStudentSessionSnapshot filters malformed reveals and reviewedResponses entries', () => {
  const result = normalizeStudentSessionSnapshot(({
    sessionId: 'session-1',
    reveals: [
      {
        questionId: 'q1',
        sharedAt: 100,
        correctOptionIds: ['a'],
        sharedResponses: [
          {
            id: 'shared-1',
            questionId: 'q1',
            answer: { type: 'multiple-choice', selectedOptionIds: ['a'] },
            sharedAt: 100,
            instructorEmoji: null,
            reactions: {},
          },
        ],
      },
      {
        questionId: 'q2',
        sharedAt: 'later',
        correctOptionIds: ['b'],
        sharedResponses: [],
      },
    ],
    reviewedResponses: [
      {
        question: { id: 'q3', type: 'free-response', text: 'Prompt', order: 0 },
        answer: { type: 'free-response', text: 'answer' },
        submittedAt: 200,
        instructorEmoji: 'star',
      },
      {
        question: null,
        answer: { type: 'free-response', text: 'bad' },
        submittedAt: 300,
        instructorEmoji: 'star',
      },
    ],
  }) as unknown as Partial<StudentSessionSnapshot>)

  assert.ok(result)
  assert.deepEqual(result.reveals.map((reveal) => reveal.questionId), ['q1'])
  assert.deepEqual(result.reviewedResponses.map((response) => response.question.id), ['q3'])
})

void test('normalizeStudentSessionSnapshot keeps valid reveal viewerResponse payloads', () => {
  const result = normalizeStudentSessionSnapshot(({
    sessionId: 'session-1',
    reveals: [
      {
        questionId: 'q1',
        sharedAt: 100,
        correctOptionIds: ['a'],
        sharedResponses: [],
        viewerResponse: {
          answer: { type: 'multiple-choice', selectedOptionIds: ['a'] },
          submittedAt: 90,
          instructorEmoji: '🔥',
          isShared: true,
        },
      },
    ],
  }) as unknown as Partial<StudentSessionSnapshot>)

  assert.ok(result)
  assert.deepEqual(result.reveals[0]?.viewerResponse, {
    answer: { type: 'multiple-choice', selectedOptionIds: ['a'] },
    submittedAt: 90,
    instructorEmoji: '🔥',
    isShared: true,
  })
})

void test('normalizeStudentSessionSnapshot sanitizes shared response reactions', () => {
  const result = normalizeStudentSessionSnapshot(({
    sessionId: 'session-1',
    reveals: [
      {
        questionId: 'q1',
        sharedAt: 100,
        correctOptionIds: null,
        sharedResponses: [
          {
            id: 'shared-1',
            questionId: 'q1',
            answer: { type: 'free-response', text: 'answer' },
            sharedAt: 100,
            instructorEmoji: null,
            reactions: {
              '👍': 2,
              '🔥': 0,
              bogus: 5,
              '💡': Number.NaN,
              '😮': -1,
              '❤️': '3',
            },
          },
        ],
      },
    ],
  }) as unknown as Partial<StudentSessionSnapshot>)

  assert.ok(result)
  assert.deepEqual(result.reveals[0]?.sharedResponses[0]?.reactions, {
    '👍': 2,
    '🔥': 0,
  })
})

void test('normalizeStudentSessionSnapshot drops malformed reveal viewerResponse payloads', () => {
  const result = normalizeStudentSessionSnapshot(({
    sessionId: 'session-1',
    reveals: [
      {
        questionId: 'q1',
        sharedAt: 100,
        correctOptionIds: ['a'],
        sharedResponses: [],
        viewerResponse: {
          answer: { type: 'multiple-choice', selectedOptionIds: ['a'] },
          submittedAt: '90',
          instructorEmoji: '🔥',
          isShared: true,
        },
      },
    ],
  }) as unknown as Partial<StudentSessionSnapshot>)

  assert.ok(result)
  assert.deepEqual(result.reveals, [])
})
