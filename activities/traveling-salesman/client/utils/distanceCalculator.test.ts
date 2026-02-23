import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateCurrentDistance, calculateTotalDistance } from './distanceCalculator'

void test('calculateCurrentDistance sums only consecutive legs', () => {
  const matrix = [
    [0, 2, 3],
    [2, 0, 4],
    [3, 4, 0],
  ]
  const route = ['city-0', 'city-1', 'city-2']
  assert.equal(calculateCurrentDistance(route, matrix), 2 + 4)
})

void test('calculateTotalDistance supports id routes and index routes', () => {
  const matrix = [
    [0, 2, 3],
    [2, 0, 4],
    [3, 4, 0],
  ]
  const idRoute = ['city-0', 'city-1', 'city-2']
  const indexRoute = [0, 1, 2]
  const expected = 2 + 4 + 3
  assert.equal(calculateTotalDistance(idRoute, matrix), expected)
  assert.equal(calculateTotalDistance(indexRoute, matrix), expected)
})
