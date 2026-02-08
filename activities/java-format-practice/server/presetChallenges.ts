/**
 * Enhanced Format Challenges with Creative Themes
 * 
 * Each challenge includes:
 * - title: Challenge name
 * - difficulty: 'beginner', 'intermediate', 'advanced'
 * - expectedOutput: Multi-line output from completing all format calls
 * - variables: Array of variable declarations
 * - scenario: Description and context
 * - formatCalls: Array of format string prompts to complete
 * - hints: Array of helpful hints
 * - gridWidth/gridHeight: Grid overlay dimensions
 */

export const formatChallenges = [
  // ============================================
  // BEGINNER CHALLENGES
  // ============================================
  {
    id: 'wanted-poster-beginner',
    title: 'Wanted Poster - Basic Info',
    difficulty: 'beginner',
    theme: 'wanted-poster',
    scenario: 'Create a wanted poster for a fictional criminal. Complete each line of the poster by choosing the right format specifier.',
    variables: [
      { name: 'name', type: 'String', value: '"The Bandit"' },
      { name: 'crime', type: 'String', value: '"Grand Theft"' },
      { name: 'reward', type: 'int', value: '5000' },
    ],
    formatCalls: [
      {
        method: 'printf',
        prompt: 'Print the title "WANTED" with a newline',
        skeleton: 'System.out.printf("%s%n", "WANTED");',
        answer: '%s%n, WANTED',
        explanation: '%s formats string values, %n adds newline',
      },
      {
        method: 'printf',
        prompt: 'Print the criminal name',
        skeleton: 'System.out.printf("Name: %s%n", name);',
        answer: 'Name: %s%n, name',
        explanation: 'Use %s for the name variable, %n adds newline',
      },
      {
        method: 'printf',
        prompt: 'Print the crime',
        skeleton: 'System.out.printf("Crime: %s%n", crime);',
        answer: 'Crime: %s%n, crime',
        explanation: 'Another string using %s, %n for newline',
      },
      {
        method: 'printf',
        prompt: 'Print the reward amount',
        skeleton: 'System.out.printf("Reward: $%d%n", reward);',
        answer: 'Reward: $%d%n, reward',
        explanation: '%d formats integers without decimals, %n for newline',
      },
    ],
    expectedOutput: 'WANTED\nName: The Bandit\nCrime: Grand Theft\nReward: $5000\n',
    hints: [
      'Use %d for integers (whole numbers)',
      'Use %s for strings (text)',
      'Use %n as the newline format specifier in printf strings',
    ],
    gridWidth: 30,
    gridHeight: 5,
  },

  // Beginner: Float formatting with prices
  {
    id: 'restaurant-menu-beginner',
    title: 'Restaurant Menu - Price Display',
    difficulty: 'beginner',
    theme: 'restaurant-menu',
    scenario: 'Build a restaurant menu listing items and their prices. Each line of the menu is a separate format challenge.',
    variables: [
      { name: 'dish1', type: 'String', value: '"Spaghetti Carbonara"' },
      { name: 'price1', type: 'double', value: '12.99' },
      { name: 'dish2', type: 'String', value: '"Tiramisu"' },
      { name: 'price2', type: 'double', value: '6.50' },
    ],
    formatCalls: [
      {
        method: 'printf',
        prompt: 'Display first dish name',
        skeleton: 'System.out.printf("%s%n", dish1);',
        answer: '%s%n, dish1',
        explanation: '%s formats string values, %n adds newline',
      },
      {
        method: 'printf',
        prompt: 'Display first price with 2 decimal places',
        skeleton: 'System.out.printf("Price: $%.2f%n", price1);',
        answer: 'Price: $%.2f%n, price1',
        explanation: '%.2f formats decimals with exactly 2 places, %n for newline',
      },
      {
        method: 'printf',
        prompt: 'Display second dish name',
        skeleton: 'System.out.printf("%s%n", dish2);',
        answer: '%s%n, dish2',
        explanation: 'Use %s for another string, %n for newline',
      },
      {
        method: 'printf',
        prompt: 'Display second price',
        skeleton: 'System.out.printf("Price: $%.2f%n", price2);',
        answer: 'Price: $%.2f%n, price2',
        explanation: 'Same format for consistency, %n for newline',
      },
    ],
    expectedOutput: 'Spaghetti Carbonara\nPrice: $12.99\nTiramisu\nPrice: $6.50\n',
    hints: [
      'Use %.2f to display money with 2 decimal places',
      'The number after the dot controls decimal precision',
      'Use %n as the newline format specifier to separate lines',
    ],
    gridWidth: 30,
    gridHeight: 5,
  },

  // Beginner: Percentage display
  {
    id: 'diagnostic-panel-beginner',
    title: 'System Diagnostic - Status Display',
    difficulty: 'beginner',
    theme: 'diagnostic-panel',
    scenario: 'Create a system diagnostic display showing various statuses and percentages. Each line is a separate format call.',
    variables: [
      { name: 'progress', type: 'int', value: '85' },
      { name: 'status', type: 'String', value: '"INITIALIZING"' },
    ],
    formatCalls: [
      {
        method: 'printf',
        prompt: 'Display the system component name (constant)',
        skeleton: 'System.out.printf("System Boot%n");',
        answer: 'System Boot%n',
        explanation: 'No format specifiers needed for a constant string, %n adds newline',
      },
      {
        method: 'printf',
        prompt: 'Display progress as percentage',
        skeleton: 'System.out.printf("Progress: %d%%%n", progress);',
        answer: 'Progress: %d%%%n, progress',
        explanation: '%d formats integers, %% outputs literal percent sign, %n for newline',
      },
      {
        method: 'printf',
        prompt: 'Display status message from variable',
        skeleton: 'System.out.printf("Status: %s%n", status);',
        answer: 'Status: %s%n, status',
        explanation: 'Use %s for the status variable, %n for newline',
      },
    ],
    expectedOutput: 'System Boot\nProgress: 85%\nStatus: INITIALIZING\n',
    hints: [
      'Use %% to print a literal percent sign',
      'A single % starts a format specifier, so %% escapes it',
      'Use %n as the newline format specifier in printf',
    ],
    gridWidth: 30,
    gridHeight: 4,
  },

  // Intermediate: Complex multi-line hacker terminal
  {
    id: 'hacker-terminal-intermediate',
    title: 'Hacker Terminal - System Override',
    difficulty: 'intermediate',
    theme: 'hacker-terminal',
    scenario: 'Create a hacker terminal display simulating system override. Each line shows a different access attempt with field alignment.',
    variables: [
      { name: 'user', type: 'String', value: '"admin"' },
      { name: 'attempts', type: 'int', value: '3' },
      { name: 'accessLevel', type: 'int', value: '9' },
      { name: 'timestamp', type: 'double', value: '1621.847' },
    ],
    formatCalls: [
      {
        method: 'printf',
        prompt: 'Line 1: Display header with user name left-aligned',
        skeleton: 'System.out.printf("%-15s | Attempting access%n", user);',
        answer: '%-15s | Attempting access%n", user',
        explanation: '%-15s left-aligns string in 15 character field, %n for newline',
      },
      {
        method: 'printf',
        prompt: 'Line 2: Show failed attempts and access level right-aligned',
        skeleton: 'System.out.printf("Failed: %2d | Level: %2d%n", attempts, accessLevel);',
        answer: '%2d | Level: %2d%n", attempts, accessLevel',
        explanation: '%2d right-aligns integers in 2 character field, %n for newline',
      },
      {
        method: 'printf',
        prompt: 'Line 3: Display timestamp with 2 decimal precision',
        skeleton: 'System.out.printf("Timestamp: %.2f seconds%n", timestamp);',
        answer: '%.2f seconds%n", timestamp',
        explanation: '%.2f shows decimal numbers with 2 places, %n for newline',
      },
    ],
    expectedOutput: 'admin           | Attempting access\nFailed:  3 | Level:  9\nTimestamp: 1621.85 seconds\n',
    hints: [
      'Use %-20s to left-align strings',
      'Use %5d to right-align numbers in 5 character width',
      'Order of arguments must match order of format specifiers',
    ],
    gridWidth: 40,
    gridHeight: 4,
  },

  // Intermediate: String alignment with prices
  {
    id: 'restaurant-menu-intermediate',
    title: 'Restaurant Menu - Aligned Columns',
    difficulty: 'intermediate',
    theme: 'restaurant-menu',
    scenario: 'Create a restaurant menu with aligned columns for dish names and prices. Format creates clean columnar layout.',
    variables: [
      { name: 'item1', type: 'String', value: '"Lasagna"' },
      { name: 'price1', type: 'double', value: '14.99' },
      { name: 'item2', type: 'String', value: '"Risotto"' },
      { name: 'price2', type: 'double', value: '13.50' },
    ],
    formatCalls: [
      {
        method: 'format',
        prompt: 'Format menu row 1 with left-aligned dish name (20 chars) and price',
        skeleton: 'String row1 = String.format("%-20s $%6.2f", item1, price1);',
        answer: '%-20s $%6.2f", item1, price1',
        explanation: '%-20s left-aligns string in 20 character field, %6.2f right-aligns price',
      },
      {
        method: 'format',
        prompt: 'Format menu row 2 with same alignment',
        skeleton: 'String row2 = String.format("%-20s $%6.2f", item2, price2);',
        answer: '%-20s $%6.2f", item2, price2',
        explanation: 'Same format ensures columns align vertically',
      },
    ],
    expectedOutput: 'Lasagna              $  14.99\nRisotto              $  13.50\n',
    hints: [
      'Use %-20s to left-align text in a 20-character field',
      'Use %6.2f to right-align numbers with 6 total width and 2 decimals',
      'Consistent widths create clean columnar alignment',
    ],
    gridWidth: 35,
    gridHeight: 3,
  },

  // Intermediate: Right-aligned numerical columns
  {
    id: 'battle-display-intermediate',
    title: 'Battle Status Display - RPG Stats',
    difficulty: 'intermediate',
    theme: 'battle-display',
    scenario: 'Create an RPG battle status display with right-aligned stat columns. Each line shows different combatant stats.',
    variables: [
      { name: 'name1', type: 'String', value: '"Knight"' },
      { name: 'hp1', type: 'int', value: '85' },
      { name: 'damage1', type: 'int', value: '12' },
      { name: 'name2', type: 'String', value: '"Wizard"' },
      { name: 'hp2', type: 'int', value: '42' },
      { name: 'damage2', type: 'int', value: '18' },
    ],
    formatCalls: [
      {
        method: 'printf',
        prompt: 'Line 1: Display first combatant with right-aligned stats',
        skeleton: 'System.out.printf("%-10s HP: %3d  DMG: %3d%n", name1, hp1, damage1);',
        answer: '%-10s HP: %3d  DMG: %3d%n", name1, hp1, damage1',
        explanation: '%-10s left-aligns name, %3d right-aligns numbers, %n for newline',
      },
      {
        method: 'printf',
        prompt: 'Line 2: Display second combatant with same format',
        skeleton: 'System.out.printf("%-10s HP: %3d  DMG: %3d%n", name2, hp2, damage2);',
        answer: '%-10s HP: %3d  DMG: %3d%n", name2, hp2, damage2',
        explanation: 'Identical format ensures columns align, %n for newline',
      },
    ],
    expectedOutput: 'Knight     HP:  85  DMG:  12\nWizard     HP:  42  DMG:  18\n',
    hints: [
      'Use %3d to right-align numbers in 3-character field',
      'Numbers are right-aligned by default when you specify width',
      'Consistent formatting creates organized columnar data',
    ],
    gridWidth: 35,
    gridHeight: 3,
  },

  // Advanced: Professional wanted poster with thousands separator
  {
    id: 'wanted-poster-advanced',
    title: 'Professional Wanted Poster - Full Details',
    difficulty: 'advanced',
    theme: 'wanted-poster',
    scenario: 'Create a professional wanted poster with full details including reward with thousands separator and precise measurements.',
    variables: [
      { name: 'name', type: 'String', value: '"Dr. Devious"' },
      { name: 'height', type: 'double', value: '5.92' },
      { name: 'weight', type: 'int', value: '187' },
      { name: 'reward', type: 'int', value: '500000' },
      { name: 'successRate', type: 'double', value: '94.5' },
    ],
    formatCalls: [
      {
        method: 'printf',
        prompt: 'Line 1: Display "=== WANTED POSTER ===" header',
        skeleton: 'System.out.printf("%n=== WANTED POSTER ===%n");',
        answer: '%n=== WANTED POSTER ===%n',
        explanation: '%n is platform-independent newline (preferred over \\n)',
      },
      {
        method: 'printf',
        prompt: 'Line 2: Display criminal name and measurements',
        skeleton: 'System.out.printf("Name: %-20s Height: %.2f ft  Weight: %4d lbs%n", name, height, weight);',
        answer: '%-20s Height: %.2f ft  Weight: %4d lbs%n", name, height, weight',
        explanation: 'Combine left-aligned string with right-aligned numbers, %n for newline',
      },
      {
        method: 'printf',
        prompt: 'Line 3: Display reward with thousands separator',
        skeleton: 'System.out.printf("Reward: $%,d%n", reward);',
        answer: '$%,d%n", reward',
        explanation: '%,d adds thousands separators (500,000), %n for newline',
      },
      {
        method: 'printf',
        prompt: 'Line 4: Display success rate percentage with borders',
        skeleton: 'System.out.printf("Success Rate: %6.1f%%%n", successRate);',
        answer: '%6.1f%%%n", successRate',
        explanation: '%% escapes percent, %6.1f right-aligns decimal, %n for newline',
      },
    ],
    expectedOutput: '\n=== WANTED POSTER ===\nName: Dr. Devious        Height: 5.92 ft  Weight:  187 lbs\nReward: $500,000\nSuccess Rate:  94.5%\n',
    hints: [
      'Use %,d to add thousands separators to integers',
      'Use %6.1f for right-aligned decimal with 1 decimal place',
      'Use %% to print a literal percent sign',
      'Use %n for cross-platform newlines',
    ],
    gridWidth: 50,
    gridHeight: 5,
  },

  // Advanced: Restaurant invoice with complex precision
  {
    id: 'restaurant-menu-advanced',
    title: 'Restaurant Invoice - Detailed Calculation',
    difficulty: 'advanced',
    theme: 'restaurant-menu',
    scenario: 'Create a detailed restaurant invoice with subtotal, tax, and total. Uses width specifiers, decimal precision, and right-alignment.',
    variables: [
      { name: 'subtotal', type: 'double', value: '127.50' },
      { name: 'taxRate', type: 'double', value: '0.08' },
      { name: 'itemCount', type: 'int', value: '8' },
    ],
    formatCalls: [
      {
        method: 'format',
        prompt: 'Line 1: Show subtotal right-aligned with 2 decimal places in 10-char width',
        skeleton: 'String line1 = String.format("Subtotal: %10.2f", subtotal);',
        answer: '%10.2f", subtotal',
        explanation: '%10.2f allocates 10 characters total, right-aligned, 2 decimals',
      },
      {
        method: 'format',
        prompt: 'Line 2: Show calculated tax (8%%) on separate line',
        skeleton: 'String line2 = String.format("Tax (8%%): %10.2f", subtotal * taxRate);',
        answer: '%10.2f", subtotal * taxRate',
        explanation: '%% escapes the percent sign in format string',
      },
      {
        method: 'format',
        prompt: 'Line 3: Show item count padded with leading zeros to 3 digits',
        skeleton: 'String line3 = String.format("Items: %03d", itemCount);',
        answer: '%03d", itemCount',
        explanation: '%03d pads with leading zeros to 3 digits total',
      },
    ],
    expectedOutput: 'Subtotal:    127.50\nTax (8%):     10.20\nItems: 008\n',
    hints: [
      'Use %10.2f for total width of 10 with 2 decimal places',
      'Use %03d to pad numbers with leading zeros',
      'The 0 flag pads with zeros instead of spaces',
    ],
    gridWidth: 25,
    gridHeight: 4,
  },

  // Advanced: Diagnostic panel with hexadecimal and complex alignment
  {
    id: 'diagnostic-panel-advanced',
    title: 'Diagnostic Panel - System Readout',
    difficulty: 'advanced',
    theme: 'diagnostic-panel',
    scenario: 'Create a detailed system diagnostic panel with memory stats, percentages, and system codes in hexadecimal.',
    variables: [
      { name: 'mission', type: 'String', value: '"Arctic Storm"' },
      { name: 'duration', type: 'int', value: '142' },
      { name: 'successRate', type: 'double', value: '98.7' },
      { name: 'errorCode', type: 'int', value: '255' },
    ],
    formatCalls: [
      {
        method: 'printf',
        prompt: 'Line 1: Display mission name left-aligned in 20 chars with status',
        skeleton: 'System.out.printf("%-20s STATUS: COMPLETE%n", mission);',
        answer: '%-20s STATUS: COMPLETE%n", mission',
        explanation: '%-20s left-aligns in 20 character field, %n for newline',
      },
      {
        method: 'printf',
        prompt: 'Line 2: Show duration in minutes and success percentage',
        skeleton: 'System.out.printf("Duration: %4d min | Success: %6.1f%%%n", duration, successRate);',
        answer: '%4d min | Success: %6.1f%%%n", duration, successRate',
        explanation: 'Combine multiple formats with careful spacing, %n for newline',
      },
      {
        method: 'format',
        prompt: 'Line 3: Convert error code to uppercase hexadecimal',
        skeleton: 'String hexCode = String.format("Code: %04X", errorCode);',
        answer: '%04X", errorCode',
        explanation: '%X displays integer as hexadecimal (uppercase), 04 pads to 4 digits',
      },
    ],
    expectedOutput: 'Arctic Storm        STATUS: COMPLETE\nDuration:  142 min | Success:  98.7%\nCode: 00FF\n',
    hints: [
      'Use %X for uppercase hexadecimal representation',
      'Use %x for lowercase hexadecimal',
      '%04X pads hexadecimal with leading zeros to 4 digits',
      'Use %6.1f for width 6 with 1 decimal precision',
    ],
    gridWidth: 45,
    gridHeight: 4,
  },
];

