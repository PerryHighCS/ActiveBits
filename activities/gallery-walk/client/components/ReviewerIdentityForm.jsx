import React from 'react';
import Button from '@src/components/ui/Button';

export default function ReviewerIdentityForm({
  nameInput,
  onNameChange,
  error,
  hasExistingName,
  isSaving,
  onSubmit,
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-gray-200 bg-white p-6 shadow">
      <h2 className="text-xl font-semibold">Introduce yourself</h2>
      <p className="text-sm text-gray-600">
        Enter your name once. We&apos;ll remember it on this device for the rest of the gallery walk.
      </p>
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">Your name</label>
        <input
          type="text"
          className="w-full rounded border border-gray-300 px-3 py-2"
          value={nameInput}
          onChange={(e) => onNameChange(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={isSaving}>
        {hasExistingName ? (isSaving ? 'Updating…' : 'Update name') : (isSaving ? 'Saving…' : 'Continue')}
      </Button>
    </form>
  );
}
