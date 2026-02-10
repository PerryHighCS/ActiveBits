import React, { useMemo } from 'react';
import { hashStringFNV1a, normalizeKeyPart, toKeyLabel } from '../../shared/keyUtils.js';
import { getNoteStyleClassName, normalizeNoteStyleId } from '../../shared/noteStyles.js';

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

export function buildFeedbackCardKeys(entries: FeedbackCardEntry[]): string[] {
  const seenKeys = new Map<string, number>();

  return entries.map((entry) => {
    if (typeof entry.id === 'string' && entry.id.trim() !== '') {
      const idKey = `id:${entry.id}`;
      const occurrence = seenKeys.get(idKey) ?? 0;
      seenKeys.set(idKey, occurrence + 1);
      return occurrence === 0 ? idKey : `${idKey}#${occurrence + 1}`;
    }

    const createdAtPart = Number.isFinite(entry.createdAt) ? String(entry.createdAt) : 'na';
    const signature = [
      normalizeKeyPart(entry.fromNameSnapshot),
      createdAtPart,
      normalizeKeyPart(entry.message),
    ].join('\u001f');
    const compactKey = `card:${toKeyLabel(entry.fromNameSnapshot)}|${createdAtPart}|${hashStringFNV1a(signature)}`;
    const occurrence = seenKeys.get(compactKey) ?? 0;
    seenKeys.set(compactKey, occurrence + 1);
    return occurrence === 0 ? compactKey : `${compactKey}#${occurrence + 1}`;
  });
}

export default function FeedbackCards({ entries = [], isLoading = false }: FeedbackCardsProps): React.JSX.Element {
  if (isLoading) {
    return <p className="text-center text-gray-600">Loading feedback…</p>;
  }

  if (entries.length === 0) {
    return <p className="text-center text-gray-600">No feedback yet.</p>;
  }

  const cardKeys = useMemo(() => buildFeedbackCardKeys(entries), [entries]);

  return (
    <div className="feedback-cards flex flex-wrap gap-4 justify-start">
      {entries.map((entry, index) => {
        const styleClass = getNoteStyleClassName(normalizeNoteStyleId(entry?.styleId));
        return (
          <div
            key={cardKeys[index]}
            className={`feedback-card min-h-56 flex flex-col rounded-lg border border-black/5 p-4 shadow-md ${styleClass}`}
            style={{ minWidth: '12rem', width: '14rem', maxWidth: '18rem', flex: '0 0 14rem' }}
          >
            <p className="text-base font-semibold text-gray-900 whitespace-pre-wrap">{entry.message}</p>
            <div className="flex flex-col items-end gap-1 text-right mt-auto">
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
