import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isQuestionStemVisuallyTruncated,
  normalizeActivationSelection,
  shouldShowQuestionPanelActions,
  toggleExpandedQuestionStem,
  toggleQuestionActivationSelection,
} from './ResonanceManager.js'

void test('toggleQuestionActivationSelection adds and removes question ids', () => {
  assert.deepEqual(toggleQuestionActivationSelection(['q1'], 'q2'), ['q1', 'q2'])
  assert.deepEqual(toggleQuestionActivationSelection(['q1', 'q2'], 'q1'), ['q2'])
})

void test('toggleExpandedQuestionStem adds and removes expanded question ids', () => {
  assert.deepEqual(toggleExpandedQuestionStem(['q1'], 'q2'), ['q1', 'q2'])
  assert.deepEqual(toggleExpandedQuestionStem(['q1', 'q2'], 'q1'), ['q2'])
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

void test('shouldShowQuestionPanelActions only keeps share controls on multiple-choice questions', () => {
  assert.equal(
    shouldShowQuestionPanelActions({
      id: 'q1',
      type: 'multiple-choice',
      text: 'Pick one',
      order: 0,
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
    }),
    true,
  )

  assert.equal(
    shouldShowQuestionPanelActions({
      id: 'q2',
      type: 'free-response',
      text: 'Explain why',
      order: 1,
    }),
    false,
  )
})

void test('isQuestionStemVisuallyTruncated uses rendered overflow rather than stem length', () => {
  assert.equal(
    isQuestionStemVisuallyTruncated({
      clientWidth: 120,
      scrollWidth: 160,
      clientHeight: 16,
      scrollHeight: 16,
    }),
    true,
  )
  assert.equal(
    isQuestionStemVisuallyTruncated({
      clientWidth: 120,
      scrollWidth: 120,
      clientHeight: 16,
      scrollHeight: 28,
    }),
    true,
  )
  assert.equal(
    isQuestionStemVisuallyTruncated({
      clientWidth: 120,
      scrollWidth: 120,
      clientHeight: 16,
      scrollHeight: 16,
    }),
    false,
  )
  assert.equal(isQuestionStemVisuallyTruncated(null), false)
})
