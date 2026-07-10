import assert from 'node:assert/strict'
import test from 'node:test'
import { reorderPostIds } from './PostboardManager.js'

void test('reorderPostIds moves the dragged post to the target position', () => {
  assert.deepEqual(
    reorderPostIds(['p1', 'p2', 'p3'], 'p3', 'p1'),
    ['p3', 'p1', 'p2'],
  )

  assert.deepEqual(
    reorderPostIds(['p1', 'p2', 'p3'], 'p1', 'p3'),
    ['p2', 'p3', 'p1'],
  )
})

void test('reorderPostIds leaves the order unchanged for no-op or invalid drags', () => {
  assert.deepEqual(
    reorderPostIds(['p1', 'p2', 'p3'], 'p2', 'p2'),
    ['p1', 'p2', 'p3'],
  )

  assert.deepEqual(
    reorderPostIds(['p1', 'p2', 'p3'], 'missing', 'p2'),
    ['p1', 'p2', 'p3'],
  )

  assert.deepEqual(
    reorderPostIds(['p1', 'p2', 'p3'], 'p1', 'missing'),
    ['p1', 'p2', 'p3'],
  )
})
