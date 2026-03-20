import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getMcqSelectionTone,
  mergeDisplayOrder,
  moveResponseIdToEnd,
  reorderResponseIds,
} from './ResponseViewer.js'

void test('reorderResponseIds moves the dragged response to the target position', () => {
  assert.deepEqual(
    reorderResponseIds(['r1', 'r2', 'r3'], 'r3', 'r1'),
    ['r3', 'r1', 'r2'],
  )

  assert.deepEqual(
    reorderResponseIds(['r1', 'r2', 'r3'], 'r1', 'r3'),
    ['r2', 'r3', 'r1'],
  )
})

void test('reorderResponseIds leaves the order unchanged for no-op or invalid drags', () => {
  assert.deepEqual(
    reorderResponseIds(['r1', 'r2', 'r3'], 'r2', 'r2'),
    ['r1', 'r2', 'r3'],
  )

  assert.deepEqual(
    reorderResponseIds(['r1', 'r2', 'r3'], 'missing', 'r2'),
    ['r1', 'r2', 'r3'],
  )
})

void test('moveResponseIdToEnd moves a dragged response to the last slot', () => {
  assert.deepEqual(
    moveResponseIdToEnd(['r1', 'r2', 'r3'], 'r1'),
    ['r2', 'r3', 'r1'],
  )

  assert.deepEqual(
    moveResponseIdToEnd(['r1', 'r2', 'r3'], 'r3'),
    ['r1', 'r2', 'r3'],
  )
})

void test('mergeDisplayOrder preserves local order for existing items and appends new ones', () => {
  assert.deepEqual(
    mergeDisplayOrder(['draft:s1:q1', 'r2', 'r1'], ['r1', 'r2', 'draft:s1:q1', 'draft:s2:q1']),
    ['draft:s1:q1', 'r2', 'r1', 'draft:s2:q1'],
  )

  assert.deepEqual(
    mergeDisplayOrder(['r2', 'missing', 'r1'], ['r1', 'r2']),
    ['r2', 'r1'],
  )
})

void test('reorder helpers tolerate unexpected runtime shapes upstream', () => {
  assert.deepEqual(
    mergeDisplayOrder([], ['r1']),
    ['r1'],
  )
})

void test('getMcqSelectionTone uses green for correct answers and red for incorrect answers', () => {
  assert.deepEqual(
    getMcqSelectionTone({ isPoll: false, isCorrect: true, isIncorrect: false }),
    {
      cellClassName: 'bg-green-50',
      dotClassName: 'bg-green-600',
    },
  )

  assert.deepEqual(
    getMcqSelectionTone({ isPoll: false, isCorrect: false, isIncorrect: true }),
    {
      cellClassName: 'bg-red-50',
      dotClassName: 'bg-red-500',
    },
  )

  assert.deepEqual(
    getMcqSelectionTone({ isPoll: true, isCorrect: false, isIncorrect: false }),
    {
      cellClassName: 'bg-sky-50',
      dotClassName: 'bg-sky-500',
    },
  )
})
