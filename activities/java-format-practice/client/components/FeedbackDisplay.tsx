import React from 'react';
import type { JavaFormatFeedback } from '../../javaFormatPracticeTypes.js'

interface FeedbackDisplayProps {
  feedback: JavaFormatFeedback | null
  onNewChallenge?: (() => void) | null
  showNextButton?: boolean
  title?: string
}

/**
 * FeedbackDisplay - Shows correct/incorrect feedback with explanations as a modal dialog
 * Includes accessibility features: ARIA attributes, focus trap, keyboard navigation
 */
export default function FeedbackDisplay({
  feedback,
  onNewChallenge,
  showNextButton = true,
  title = 'Feedback',
}: FeedbackDisplayProps) {
    const dismissHandlerRef = React.useRef<(() => void) | undefined>(undefined);

    // Always keep the latest dismiss handler in the ref
    React.useEffect(() => {
      dismissHandlerRef.current = feedback?.onDismiss;
    }, [feedback]);
  const feedbackReadyRef = React.useRef(false);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const modalRef = React.useRef<HTMLDivElement | null>(null);
  const overlayRef = React.useRef<HTMLDivElement | null>(null);
  const previousActiveElementRef = React.useRef<Element | null>(null);

  const handleDismiss = React.useCallback(() => {
    // For errors, call the dismiss callback which will focus the error input
    // For correct answers, call onNewChallenge via the button click
    if (dismissHandlerRef.current) {
      dismissHandlerRef.current();
    }
  }, []);

  React.useEffect(() => {
    // Reset the ready flag when feedback changes (new problem)
    feedbackReadyRef.current = false;
  }, [feedback?.message]);

  React.useEffect(() => {
    if (!feedback) return;

    // Store the previously focused element so we can restore it when modal closes
    previousActiveElementRef.current = document.activeElement;

    // For correct answers, focus the button when feedback appears
    // For errors, let the error input get focused via the dismiss callback
    let focusTimer: ReturnType<typeof setTimeout> | undefined
    if (feedback.isCorrect) {
      focusTimer = setTimeout(() => {
        if (buttonRef.current) {
          buttonRef.current.focus();
        }
      }, 0);
    }

    // Add a small delay to prevent the same Enter keystroke from triggering both
    // the answer check and the next challenge
    const readyTimer = setTimeout(() => {
      feedbackReadyRef.current = true;
    }, 100);

    const handleKeyPress = (e: KeyboardEvent) => {
      // Guard against feedback becoming null while handler is still attached
      if (!feedback) return;

      // Don't handle keyboard events if the button is focused (let the button's onClick handle it)
      if (e.target === buttonRef.current) {
        return;
      }
      // Enter: advance for correct, dismiss for incorrect
      if (e.key === 'Enter' && feedbackReadyRef.current) {
        if (feedback.isCorrect) {
          if (showNextButton && onNewChallenge) {
            onNewChallenge();
          }
        } else {
          // Dismiss modal and focus error input
          if (dismissHandlerRef.current) dismissHandlerRef.current();
        }
      }
      // Escape always dismisses modal and clears feedback
      if (e.key === 'Escape' && feedbackReadyRef.current) {
        if (dismissHandlerRef.current) dismissHandlerRef.current();
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
            (lastElement as HTMLElement | undefined)?.focus();
          }
        } else {
          // Tab
          if (document.activeElement === lastElement) {
            e.preventDefault();
            (firstElement as HTMLElement | undefined)?.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => {
      clearTimeout(focusTimer);
      clearTimeout(readyTimer);
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, [onNewChallenge, showNextButton, feedback]);

  // Restore focus ONLY when modal is dismissed (feedback becomes null)
  React.useEffect(() => {
    if (feedback === null && previousActiveElementRef.current instanceof HTMLElement) {
      previousActiveElementRef.current.focus();
    }
  }, [feedback]);

  if (!feedback) return null;

  return (
    <div
      ref={overlayRef}
      className="feedback-modal-overlay"
      onClick={handleDismiss}
      role="presentation"
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
          {typeof feedback.explanation === 'string' && feedback.explanation.length > 0 && (
            <div className="feedback-explanation">{feedback.explanation}</div>
          )}
        </div>
        <div className="feedback-modal-footer">
          {showNextButton ? (
            <button ref={buttonRef} onClick={onNewChallenge ?? undefined} className="new-challenge-btn">
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
