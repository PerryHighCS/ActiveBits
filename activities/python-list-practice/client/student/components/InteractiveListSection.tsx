import type { ReactNode, MouseEvent } from 'react';

interface Challenge {
  op?: string;
  variant?: string;
  [key: string]: unknown;
}

interface InteractiveListSectionProps {
  challenge: Challenge;
  interactiveList: (string | number)[];
  isListBuildVariant: boolean;
  supportsSequenceSelection: boolean;  // Kept for API stability
  selectedRange: [number, number] | null;
  selectedSequence: number[];
  selectedIndex: number | null;
  selectedValueIndex: number | null;
  onIndexClick: (index: number, event: MouseEvent) => void;
  onValueClick: (index: number, event: MouseEvent) => void;
  allowDuplicateValues?: boolean;
}

export default function InteractiveListSection({
  challenge,
  interactiveList,
  isListBuildVariant,
  // @ts-expect-error - supportsSequenceSelection kept for API stability
  _supportsSequenceSelection,
  selectedRange,
  selectedSequence,
  selectedIndex,
  selectedValueIndex,
  onIndexClick,
  onValueClick,
  allowDuplicateValues = false,
}: InteractiveListSectionProps): ReactNode {
  if (interactiveList.length === 0) return null;

  const instructionText = isListBuildVariant
    ? 'Tap values to build the final list in order.'
    : challenge?.op === 'for-range'
      ? 'Tap values in order to build the output sequence.'
      : ['value-selection', 'number-choice', 'index-value'].includes(challenge?.variant as string)
        ? 'Tap values to answer the question.'
        : 'Tap indexes (to answer with the index) or values (to answer with the value).';

  return (
    <div className="python-list-visual mt-3">
      <div className="text-sm text-emerald-900 mb-2">
        {instructionText}
      </div>
      <div className="python-list-grid">
        {(() => {
          const seen = new Set<string>();
          return interactiveList.map((item, idx) => {
            const key = typeof item === 'string' ? `s:${item}` : `n:${item}`;
            const isDuplicate = !allowDuplicateValues && seen.has(key);
            if (!seen.has(key)) seen.add(key);
            if (isDuplicate) return null;
            const inRange = selectedRange && idx >= selectedRange[0] && idx <= selectedRange[1];
            const isSequenceSelected = selectedSequence.includes(idx);
            const isSelectedValue = selectedValueIndex === idx || isSequenceSelected;
            const showIndexButton = !isListBuildVariant
              && !['value-selection', 'number-choice', 'index-value'].includes(challenge?.variant as string);
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
                {isDuplicate ? null : (
                  <button
                    type="button"
                    className={`python-list-value-pill ${inRange ? 'range' :
                      isSelectedValue ? 'selected' : ''}`}
                    onClick={(e) => onValueClick(idx, e)}
                    title={`Value at index ${idx}`}
                  >
                    {String(item)}
                  </button>
                )}
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}
