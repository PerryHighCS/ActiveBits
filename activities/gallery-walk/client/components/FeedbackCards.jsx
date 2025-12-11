import React from 'react';

export default function FeedbackCards({ entries, isLoading }) {
  if (isLoading) {
    return <p className="text-center text-gray-600">Loading feedback…</p>;
  }

  if (!entries?.length) {
    return <p className="text-center text-gray-600">No feedback yet.</p>;
  }

  return (
    <div className="grid gap-4">
      {entries.map((entry) => (
        <div key={entry.id} className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 shadow-sm">
          <p className="text-sm font-semibold text-yellow-900">{entry.fromNameSnapshot || 'Reviewer'}</p>
          <p className="mt-1 text-gray-800 whitespace-pre-wrap">{entry.message}</p>
          {entry.createdAt && (
            <p className="mt-2 text-xs text-gray-500">{new Date(entry.createdAt).toLocaleString()}</p>
          )}
        </div>
      ))}
    </div>
  );
}
