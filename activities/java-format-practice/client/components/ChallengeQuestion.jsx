import React from 'react';

/**
 * ChallengeQuestion Component
 * Displays the challenge prompt safely
 */
export default function ChallengeQuestion({ prompt }) {
  if (!prompt || typeof prompt !== 'string') {
    return <div className="question">Invalid question</div>;
  }

  return <div className="question">{prompt}</div>;
}
