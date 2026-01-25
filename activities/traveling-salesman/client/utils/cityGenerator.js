/**
 * Fantasy city names for the TSP map
 */
const CITY_NAMES = [
  'Dusty Gulch', 'Coyote Flats', 'Red Rock', 'Tumbleweed', 'Silver Spur',
  'Deadwood', 'Dry Creek', 'Broken Wheel', 'Copper Ridge', 'Buffalo Run',
  'Boot Hill', 'Prospector\'s Rest', 'Stagecoach Crossing', 'Saguaro Bend', 'Outlaw Pass',
  'Sundance', 'Cattle King', 'Prairie Rose', 'Mesa Vista', 'Lucky Horseshoe',
  'Blackwater', 'Rustler\'s Ridge', 'Gold Camp', 'Whiskey Bend', 'High Noon'
];

/**
 * Seeded pseudorandom number generator
 * Uses Mulberry32 algorithm
 * @param {number} seed - Initial seed value
 * @returns {function} Function that returns random numbers between 0 and 1
 */
export function seededRandom(seed) {
  // Mulberry32: fast, deterministic PRNG for visual use.
  let state = (seed || 0) >>> 0;
  return function() {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Shuffle array using Fisher-Yates algorithm with seeded random
 * @param {Array} array - Array to shuffle
 * @param {function} random - Seeded random function
 * @returns {Array} Shuffled array
 */
function shuffleArray(array, random) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Generate cities with fantasy names at random positions
 * @param {number} count - Number of cities to generate (4-12)
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @param {number} seed - Seed for random generation (ensures consistency)
 * @returns {Array} Array of city objects with id, x, y, name
 */
export function generateCities(count, width = 700, height = 500, seed = Date.now()) {
  if (count > CITY_NAMES.length) {
    throw new Error(`Cannot generate ${count} cities: only ${CITY_NAMES.length} names available.`);
  }
  // Use seeded random for consistency across clients
  const random = seededRandom(seed);

  // Shuffle and pick first N names
  const names = shuffleArray([...CITY_NAMES], random).slice(0, count);

  const cities = [];
  const padding = 60;
  const baseMinDistance = 80; // Minimum distance between cities

  // Generate positions with minimum spacing
  for (let i = 0; i < count; i++) {
    let x, y, valid;
    let attempts = 0;
    const maxAttempts = 100;
    let minDistance = baseMinDistance;

    do {
      x = padding + random() * (width - 2 * padding);
      y = padding + random() * (height - 2 * padding);

      // Check minimum distance from existing cities (avoid overlap)
      valid = cities.every(c => {
        const dx = c.x - x;
        const dy = c.y - y;
        return Math.sqrt(dx * dx + dy * dy) > minDistance;
      });

      attempts++;
      if (attempts === Math.floor(maxAttempts / 2)) {
        minDistance = Math.max(30, Math.round(baseMinDistance * 0.7));
      }
      if (attempts === Math.floor((maxAttempts * 3) / 4)) {
        minDistance = Math.max(20, Math.round(baseMinDistance * 0.5));
      }
    } while (!valid && attempts < maxAttempts);

    if (!valid) {
      console.warn('City placement relaxed: minimum distance constraint could not be met.', {
        seed,
        cityIndex: i,
        attempts,
        minDistance
      });
    }

    cities.push({
      id: `city-${i}`,
      x: Math.round(x),
      y: Math.round(y),
      name: names[i]
    });
  }

  return cities;
}
