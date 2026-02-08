import { ReactNode } from 'react';
import Button from '@src/components/ui/Button.js';

interface Challenge {
  prompt: string;
  question?: string;
  [key: string]: unknown;
}

interface QuestionHintSectionProps {
  challenge: Challenge | null;
  hintStage: 'none' | 'definition' | 'answer';
  showHintButtons: boolean;
  onShowHint: () => void;
  onShowAnswer: () => void;
  hintDefinition: string | ReactNode;
  answerDetails?: string[] | ReactNode[];  // Kept for API stability
  showHintBody?: boolean;
}

export default function QuestionHintSection({
  challenge,
  hintStage,
  showHintButtons,
  onShowHint,
  onShowAnswer,
  hintDefinition,
  // @ts-expect-error - answerDetails kept for API stability
  answerDetails,
  showHintBody = true,
}: QuestionHintSectionProps): ReactNode {
  if (!challenge) return null;

  return (
    <>
      <div className="python-list-prompt">
        <code className="block whitespace-pre-wrap text-sm">
          {challenge.prompt}
        </code>
      </div>
      <div className="python-list-question-row">
        <div className="python-list-question">
          <span>{challenge.question || 'What is the output?'}</span>
          {showHintButtons && (
            <div className="python-list-hint-controls">
              {hintStage === 'none' && (
                <Button className="python-list-hint-btn" onClick={onShowHint}>
                  💡 Show Hint
                </Button>
              )}
              {hintStage === 'definition' && (
                <Button className="python-list-hint-btn secondary" onClick={onShowAnswer}>
                  🎯 Show Answer
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      {hintStage !== 'none' && showHintBody && (
        <div className={`python-list-hint ${hintStage === 'answer' ? 'answer' : ''}`}>
          <div>{hintDefinition}</div>
        </div>
      )}
    </>
  );
}
