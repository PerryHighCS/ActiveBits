import type { City, DistanceMatrix, MixedRoute, RouteStep } from './tspUtilsTypes'

function routeStepToIndex(step: RouteStep): number | null {
  if (typeof step === 'number') {
    return Number.isFinite(step) ? step : null
  }

  const idPart = step.includes('-') ? step.split('-')[1] ?? '' : step
  const index = Number.parseInt(idPart, 10)
  return Number.isFinite(index) ? index : null
}

/**
 * Calculate Euclidean distance between two cities
 */
export function calculateDistance(city1: City, city2: City): number {
  const dx = city2.x - city1.x
  const dy = city2.y - city1.y
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Build distance matrix for all cities
 * Matrix[i][j] = distance from city i to city j
 */
export function buildDistanceMatrix(cities: City[]): DistanceMatrix {
  const n = cities.length
  const matrix: DistanceMatrix = Array.from({ length: n }, () => Array(n).fill(0))

  for (let i = 0; i < n; i++) {
    const from = cities[i]
    if (!from) continue

    for (let j = 0; j < n; j++) {
      if (i !== j) {
        const to = cities[j]
        if (!to) continue
        matrix[i]![j] = calculateDistance(from, to)
      }
    }
  }

  return matrix
}

/**
 * Calculate total distance for a route
 * Includes return to starting city
 */
export function calculateRouteDistance(route: MixedRoute, distanceMatrix: DistanceMatrix): number {
  if (!route || route.length === 0) return 0

  let total = 0
  for (let i = 0; i < route.length; i++) {
    const from = routeStepToIndex(route[i] as RouteStep)
    const to = routeStepToIndex(route[(i + 1) % route.length] as RouteStep)
    if (from == null || to == null) continue
    const value = distanceMatrix[from]?.[to]
    total += typeof value === 'number' ? value : 0
  }

  return total
}

/**
 * Calculate distance for the current (non-complete) route
 * Does not include return to start city
 */
export function calculateCurrentDistance(route: MixedRoute, distanceMatrix: DistanceMatrix): number {
  if (!route || route.length <= 1) return 0
  let total = 0
  for (let i = 0; i < route.length - 1; i++) {
    const from = routeStepToIndex(route[i] as RouteStep)
    const to = routeStepToIndex(route[i + 1] as RouteStep)
    if (from == null || to == null) continue
    const value = distanceMatrix[from]?.[to]
    total += typeof value === 'number' ? value : 0
  }
  return total
}

/**
 * Check if a route includes all cities.
 */
export function isRouteComplete(route: unknown, cityCount: number): boolean {
  if (!Array.isArray(route) || !Number.isFinite(cityCount)) return false
  return route.length === cityCount && cityCount > 0
}

/**
 * Wrapper to compute either current or total route distance.
 */
export function getRouteDistance(route: MixedRoute, distanceMatrix: DistanceMatrix, closeLoop = false): number {
  if (closeLoop) {
    return calculateTotalDistance(route, distanceMatrix)
  }
  return calculateCurrentDistance(route, distanceMatrix)
}

/**
 * Calculate total distance for a route of city indices
 * Includes return to starting city
 */
export function calculateTotalDistance(route: MixedRoute, distanceMatrix: DistanceMatrix): number {
  if (!route || route.length === 0) return 0
  let total = 0
  for (let i = 0; i < route.length; i++) {
    const from = routeStepToIndex(route[i] as RouteStep)
    const to = routeStepToIndex(route[(i + 1) % route.length] as RouteStep)
    if (from == null || to == null) continue
    const value = distanceMatrix[from]?.[to]
    total += typeof value === 'number' ? value : 0
  }
  return total
}
