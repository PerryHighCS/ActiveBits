import React from 'react';
import Button from '@src/components/ui/Button';
import NoteStyleSelect from './NoteStyleSelect.jsx';
import { getNoteStyleClassName, normalizeNoteStyleId } from '../../shared/noteStyles.js';

export default function ReviewerFeedbackForm({
  projectTitle,
  message,
  onMessageChange,
  notice,
  isSubmitting,
  onSubmit,
  onCancel,
  onScan,
  scannerError,
  canScan,
  styleId,
  onStyleChange,
}) {
  const noteStyleClass = getNoteStyleClassName(normalizeNoteStyleId(styleId));
  return (
    <div className="space-y-4 rounded-none border-0 bg-transparent p-0 sm:rounded-lg sm:border sm:border-gray-200 sm:bg-white sm:p-6 sm:shadow">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">
            Reviewing <span className="font-semibold">{projectTitle || 'this project'}</span>
          </h2>
        </div>
        <NoteStyleSelect value={styleId} onChange={onStyleChange} label="Note style" />
      </div>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className={`note-style-field ${noteStyleClass}`}>
          <textarea
            className="w-full border-0 bg-transparent px-3 py-2 text-gray-900 placeholder-gray-600 focus:outline-none focus:ring-0"
            rows={5}
            value={message}
            onChange={(e) => onMessageChange(e.target.value)}
            placeholder="Share what you liked and what could improve"
          />
        </div>
        {notice && <p className="text-sm text-indigo-700">{notice}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Sending…' : 'Submit feedback'}
          </Button>
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
              Cancel
            </Button>
          )}
        </div>
      </form>
      {canScan && (
        <Button type="button" variant="outline" onClick={onScan}>
          Scan QR to review another project
        </Button>
      )}
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
