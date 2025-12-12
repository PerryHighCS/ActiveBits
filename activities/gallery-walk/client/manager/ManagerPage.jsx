import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import SessionHeader from '@src/components/common/SessionHeader';
import Button from '@src/components/ui/Button';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';
import { sortFeedbackEntries, insertFeedbackEntry } from './feedbackUtils';
import { NOTE_STYLE_OPTIONS, getNoteStyleClassName, normalizeNoteStyleId } from '../../shared/noteStyles.js';
import GalleryWalkFeedbackTable from '../components/GalleryWalkFeedbackTable.jsx';
import GalleryWalkNotesView from '../components/GalleryWalkNotesView.jsx';

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
  const [showNotesView, setShowNotesView] = useState(false);
  const [notesReviewee, setNotesReviewee] = useState('all');
  const [sessionTitle, setSessionTitle] = useState('');
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [titleSaveError, setTitleSaveError] = useState(null);
  const titleInitializedRef = useRef(false);

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
      setSessionTitle(data.config?.title || '');
      setTitleSaveError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    titleInitializedRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return undefined;
    if (!titleInitializedRef.current) {
      titleInitializedRef.current = true;
      return undefined;
    }
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setIsSavingTitle(true);
      setTitleSaveError(null);
      try {
        const res = await fetch(`/api/gallery-walk/${sessionId}/title`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: sessionTitle }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Unable to save title');
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          setTitleSaveError(err.message || 'Unable to save title');
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSavingTitle(false);
        }
      }
    }, 600);
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [sessionId, sessionTitle]);

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
    () => JSON.stringify({ reviewees, reviewers, feedback, title: sessionTitle }),
    [reviewees, reviewers, feedback, sessionTitle],
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

  const renderStageControls = () => {
    const isGallery = stage === 'gallery';
    const nextStage = isGallery ? 'review' : 'gallery';
    const description = isGallery
      ? (
        <>
          <strong className="font-semibold text-gray-900">Gallery Walk.</strong>
          {' '}
          Students provide peer feedback on each other&apos;s work. Feedback is not visible until review mode.
        </>
      )
      : (
        <>
          <strong className="font-semibold text-gray-900">Feedback Review.</strong>
          {' '}
          Students can see feedback left by their peers.
        </>
      );
    const buttonLabel = isGallery ? 'Switch to Feedback review mode' : 'Switch to Gallery Walk mode';
    return (
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold text-gray-700">Session mode</label>
        <p className="text-sm text-gray-600 flex-1 min-w-[12rem]">{description}</p>
        <Button type="button" variant="outline" onClick={() => handleStageChange(nextStage)}>
          {buttonLabel}
        </Button>
      </div>
    );
  };

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
    <GalleryWalkFeedbackTable
      feedback={sortedFeedback}
      reviewees={reviewees}
      reviewers={reviewers}
      containerClassName="mt-6"
      emptyMessage="No feedback yet."
      headerOverrides={{
        to: (
          <>
            <span className="print:hidden">{renderTableHeaderCell('To', 'to')}</span>
            <span className="hidden print:inline font-semibold">To</span>
          </>
        ),
        from: (
          <>
            <span className="print:hidden">{renderTableHeaderCell('From', 'fromNameSnapshot')}</span>
            <span className="hidden print:inline font-semibold">From</span>
          </>
        ),
        posted: (
          <>
            <span className="print:hidden">{renderTableHeaderCell('Posted', 'createdAt')}</span>
            <span className="hidden print:inline font-semibold">Posted</span>
          </>
        ),
      }}
    />
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
        title: data.config?.title || '',
      }));
    } catch (err) {
      setError(err.message);
    }
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
    return (
              <GalleryWalkNotesView
                reviewees={reviewees}
                feedbackByReviewee={feedbackByReviewee}
                selectedReviewee={notesReviewee}
                onSelectReviewee={setNotesReviewee}
                selectId="notesSelect"
                containerClassName="rounded-lg border border-gray-200 bg-white p-4 shadow"
                filterClassName="notes-actions"
                hideFilterOnPrint={false}
                gridClassName="mt-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 print:flex print:flex-wrap"
                emptySelectionText="No students selected for notes view."
                noFeedbackText="No feedback yet."
                includeAllRevieweesWhenAllSelected={false}
                printTitle={sessionTitle || 'Gallery Walk Feedback'}
              />
            );
          };

  return (
    <div className="p-6 manager-page" data-print-title={sessionTitle || 'Gallery Walk Feedback'}>
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
            <div className="flex flex-col gap-4 md:flex-row md:items-stretch">
              <div className="flex-1 space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor="manager-session-title" className="text-sm font-semibold text-gray-700">
                      Session title
                    </label>
                    {titleSaveError ? (
                      <span className="text-xs text-red-600">{titleSaveError}</span>
                    ) : (
                      <span className="text-xs text-gray-500">{isSavingTitle ? 'Saving…' : 'Saved'}</span>
                    )}
                  </div>
                  <input
                    id="manager-session-title"
                    type="text"
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    value={sessionTitle}
                    onChange={(event) => setSessionTitle(event.target.value)}
                    placeholder="e.g., Spring Showcase"
                  />
                </div>
                {renderStageControls()}
              </div>
              <div className="md:w-64">
                <div className="h-full rounded border border-gray-200 bg-gray-50 px-4 py-4 text-right flex flex-col justify-center">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Connected students</p>
                  <p className="text-2xl font-semibold text-gray-900">{Object.keys(reviewees).length}</p>
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
              <Button type="button" variant="outline" onClick={() => window.print()}>
                Print
              </Button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
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
