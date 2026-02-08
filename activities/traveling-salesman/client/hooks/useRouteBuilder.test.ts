import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveHydratedDistances } from './useRouteBuilder'

const matrix = [
  [0, 2, 3],
  [2, 0, 4],
  [3, 4, 0],
]

test('resolveHydratedDistances returns complete totals', () => {
  const result = resolveHydratedDistances(['city-0', 'city-1', 'city-2'], true, null, matrix)
  assert.equal(result.totalDistance, 9)
  assert.equal(result.currentDistance, 9)
})

test('resolveHydratedDistances returns in-progress distance when not complete', () => {
  const result = resolveHydratedDistances(['city-0', 'city-2'], false, null, matrix)
  assert.equal(result.totalDistance, 0)
  assert.equal(result.currentDistance, 3)
})
