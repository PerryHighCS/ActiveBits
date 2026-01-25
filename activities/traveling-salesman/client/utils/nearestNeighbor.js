import { calculateTotalDistance } from './distanceCalculator.js';

/**
 * Solve TSP using nearest neighbor heuristic
 * Greedy algorithm: always visit nearest unvisited city
 * @param {Array} cities - Array of city objects
 * @param {Array} distanceMatrix - Pre-computed distance matrix
 * @param {object} options - { startIndex }
 * @returns {object} { route: ['city-0', 'city-2', ...], distance: number }
 */
export function solveTSPNearestNeighbor(cities, distanceMatrix, options = {}) {
  const n = cities.length;
  const { startIndex = 0 } = options;

  if (n <= 1) {
    return {
      route: cities.map(c => c.id),
      distance: 0
    };
  }

  const unvisited = new Set(Array.from({ length: n }, (_, i) => i));
  const route = [];

  let current = Math.max(0, Math.min(n - 1, startIndex));  // Start from selected city
  route.push(current);
  unvisited.delete(current);

  // Greedily select nearest unvisited city
  while (unvisited.size > 0) {
    let nearest = null;
    let minDist = Infinity;

    for (const city of unvisited) {
      const dist = distanceMatrix[current][city];
      if (dist < minDist) {
        minDist = dist;
        nearest = city;
      }
    }

    route.push(nearest);
    unvisited.delete(nearest);
    current = nearest;
  }

  const distance = calculateTotalDistance(route, distanceMatrix);

  return {
    route: route.map(i => `city-${i}`),
    distance
  };
}
