import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSoloDisplayedRoutes, sortRoutesByDistance } from './TSPStudent'

void test('sortRoutesByDistance sorts ascending with nulls last', () => {
  const routes = [
    { id: 'a', type: 'student', distance: 22 },
    { id: 'b', type: 'student', distance: null },
    { id: 'c', type: 'student', distance: 10 },
  ]

  const result = sortRoutesByDistance(routes)
  assert.deepEqual(result.map((route) => route.id), ['c', 'a', 'b'])
})

void test('buildSoloDisplayedRoutes returns only active solo algorithm route', () => {
  const soloAlgorithms = {
    bruteForce: {
      name: 'Brute Force (Optimal)',
      route: ['city-0', 'city-1'],
      distance: 20,
      checked: 1,
      totalChecks: 1,
      cancelled: false,
      computeTime: 0.1,
    },
    heuristic: {
      name: 'Nearest Neighbor',
      route: ['city-1', 'city-0'],
      distance: 30,
      computeTime: 0.01,
    },
  }

  const bruteForceView = buildSoloDisplayedRoutes(true, 'bruteforce', soloAlgorithms)
  const heuristicView = buildSoloDisplayedRoutes(true, 'heuristic', soloAlgorithms)
  const disabledView = buildSoloDisplayedRoutes(false, 'bruteforce', soloAlgorithms)

  assert.deepEqual(bruteForceView.map((route) => route.id), ['bruteforce'])
  assert.deepEqual(heuristicView.map((route) => route.id), ['heuristic'])
  assert.deepEqual(disabledView, [])
})
