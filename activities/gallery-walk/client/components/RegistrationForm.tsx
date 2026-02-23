import React from 'react';
import Button from '@src/components/ui/Button';

interface RegistrationFormProps {
  name: string;
  projectTitle: string;
  onNameChange: (value: string) => void;
  onProjectChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  error?: string | null;
  isSubmitting?: boolean;
}

export default function RegistrationForm({
  name,
  projectTitle,
  onNameChange,
  onProjectChange,
  onSubmit,
  error,
  isSubmitting = false,
}: RegistrationFormProps): React.JSX.Element {
  const errorId = error ? 'reviewee-name-error' : undefined;
  return (
    <form onSubmit={onSubmit} className="space-y-4 bg-white shadow rounded-lg p-6">
      <div>
        <h2 className="text-xl font-semibold">Prepare for review</h2>
        <p className="text-gray-600 mt-1">
          Enter your name(s) (and optional project title). This information is sent to the teacher.
        </p>
      </div>
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1" htmlFor="reviewee-name-input">Your name(s)</label>
        <input
          id="reviewee-name-input"
          type="text"
          className="w-full rounded border border-gray-300 px-3 py-2"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          aria-required="true"
          aria-invalid={Boolean(error)}
          aria-describedby={errorId}
        />
      </div>
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">Project title (optional)</label>
        <input
          type="text"
          className="w-full rounded border border-gray-300 px-3 py-2"
          value={projectTitle}
          onChange={(e) => onProjectChange(e.target.value)}
        />
      </div>
      {error && (
        <p id={errorId} className="text-sm text-red-600" aria-live="polite">
          {error}
        </p>
      )}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Registering…' : 'Save and continue'}
      </Button>
    </form>
  );
}
