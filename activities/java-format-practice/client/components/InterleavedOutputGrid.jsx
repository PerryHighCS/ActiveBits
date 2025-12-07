import React from 'react';

// InterleavedOutputGrid: shows expected and actual output side-by-side or interleaved
// For String.format: shows expected (static/dynamic coloring) and actual (correct/incorrect coloring) on alternating rows with variable names
// For printf: shows combined output with static/dynamic and correct/incorrect coloring
export default function InterleavedOutputGrid({ expected, actual, width = 30, height = 3, lineData = null }) {
  // If lineData is provided (String.format problems with variable names), use structured approach
  if (lineData && Array.isArray(lineData)) {
    return (
      <div className="character-grid-container">
        <table className="character-grid">
          <thead>
            <tr>
              <th className="grid-row-label" style={{ width: '80px' }}></th>
              {Array.from({ length: width }).map((_, i) => (
                <th key={`tens-${i}`} className="grid-column-header grid-column-header-tens">
                  {i % 10 === 0 ? Math.floor(i / 10) : '\u00A0'}
                </th>
              ))}
            </tr>
            <tr>
              <th className="grid-row-label" style={{ width: '80px' }}></th>
              {Array.from({ length: width }).map((_, i) => (
                <th key={`ones-${i}`} className="grid-column-header">
                  {i % 10}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lineData.map((lineInfo, idx) => {
              // Replace %n with ↵ for display, but DON'T split on newlines for String.format problems
              // The ↵ symbol will just appear as a character in the row
              const expDisplay = (lineInfo.expected || '').replace(/%n/g, '↵').replace(/\n/g, '');
              const actDisplay = (lineInfo.actual || '').replace(/%n/g, '↵').replace(/\n/g, '');
              
              return (
                <React.Fragment key={idx}>
                  {/* Expected output row for this variable - with static/dynamic coloring from mask */}
                  <tr>
                    <td className="grid-row-label" style={{ background: '#ccc', fontWeight: 'bold', fontSize: '12px' }}>
                      {lineInfo.varName}
                    </td>
                    {Array.from({ length: width }).map((_, colIdx) => {
                      const char = expDisplay?.[colIdx] || '';
                      const maskChar = lineInfo.expectedMask?.replace(/\n/g, '')?.[colIdx] || '';
                      const isEmpty = !char;
                      
                      let bgColor = '#f3f4f6'; // Gray for empty
                      let borderColor = '#ccc';
                      
                      if (!isEmpty) {
                        if (maskChar === 'S') {
                          bgColor = '#fef3c7'; // Orange for static
                          borderColor = '#f59e0b';
                        } else if (maskChar === 'D' || maskChar === 'V') {
                          bgColor = '#dbeafe'; // Blue for dynamic
                          borderColor = '#3b82f6';
                        }
                      }
                      
                      return (
                        <td key={colIdx} className="grid-cell" style={{ background: bgColor, borderColor: borderColor }}>
                          {char || '\u00A0'}
                        </td>
                      );
                    })}
                  </tr>
                  {/* Actual output row for this variable - with correct/incorrect coloring */}
                  <tr>
                    {(() => {
                      // Determine if entire line is correct
                      let lineIsCorrect = true;
                      if (expDisplay !== actDisplay) {
                        lineIsCorrect = false;
                      }
                      const labelBg = lineIsCorrect ? '#dcfce7' : '#fee2e2'; // Green if correct, red if not
                      
                      return (
                        <td className="grid-row-label" style={{ background: labelBg, fontWeight: 'bold', fontSize: '12px' }}>
                          Actual
                        </td>
                      );
                    })()}
                    {Array.from({ length: width }).map((_, colIdx) => {
                      const expChar = expDisplay?.[colIdx] || '';
                      const actChar = actDisplay?.[colIdx] || '';
                      let bgColor = '#f3f4f6'; // Gray for empty
                      
                      if (actChar) {
                        if (actChar === expChar) {
                          bgColor = '#dcfce7'; // Light green for match
                        } else {
                          bgColor = '#fee2e2'; // Light red for mismatch
                        }
                      }
                      
                      return (
                        <td key={colIdx} className="grid-cell" style={{ background: bgColor }}>
                          {actChar || '\u00A0'}
                        </td>
                      );
                    })}
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        <div className="grid-legend">
          <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>Expected (Static/Dynamic):</div>
          <div className="grid-legend-item">
            <div className="grid-legend-box" style={{ background: '#fef3c7', borderColor: '#f59e0b', border: '2px solid #f59e0b' }}></div>
            <span>Static characters</span>
          </div>
          <div className="grid-legend-item">
            <div className="grid-legend-box" style={{ background: '#dbeafe', borderColor: '#3b82f6', border: '2px solid #3b82f6' }}></div>
            <span>Dynamic characters</span>
          </div>
          <div style={{ marginTop: '8px', marginBottom: '8px', fontWeight: 'bold' }}>Actual (Correct/Incorrect):</div>
          <div className="grid-legend-item">
            <div className="grid-legend-box" style={{ background: '#dcfce7' }}></div>
            <span>Correct (green)</span>
          </div>
          <div className="grid-legend-item">
            <div className="grid-legend-box" style={{ background: '#fee2e2' }}></div>
            <span>Incorrect (red)</span>
          </div>
        </div>
      </div>
    );
  }

  // Original behavior for printf-style problems (combined output with newlines)
  const expLines = (expected || '').split(/\n/);
  const actLines = (actual || '').split(/\n/);
  
  return (
    <div className="character-grid-container">
      <table className="character-grid">
        <thead>
          <tr>
            <th className="grid-row-label" style={{ width: '80px' }}></th>
            {Array.from({ length: width }).map((_, i) => (
              <th key={`tens-${i}`} className="grid-column-header grid-column-header-tens">
                {i % 10 === 0 ? Math.floor(i / 10) : '\u00A0'}
              </th>
            ))}
          </tr>
          <tr>
            <th className="grid-row-label" style={{ width: '80px' }}></th>
            {Array.from({ length: width }).map((_, i) => (
              <th key={`ones-${i}`} className="grid-column-header">
                {i % 10}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.max(expLines.length, actLines.length, height) }).map((_, idx) => (
            <React.Fragment key={idx}>
              {/* Expected output row */}
              <tr>
                <td className="grid-row-label" style={{ background: '#ccc', fontWeight: 'bold', fontSize: '12px' }}>
                  Expected
                </td>
                {Array.from({ length: width }).map((_, colIdx) => {
                  const char = expLines[idx]?.[colIdx] || '';
                  return (
                    <td key={colIdx} className="grid-cell" style={{ background: '#eee', color: '#666' }}>
                      {char || '\u00A0'}
                    </td>
                  );
                })}
              </tr>
              {/* Actual output row, with character-level highlighting */}
              <tr>
                <td className="grid-row-label" style={{ background: '#f0f0f0', fontWeight: 'bold', fontSize: '12px' }}>
                  Actual
                </td>
                {Array.from({ length: width }).map((_, colIdx) => {
                  const expChar = expLines[idx]?.[colIdx] || '';
                  const actChar = actLines[idx]?.[colIdx] || '';
                  let bgColor = '#fff';
                  
                  if (actChar) {
                    if (actChar === expChar) {
                      bgColor = '#90EE90'; // Green for match
                    } else {
                      bgColor = '#FF6B6B'; // Red for mismatch
                    }
                  }
                  
                  return (
                    <td key={colIdx} className="grid-cell" style={{ background: bgColor }}>
                      {actChar || '\u00A0'}
                    </td>
                  );
                })}
              </tr>
            </React.Fragment>
          ))}
        </tbody>
      </table>
      <div className="grid-legend">
        <div className="grid-legend-item">
          <div className="grid-legend-box" style={{ background: '#90EE90' }}></div>
          <span>Correct character (green)</span>
        </div>
        <div className="grid-legend-item">
          <div className="grid-legend-box" style={{ background: '#FF6B6B' }}></div>
          <span>Incorrect character (red)</span>
        </div>
      </div>
    </div>
  );
}
