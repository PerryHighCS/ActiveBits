import React from 'react';
import Button from '@src/components/ui/Button';

/**
 * ChallengeSelector - UI for selecting which Java String method types to practice
 */
export default function ChallengeSelector({ selectedTypes, onTypeSelect }) {
  const types = [
    { id: 'all', label: 'All Methods', emoji: '🎯' },
    { id: 'substring', label: 'substring()', emoji: '✂️' },
    { id: 'indexOf', label: 'indexOf()', emoji: '🔍' },
    { id: 'equals', label: 'equals()', emoji: '⚖️' },
    { id: 'length', label: 'length()', emoji: '📏' },
    { id: 'compareTo', label: 'compareTo()', emoji: '🔀' },
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
          <span className="type-emoji">{type.emoji}</span>
          <span className="type-label">{type.label}</span>
        </Button>
      ))}
    </div>
  );
}
