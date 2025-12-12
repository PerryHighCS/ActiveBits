import React from 'react';
import NoteStyleSelect from './NoteStyleSelect.jsx';
import { getNoteStyleClassName, normalizeNoteStyleId } from '../../shared/noteStyles.js';

export default function LocalReviewerForm({
  reviewerName,
  message,
  onNameChange,
  onMessageChange,
  onSubmit,
  onCancel,
  styleId,
  onStyleChange,
  disabled,
  notice,
  isSubmitting,
}) {
  const noteStyleClass = getNoteStyleClassName(normalizeNoteStyleId(styleId));
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:gap-4">
        <div className="flex flex-1 flex-col gap-1">
          <label className="block text-sm font-semibold text-gray-700">Reviewer name</label>
          <input
            type="text"
            className="w-full rounded border border-gray-300 px-3 py-2"
            value={reviewerName}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Enter your name"
            disabled={disabled}
          />
        </div>
        <div className="md:w-56">
          <NoteStyleSelect value={styleId} onChange={onStyleChange} label="Note style" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">Feedback message</label>
        <div className={`note-style-field ${noteStyleClass}`}>
          <textarea
            className="w-full border-0 bg-transparent px-3 py-2 text-gray-900 placeholder-gray-600 focus:outline-none focus:ring-0"
            rows={4}
            value={message}
            onChange={(e) => onMessageChange(e.target.value)}
            placeholder="Leave your feedback here"
            disabled={disabled}
          />
        </div>
      </div>
      {notice && <p className="text-sm text-indigo-700">{notice}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          disabled={isSubmitting || disabled}
        >
          {isSubmitting ? 'Sending…' : 'Submit feedback'}
        </button>
        {onCancel && (
          <button
            type="button"
            className="inline-flex items-center justify-center rounded border border-gray-300 px-4 py-2 font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
