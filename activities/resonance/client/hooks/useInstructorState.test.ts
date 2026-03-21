import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeInstructorStateSnapshot } from './useInstructorState.js'
import type { InstructorStateSnapshot } from './useInstructorState.js'

void test('normalizeInstructorStateSnapshot rejects array annotations and responseOrderOverrides', () => {
  const result = normalizeInstructorStateSnapshot(({
    sessionId: 'session-1',
    annotations: ['not', 'a', 'record'],
    responseOrderOverrides: ['also', 'not', 'a', 'record'],
  }) as unknown as Partial<InstructorStateSnapshot>)

  assert.ok(result)
  assert.deepEqual(result.annotations, {})
  assert.deepEqual(result.responseOrderOverrides, {})
})

void test('normalizeInstructorStateSnapshot preserves record annotations and responseOrderOverrides', () => {
  const result = normalizeInstructorStateSnapshot({
    sessionId: 'session-1',
    annotations: {
      responseA: {
        starred: true,
        flagged: false,
        emoji: null,
      },
    },
    responseOrderOverrides: {
      q1: ['responseA'],
    },
  })

  assert.ok(result)
  assert.deepEqual(result.annotations, {
    responseA: {
      starred: true,
      flagged: false,
      emoji: null,
    },
  })
  assert.deepEqual(result.responseOrderOverrides, {
    q1: ['responseA'],
  })
})

void test('normalizeInstructorStateSnapshot filters malformed responses and progress entries', () => {
  const result = normalizeInstructorStateSnapshot(({
    sessionId: 'session-1',
    responses: [
      null,
      {
        id: 'response-1',
        questionId: 'q1',
        studentId: 'student-1',
        studentName: 'Ada',
        submittedAt: 123,
        answer: { type: 'free-response', text: 'answer' },
      },
      {
        id: 'response-2',
        questionId: 'q2',
        studentId: 5,
        studentName: 'Broken',
        submittedAt: 456,
        answer: { type: 'free-response', text: 'bad' },
      },
    ],
    progress: [
      null,
      {
        questionId: 'q1',
        studentId: 'student-1',
        studentName: 'Ada',
        updatedAt: 999,
        status: 'submitted',
        answer: { type: 'free-response', text: 'stale duplicate' },
        responseId: 'response-1',
      },
      {
        questionId: 'q2',
        studentId: 'student-2',
        studentName: 'Grace',
        updatedAt: 1000,
        status: 'working',
        answer: null,
        responseId: null,
      },
      {
        questionId: 'q3',
        studentId: 'student-3',
        studentName: 'Invalid',
        updatedAt: 'later',
        status: 'working',
      },
    ],
  }) as unknown as Partial<InstructorStateSnapshot>)

  assert.ok(result)
  assert.deepEqual(result.responses.map((response) => response.id), ['response-1'])
  assert.deepEqual(
    result.progress.map((entry) => ({ questionId: entry.questionId, studentId: entry.studentId, status: entry.status })),
    [
      { questionId: 'q1', studentId: 'student-1', status: 'submitted' },
      { questionId: 'q2', studentId: 'student-2', status: 'working' },
    ],
  )
})

void test('normalizeInstructorStateSnapshot filters malformed reveal entries', () => {
  const result = normalizeInstructorStateSnapshot(({
    sessionId: 'session-1',
    reveals: [
      null,
      {
        questionId: 'q1',
        sharedAt: 123,
        correctOptionIds: ['a'],
        sharedResponses: [],
      },
      {
        questionId: 'q2',
        sharedAt: 'later',
        correctOptionIds: ['b'],
        sharedResponses: [],
      },
      {
        questionId: 'q3',
        sharedAt: 456,
        correctOptionIds: 5,
        sharedResponses: [],
      },
    ],
  }) as unknown as Partial<InstructorStateSnapshot>)

  assert.ok(result)
  assert.deepEqual(result.reveals.map((reveal) => reveal.questionId), ['q1'])
})
