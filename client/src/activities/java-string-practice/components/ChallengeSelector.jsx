import React from 'react';
import Button from '@src/components/ui/Button';

/**
 * ChallengeSelector - UI for selecting which Java String method types to practice
 * @param {Set} selectedTypes - Currently selected method types
 * @param {Function} onTypeSelect - Callback when a type is selected (undefined for read-only mode)
 */
export default function ChallengeSelector({ selectedTypes, onTypeSelect }) {
  const types = [
    { id: 'all', label: 'All Methods' },
    { id: 'substring', label: 'substring()' },
    { id: 'indexOf', label: 'indexOf()' },
    { id: 'equals', label: 'equals()' },
    { id: 'length', label: 'length()' },
    { id: 'compareTo', label: 'compareTo()' },
  ];

  const isReadOnly = !onTypeSelect;

  return (
    <div className="type-selector">
      {types.map(type => (
        <Button
          key={type.id}
          onClick={isReadOnly ? undefined : () => onTypeSelect(type.id)}
          className={`type-btn ${selectedTypes.has(type.id) ? 'selected' : ''} ${isReadOnly ? 'read-only' : ''}`}
          aria-pressed={selectedTypes.has(type.id)}
          disabled={isReadOnly}
        >
          {type.label}
        </Button>
      ))}
    </div>
  );
}
