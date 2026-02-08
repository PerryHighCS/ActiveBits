import { ReactNode } from 'react';
import FocusSummary from './FocusSummary.js';

interface QuestionType {
  id: string;
  label: string;
}

interface ControlsPanelProps {
  isSolo: boolean;
  soloQuestionTypes: QuestionType[];
  allowedTypes: Set<string>;
  handleSoloToggleType: (typeId: string) => void;
  allowedTypeList: string[];
  QUESTION_LABELS: Record<string, string>;
}

export default function ControlsPanel({
  isSolo,
  soloQuestionTypes,
  allowedTypes,
  handleSoloToggleType,
  allowedTypeList,
  QUESTION_LABELS,
}: ControlsPanelProps): ReactNode {
  return (
    <>
      {isSolo && (
        <div className="python-list-card">
          <p className="text-sm font-semibold text-emerald-900 mb-2">Choose question types</p>
          <div className="flex flex-wrap gap-2">
            {soloQuestionTypes.map((type) => (
              <button
                key={type.id}
                type="button"
                className={`python-list-chip ${allowedTypes.has(type.id) ? 'selected' : ''}`}
                onClick={() => handleSoloToggleType(type.id)}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {!isSolo && (
        <div className="python-list-card">
          <FocusSummary allowedTypeList={allowedTypeList} allowedTypes={allowedTypes} labels={QUESTION_LABELS} />
        </div>
      )}
    </>
  );
}
