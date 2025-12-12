import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
} from 'react';
import Button from '@src/components/ui/Button';
import FeedbackCards from './FeedbackCards.jsx';
import { getTimestampMeta } from '../manager/managerUtils.js';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export default function GalleryWalkSoloViewer() {
  const fileInputRef = useRef(null);
  const [fileResult, setFileResult] = useState(null);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState('notes');
  const [notesReviewee, setNotesReviewee] = useState('all');

  useEffect(() => {
    if (!fileResult) return;
    setViewMode(fileResult.type === 'teacher' ? 'table' : 'notes');
    setNotesReviewee('all');
  }, [fileResult]);

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const feedback = Array.isArray(data.feedback) ? data.feedback : [];
      const base = {
        sessionId: data.sessionId || 'unknown',
        exportedAt: data.exportedAt || Date.now(),
        feedback,
      };
      if (isPlainObject(data.reviewees)) {
        setFileResult({
          type: 'teacher',
          fileName: file.name,
          data: {
            ...base,
            reviewees: data.reviewees,
            reviewers: isPlainObject(data.reviewers) ? data.reviewers : {},
          },
        });
        setError(null);
        return;
      }
      const revieweeId = data.revieweeId
        || Object.keys(isPlainObject(data.reviewees) ? data.reviewees : {})[0]
        || 'student';
      const revieweeRecord = data.reviewee
        || (isPlainObject(data.reviewees) ? data.reviewees[revieweeId] : null)
        || null;
      setFileResult({
        type: 'student',
        fileName: file.name,
        data: {
          ...base,
          revieweeId,
          reviewee: revieweeRecord,
        },
      });
      setError(null);
    } catch (err) {
      console.error('Failed to read solo feedback file', err);
      setFileResult(null);
      setError('Unable to read file. Upload a Gallery Walk export (.gw).');
    } finally {
      if (event.target) event.target.value = '';
    }
  };

  const sortedFeedback = useMemo(() => {
    if (!fileResult) return [];
    return [...(fileResult.data.feedback || [])].sort(
      (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    );
  }, [fileResult]);

  const feedbackByReviewee = useMemo(() => {
    return sortedFeedback.reduce((acc, entry) => {
      if (!entry?.to) return acc;
      acc[entry.to] = acc[entry.to] || [];
      acc[entry.to].push(entry);
      return acc;
    }, {});
  }, [sortedFeedback]);

  const renderTeacherTable = () => {
    const reviewees = fileResult?.data?.reviewees || {};
    const reviewers = fileResult?.data?.reviewers || {};
    return (
      <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white shadow print:border-0 print:shadow-none">
        <table className="min-w-full divide-y divide-gray-200 text-sm print:text-xs">
          <thead className="bg-gray-50 print:bg-white">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">To</th>
              <th className="px-4 py-3 text-left font-semibold">From</th>
              <th className="px-4 py-3 text-left font-semibold">Posted</th>
              <th className="px-4 py-3 text-left font-semibold">Message</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sortedFeedback.map((entry) => {
              const recipient = reviewees[entry.to];
              const timestamp = getTimestampMeta(entry.createdAt);
              const screenText = timestamp.date
                ? (timestamp.showDateOnScreen
                  ? `${timestamp.date.toLocaleDateString()} ${timestamp.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                  : timestamp.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
                : '—';
              const printText = timestamp.date
                ? `${timestamp.date.toLocaleDateString()} ${timestamp.date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                : '—';
              return (
                <tr key={entry.id}>
                  <td className="px-4 py-3">
                    {recipient?.name || recipient?.projectTitle || entry.to || '—'}
                  </td>
                  <td className="px-4 py-3">{entry.fromNameSnapshot || reviewers[entry.from]?.name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">
                    <span className="print:hidden">{screenText}</span>
                    <span className="hidden print:inline">{printText}</span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="whitespace-pre-wrap">{entry.message}</p>
                  </td>
                </tr>
              );
            })}
            {!sortedFeedback.length && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                  No feedback entries in this file.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  const renderTeacherNotes = () => {
    const reviewees = fileResult?.data?.reviewees || {};
    const revieweeEntries = Object.entries(reviewees);
    const selectedIds = notesReviewee === 'all'
      ? revieweeEntries.map(([id]) => id)
      : revieweeEntries.some(([id]) => id === notesReviewee)
        ? [notesReviewee]
        : [];
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 print:hidden">
          <label htmlFor="solo-notes-select" className="text-sm font-semibold text-gray-700">Student view</label>
          <select
            id="solo-notes-select"
            className="rounded border border-gray-300 px-3 py-1 text-sm"
            value={notesReviewee}
            onChange={(e) => setNotesReviewee(e.target.value)}
          >
            <option value="all">All students</option>
            {revieweeEntries.map(([id, info]) => (
              <option key={id} value={id}>
                {info?.name || info?.projectTitle || id}
              </option>
            ))}
          </select>
        </div>
        <div className="manager-notes-grid grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {selectedIds.map((id) => {
            const cards = feedbackByReviewee[id] || [];
            const info = reviewees[id];
            return (
              <div key={id} className="notes-student-card rounded border border-gray-200 p-4 shadow-sm">
                <div className="flex items-baseline justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">Student</p>
                    <p className="text-lg font-semibold text-gray-900">{info?.name || info?.projectTitle || id}</p>
                    {info?.projectTitle && (
                      <p className="text-sm text-gray-600">{info.projectTitle}</p>
                    )}
                  </div>
                  <span className="text-sm text-gray-500">
                    {cards.length} note{cards.length === 1 ? '' : 's'}
                  </span>
                </div>
                {cards.length === 0 ? (
                  <p className="mt-3 text-sm text-gray-500">No feedback for this student in the file.</p>
                ) : (
                  <div className="mt-4">
                    <FeedbackCards entries={cards} isLoading={false} />
                  </div>
                )}
              </div>
            );
          })}
          {!selectedIds.length && (
            <p className="text-sm text-gray-500">No students found in this export.</p>
          )}
        </div>
      </div>
    );
  };

  const renderStudentView = () => {
    const { reviewee } = fileResult?.data || {};
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            {reviewee?.name && <p className="text-lg font-semibold text-gray-900">{reviewee.name}</p>}
            {reviewee?.projectTitle && <p className="text-sm text-gray-600">{reviewee.projectTitle}</p>}
            <p className="text-xs text-gray-500">
              {fileResult?.fileName || 'Uploaded file'}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => window.print()}>
            Print
          </Button>
        </div>
        <FeedbackCards entries={sortedFeedback} isLoading={false} />
      </div>
    );
  };

  const renderLoadedContent = () => {
    if (!fileResult) return null;
    const exportedAt = new Date(fileResult.data.exportedAt);
    const summaryText = exportedAt.toString() !== 'Invalid Date'
      ? exportedAt.toLocaleString()
      : null;
    return (
      <div className="space-y-4 solo-feedback-loaded">
        <div className="rounded border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          <p className="font-semibold">{fileResult.fileName}</p>
          <p>Session ID: {fileResult.data.sessionId}</p>
          {summaryText && <p>Exported: {summaryText}</p>}
          <p>Feedback entries: {sortedFeedback.length}</p>
        </div>
        {fileResult.type === 'teacher' ? (
          <>
            <div className="flex flex-wrap items-center gap-3 print:hidden">
              <Button
                type="button"
                variant={viewMode === 'table' ? 'default' : 'outline'}
                onClick={() => setViewMode('table')}
              >
                Table view
              </Button>
              <Button
                type="button"
                variant={viewMode === 'notes' ? 'default' : 'outline'}
                onClick={() => setViewMode('notes')}
              >
                Notes view
              </Button>
              <Button type="button" variant="outline" onClick={() => window.print()}>
                Print
              </Button>
            </div>
            {viewMode === 'table' ? renderTeacherTable() : renderTeacherNotes()}
          </>
        ) : (
          renderStudentView()
        )}
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow space-y-4 solo-feedback-viewer">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Review saved feedback</h2>
          <p className="text-gray-600">
            Upload the `.gw` file exported from a student page or the teacher dashboard to view comments.
          </p>
        </div>
        <Button type="button" onClick={() => fileInputRef.current?.click()}>
          {fileResult ? 'Upload another file' : 'Upload feedback (.gw)'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".gw,.json,application/json"
          className="hidden"
          onChange={handleFileUpload}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {fileResult ? (
        renderLoadedContent()
      ) : (
        <div className="rounded border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-gray-600">
          <p>Use the buttons above to export feedback as `.gw` files from the student or teacher experience.</p>
          <p>You can review those files here without needing a live session.</p>
        </div>
      )}
    </div>
  );
}
