import { solveTSPBruteForce } from './bruteForce'
import { solveTSPNearestNeighbor } from './nearestNeighbor'
import type {
  BruteForceOptions,
  City,
  DistanceMatrix,
  HeuristicOptions,
  TimedBruteForceResult,
  TimedHeuristicResult,
} from './tspUtilsTypes'

interface BruteForceRunOptions extends BruteForceOptions {
  cities: City[]
  distanceMatrix: DistanceMatrix
}

interface HeuristicRunOptions extends HeuristicOptions {
  cities: City[]
  distanceMatrix: DistanceMatrix
}

export async function runBruteForce({
  cities,
  distanceMatrix,
  startIndex = 0,
  onProgress,
  shouldCancel,
}: BruteForceRunOptions): Promise<TimedBruteForceResult> {
  const start = performance.now()
  const result = await solveTSPBruteForce(cities, distanceMatrix, {
    startIndex,
    onProgress,
    shouldCancel,
  })
  const end = performance.now()
  const computeTime = result.cancelled ? null : Number(((end - start) / 1000).toFixed(3))
  return { ...result, computeTime }
}

export function runHeuristic({ cities, distanceMatrix, startIndex = 0 }: HeuristicRunOptions): TimedHeuristicResult {
  const start = performance.now()
  const result = solveTSPNearestNeighbor(cities, distanceMatrix, { startIndex })
  const end = performance.now()
  const computeTime = Number(((end - start) / 1000).toFixed(3))
  return { ...result, computeTime }
}
