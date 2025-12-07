import React from 'react';
import CharacterGrid from './CharacterGrid';

/**
 * FeedbackDisplay - Shows correct/incorrect feedback with explanations
 */
export default function FeedbackDisplay({ feedback, onNewChallenge, showNextButton = true }) {
  const feedbackReadyRef = React.useRef(false);

  React.useEffect(() => {
    // Reset the ready flag when feedback changes (new problem)
    feedbackReadyRef.current = false;
  }, [feedback?.message]);

  React.useEffect(() => {
    if (!feedback || !showNextButton) return;

    // Add a small delay to prevent the same Enter keystroke from triggering both
    // the answer check and the next challenge
    const timer = setTimeout(() => {
      feedbackReadyRef.current = true;
    }, 100);

    const handleKeyPress = (e) => {
      if (e.key === 'Enter' && feedback && feedbackReadyRef.current) {
        onNewChallenge();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [onNewChallenge, feedback, showNextButton]);

  if (!feedback) return null;

  return (
    <div className={`feedback ${feedback.isCorrect ? 'correct' : 'incorrect'}`}>
      <div className="feedback-message" dangerouslySetInnerHTML={{ __html: feedback.message }} />
      {feedback.explanation && (
        <div className="feedback-explanation">{feedback.explanation}</div>
      )}
      {showNextButton && (
        <button onClick={onNewChallenge} className="new-challenge-btn">
          Next Challenge ↵
        </button>
      )}
    </div>
  );
}
