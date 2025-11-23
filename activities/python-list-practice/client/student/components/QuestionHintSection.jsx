import React from 'react';
import Button from '@src/components/ui/Button';

export default function QuestionHintSection({
  challenge,
  hintStage,
  showHintButtons,
  onShowHint,
  onShowAnswer,
  hintDefinition,
  answerDetails,
  showHintBody = true,
}) {
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
