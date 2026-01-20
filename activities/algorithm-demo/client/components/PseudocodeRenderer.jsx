import React from 'react';
import './PseudocodeRenderer.css';
import { renderPseudocodeWithBold } from '../utils/pseudocodeUtils.jsx';

/**
 * Renders pseudocode with span IDs and highlighting
 * @param {object} props
 * @param {string[]} props.lines - Array of pseudocode lines
 * @param {Set<string>|string[]} [props.highlightedLines] - Set or array of span IDs to highlight (preferred)
 * @param {Set<string>|string[]} [props.highlightedIds] - Deprecated: use highlightedLines instead
 * @param {string} [props.className] - Additional CSS class
 */
export default function PseudocodeRenderer(props) {
  const { lines, highlightedLines, highlightedIds, overlays = {}, className = '' } = props;
  
  // Support both highlightedLines and highlightedIds for backward compatibility
  const ids = highlightedLines || highlightedIds || new Set();
  
  // Normalize ids: convert array to Set if needed
  let highlightSet = ids;
  if (Array.isArray(ids)) {
    highlightSet = new Set(ids);
  } else if (!highlightSet || typeof highlightSet.has !== 'function') {
    highlightSet = new Set();
  }

  // Parse pseudocode line to render bold text marked with **
  const renderLineContent = (text) => renderPseudocodeWithBold(text);

  return (
    <pre className={`pseudocode-renderer ${className}`}>
      {lines.map((line, idx) => {
        const overlayEntry = overlays[`line-${idx}`];
        return (
          <div key={idx} className="pseudocode-line">
            <span
              id={`line-${idx}`}
              className={`pseudocode-span ${highlightSet.has(`line-${idx}`) ? 'highlighted' : ''} ${overlayEntry ? 'has-overlay' : ''}`}
            >
              {renderLineContent(line)}
              {overlayEntry && renderOverlay(overlayEntry)}
            </span>
          </div>
        );
      })}
    </pre>
  );
}

function renderOverlay(overlay) {
  if (overlay && typeof overlay === 'object') {
    const val = overlay.value !== undefined ? overlay.value : null;
    if (val !== null) {
      return (
        <span className="overlay-inline">
          <span className="overlay-value">{String(val)}</span>
        </span>
      );
    }
    // Fallback for unexpected object shapes
    return null;
  }
  return <span className="overlay-badge">{overlay}</span>;
}
