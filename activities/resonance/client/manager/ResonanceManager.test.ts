import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeActivationSelection,
  toggleQuestionActivationSelection,
} from './ResonanceManager.js'

void test('toggleQuestionActivationSelection adds and removes question ids', () => {
  assert.deepEqual(toggleQuestionActivationSelection(['q1'], 'q2'), ['q1', 'q2'])
  assert.deepEqual(toggleQuestionActivationSelection(['q1', 'q2'], 'q1'), ['q2'])
})

void test('normalizeActivationSelection keeps valid selection and falls back to live questions or first question', () => {
  assert.deepEqual(
    normalizeActivationSelection(['q2'], ['q1', 'q2', 'q3'], ['q1', 'q3']),
    ['q2'],
  )
  assert.deepEqual(
    normalizeActivationSelection(['missing'], ['q1', 'q2', 'q3'], ['q1', 'q3']),
    ['q1', 'q3'],
  )
  assert.deepEqual(
    normalizeActivationSelection([], ['q1', 'q2', 'q3'], []),
    ['q1'],
  )
  assert.deepEqual(
    normalizeActivationSelection([], [], []),
    [],
  )
})
