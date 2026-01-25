/**
 * Calculate total distance for a route (including return to start)
 * @param {Array} route - Array of city indices
 * @param {Array} distanceMatrix - Distance matrix
 * @returns {number} Total route distance
 */
function calculateTotalDistance(route, distanceMatrix) {
  let total = 0;
  for (let i = 0; i < route.length; i++) {
    const from = route[i];
    const to = route[(i + 1) % route.length];
    total += distanceMatrix[from][to];
  }
  return total;
}

/**
 * Solve TSP using nearest neighbor heuristic
 * Greedy algorithm: always visit nearest unvisited city
 * @param {Array} cities - Array of city objects
 * @param {Array} distanceMatrix - Pre-computed distance matrix
 * @returns {object} { route: ['city-0', 'city-2', ...], distance: number }
 */
export function solveTSPNearestNeighbor(cities, distanceMatrix) {
  const n = cities.length;

  if (n <= 1) {
    return {
      route: cities.map(c => c.id),
      distance: 0
    };
  }

  const unvisited = new Set(Array.from({ length: n }, (_, i) => i));
  const route = [];

  let current = 0;  // Start from city 0
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