/**
 * Get challenges by theme
 * @param {string} theme - Theme name ('Wanted Poster', 'Fantasy Menu', 'Spy Badge')
 * @returns {Array} - Challenges for that theme
 */
export function getChallengesByTheme(theme: string) {
  return formatChallenges.filter((c) => c.theme === theme);
}

/**
 * Get challenges by difficulty
 * @param {string} difficulty - 'beginner', 'intermediate', 'advanced'
 * @returns {Array} - Challenges at that difficulty
 */
export function getChallengesByDifficulty(difficulty: string) {
  return formatChallenges.filter((c) => c.difficulty === difficulty);
}

/**
 * Get available themes
 * @returns {Array} - List of unique themes
 */
export function getThemes() {
  return [...new Set(formatChallenges.map((c) => c.theme))];
}

/**
 * Get random challenge
 * @param {string} theme - Optional theme filter
 * @param {string} difficulty - Optional difficulty filter
 * @returns {object} - Random challenge matching filters
 */
export function getRandomChallenge(theme: string | null = null, difficulty: string | null = null) {
  let challenges = formatChallenges;

  if (theme) {
    challenges = challenges.filter((c) => c.theme === theme);
  }

  if (difficulty) {
    challenges = challenges.filter((c) => c.difficulty === difficulty);
  }

  if (challenges.length === 0) {
    return formatChallenges[0];
  }

  return challenges[Math.floor(Math.random() * challenges.length)];
}

export default formatChallenges;
