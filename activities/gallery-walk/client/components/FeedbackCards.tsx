import React from 'react';
import { getNoteStyleClassName, normalizeNoteStyleId } from '../../shared/noteStyles';

interface FeedbackCardEntry {
  id?: string;
  message?: string;
  fromNameSnapshot?: string;
  createdAt?: number;
  styleId?: string;
}

interface FeedbackCardsProps {
  entries?: FeedbackCardEntry[];
  isLoading?: boolean;
}

export default function FeedbackCards({ entries = [], isLoading = false }: FeedbackCardsProps): React.JSX.Element {
  if (isLoading) {
    return <p className="text-center text-gray-600">Loading feedback…</p>;
  }

  if (entries.length === 0) {
    return <p className="text-center text-gray-600">No feedback yet.</p>;
  }

  return (
    <div className="feedback-cards flex flex-wrap gap-4 justify-start">
      {entries.map((entry, index) => {
        const styleClass = getNoteStyleClassName(normalizeNoteStyleId(entry?.styleId));
        return (
          <div
            key={entry.id ?? `feedback-card-${index}`}
            className={`feedback-card min-h-[14rem] flex flex-col rounded-lg border border-black/5 p-4 shadow-md ${styleClass}`}
            style={{ minWidth: '12rem', width: '14rem', maxWidth: '18rem', flex: '0 0 14rem' }}
          >
            <p className="text-base font-semibold text-gray-900 whitespace-pre-wrap">{entry.message}</p>
            <div className="mt-4 flex flex-col items-end gap-1 text-right mt-auto">
              <p className="text-sm font-semibold text-gray-800">
                {entry.fromNameSnapshot || 'Reviewer'}
              </p>
              {entry.createdAt != null && (
                <p className="text-xs text-gray-600">{new Date(entry.createdAt).toLocaleString()}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
