import React from 'react';

/**
 * FeedbackDisplay - Shows correct/incorrect feedback with explanations as a modal dialog
 */
export default function FeedbackDisplay({ feedback, onNewChallenge, showNextButton = true, title = 'Feedback' }) {
  const feedbackReadyRef = React.useRef(false);
  const buttonRef = React.useRef(null);

  const handleDismiss = React.useCallback(() => {
    // For errors, just close without advancing by setting feedback to null
    // This is typically done by the parent component via setFeedback(null)
    if (feedback?.onDismiss) {
      feedback.onDismiss();
    }
  }, [feedback]);

  React.useEffect(() => {
    // Reset the ready flag when feedback changes (new problem)
    feedbackReadyRef.current = false;
  }, [feedback?.message]);

  React.useEffect(() => {
    if (!feedback) return;

    // Focus the button when feedback appears
    const focusTimer = setTimeout(() => {
      if (buttonRef.current) {
        buttonRef.current.focus();
      }
    }, 0);

    // Add a small delay to prevent the same Enter keystroke from triggering both
    // the answer check and the next challenge
    const readyTimer = setTimeout(() => {
      feedbackReadyRef.current = true;
    }, 100);

    const handleKeyPress = (e) => {
      if (e.key === 'Enter' && feedback && feedbackReadyRef.current) {
        // On Enter, advance to next challenge (only for correct answers)
        if (showNextButton && onNewChallenge) {
          onNewChallenge();
        }
      }
      // Allow Escape to close the modal without advancing
      if (e.key === 'Escape' && feedback && feedbackReadyRef.current) {
        handleDismiss();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => {
      clearTimeout(focusTimer);
      clearTimeout(readyTimer);
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [onNewChallenge, feedback, showNextButton, handleDismiss]);

  if (!feedback) return null;

  return (
    <div className="feedback-modal-overlay" onClick={handleDismiss}>
      <div 
        className={`feedback-modal ${feedback.isCorrect ? 'correct' : 'incorrect'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="feedback-modal-header">
          <h2 className="feedback-modal-title">{title}</h2>
        </div>
        <div className="feedback-modal-body">
          <div className="feedback-message" dangerouslySetInnerHTML={{ __html: feedback.message }} />
          {feedback.explanation && (
            <div className="feedback-explanation">{feedback.explanation}</div>
          )}
        </div>
        <div className="feedback-modal-footer">
          {showNextButton ? (
            <button ref={buttonRef} onClick={onNewChallenge} className="new-challenge-btn">
              Next Challenge
            </button>
          ) : (
            <button ref={buttonRef} onClick={handleDismiss} className="new-challenge-btn">
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
