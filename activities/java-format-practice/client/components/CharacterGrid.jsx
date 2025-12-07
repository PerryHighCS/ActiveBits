import React from 'react';

/**
 * CharacterGrid Component
 * Displays a character grid overlay for visual reference in format challenges
 * Numbers columns by default, with option to include row numbers
 */
export default function CharacterGrid({ text, width = 20, height = 4, showRows = false }) {
  if (!text) return null;

  // Build grid from text
  const lines = text.split('\n').filter(line => line.length > 0);
  const gridLines = lines.slice(0, height);

  return (
    <div className="character-grid-container">
      <table className="character-grid">
        <thead>
          <tr>
            {showRows && <th className="grid-row-header"></th>}
            {Array.from({ length: width }).map((_, i) => (
                <th key={`tens-${i}`} className="grid-column-header grid-column-header-tens">
                  {i % 10 === 0 ? Math.floor(i / 10) : '\u00A0'}
              </th>
            ))}
          </tr>
          <tr>
            {showRows && <th className="grid-row-header"></th>}
            {Array.from({ length: width }).map((_, i) => (
              <th key={`ones-${i}`} className="grid-column-header">
                {i % 10}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {gridLines.map((line, rowIdx) => (
            <tr key={rowIdx}>
              {showRows && (
                <td className="grid-row-header">{rowIdx}</td>
              )}
              {Array.from({ length: width }).map((_, colIdx) => {
                const char = line[colIdx];
                const isEmpty = char === undefined;
                return (
                  <td
                    key={colIdx}
                    className={`grid-cell ${isEmpty ? 'grid-cell-empty' : ''}`}
                  >
                    {isEmpty ? '\u00A0' : char}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
