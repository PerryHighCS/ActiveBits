import React from 'react';
import Button from '@src/components/ui/Button';

/**
 * ChallengeSelector - UI for selecting which Java String method types to practice
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

  return (
    <div className="type-selector">
      {types.map(type => (
        <Button
          key={type.id}
          onClick={() => onTypeSelect(type.id)}
          className={`type-btn ${selectedTypes.has(type.id) ? 'selected' : ''}`}
          aria-pressed={selectedTypes.has(type.id)}
        >
          {type.label}
        </Button>
      ))}
    </div>
  );
}
