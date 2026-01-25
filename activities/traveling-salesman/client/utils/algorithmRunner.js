import { solveTSPBruteForce } from './bruteForce.js';
import { solveTSPNearestNeighbor } from './nearestNeighbor.js';

export async function runBruteForce({
  cities,
  distanceMatrix,
  startIndex = 0,
  onProgress,
  shouldCancel
}) {
  const start = performance.now();
  const result = await solveTSPBruteForce(cities, distanceMatrix, {
    startIndex,
    onProgress,
    shouldCancel
  });
  const end = performance.now();
  const computeTime = result.cancelled
    ? null
    : Number(((end - start) / 1000).toFixed(3));
  return { ...result, computeTime };
}

export function runHeuristic({
  cities,
  distanceMatrix,
  startIndex = 0
}) {
  const start = performance.now();
  const result = solveTSPNearestNeighbor(cities, distanceMatrix, { startIndex });
  const end = performance.now();
  const computeTime = Number(((end - start) / 1000).toFixed(3));
  return { ...result, computeTime };
}

