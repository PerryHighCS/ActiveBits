import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import SessionHeader from '@src/components/common/SessionHeader';
import Button from '@src/components/ui/Button';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';
import { sortFeedbackEntries, insertFeedbackEntry } from './feedbackUtils';
import { getTimestampMeta } from './managerUtils';
import { NOTE_STYLE_OPTIONS, getNoteStyleClassName, normalizeNoteStyleId } from '../../shared/noteStyles.js';
import FeedbackCards from '../components/FeedbackCards.jsx';

export default function ManagerPage() {
  const { sessionId } = useParams();
  const [stage, setStage] = useState('gallery');
  const [feedback, setFeedback] = useState([]);
  const [reviewees, setReviewees] = useState({});
  const [reviewers, setReviewers] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortField, setSortField] = useState('createdAt');
  const [sortDirection, setSortDirection] = useState('desc');
  const [exportSignature, setExportSignature] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importError, setImportError] = useState(null);
  const [showNotesView, setShowNotesView] = useState(false);
  const [notesReviewee, setNotesReviewee] = useState('all');
  const fileInputRef = useRef(null);

  const loadSnapshot = useCallback(async () => {
    if (!sessionId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/gallery-walk/${sessionId}/feedback`);
      if (!res.ok) {
        throw new Error('Failed to load session data');
      }
      const data = await res.json();
      setStage(data.stage || 'gallery');
      setFeedback(Array.isArray(data.feedback) ? data.feedback : []);
      setReviewees(data.reviewees || {});
      setReviewers(data.reviewers || {});
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  const handleStageChange = async (nextStage) => {
    if (!sessionId || stage === nextStage) return;
    try {
      const res = await fetch(`/api/gallery-walk/${sessionId}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: nextStage }),
      });
      if (!res.ok) {
        throw new Error('Failed to update stage');
      }
      const data = await res.json();
      setStage(data.stage || nextStage);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedFeedback = useMemo(
    () => sortFeedbackEntries(feedback, sortField, sortDirection),
    [feedback, sortField, sortDirection],
  );
  const currentSignature = useMemo(
    () => JSON.stringify({ reviewees, reviewers, feedback }),
    [reviewees, reviewers, feedback],
  );
  useEffect(() => {
    if (exportSignature === null) {
      setExportSignature(currentSignature);
    }
  }, [currentSignature, exportSignature]);
  const hasUnsavedChanges = Boolean(sessionId && currentSignature !== exportSignature);
  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (hasUnsavedChanges) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    if (hasUnsavedChanges) {
      window.addEventListener('beforeunload', handleBeforeUnload);
    }
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasUnsavedChanges]);

  const buildWsUrl = useCallback(() => {
    if (!sessionId) return null;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/gallery-walk?sessionId=${sessionId}`;
  }, [sessionId]);

  const handleWsMessage = useCallback((event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'stage-changed') {
        setStage(message.payload?.stage || message.stage || 'gallery');
        return;
      }
      if (message.type === 'reviewees-updated') {
        setReviewees(message.payload?.reviewees || {});
        return;
      }
      if (message.type === 'feedback-added') {
        const entry = message.payload?.feedback;
        if (entry) {
          setFeedback((prev) => insertFeedbackEntry(prev, entry));
        }
      }
    } catch {
      // ignore malformed events
    }
  }, []);

  const { connect: connectWs, disconnect: disconnectWs } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(sessionId),
    onMessage: handleWsMessage,
  });

  useEffect(() => {
    if (!sessionId) return undefined;
    connectWs();
    return () => disconnectWs();
  }, [sessionId, connectWs, disconnectWs]);

  const renderStageControls = () => (
    <div className="flex gap-3">
      <Button
        type="button"
        variant={stage === 'gallery' ? 'default' : 'outline'}
        onClick={() => handleStageChange('gallery')}
      >
        Gallery Walk mode
      </Button>
      <Button
        type="button"
        variant={stage === 'review' ? 'default' : 'outline'}
        onClick={() => handleStageChange('review')}
      >
        Feedback review mode
      </Button>
    </div>
  );

  const renderTableHeaderCell = (label, field) => (
    <button
      type="button"
      className="flex items-center gap-1 text-left text-sm font-semibold text-gray-700"
      onClick={() => handleSort(field)}
    >
      {label}
      {sortField === field && (
        <span className="text-xs text-gray-500">{sortDirection === 'asc' ? '▲' : '▼'}</span>
      )}
    </button>
  );

  const renderFeedbackTable = () => (
    <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200 bg-white shadow print:border-0 print:shadow-none">
      <table className="min-w-full divide-y divide-gray-200 text-sm print:text-xs">
        <thead className="bg-gray-50 print:bg-white">
          <tr>
            <th className="px-4 py-3">
              <span className="print:hidden">{renderTableHeaderCell('To', 'to')}</span>
              <span className="hidden print:inline font-semibold">To</span>
            </th>
            <th className="px-4 py-3">
              <span className="print:hidden">{renderTableHeaderCell('From', 'fromNameSnapshot')}</span>
              <span className="hidden print:inline font-semibold">From</span>
            </th>
            <th className="px-4 py-3">
              <span className="print:hidden">{renderTableHeaderCell('Posted', 'createdAt')}</span>
              <span className="hidden print:inline font-semibold">Posted</span>
            </th>
            <th className="px-4 py-3">
              <span className="font-semibold">Message</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sortedFeedback.map((entry) => (
            <tr key={entry.id}>
              <td className="px-4 py-3">
                {reviewees[entry.to]?.name || reviewees[entry.to]?.projectTitle || entry.to || '—'}
              </td>
              <td className="px-4 py-3">{entry.fromNameSnapshot || reviewers[entry.from]?.name || '—'}</td>

              <td className="px-4 py-3 text-gray-600">
                {(() => {
                  const { date, showDateOnScreen } = getTimestampMeta(entry.createdAt);
                  if (!date) return '—';
                  const dateString = date.toLocaleDateString();
                  const timeString = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                  const screenText = showDateOnScreen ? `${dateString} ${timeString}` : timeString;
                  const printText = `${dateString} ${timeString}`.trim();
                  return (
                    <>
                      <span className="print:hidden">{screenText}</span>
                      <span className="hidden print:inline">{printText}</span>
                    </>
                  );
                })()}
              </td>
              <td className="px-4 py-3">
                <p className="whitespace-pre-wrap">{entry.message}</p>
              </td>
            </tr>
          ))}
          {!sortedFeedback.length && (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                No feedback yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
  const handleDownloadExport = async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/gallery-walk/${sessionId}/export`);
      if (!res.ok) throw new Error('Unable to export session data');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `gallery-walk-${sessionId}-${timestamp}.gw`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportSignature(JSON.stringify({
        reviewees: data.reviewees,
        reviewers: data.reviewers,
        feedback: data.feedback,
      }));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportError(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      setImportPreview({
        fileName: file.name,
        loadedAt: new Date(),
        data,
      });
    } catch (err) {
      setImportPreview(null);
      setImportError('Could not parse uploaded file. Make sure it is a valid JSON export.');
    } finally {
      event.target.value = '';
    }
  };

  const renderImportPreview = () => {
    if (!importPreview) return null;
    const { data, fileName } = importPreview;
    const previewFeedback = Array.isArray(data.feedback) ? data.feedback : [];
    const previewReviewees = data.reviewees || {};
    const previewReviewers = data.reviewers || {};
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 shadow">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Imported file preview</h3>
            <p className="text-sm text-blue-800">{fileName}</p>
          </div>
          <Button type="button" variant="outline" onClick={() => setImportPreview(null)}>
            Close
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="font-semibold text-gray-700">Students</p>
            <p>{Object.keys(previewReviewees).length}</p>
          </div>
          <div>
            <p className="font-semibold text-gray-700">Reviewers</p>
            <p>{Object.keys(previewReviewers).length}</p>
          </div>
          <div>
            <p className="font-semibold text-gray-700">Feedback entries</p>
            <p>{previewFeedback.length}</p>
          </div>
          <div>
            <p className="font-semibold text-gray-700">Stage</p>
            <p>{(data.stage || 'unknown').toUpperCase()}</p>
          </div>
        </div>
        <div className="mt-4 max-h-60 overflow-auto rounded border border-blue-100 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-blue-100">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">To</th>
                <th className="px-3 py-2 text-left font-semibold">From</th>
                <th className="px-3 py-2 text-left font-semibold">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-blue-50">
              {previewFeedback.slice(0, 8).map((entry) => (
                <tr key={entry.id}>
                  <td className="px-3 py-2">{previewReviewees[entry.to]?.name || entry.to}</td>
                  <td className="px-3 py-2">{entry.fromNameSnapshot}</td>
                  <td className="px-3 py-2">{entry.message}</td>
                </tr>
              ))}
              {!previewFeedback.length && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-center text-gray-500">
                    No entries in this file.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-gray-600">
          Uploading does not alter the live session. Use this preview to review saved feedback.
        </p>
      </div>
    );
  };

  const feedbackByReviewee = useMemo(() => {
    const map = {};
    feedback.forEach((entry) => {
      map[entry.to] = map[entry.to] || [];
      map[entry.to].push(entry);
    });
    return map;
  }, [feedback]);

  const renderNotesView = () => {
    if (!showNotesView) return null;
    const revieweeIds = notesReviewee === 'all'
      ? Object.keys(feedbackByReviewee)
      : notesReviewee
        ? [notesReviewee]
        : [];
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow">
        <div className="flex flex-wrap items-center gap-3 notes-actions">
          <label htmlFor="notesSelect" className="text-sm font-semibold text-gray-700">Student view</label>
          <select
            id="notesSelect"
            className="rounded border border-gray-300 px-3 py-1 text-sm"
            value={notesReviewee}
            onChange={(e) => setNotesReviewee(e.target.value)}
          >
            <option value="all">All students</option>
            {Object.entries(reviewees).map(([id, info]) => (
              <option key={id} value={id}>
                {info?.name || info?.projectTitle || id}
              </option>
            ))}
          </select>
          {/* <div className="ml-auto">
            <Button type="button" variant="outline" onClick={() => window.print()}>
              Print
            </Button>
          </div> */}
        </div>
        <div className="manager-notes-grid mt-4 grid gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 print:flex print:flex-wrap">
          {revieweeIds.map((id) => {
            const cards = feedbackByReviewee[id] || [];
            const info = reviewees[id];
            return (
              <div key={id} className="notes-student-card rounded border border-gray-200 p-4 shadow-sm">
                <div className="flex items-baseline justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">Student</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {info?.name || id}
                    </p>
                    {info?.projectTitle && (
                      <p className="text-sm text-gray-600">{info.projectTitle}</p>
                    )}
                  </div>
                  <span className="text-sm text-gray-500">
                    {cards.length} note{cards.length === 1 ? '' : 's'}
                  </span>
                </div>
                {cards.length === 0 ? (
                  <p className="mt-3 text-sm text-gray-500">No feedback yet.</p>
                ) : (
                  <div className="mt-4">
                    <FeedbackCards entries={cards} isLoading={false} />
                  </div>
                )}
              </div>
            );
          })}
          {!revieweeIds.length && (
            <p className="text-sm text-gray-500">No students selected for notes view.</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 manager-page">
      <div className="print:hidden">
        <SessionHeader activityName="Gallery Walk" sessionId={sessionId || 'unknown'} />
      </div>
      {!sessionId ? (
        <div className="mt-6 text-gray-600 space-y-2">
          <p>No session selected. Start a Gallery Walk from the dashboard to get a join code.</p>
          <Link to="/manage" className="text-blue-600 underline">
            Back to dashboard
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <div className="rounded border border-gray-200 bg-white p-4 shadow print:hidden">
            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              {renderStageControls()}
              <div className="flex flex-1 items-center justify-end gap-6">
                <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-right">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Connected students</p>
                  <p className="text-2xl font-semibold text-gray-900">{Object.keys(reviewees).length}</p>
                </div>
                <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-right">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Connected reviewers</p>
                  <p className="text-2xl font-semibold text-gray-900">{Object.keys(reviewers).length}</p>
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 print:hidden">
            <div className="me-auto">
                <Button
                  type="button"
                  variant={showNotesView ? 'default' : 'outline'}
                  onClick={() => setShowNotesView((prev) => !prev)}
                >
                  {showNotesView ? 'Table view' : 'Notes view'}
                </Button>
              </div>
            
              <Button type="button" onClick={handleDownloadExport} disabled={!feedback.length}>
                Download feedback
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                Upload saved feedback
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".gw,.json,application/json"
                className="hidden"
                onChange={handleImportFile}
              />
              <Button type="button" variant="outline" onClick={() => window.print()}>
                Print
              </Button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {importError && <p className="text-sm text-red-600">{importError}</p>}
          {renderImportPreview()}
          {isLoading ? (
            <p className="text-gray-600">Loading session data…</p>
          ) : (
            <>
              {!showNotesView && renderFeedbackTable()}
              {showNotesView && renderNotesView()}
            </>
          )}
        </div>
      )}
      {hasUnsavedChanges && (
        <div className="fixed bottom-4 left-0 right-0 flex justify-center">
          <div className="rounded border border-yellow-400 bg-yellow-50 px-4 py-2 text-sm text-yellow-800 shadow-lg">
            Feedback collected since the last download will be lost when the session ends. Export the JSON to archive.
          </div>
        </div>
      )}
    </div>
  );
}
