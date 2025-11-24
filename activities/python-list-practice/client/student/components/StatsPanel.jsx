import React from 'react';
import SessionHeader from '../components/SessionHeader';

export default function StatsPanel({ isSolo, submittedName, sessionId, stats }) {
  if (isSolo) {
    return <SessionHeader activityName="Python List Practice" stats={stats} simple />;
  }
  return <SessionHeader submittedName={submittedName} sessionId={sessionId} stats={stats} />;
}
