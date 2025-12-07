import React, { useState } from 'react';

/**
 * CharacterGrid Component
 * Displays a character grid overlay for visual reference in format challenges
 * Numbers columns by default, with option to include row numbers
 */
export default function CharacterGrid({ text, mask, width = 20, height = 4, showRows = false }) {
  const [hoveredCol, setHoveredCol] = useState(null);
  const [selectionStart, setSelectionStart] = useState(null);
  const [selectionEnd, setSelectionEnd] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  
  if (!text) return null;
  
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

  const selection = getSelectionInfo();
  
  return (
    <div className="character-grid-container" onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
      <table className="character-grid">
        <thead>
          <tr>
            {showRows && <th className="grid-row-header"></th>}
            {Array.from({ length: width }).map((_, i) => {
              const selected = isSelected(i);
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
            {showRows && <th className="grid-row-header"></th>}
            {Array.from({ length: width }).map((_, i) => {
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
          {gridLines.map((line, rowIdx) => (
            <tr key={rowIdx}>
              {showRows && (
                <td className="grid-row-header">{rowIdx}</td>
              )}
              {Array.from({ length: width }).map((_, colIdx) => {
                const char = line[colIdx];
                const maskChar = maskLines[rowIdx]?.[colIdx];
                const isEmpty = char === undefined || char === '';
                const selected = isSelected(colIdx);
                // Only apply mask class if cell has content
                const maskClass = !isEmpty && maskChar === 'V' ? 'grid-cell-dynamic' : 
                                 !isEmpty && maskChar === 'S' ? 'grid-cell-static' : '';
                return (
                  <td
                    key={colIdx}
                    className={`grid-cell ${isEmpty ? 'grid-cell-empty' : ''} ${maskClass} ${hoveredCol === colIdx ? 'grid-cell-hovered' : ''} ${selected ? 'grid-cell-selected' : ''}`}
                    onMouseDown={() => handleMouseDown(colIdx)}
                    onMouseEnter={() => handleMouseEnter(colIdx)}
                    onMouseLeave={() => setHoveredCol(null)}
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
