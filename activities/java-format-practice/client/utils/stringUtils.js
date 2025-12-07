/**
 * Split a comma-separated string into parts, respecting quoted strings.
 * Example: '"Hello, World", name, 42' => ['"Hello, World"', 'name', '42']
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
      parts.push(current.trim());
      current = '';
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
