import React, { useEffect } from 'react';
import Button from '@src/components/ui/Button';

/**
 * AnswerSection - Input fields and submission UI for different challenge types
 * Handles text input, True/False buttons, and Positive/Zero/Negative buttons
 */
export default function AnswerSection({ 
  challenge, 
  userAnswer, 
  selectedIndices, 
  onAnswerChange, 
  onSubmit 
}) {
  const { type } = challenge;

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (type === 'equals' && (e.key === 't' || e.key === 'T')) {
        onSubmit(true);
      } else if (type === 'equals' && (e.key === 'f' || e.key === 'F')) {
        onSubmit(false);
      } else if (type === 'compareTo') {
        if (e.key === 'p' || e.key === 'P') {
          onSubmit('positive');
        } else if (e.key === 'z' || e.key === 'Z') {
          onSubmit(0);
        } else if (e.key === 'n' || e.key === 'N') {
          onSubmit('negative');
        }
      } else if (e.key === 'Enter' && userAnswer !== '') {
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
          type="text"
          className="answer-input"
          value={displayValue}
          onChange={(e) => onAnswerChange(e.target.value)}
          placeholder={
            type === 'substring' ? 'Type your answer or click letters above' :
            type === 'indexOf' ? 'Click a letter above or type the index' :
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
