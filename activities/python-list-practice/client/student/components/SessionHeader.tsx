import { ReactNode } from 'react';
import StatsPanel from './StatsPanel.js';

interface Stats {
  total: number;
  correct: number;
  streak: number;
  longestStreak: number;
}

interface SessionHeaderProps {
  submittedName: string | undefined;
  sessionId: string | undefined;
  stats: Stats;
  simple?: boolean;
  activityName?: string;
}

export default function SessionHeader({
  submittedName,
  sessionId,
  stats,
  simple = false,
  activityName = 'Python List Practice',
}: SessionHeaderProps): ReactNode {
  if (simple) {
    return (
      <div className="python-list-header">
        <div className="python-list-header-top">
          <div className="python-list-title">{activityName}</div>
        </div>
        <StatsPanel stats={stats} />
      </div>
    );
  }

      return (
        <div className="python-list-header">
          <div className="python-list-header-top">
            <div className="python-list-title">{activityName}</div>
            <div className="python-list-session-tag">Join Code: {sessionId || ''}</div>
          </div>
          <div className="python-list-subtitle">Welcome, {submittedName || ''}!</div>
          <StatsPanel stats={stats} />
        </div>
      )
}
