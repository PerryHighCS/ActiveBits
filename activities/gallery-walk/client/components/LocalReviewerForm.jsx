import React from 'react';

export default function LocalReviewerForm({
  reviewerName,
  message,
  onNameChange,
  onMessageChange,
  onSubmit,
  disabled,
  notice,
  isSubmitting,
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">Reviewer name</label>
        <input
          type="text"
          className="w-full rounded border border-gray-300 px-3 py-2"
          value={reviewerName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Enter your name"
          disabled={disabled}
        />
      </div>
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">Feedback message</label>
        <textarea
          className="w-full rounded border border-gray-300 px-3 py-2"
          rows={4}
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          placeholder="Leave your feedback here"
          disabled={disabled}
        />
      </div>
      {notice && <p className="text-sm text-indigo-700">{notice}</p>}
      <button
        type="submit"
        className="inline-flex items-center justify-center rounded bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
        disabled={isSubmitting || disabled}
      >
        {isSubmitting ? 'Sending…' : 'Submit feedback'}
      </button>
    </form>
  );
}
