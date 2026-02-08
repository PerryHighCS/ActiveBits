import React from 'react'
import type { JavaFormatDifficulty, JavaFormatTheme } from '../../javaFormatPracticeTypes.js'

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
}: {
  currentDifficulty: JavaFormatDifficulty
  currentTheme: JavaFormatTheme
  onDifficultyChange: (difficulty: JavaFormatDifficulty) => void
  onThemeChange: (theme: JavaFormatTheme) => void
  isDisabled: boolean
}) {
  const difficulties: Array<{ id: JavaFormatDifficulty; label: string }> = [
    { id: 'beginner', label: 'Beginner' },
    { id: 'intermediate', label: 'Intermediate' },
    { id: 'advanced', label: 'Advanced' },
  ]

  const themes: Array<{ id: JavaFormatTheme; label: string }> = [
    { id: 'all', label: 'All Themes' },
    { id: 'wanted-poster', label: 'Wanted Poster' },
    { id: 'spy-badge', label: 'Spy Badge' },
    { id: 'fantasy-menu', label: 'Fantasy Menu' },
  ]

  return (
    <React.Fragment>
      <div className="challenge-selector">
        <div className="selector-group">
          <label>Difficulty:</label>
          <div className="button-group">
            {difficulties.map((d) => (
              <button
                key={d.id}
                className={`selector-btn ${currentDifficulty === d.id ? 'selected' : ''}`}
                type="button"
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
                type="button"
                onClick={() => onThemeChange(t.id)}
                disabled={isDisabled}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </React.Fragment>
  );
}
