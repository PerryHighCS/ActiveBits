/**
 * Split a comma-separated string into parts, respecting quoted strings and format specifiers.
 * Format specifiers like %,d should not be split on their internal comma.
 * Example: '"Hello, World", name, 42' => ['"Hello, World"', 'name', '42']
 * Example: 'Reward: $%,d, {{bounty}}' => ['Reward: $%,d', '{{bounty}}']
 */
export function splitArgumentsRespectingQuotes(str) {
  const parts = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const prevChar = i > 0 ? str[i - 1] : '';

    if (char === '"' && prevChar !== '\\') {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === ',' && !inQuotes) {
      // Check if this comma is part of a format specifier
      // A comma is part of a format specifier if:
      // 1. It comes after a % and before a conversion character (s, d, f, x, X, etc.)
      // 2. Only valid format specifier characters appear between the % and comma
      let isFormatSpecifierComma = false;
      
      // Check if we're in the middle of a format specifier by looking back for %
      // and ahead for a conversion character
      const beforeComma = current;
      const afterComma = str.slice(i + 1);
      
      // Find the last % in current string
      const lastPercentIdx = beforeComma.lastIndexOf('%');
      if (lastPercentIdx !== -1) {
        // Check what's between the % and the comma
        const betweenPercentAndComma = beforeComma.slice(lastPercentIdx + 1);
        // Valid format specifier characters: flags (-, +, 0, (, #), comma itself, and width/precision digits
        if (/^[-+0(#\d.]*$/.test(betweenPercentAndComma)) {
          // Check if there's a conversion character in the next few characters
          // (accounting for possible width/precision digits)
          const lookAhead = afterComma.match(/^(\d*[sdfxXbBhHcC])/);
          if (lookAhead) {
            // This comma is between % and a conversion char - it's a format flag
            isFormatSpecifierComma = true;
          }
        }
      }
      
      if (!isFormatSpecifierComma) {
        parts.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

/**
 * Join answer parts with commas and spaces.
 */
export function buildAnswerString(parts = []) {
  return parts.map((p) => p.trim()).join(', ');
}

/**
 * Highlight the first difference between two strings with HTML spans.
 */
export function highlightDiff(expected, actual) {
  if (expected === actual) return { expected, actual };
  let i = 0;
  while (i < expected.length && i < actual.length && expected[i] === actual[i]) i++;
  // Find end of difference
  let j = 0;
  while (
    j < expected.length - i &&
    j < actual.length - i &&
    expected[expected.length - 1 - j] === actual[actual.length - 1 - j]
  ) j++;
  const expDiff =
    expected.slice(0, i) +
    '<span class="diff-highlight">' + expected.slice(i, expected.length - j) + '</span>' +
    expected.slice(expected.length - j);
  const actDiff =
    actual.slice(0, i) +
    '<span class="diff-highlight">' + actual.slice(i, actual.length - j) + '</span>' +
    actual.slice(actual.length - j);
  return { expected: expDiff, actual: actDiff };
}
