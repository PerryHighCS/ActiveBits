import { calculateTotalDistance } from './distanceCalculator'
import type { City, DistanceMatrix, HeuristicOptions, HeuristicResult } from './tspUtilsTypes'

/**
 * Solve TSP using nearest neighbor heuristic
 * Greedy algorithm: always visit nearest unvisited city
 */
export function solveTSPNearestNeighbor(
  cities: City[],
  distanceMatrix: DistanceMatrix,
  options: HeuristicOptions = {},
): HeuristicResult {
  const n = cities.length
  const { startIndex = 0 } = options

  if (n <= 1) {
    return {
      route: cities.map((city) => city.id),
      distance: 0,
    }
  }

  const unvisited = new Set(Array.from({ length: n }, (_, index) => index))
  const route: number[] = []

  let current = Math.max(0, Math.min(n - 1, startIndex)) // Start from selected city
  route.push(current)
  unvisited.delete(current)

  // Greedily select nearest unvisited city
  while (unvisited.size > 0) {
    let nearest: number | null = null
    let minDist = Infinity

    for (const city of unvisited) {
      const dist = distanceMatrix[current]?.[city] ?? Infinity
      if (dist < minDist) {
        minDist = dist
        nearest = city
      }
    }

    if (nearest == null) {
      break
    }

    route.push(nearest)
    unvisited.delete(nearest)
    current = nearest
  }

  const distance = calculateTotalDistance(route, distanceMatrix)

  return {
    route: route.map((index) => `city-${index}`),
    distance,
  }
}
