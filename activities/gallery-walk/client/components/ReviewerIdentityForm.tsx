import React from 'react';
import Button from '@src/components/ui/Button';

interface ReviewerIdentityFormProps {
  nameInput: string;
  onNameChange: (value: string) => void;
  error?: string | null;
  hasExistingName?: boolean;
  isSaving?: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

export default function ReviewerIdentityForm({
  nameInput,
  onNameChange,
  error,
  hasExistingName = false,
  isSaving = false,
  onSubmit,
}: ReviewerIdentityFormProps): React.JSX.Element {
  const errorId = error ? 'reviewer-identity-error' : undefined;
  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-gray-200 bg-white p-6 shadow">
      <h2 className="text-xl font-semibold">Introduce yourself</h2>
      <p className="text-sm text-gray-600">
        Enter your name once. We&apos;ll remember it on this device for the rest of the gallery walk.
      </p>
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1" htmlFor="reviewer-identity-name">Your name</label>
        <input
          id="reviewer-identity-name"
          type="text"
          className="w-full rounded border border-gray-300 px-3 py-2"
          value={nameInput}
          onChange={(e) => onNameChange(e.target.value)}
          aria-required="true"
          aria-invalid={Boolean(error)}
          aria-describedby={errorId}
        />
      </div>
      {error && (
        <p id={errorId} className="text-sm text-red-600" aria-live="polite">
          {error}
        </p>
      )}
      <Button type="submit" disabled={isSaving}>
        {hasExistingName ? (isSaving ? 'Updating…' : 'Update name') : (isSaving ? 'Saving…' : 'Continue')}
      </Button>
    </form>
  );
}
