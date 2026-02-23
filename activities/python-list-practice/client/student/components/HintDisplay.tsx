import type { ReactNode } from 'react';

interface HintDisplayProps {
  hintStage: 'none' | 'definition' | 'answer';
  hintDefinition: string | ReactNode;
  answerDetails?: string[] | ReactNode[];
  expected: unknown;
}

export default function HintDisplay({ hintStage, hintDefinition, answerDetails, expected }: HintDisplayProps): ReactNode {
  if (hintStage === 'none') return null;

  return (
    <div className={`python-list-hint ${hintStage === 'answer' ? 'answer' : ''}`}>
      <div>{hintDefinition}</div>
      {hintStage === 'answer' && (
        <div className="python-list-hint-answer">
          <div>Answer: {String(expected)}</div>
          {(answerDetails || []).map((detail, idx) => (
            <div key={`answer-detail-${idx}`} className="python-list-hint-detail">
              {detail}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
