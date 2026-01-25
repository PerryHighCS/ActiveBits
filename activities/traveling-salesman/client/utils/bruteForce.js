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

function factorial(n) {
  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }
  return result;
}

/**
 * Solve TSP using brute force (exhaustive search)
 * @param {Array} cities - Array of city objects
 * @param {Array} distanceMatrix - Pre-computed distance matrix
 * @param {object} options - { onProgress, shouldCancel, progressEvery, yieldEvery }
 * @returns {object} { route: ['city-0', ...], distance: number, checked: number, totalChecks: number, cancelled: boolean }
 */
export async function solveTSPBruteForce(cities, distanceMatrix, options = {}) {
  const n = cities.length;
  const {
    onProgress,
    shouldCancel,
    progressEvery = 5000,
    yieldEvery = 5000
  } = options;

  if (n <= 1) {
    return {
      route: cities.map(c => c.id),
      distance: 0,
      checked: 0,
      totalChecks: 0,
      cancelled: false
    };
  }

  const indices = Array.from({ length: n - 1 }, (_, i) => i + 1);
  const totalChecks = factorial(n - 1);

  let bestRoute = null;
  let bestDistance = Infinity;
  let checked = 0;
  let cancelled = false;

  const maybeReportProgress = () => {
    if (onProgress && (checked % progressEvery === 0 || checked === totalChecks)) {
      onProgress(checked, totalChecks);
    }
  };

  const maybeYield = async () => {
    if (checked % yieldEvery === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  };

  const used = Array(n).fill(false);
  const current = [];

  const backtrack = async () => {
    if (shouldCancel && shouldCancel()) {
      cancelled = true;
      return;
    }

    if (current.length === indices.length) {
      const route = [0, ...current];
      const distance = calculateTotalDistance(route, distanceMatrix);
      checked += 1;

      if (distance < bestDistance) {
        bestDistance = distance;
        bestRoute = route.map(i => `city-${i}`);
      }

      maybeReportProgress();
      await maybeYield();
      return;
    }

    for (let i = 1; i < n; i++) {
      if (cancelled) return;
      if (used[i]) continue;
      used[i] = true;
      current.push(i);
      await backtrack();
      current.pop();
      used[i] = false;
      if (cancelled) return;
    }
  };

  if (onProgress) onProgress(0, totalChecks);
  await backtrack();
  if (onProgress) onProgress(checked, totalChecks);

  return {
    route: bestRoute,
    distance: bestDistance,
    checked,
    totalChecks,
    cancelled
  };
}
