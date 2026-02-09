import type { ReactNode } from 'react';
import Button from '@src/components/ui/Button.js';

interface Feedback {
  isCorrect: boolean;
  message: string | ReactNode;
}

interface Challenge {
  type?: string;
  [key: string]: unknown;
}

interface AnswerPanelProps {
  answer: string;
  onAnswerChange: (value: string) => void;
  challenge: Challenge;
  answerRef: React.RefObject<HTMLInputElement | null>;
  disabled: boolean;
  loading: boolean;
  onSubmit: () => void;
  onClear: () => void;
  feedback: Feedback | null;
  onNext: () => void;
}

export default function AnswerPanel({
  answer,
  onAnswerChange,
  challenge,
  answerRef,
  disabled,
  loading,
  onSubmit,
  onClear,
  feedback,
  onNext,
}: AnswerPanelProps): ReactNode {
  return (
    <div className="python-list-card python-list-answer-panel">
      <label className="python-list-label">
        Your Answer
        <input
          ref={answerRef}
          value={answer}
          onChange={(e) => onAnswerChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !disabled) {
              e.preventDefault();
              if (!loading && answer.trim()) {
                onSubmit();
              }
            }
          }}
          className="python-list-input mt-1"
          placeholder="Type your answer (comma-separated for multiple values)"
          disabled={disabled}
        />
      </label>
      {challenge.type === 'list' && (
        <p className="text-xs text-emerald-700 mt-1">Enter values separated by commas.</p>
      )}
      {!disabled && (
        <div className="flex gap-2 mt-3">
          <Button
            onClick={onSubmit}
            disabled={loading || !answer.trim()}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            Check
          </Button>
          <Button
            variant="outline"
            onClick={onClear}
            className="border-emerald-300 text-emerald-800 hover:bg-emerald-50"
          >
            Clear
          </Button>
        </div>
      )}
      {feedback && (
        <div className={`python-list-feedback ${feedback.isCorrect ? 'correct' : 'incorrect'} feedback-with-action`}>
          <div className="feedback-message">{feedback.message}</div>
          {disabled && (
            <div className="feedback-action">
              <Button
                onClick={onNext}
                className="bg-emerald-700 hover:bg-emerald-800 text-white"
              >
                Next Challenge
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
