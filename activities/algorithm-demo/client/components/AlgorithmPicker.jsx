import React from 'react';
import './AlgorithmPicker.css';

/**
 * Picker for available algorithms
 * @param {object} props
 * @param {array} props.algorithms - Array of algorithm modules
 * @param {string} [props.selectedId] - Currently selected algorithm ID
 * @param {function} props.onSelect - Called with algorithmId when selection changes
 * @param {string} [props.title] - Picker title
 * @param {string} [props.className] - Additional CSS class
 */
export default function AlgorithmPicker({
  algorithms,
  selectedId,
  onSelect,
  title = 'Select Algorithm',
  className = '',
}) {
  return (
    <div className={`algorithm-picker ${className}`}>
      <label className="algorithm-picker-label">{title}</label>
      <div className="algorithm-picker-grid">
        {algorithms.map((algo) => (
          <button
            key={algo.id}
            className={`algorithm-card ${selectedId === algo.id ? 'selected' : ''}`}
            onClick={() => onSelect(algo.id)}
          >
            <div className="algorithm-card-title">{algo.name}</div>
            <div className="algorithm-card-description">{algo.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
