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
  // Note: factorial grows fast and will exceed Number.MAX_SAFE_INTEGER for n >= 18.
  // Current max city count keeps (n - 1)! within safe integer range.
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
 * @param {object} options - { onProgress, shouldCancel, progressEvery, yieldEvery, startIndex }
 * @returns {object} { route: ['city-0', ...], distance: number, checked: number, totalChecks: number, cancelled: boolean }
 */
export async function solveTSPBruteForce(cities, distanceMatrix, options = {}) {
  const n = cities.length;
  const {
    onProgress,
    shouldCancel,
    progressEvery = 5000,
    yieldEvery = 5000,
    startIndex = 0
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

  const normalizedStart = Math.max(0, Math.min(n - 1, startIndex));
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
  used[normalizedStart] = true;

  const backtrack = async () => {
    if (shouldCancel && shouldCancel()) {
      cancelled = true;
      return;
    }

    if (current.length === n - 1) {
      const route = [normalizedStart, ...current];
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

    for (let i = 0; i < n; i++) {
      if (i === normalizedStart) continue;
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
