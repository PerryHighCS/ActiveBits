import React from 'react';

export default function TitleEditor({ value, onChange, isSaving, error }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="manager-session-title" className="text-sm font-semibold text-gray-700">
          Session title
        </label>
        {error ? (
          <span className="text-xs text-red-600">{error}</span>
        ) : (
          <span className="text-xs text-gray-500">{isSaving ? 'Saving…' : 'Saved'}</span>
        )}
      </div>
      <input
        id="manager-session-title"
        type="text"
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="e.g., Spring Showcase"
      />
    </div>
  );
}
