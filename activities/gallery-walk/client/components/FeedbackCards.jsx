import React from 'react';
import { getNoteStyleClassName, normalizeNoteStyleId } from '../../shared/noteStyles.js';

export default function FeedbackCards({ entries, isLoading }) {
  if (isLoading) {
    return <p className="text-center text-gray-600">Loading feedback…</p>;
  }

  if (!entries?.length) {
    return <p className="text-center text-gray-600">No feedback yet.</p>;
  }

  return (
    <div className="flex flex-wrap gap-4 justify-start">
      {entries.map((entry) => {
        const styleClass = getNoteStyleClassName(normalizeNoteStyleId(entry?.styleId));
        return (
          <div
            key={entry.id}
            className={`min-h-[14rem] flex flex-col rounded-lg border border-black/5 p-4 shadow-md ${styleClass}`}
            style={{ minWidth: '12rem', width: '14rem', maxWidth: '18rem' }}
          >
            <p className="text-base font-semibold text-gray-900 whitespace-pre-wrap">{entry.message}</p>
            <div className="mt-4 flex flex-col items-end gap-1 text-right mt-auto">
              <p className="text-sm font-semibold text-gray-800">
                {entry.fromNameSnapshot || 'Reviewer'}
              </p>
              {entry.createdAt && (
                <p className="text-xs text-gray-600">{new Date(entry.createdAt).toLocaleString()}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
