import { factorial } from './mathHelpers'
import { calculateTotalDistance } from './distanceCalculator'
import type { BruteForceOptions, BruteForceResult, City, DistanceMatrix } from './tspUtilsTypes'

/**
 * Solve TSP using brute force (exhaustive search)
 */
export async function solveTSPBruteForce(
  cities: City[],
  distanceMatrix: DistanceMatrix,
  options: BruteForceOptions = {},
): Promise<BruteForceResult> {
  const n = cities.length
  const { onProgress, shouldCancel, progressEvery = 5000, yieldEvery = 5000, startIndex = 0 } = options

  if (n <= 1) {
    return {
      route: cities.map((city) => city.id),
      distance: 0,
      checked: 0,
      totalChecks: 0,
      cancelled: false,
    }
  }

  const normalizedStart = Math.max(0, Math.min(n - 1, startIndex))
  const totalChecks = factorial(n - 1)

  let bestRoute: string[] | null = null
  let bestDistance = Infinity
  let checked = 0
  let cancelled = false

  const maybeReportProgress = (): void => {
    if (onProgress && (checked % progressEvery === 0 || checked === totalChecks)) {
      onProgress(checked, totalChecks)
    }
  }

  const maybeYield = async (): Promise<void> => {
    if (checked % yieldEvery === 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
    }
  }

  const used: boolean[] = Array(n).fill(false)
  const current: number[] = []
  used[normalizedStart] = true

  const backtrack = async (): Promise<void> => {
    if (shouldCancel && shouldCancel()) {
      cancelled = true
      return
    }

    if (current.length === n - 1) {
      const route = [normalizedStart, ...current]
      const distance = calculateTotalDistance(route, distanceMatrix)
      checked += 1

      if (distance < bestDistance) {
        bestDistance = distance
        bestRoute = route.map((index) => `city-${index}`)
      }

      maybeReportProgress()
      await maybeYield()
      return
    }

    for (let i = 0; i < n; i++) {
      if (i === normalizedStart) continue
      if (cancelled) return
      if (used[i]) continue
      used[i] = true
      current.push(i)
      await backtrack()
      current.pop()
      used[i] = false
      if (cancelled) return
    }
  }

  if (onProgress) onProgress(0, totalChecks)
  await backtrack()
  if (onProgress) onProgress(checked, totalChecks)

  return {
    route: bestRoute,
    distance: bestDistance,
    checked,
    totalChecks,
    cancelled,
  }
}
