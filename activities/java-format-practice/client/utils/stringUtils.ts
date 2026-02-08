/**
 * Split a comma-separated string into parts, respecting quoted strings and format specifiers.
 * Format specifiers like %,d should not be split on their internal comma.
 * Example: '"Hello, World", name, 42' => ['"Hello, World"', 'name', '42']
 * Example: 'Reward: $%,d, {{bounty}}' => ['Reward: $%,d', '{{bounty}}']
 */
export function splitArgumentsRespectingQuotes(str: string): string[] {
  const parts: string[] = [];
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
export function buildAnswerString(parts: string[] = []): string {
  return parts.map((p) => p.trim()).join(', ');
}

/**
 * Escape HTML special characters to prevent XSS attacks.
 * Converts <, >, &, ", and ' to their HTML entity equivalents.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Highlight the first difference between two strings with HTML spans.
 * Escapes HTML in both strings before adding highlighting to prevent XSS.
 */
export function highlightDiff(expected: string, actual: string): { expected: string; actual: string } {
  // Escape HTML in both strings first
  const safeExpected = escapeHtml(expected);
  const safeActual = escapeHtml(actual);
  
  if (safeExpected === safeActual) return { expected: safeExpected, actual: safeActual };
  let i = 0;
  while (i < safeExpected.length && i < safeActual.length && safeExpected[i] === safeActual[i]) i++;
  // Find end of difference
  let j = 0;
  while (
    j < safeExpected.length - i &&
    j < safeActual.length - i &&
    safeExpected[safeExpected.length - 1 - j] === safeActual[safeActual.length - 1 - j]
  ) j++;
  const expDiff =
    safeExpected.slice(0, i) +
    '<span class="diff-highlight">' + safeExpected.slice(i, safeExpected.length - j) + '</span>' +
    safeExpected.slice(safeExpected.length - j);
  const actDiff =
    safeActual.slice(0, i) +
    '<span class="diff-highlight">' + safeActual.slice(i, safeActual.length - j) + '</span>' +
    safeActual.slice(safeActual.length - j);
  return { expected: expDiff, actual: actDiff };
}
