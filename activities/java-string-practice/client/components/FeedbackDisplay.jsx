import React, { useEffect } from 'react';
import Button from '@src/components/ui/Button';

/**
 * FeedbackDisplay - Shows correct/incorrect feedback with explanations
 */
export default function FeedbackDisplay({ feedback, onNewChallenge }) {
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === 'Enter') {
        onNewChallenge();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [onNewChallenge]);

  if (!feedback) return null;

  return (
    <div className={`feedback ${feedback.isCorrect ? 'correct' : 'incorrect'}`}>
      <div className="feedback-message">{feedback.message}</div>
      <Button onClick={onNewChallenge} className="new-challenge-btn">
        Next Challenge ↵
      </Button>
    </div>
  );
}
