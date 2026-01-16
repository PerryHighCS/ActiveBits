import React from 'react';
import './PseudocodeRenderer.css';

/**
 * Renders pseudocode with span IDs and highlighting
 * @param {object} props
 * @param {string[]} props.lines - Array of pseudocode lines
 * @param {Set<string>} [props.highlightedIds] - Set of span IDs to highlight
 * @param {string} [props.className] - Additional CSS class
 */
export default function PseudocodeRenderer({ lines, highlightedIds = new Set(), className = '' }) {
  return (
    <pre className={`pseudocode-renderer ${className}`}>
      {lines.map((line, idx) => (
        <div key={idx} className="pseudocode-line">
          <span
            id={`line-${idx}`}
            className={`pseudocode-span ${highlightedIds.has(`line-${idx}`) ? 'highlighted' : ''}`}
          >
            {line}
          </span>
        </div>
      ))}
    </pre>
  );
}
