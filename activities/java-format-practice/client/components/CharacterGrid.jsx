import React from 'react';

/**
 * CharacterGrid Component
 * Displays a character grid overlay for visual reference in format challenges
 * Numbers columns by default, with option to include row numbers
 */
export default function CharacterGrid({ text, mask, width = 20, height = 4, showRows = false }) {
  if (!text) return null;

  // Build grid from text
  const lines = text.split('\n');
  const gridLines = lines.slice(0, height);

  // Build mask lines by parsing the mask string character-by-character
  // The mask string should have the same length as text (including \n characters)
  const maskLines = [];
  let maskIdx = 0;
  
  for (let i = 0; i < lines.length && i < height; i++) {
    const line = lines[i];
    const maskLine = [];
    
    for (let j = 0; j < line.length; j++) {
      if (maskIdx < (mask || '').length) {
        maskLine.push(mask[maskIdx]);
        maskIdx++;
      } else {
        maskLine.push('');
      }
    }
    
    maskLines.push(maskLine.join(''));
    
    // Skip the newline character in the mask
    if (maskIdx < (mask || '').length && mask[maskIdx] === 'S') {
      // This corresponds to the \n character
      maskIdx++;
    }
  }

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
                const maskChar = maskLines[rowIdx]?.[colIdx];
                const isEmpty = char === undefined || char === '';
                // Only apply mask class if cell has content
                const maskClass = !isEmpty && maskChar === 'V' ? 'grid-cell-dynamic' : 
                                 !isEmpty && maskChar === 'S' ? 'grid-cell-static' : '';
                return (
                  <td
                    key={colIdx}
                    className={`grid-cell ${isEmpty ? 'grid-cell-empty' : ''} ${maskClass}`}
                  >
                    {isEmpty ? '\u00A0' : char}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid-legend">
        <div className="grid-legend-item">
          <div className="grid-legend-box static"></div>
          <span>Format string text (spaces, punctuation, literal text)</span>
        </div>
        <div className="grid-legend-item">
          <div className="grid-legend-box dynamic"></div>
          <span>Format specifier values (from %s, %d, %f, etc.)</span>
        </div>
      </div>
    </div>
  );
}
