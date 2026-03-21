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
