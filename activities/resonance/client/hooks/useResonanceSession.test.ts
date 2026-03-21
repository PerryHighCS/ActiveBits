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
