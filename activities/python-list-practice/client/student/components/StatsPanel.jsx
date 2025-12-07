import React from 'react';

export default function StatsPanel({ stats }) {
  const total = stats?.total || 0;
  const correct = stats?.correct || 0;
  const streak = stats?.streak || 0;
  const longestStreak = stats?.longestStreak || 0;
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

  return (
    <div className="stats-panel">
      <h3>Your Progress</h3>
      <div className="stats-grid">
        <div className="stat-item">
          <div className="stat-value">{total}</div>
          <div className="stat-label">Total Attempts</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{correct}</div>
          <div className="stat-label">Correct</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{accuracy}%</div>
          <div className="stat-label">Accuracy</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{streak}</div>
          <div className="stat-label">Current Streak</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{longestStreak}</div>
          <div className="stat-label">Longest Streak</div>
        </div>
      </div>
    </div>
  );
}
