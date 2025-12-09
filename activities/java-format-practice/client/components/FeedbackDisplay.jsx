import React from 'react';

/**
 * FeedbackDisplay - Shows correct/incorrect feedback with explanations as a modal dialog
 * Includes accessibility features: ARIA attributes, focus trap, keyboard navigation
 */
export default function FeedbackDisplay({ feedback, onNewChallenge, showNextButton = true, title = 'Feedback' }) {
  const feedbackReadyRef = React.useRef(false);
  const buttonRef = React.useRef(null);
  const modalRef = React.useRef(null);
  const overlayRef = React.useRef(null);
  const previousActiveElementRef = React.useRef(null);

  const handleDismiss = React.useCallback(() => {
    // For errors, just close without advancing by setting feedback to null
    // This is typically done by the parent component via setFeedback(null)
    if (feedback?.onDismiss) {
      // Use setTimeout to allow the modal to close first before focusing the input
      // This prevents the modal from stealing focus from the newly focused input
      setTimeout(() => {
        feedback.onDismiss();
      }, 0);
    }
  }, [feedback]);

  React.useEffect(() => {
    // Reset the ready flag when feedback changes (new problem)
    feedbackReadyRef.current = false;
  }, [feedback?.message]);

  React.useEffect(() => {
    if (!feedback) return;

    // Store the previously focused element so we can restore it when modal closes
    previousActiveElementRef.current = document.activeElement;

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
      // Handle Tab key for focus trap
      if (e.key === 'Tab' && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          // Shift + Tab
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          // Tab
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => {
      clearTimeout(focusTimer);
      clearTimeout(readyTimer);
      window.removeEventListener('keydown', handleKeyPress);
      // Restore focus to the previously focused element when modal closes
      if (previousActiveElementRef.current && previousActiveElementRef.current.focus) {
        previousActiveElementRef.current.focus();
      }
    };
  }, [onNewChallenge, feedback, showNextButton, handleDismiss]);

  if (!feedback) return null;

  return (
    <div
      ref={overlayRef}
      className="feedback-modal-overlay"
      onClick={handleDismiss}
      role="presentation"
      aria-hidden="false"
    >
      <div
        ref={modalRef}
        className={`feedback-modal ${feedback.isCorrect ? 'correct' : 'incorrect'}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-modal-title"
      >
        <div className="feedback-modal-header">
          <h2 id="feedback-modal-title" className="feedback-modal-title">{title}</h2>
        </div>
        <div className="feedback-modal-body">
          {typeof feedback.message === 'string' ? (
            <div className="feedback-message" dangerouslySetInnerHTML={{ __html: feedback.message }} />
          ) : Array.isArray(feedback.message) ? (
            <div className="feedback-message">
              {feedback.message.map((line, idx) => (
                <div key={idx}>
                  {typeof line === 'string' ? line : (
                    <>
                      {line.text && <span>{line.text}</span>}
                      {line.emphasis && <b>{line.emphasis}</b>}
                      {line.textAfter && <span>{line.textAfter}</span>}
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="feedback-message">{feedback.message}</div>
          )}
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
