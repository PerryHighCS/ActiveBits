import React from 'react';

export default function InteractiveListSection({
  challenge,
  interactiveList,
  isListBuildVariant,
  supportsSequenceSelection,
  selectedRange,
  selectedSequence,
  selectedIndex,
  selectedValueIndex,
  onIndexClick,
  onValueClick,
  onStartRange,
  onExtendRange,
  onFinishRange,
}) {
  if (!interactiveList.length) return null;

  const instructionText = isListBuildVariant
    ? 'Tap values to build the final list in order.'
    : challenge?.op === 'for-range'
      ? 'Tap values in order to build the output sequence.'
      : ['value-selection', 'number-choice', 'index-value'].includes(challenge?.variant)
        ? 'Tap values to answer the question.'
        : 'Tap indexes (to answer with the index) or values (to answer with the value).';

  return (
    <div className="python-list-visual mt-3">
      <div className="text-sm text-emerald-900 mb-2">
        {instructionText}
      </div>
      <div className="python-list-grid">
        {interactiveList.map((item, idx) => {
          const inRange = selectedRange && idx >= selectedRange[0] && idx <= selectedRange[1];
          const isSequenceSelected = selectedSequence.includes(idx);
          const isSelectedValue = selectedValueIndex === idx || isSequenceSelected;
          const showIndexButton = !isListBuildVariant
            && !['value-selection', 'number-choice', 'index-value'].includes(challenge?.variant);
          return (
            <div className="python-list-slot" key={`slot-${idx}`}>
              {showIndexButton && (
                <button
                  type="button"
                  className={`python-list-index-btn ${selectedIndex === idx ? 'selected' : ''}`}
                  onClick={(e) => onIndexClick(idx, e)}
                  title={`Index ${idx}`}
                >
                  {idx}
                </button>
              )}
              <button
                type="button"
                className={`python-list-value-pill ${inRange ? 'range' :
                  isSelectedValue ? 'selected' : ''}`}
                onClick={(e) => onValueClick(idx, e)}
                onMouseDown={() => supportsSequenceSelection && onStartRange(idx)}
                onMouseEnter={() => supportsSequenceSelection && onExtendRange(idx)}
                onMouseUp={() => supportsSequenceSelection && onFinishRange()}
                title={`Value at index ${idx}`}
              >
                {String(item)}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
