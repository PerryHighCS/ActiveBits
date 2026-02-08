import React from 'react'
import type { JavaFormatStats } from '../../javaFormatPracticeTypes.js'

/**
 * StatsPanel - Display student statistics
 */
interface StatsPanelProps {
  stats: JavaFormatStats
}

export default function StatsPanel({ stats }: StatsPanelProps) {
  const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0

  return (
    <React.Fragment>
      <div className="java-format-stats-panel">
        <h3>Your Progress</h3>
        <div className="stats-grid">
          <div className="stat-item">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Attempts</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.correct}</div>
            <div className="stat-label">Correct</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{accuracy}%</div>
            <div className="stat-label">Accuracy</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.streak}</div>
            <div className="stat-label">Current Streak</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.longestStreak}</div>
            <div className="stat-label">Longest Streak</div>
          </div>
        </div>
      </div>
    </React.Fragment>
  )
}
