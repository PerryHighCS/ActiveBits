import type { ReactNode } from 'react';

interface Stats {
  total?: number;
  correct?: number;
  streak?: number;
  longestStreak?: number;
}

interface StatsPanelProps {
  stats: Stats;
}

export default function StatsPanel({ stats }: StatsPanelProps): ReactNode {
  const total = stats?.total || 0;
  const correct = stats?.correct || 0;
  const streak = stats?.streak || 0;
  const longestStreak = stats?.longestStreak || 0;
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

  return (
    <div className="python-list-stats">
      <div className="python-list-stat">Total: {total}</div>
      <div className="python-list-stat">Correct: {correct}</div>
      <div className="python-list-stat">Accuracy: {accuracy}%</div>
      <div className="python-list-stat">Streak: {streak}</div>
      <div className="python-list-stat">Longest: {longestStreak}</div>
    </div>
  );
}
