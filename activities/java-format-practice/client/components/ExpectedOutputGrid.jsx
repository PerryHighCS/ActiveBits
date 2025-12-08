import React, { useState } from 'react';
import { formatWithMask } from '../challenges';
import { safeEvaluate } from '../utils/safeEvaluator';

// ExpectedOutputGrid for String.format problems - shows expected output with variable names as row labels
export default function ExpectedOutputGrid({ formatCalls, width = 30, height = 3, variables = [], preComputedOutput = null, preComputedMask = null }) {
  // Validate and constrain width and height parameters
  const validatedWidth = Math.max(1, Math.min(Number.isInteger(width) ? width : 30, 100));
  const validatedHeight = Math.max(1, Math.min(Number.isInteger(height) ? height : 3, 100));
  
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
  // Build the expected output for each line by computing the format calls
  // If preComputedOutput is provided, use that instead of re-computing
  let preCompLines = [];
  let preCompMasks = [];
  if (preComputedOutput) {
    // Split output by newlines
    const allLines = preComputedOutput.split('\n');
    preCompLines = allLines.slice(0, formatCalls.length);
    
    // For masks, we need to split in sync with the output
    // The mask string has same length as output (including newlines which are marked as 'S')
    // Split the mask at the same newline positions as the output
    if (preComputedMask) {
      let maskIdx = 0;
      for (let i = 0; i < formatCalls.length; i++) {
        const lineLength = preCompLines[i].length;
        preCompMasks[i] = preComputedMask.substring(maskIdx, maskIdx + lineLength);
        maskIdx += lineLength + 1; // +1 for the 'S' that represents the newline
      }
    }
  }
  
  const lines = formatCalls.map((call, callIdx) => {
    let varName = '';
    const skeletonMatch = call.skeleton?.match(/String\s+(\w+)\s*=/);
    if (skeletonMatch) {
      varName = skeletonMatch[1];
    }
    
    // Use pre-computed output if available
    let expectedText = preCompLines[callIdx] || '';
    let expectedMask = preCompMasks[callIdx] || 'V'.repeat(expectedText.length);
    
    // If pre-computed output is not available, try to compute it
    if (!preComputedOutput) {
      const answerStr = call.answer || '';
      if (answerStr.trim()) {
        try {
          // Split arguments properly, respecting quoted strings
          const answerParts = [];
          let current = '';
          let inQuotes = false;
          
          for (let i = 0; i < answerStr.length; i++) {
            const char = answerStr[i];
            const prevChar = i > 0 ? answerStr[i - 1] : '';
            
            if (char === '"' && prevChar !== '\\') {
              inQuotes = !inQuotes;
              current += char;
            } else if (char === ',' && !inQuotes) {
              answerParts.push(current.trim());
              current = '';
            } else {
              current += char;
            }
          }
          if (current.trim()) {
            answerParts.push(current.trim());
          }
          
          if (answerParts[0].startsWith('"') && answerParts[0].endsWith('"')) {
            const fmt = answerParts[0].slice(1, -1);
            const argExprs = answerParts.slice(1);
            
            // Build value map from variables
            const valueMap = {};
            (variables || []).forEach((v) => {
              let val = v.value;
              if (v.type === 'String') {
                val = val.replace(/^"(.*)"$/, '$1');
              }
              valueMap[v.name] = v.type === 'String' ? val : parseFloat(val) || 0;
            });
            
            // Evaluate arguments
            const argValues = argExprs.map((expr) => {
              return safeEvaluate(expr, valueMap);
            });
            
            // Use formatWithMask to properly format
            const result = formatWithMask(fmt, argValues);
            expectedText = result.text.replace(/%n/g, '').replace(/\n/g, '');
            expectedMask = result.mask.replace(/%n/g, '').replace(/\n/g, '');
          }
        } catch {
          // If we can't compute expected, leave it empty
        }
      }
    }
    
    return { varName, expectedText, expectedMask };
  });

  const selection = getSelectionInfo();
  
  return (
    <div className="character-grid-container" onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
      <table className="character-grid">
        <thead>
          <tr>
            <th className="grid-row-label" style={{ width: '80px' }}></th>
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
            <th className="grid-row-label" style={{ width: '80px' }}></th>
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
          {lines.map((line, idx) => {
            const displayLines = line.expectedText ? line.expectedText.split(/\n/) : [''];
            const maskLines = line.expectedMask ? line.expectedMask.split(/\n/) : [''];
            
            return displayLines.map((displayLine, lineIdx) => (
              <tr key={`${idx}-${lineIdx}`}>
                <td className="grid-row-label" style={{ background: '#ccc', fontWeight: 'bold', fontSize: '12px' }}>
                  {lineIdx === 0 ? line.varName : ''}
                </td>
                {Array.from({ length: validatedWidth }).map((_, colIdx) => {
                  const char = displayLine?.[colIdx] || '';
                  const maskChar = maskLines[lineIdx]?.[colIdx] || '';
                  const isEmpty = !char;
                  
                  // Color based on mask: 'S' = static (orange), 'D' = dynamic (blue), empty = gray
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
            ));
          })}
        </tbody>
      </table>
      <div className="grid-legend">
        <div className="grid-legend-item">
          <div className="grid-legend-box" style={{ background: '#fef3c7', borderColor: '#f59e0b', border: '2px solid #f59e0b' }}></div>
          <span>Static characters (format string)</span>
        </div>
        <div className="grid-legend-item">
          <div className="grid-legend-box" style={{ background: '#dbeafe', borderColor: '#3b82f6', border: '2px solid #3b82f6' }}></div>
          <span>Dynamic characters (from arguments)</span>
        </div>
      </div>
    </div>
  );
}