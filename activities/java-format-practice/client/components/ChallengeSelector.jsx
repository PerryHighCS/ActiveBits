import React from 'react';

/**
 * ChallengeSelector Component
 * Allows selection of difficulty level and theme
 */
export default function ChallengeSelector({
  currentDifficulty,
  currentTheme,
  onDifficultyChange,
  onThemeChange,
  isDisabled,
}) {
  const difficulties = [
    { id: 'beginner', label: 'Beginner' },
    { id: 'intermediate', label: 'Intermediate' },
    { id: 'advanced', label: 'Advanced' },
  ];

  const themes = [
    { id: 'all', label: 'All Themes' },
    { id: 'wanted-poster', label: 'Wanted Poster' },
    { id: 'spy-badge', label: 'Spy Badge' },
    { id: 'fantasy-menu', label: 'Fantasy Menu' },
  ];

  return (
    <div className="challenge-selector">
      <div className="selector-group">
        <label>Difficulty:</label>
        <div className="button-group">
          {difficulties.map((d) => (
            <button
              key={d.id}
              className={`selector-btn ${currentDifficulty === d.id ? 'selected' : ''}`}
              onClick={() => onDifficultyChange(d.id)}
              disabled={isDisabled}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="selector-group">
        <label>Theme:</label>
        <div className="button-group">
          {themes.map((t) => (
            <button
              key={t.id}
              className={`selector-btn ${currentTheme === t.id ? 'selected' : ''}`}
              onClick={() => onThemeChange(t.id)}
              disabled={isDisabled}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
