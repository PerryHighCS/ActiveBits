import React from 'react';

export default function SessionHeader({
  submittedName,
  sessionId,
  stats = { total: 0, correct: 0, streak: 0, longestStreak: 0 },
  simple = false,
  activityName = 'Python List Practice',
}) {
  const total = stats.total || 0;
  const correct = stats.correct || 0;
  const streak = stats.streak || 0;
  const longestStreak = stats.longestStreak || 0;
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

  if (simple) {
    return (
      <div className="python-list-header">
        <div className="python-list-header-top">
          <div className="python-list-title">{activityName}</div>
          <div className="python-list-stats">
            <div className="python-list-stat">Attempted: {total}</div>
            <div className="python-list-stat">Correct: {correct}</div>
            <div className="python-list-stat">Accuracy: {accuracy}%</div>
            <div className="python-list-stat">Streak: {streak}</div>
            <div className="python-list-stat">Longest: {longestStreak}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="python-list-header">
      <div className="python-list-header-top">
        <div className="python-list-title">{activityName}</div>
        <div className="python-list-session-tag">Join Code: {sessionId}</div>
      </div>
      <div className="python-list-subtitle">Welcome, {submittedName}!</div>
      <div className="python-list-stats">
        <div className="python-list-stat">Total: {total}</div>
        <div className="python-list-stat">Correct: {correct}</div>
        <div className="python-list-stat">Accuracy: {accuracy}%</div>
        <div className="python-list-stat">Streak: {streak}</div>
        <div className="python-list-stat">Longest: {longestStreak}</div>
      </div>
    </div>
  );
}
