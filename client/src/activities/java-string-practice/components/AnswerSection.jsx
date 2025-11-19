import React, { useEffect, useRef } from 'react';
import Button from '@src/components/ui/Button';

/**
 * AnswerSection - Input fields and submission UI for different challenge types
 * Handles text input, True/False buttons, and Positive/Zero/Negative buttons
 * 
 * IMPORTANT: This component should only be rendered when feedback is NOT shown.
 * The parent component (JavaStringPractice.jsx) conditionally renders this with
 * {!feedback && <AnswerSection ... />} to ensure keyboard shortcuts are only
 * active during answer input, not during feedback display.
 * 
 * Keyboard shortcuts:
 * - equals challenges: T (true), F (false)
 * - compareTo challenges: P (positive), Z (zero), N (negative)
 * - text input challenges: Enter (submit)
 * 
 * @param {Object} props
 * @param {Object} props.challenge - Current challenge object with type and question
 * @param {string} props.userAnswer - Current user answer text
 * @param {Array<number>} props.selectedIndices - Indices selected by clicking
 * @param {Function} props.onAnswerChange - Callback when answer text changes
 * @param {Function} props.onSubmit - Callback when answer is submitted
 */
export default function AnswerSection({ 
  challenge, 
  userAnswer, 
  selectedIndices, 
  onAnswerChange, 
  onSubmit 
}) {
  const { type } = challenge;
  const inputRef = useRef(null);

  // Auto-focus input field when challenge changes (for text input types)
  useEffect(() => {
    if (inputRef.current && (type === 'substring' || type === 'indexOf' || type === 'length')) {
      inputRef.current.focus();
    }
  }, [challenge, type]);

  // Handle keyboard shortcuts for answer submission
  // NOTE: This component is unmounted when feedback is shown (see parent component),
  // so these listeners are automatically cleaned up and don't interfere with other shortcuts
  useEffect(() => {
    const handleKeyPress = (e) => {
      // Ignore if user is typing in an input field (except for Enter key)
      if (e.target.tagName === 'INPUT' && e.key !== 'Enter') {
        return;
      }

      if (type === 'equals' && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        onSubmit(true);
      } else if (type === 'equals' && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        onSubmit(false);
      } else if (type === 'compareTo') {
        if (e.key === 'p' || e.key === 'P') {
          e.preventDefault();
          onSubmit('positive');
        } else if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault();
          onSubmit(0);
        } else if (e.key === 'n' || e.key === 'N') {
          e.preventDefault();
          onSubmit('negative');
        }
      } else if (e.key === 'Enter' && userAnswer !== '') {
        e.preventDefault();
        onSubmit(userAnswer);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [type, userAnswer, onSubmit]);

  // For substring with 2 selected indices, show the selected text
  const displayValue = type === 'substring' && selectedIndices.length === 2
    ? userAnswer
    : userAnswer;

  if (type === 'equals') {
    return (
      <div className="answer-section">
        <div className="answer-buttons">
          <Button
            onClick={() => onSubmit(true)}
            className="answer-btn true-btn"
          >
            True (T)
          </Button>
          <Button
            onClick={() => onSubmit(false)}
            className="answer-btn false-btn"
          >
            False (F)
          </Button>
        </div>
      </div>
    );
  }

  if (type === 'compareTo') {
    return (
      <div className="answer-section">
        <div className="compareTo-hint">
          Choose the sign of the result:
        </div>
        <div className="answer-buttons compareTo-buttons">
          <Button
            onClick={() => onSubmit('positive')}
            className="answer-btn positive-btn"
          >
            Positive (P)
          </Button>
          <Button
            onClick={() => onSubmit(0)}
            className="answer-btn zero-btn"
          >
            Zero (Z)
          </Button>
          <Button
            onClick={() => onSubmit('negative')}
            className="answer-btn negative-btn"
          >
            Negative (N)
          </Button>
        </div>
      </div>
    );
  }

  // Text input for substring, indexOf, length
  return (
    <div className="answer-section">
      <div className="answer-input-row">
        <input
          ref={inputRef}
          type="text"
          className="answer-input"
          value={displayValue}
          onChange={(e) => onAnswerChange(e.target.value)}
          placeholder={
            type === 'substring' ? 'Click letters for text or indices for numbers' :
            type === 'indexOf' ? 'Click indices for numbers or letters for text' :
            'Type your answer'
          }
          disabled={type === 'substring' && selectedIndices.length === 2}
        />
        <Button
          onClick={() => onSubmit(userAnswer)}
          disabled={userAnswer === ''}
          className="submit-btn"
        >
          Submit ↵
        </Button>
      </div>
      {type === 'substring' && selectedIndices.length === 1 && (
        <div className="selection-hint">
          Click another letter to complete your selection
        </div>
      )}
    </div>
  );
}
