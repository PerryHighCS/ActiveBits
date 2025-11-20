/**
 * CSV Utility Functions
 * Implements RFC 4180 CSV formatting
 */

/**
 * Properly escape a CSV cell value according to RFC 4180
 * @param {*} cell - The cell value to escape
 * @returns {string} - The properly escaped CSV cell
 */
export function escapeCsvCell(cell) {
  const stringValue = String(cell ?? '');
  // If cell contains quotes, commas, or newlines, it must be quoted
  // and internal quotes must be doubled
  if (stringValue.includes('"') || stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('\r')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

/**
 * Convert a 2D array to CSV format
 * @param {Array<Array<*>>} data - 2D array where first row is headers
 * @returns {string} - CSV formatted string
 */
export function arrayToCsv(data) {
  return data.map(row => row.map(escapeCsvCell).join(',')).join('\n');
}

/**
 * Download a CSV file
 * @param {string} csvContent - The CSV content
 * @param {string} filename - The filename (without extension)
 */
export function downloadCsv(csvContent, filename) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
