import React from 'react';

export default function HintDisplay({ hintStage, hintDefinition, answerDetails, expected }) {
  if (hintStage === 'none') return null;

  return (
    <div className={`python-list-hint ${hintStage === 'answer' ? 'answer' : ''}`}>
      <div>{hintDefinition}</div>
      {hintStage === 'answer' && (
        <div className="python-list-hint-answer">
          <div>Answer: {expected}</div>
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
