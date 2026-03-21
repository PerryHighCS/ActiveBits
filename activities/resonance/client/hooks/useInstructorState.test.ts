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
