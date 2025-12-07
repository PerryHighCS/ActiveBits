import React from 'react';
import { formatWithMask } from '../challenges';

// ExpectedOutputGrid for String.format problems - shows expected output with variable names as row labels
export default function ExpectedOutputGrid({ formatCalls, width = 30, height = 3, variables = [] }) {
  // Build the expected output for each line by computing the format calls
  const lines = formatCalls.map((call) => {
    let varName = '';
    const skeletonMatch = call.skeleton?.match(/String\s+(\w+)\s*=/);
    if (skeletonMatch) {
      varName = skeletonMatch[1];
    }
    
    // Compute expected output by parsing and evaluating the answer
    let expectedText = '';
    let expectedMask = '';
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
            const trimmed = expr.trim();
            if (!trimmed) return '';
            const keys = Object.keys(valueMap);
            const vals = Object.values(valueMap);
            try {
              // eslint-disable-next-line no-new-func
              return new Function(...keys, `return ${trimmed};`)(...vals);
            } catch {
              return '';
            }
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
    
    return { varName, expectedText, expectedMask };
  });

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
          {lines.map((line, idx) => {
            const displayLines = line.expectedText ? line.expectedText.split(/\n/) : [''];
            const maskLines = line.expectedMask ? line.expectedMask.split(/\n/) : [''];
            
            return displayLines.map((displayLine, lineIdx) => (
              <tr key={`${idx}-${lineIdx}`}>
                <td className="grid-row-label" style={{ background: '#ccc', fontWeight: 'bold', fontSize: '12px' }}>
                  {lineIdx === 0 ? line.varName : ''}
                </td>
                {Array.from({ length: width }).map((_, colIdx) => {
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
                  
                  return (
                    <td key={colIdx} className="grid-cell" style={{ background: bgColor, borderColor: borderColor }}>
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