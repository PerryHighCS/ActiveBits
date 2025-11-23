import React from 'react';

export default function SessionHeader({ submittedName, sessionId, stats }) {
  return (
    <div className="python-list-header">
      <div className="python-list-header-top">
        <div className="python-list-title">Python List Practice</div>
        <div className="python-list-session-tag">Join Code: {sessionId}</div>
      </div>
      <div className="python-list-subtitle">Welcome, {submittedName}!</div>
      <div className="python-list-stats">
        <div className="python-list-stat">Total: {stats.total}</div>
        <div className="python-list-stat">Correct: {stats.correct}</div>
        <div className="python-list-stat">Streak: {stats.streak}</div>
      </div>
    </div>
  );
}
