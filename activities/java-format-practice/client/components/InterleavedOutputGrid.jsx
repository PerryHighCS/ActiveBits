import React, { useState } from 'react';

// InterleavedOutputGrid: shows expected and actual output side-by-side or interleaved
// For String.format: shows expected (static/dynamic coloring) and actual (correct/incorrect coloring) on alternating rows with variable names
// For printf: shows combined output with static/dynamic and correct/incorrect coloring
export default function InterleavedOutputGrid({ expected, actual, width = 30, height = 3, lineData = null }) {
  // Validate and constrain width and height parameters
  const validatedWidth = Math.max(1, Math.min(Number.isInteger(width) ? width : 30, 100));

  const [hoveredCol, setHoveredCol] = useState(null);
  const [selectionStart, setSelectionStart] = useState(null);
  const [selectionEnd, setSelectionEnd] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = (colIdx) => {
    // Always start a new selection on mouse down
    setSelectionStart(colIdx);
    setSelectionEnd(colIdx);
    setIsDragging(true);
  };

  const handleMouseEnter = (colIdx) => {
    if (!isDragging) {
      setHoveredCol(colIdx);
    }
    if (isDragging) {
      setSelectionEnd(colIdx);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const isSelected = (colIdx) => {
    if (selectionStart === null || selectionEnd === null) return false;
    const start = Math.min(selectionStart, selectionEnd);
    const end = Math.max(selectionStart, selectionEnd);
    return colIdx >= start && colIdx <= end;
  };

  const getSelectionInfo = () => {
    if (selectionStart === null || selectionEnd === null) return null;
    const start = Math.min(selectionStart, selectionEnd);
    const end = Math.max(selectionStart, selectionEnd);
    return { start, end, count: end - start + 1 };
  };
  // If lineData is provided (String.format problems with variable names), use structured approach
  if (lineData && Array.isArray(lineData)) {
    return (
      <div className="character-grid-container" onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
        <table className="character-grid">
          <thead>
            <tr>
              <th className="grid-row-label sticky-label" style={{ width: '80px' }}></th>
              {Array.from({ length: validatedWidth }).map((_, i) => {
                const selected = isSelected(i);
                const selection = getSelectionInfo();
                const isSelectionStart = selection && i === selection.start;
                const isInSelection = selected && !isSelectionStart;

                // Skip rendering cells that are part of the colspan
                if (isInSelection) return null;

                return (
                  <th
                    key={`tens-${i}`}
                    className={`grid-column-header grid-column-header-tens ${hoveredCol === i ? 'grid-column-hovered' : ''} ${selected ? 'grid-column-selected' : ''}`}
                    colSpan={isSelectionStart ? selection.count : 1}
                    data-count={isSelectionStart ? selection.count : undefined}
                    onMouseDown={() => handleMouseDown(i)}
                    onMouseEnter={() => handleMouseEnter(i)}
                    onMouseLeave={() => setHoveredCol(null)}
                  >
                    {isSelectionStart ? selection.count : ((hoveredCol === i || i % 10 === 0) ? Math.floor(i / 10) : '\u00A0')}
                  </th>
                );
              }).filter(Boolean)}
            </tr>
            <tr>
              <th className="grid-row-label sticky-label" style={{ width: '80px' }}></th>
              {Array.from({ length: validatedWidth }).map((_, i) => {
                const selected = isSelected(i);
                return (
                  <th
                    key={`ones-${i}`}
                    className={`grid-column-header ${hoveredCol === i ? 'grid-column-hovered' : ''} ${selected ? 'grid-column-selected' : ''}`}
                    onMouseDown={() => handleMouseDown(i)}
                    onMouseEnter={() => handleMouseEnter(i)}
                    onMouseLeave={() => setHoveredCol(null)}
                  >
                    {i % 10}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {lineData.map((lineInfo, idx) => {
              // Replace %n with ↵ for display, but DON'T split on newlines for String.format problems
              // The ↵ symbol will just appear as a character in the row
              // Visualize newlines as ↵ so students see extra/ missing returns
              const expDisplay = (lineInfo.expected || '').replace(/%n/g, '↵').replace(/\n/g, '↵');
              const actDisplay = (lineInfo.actual || '').replace(/%n/g, '↵').replace(/\n/g, '↵');
              // Masks should only contain 'S', 'V', or 'D' characters - no newlines to normalize
              const normalizedMask = lineInfo.expectedMask || '';
              const normalizedUserMask = lineInfo.userMask || '';

              return (
                <React.Fragment key={idx}>
                  {/* Expected output row for this variable - with static/dynamic coloring from mask */}
                  <tr>
                    <td className="grid-row-label sticky-label" style={{ background: '#ccc', fontWeight: 'bold', fontSize: '12px' }}>
                      {lineInfo.varName}
                    </td>
                    {Array.from({ length: validatedWidth }).map((_, colIdx) => {
                      const char = expDisplay?.[colIdx] || '';
                      const maskChar = normalizedMask?.[colIdx] || '';
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

                      const selected = isSelected(colIdx);
                      return (
                        <td
                          key={colIdx}
                          className={`grid-cell ${hoveredCol === colIdx ? 'grid-cell-hovered' : ''} ${selected ? 'grid-cell-selected' : ''}`}
                          style={{ background: bgColor, borderColor: borderColor }}
                          onMouseDown={() => handleMouseDown(colIdx)}
                          onMouseEnter={() => handleMouseEnter(colIdx)}
                          onMouseLeave={() => setHoveredCol(null)}
                        >
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
                        <td className="grid-row-label sticky-label" style={{ background: labelBg, fontWeight: 'bold', fontSize: '12px' }}>
                          Actual
                        </td>
                      );
                    })()}
                    {Array.from({ length: validatedWidth }).map((_, colIdx) => {
                      const expChar = expDisplay?.[colIdx] || '';
                      const actChar = actDisplay?.[colIdx] || '';
                      const maskChar = normalizedUserMask?.[colIdx] || '';
                      let bgColor = '#f3f4f6'; // Gray for empty
                      let borderColor = '#b6b6b6';
                      let borderWidth = '1px';
                      if (maskChar === 'S') {
                        borderColor = '#f59e0b'; // Orange border for static
                        borderWidth = '2px';
                      } else if (maskChar === 'D' || maskChar === 'V') {
                        borderColor = '#3b82f6'; // Blue border for dynamic
                        borderWidth = '2px';
                      }

                      if (actChar) {
                        if (actChar === expChar) {
                          bgColor = '#dcfce7'; // Light green for match
                        } else {
                          bgColor = '#fee2e2'; // Light red for mismatch
                        }
                      }

                      const selected = isSelected(colIdx);
                      return (
                        <td
                          key={colIdx}
                          className={`grid-cell ${hoveredCol === colIdx ? 'grid-cell-hovered' : ''} ${selected ? 'grid-cell-selected' : ''}`}
                          style={{ background: bgColor, borderColor: borderColor, borderWidth: borderWidth }}
                          onMouseDown={() => handleMouseDown(colIdx)}
                          onMouseEnter={() => handleMouseEnter(colIdx)}
                          onMouseLeave={() => setHoveredCol(null)}
                        >
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
  // Show newline characters explicitly so mismatches are visible
  // Preserve newlines visually by inserting ↵ before splitting into rows
  const expLines = (expected || '')
    .replace(/%n/g, '↵')
    .replace(/\n/g, '↵\n')
    .split('\n');
  const actLines = (actual || '')
    .replace(/%n/g, '↵')
    .replace(/\n/g, '↵\n')
    .split('\n');

  return (
    <div className="character-grid-container">
      <table className="character-grid">
        <thead>
          <tr>
            <th className="grid-row-label" style={{ width: '80px' }}></th>
            {Array.from({ length: validatedWidth }).map((_, i) => (
              <th key={`tens-${i}`} className="grid-column-header grid-column-header-tens">
                {i % 10 === 0 ? Math.floor(i / 10) : '\u00A0'}
              </th>
            ))}
          </tr>
          <tr>
            <th className="grid-row-label" style={{ width: '80px' }}></th>
            {Array.from({ length: validatedWidth }).map((_, i) => (
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
                {Array.from({ length: validatedWidth }).map((_, colIdx) => {
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
                {Array.from({ length: validatedWidth }).map((_, colIdx) => {
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
