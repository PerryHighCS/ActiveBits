/**
 * Calculate Euclidean distance between two cities
 * @param {object} city1 - First city with x, y coordinates
 * @param {object} city2 - Second city with x, y coordinates
 * @returns {number} Euclidean distance between cities
 */
export function calculateDistance(city1, city2) {
  const dx = city2.x - city1.x;
  const dy = city2.y - city1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Build distance matrix for all cities
 * Matrix[i][j] = distance from city i to city j
 * @param {Array} cities - Array of city objects with x, y coordinates
 * @returns {Array} 2D array of distances
 */
export function buildDistanceMatrix(cities) {
  const n = cities.length;
  const matrix = Array(n).fill(null).map(() => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j) {
        matrix[i][j] = calculateDistance(cities[i], cities[j]);
      }
    }
  }

  return matrix;
}

/**
 * Calculate total distance for a route
 * Includes return to starting city
 * @param {Array} route - Array of city IDs in visit order (e.g., ['city-0', 'city-2', 'city-1'])
 * @param {Array} distanceMatrix - Distance matrix
 * @returns {number} Total route distance
 */
export function calculateRouteDistance(route, distanceMatrix) {
  if (!route || route.length === 0) return 0;

  let total = 0;
  for (let i = 0; i < route.length; i++) {
    const from = parseInt(route[i].split('-')[1], 10);
    const to = parseInt(route[(i + 1) % route.length].split('-')[1], 10);
    total += distanceMatrix?.[from]?.[to] || 0;
  }

  return total;
}

/**
 * Calculate distance for the current (non-complete) route
 * Does not include return to start city
 * @param {Array} route - Array of city IDs in visit order
 * @param {Array} distanceMatrix - Distance matrix
 * @returns {number} Current route distance
 */
export function calculateCurrentDistance(route, distanceMatrix) {
  if (!route || route.length <= 1) return 0;
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const from = parseInt(route[i].split('-')[1], 10);
    const to = parseInt(route[i + 1].split('-')[1], 10);
    total += distanceMatrix?.[from]?.[to] || 0;
  }
  return total;
}

/**
 * Calculate total distance for a route of city indices
 * Includes return to starting city
 * @param {Array} route - Array of city indices
 * @param {Array} distanceMatrix - Distance matrix
 * @returns {number} Total route distance
 */
export function calculateTotalDistance(route, distanceMatrix) {
  if (!route || route.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < route.length; i++) {
    const fromRaw = route[i];
    const toRaw = route[(i + 1) % route.length];
    const from = typeof fromRaw === 'string' ? parseInt(fromRaw.split('-')[1], 10) : fromRaw;
    const to = typeof toRaw === 'string' ? parseInt(toRaw.split('-')[1], 10) : toRaw;
    total += distanceMatrix?.[from]?.[to] || 0;
  }
  return total;
}
