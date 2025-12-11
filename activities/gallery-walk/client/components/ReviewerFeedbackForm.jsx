import React from 'react';
import Button from '@src/components/ui/Button';

export default function ReviewerFeedbackForm({
  projectTitle,
  stageBadge,
  message,
  onMessageChange,
  notice,
  isSubmitting,
  onSubmit,
  onScan,
  onCameraFallback,
  scannerError,
}) {
  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Feedback form</h2>
          <p className="text-gray-600 text-sm">
            Reviewing <span className="font-semibold">{projectTitle || 'this project'}</span>
          </p>
        </div>
        {stageBadge}
      </div>
      <form onSubmit={onSubmit} className="space-y-3">
        <textarea
          className="w-full rounded border border-gray-300 px-3 py-2"
          rows={5}
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          placeholder="Share what you liked and what could improve"
        />
        {notice && <p className="text-sm text-indigo-700">{notice}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Sending…' : 'Submit feedback'}
        </Button>
      </form>
      <div className="flex flex-col gap-2">
        <Button type="button" variant="outline" onClick={onScan}>
          Scan QR to review another project
        </Button>
        <button type="button" className="text-sm text-blue-600 underline" onClick={onCameraFallback}>
          Use your camera app instead
        </button>
      </div>
      {scannerError === 'scanner-unavailable' && (
        <p className="text-sm text-red-600">
          Your browser will not open the scanner. Use your phone’s camera app to scan the next code.
        </p>
      )}
      {scannerError === 'scanner-invalid' && (
        <p className="text-sm text-red-600">
          That QR code was not for this session. Make sure you scan the code shown on this station.
        </p>
      )}
    </div>
  );
}
