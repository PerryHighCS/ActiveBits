import SessionHeader from '@src/components/common/SessionHeader';
import Button from '@src/components/ui/Button';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import FeedbackViewSwitcher from '../components/FeedbackViewSwitcher.js';
import GalleryWalkFeedbackTable from '../components/GalleryWalkFeedbackTable.js';
import GalleryWalkNotesView from '../components/GalleryWalkNotesView.js';
import StageControls from '../components/StageControls.js';
import TitleEditor from '../components/TitleEditor.js';
import useGalleryWalkSession, {
    type GalleryWalkFeedbackEntry,
    type GalleryWalkReviewees,
    type GalleryWalkReviewers,
} from '../hooks/useGalleryWalkSession.js';
import { sortFeedbackEntries, type SortDirection, type SortableFeedbackField } from './feedbackUtils.js';

type SortField = SortableFeedbackField;

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export default function ManagerPage() {
  const { sessionId } = useParams<{ sessionId?: string }>();

  const {
    stage,
    setStage,
    feedback,
    reviewees,
    reviewers,
    sessionTitle,
    setSessionTitle,
    isLoading,
    error,
    setError,
  } = useGalleryWalkSession(sessionId);

  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [exportSignature, setExportSignature] = useState<string | null>(null);
  const [showNotesView, setShowNotesView] = useState(false);
  const [notesReviewee, setNotesReviewee] = useState('all');
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [titleSaveError, setTitleSaveError] = useState<string | null>(null);
  const titleInitializedRef = useRef(false);

  useEffect(() => {
    titleInitializedRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    if (sessionId == null) return undefined;
    if (titleInitializedRef.current !== true) {
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
        if (res.ok !== true) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || 'Unable to save title');
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setTitleSaveError(getErrorMessage(err, 'Unable to save title'));
        }
      } finally {
        if (controller.signal.aborted !== true) {
          setIsSavingTitle(false);
        }
      }
    }, 600);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [sessionId, sessionTitle]);

  const handleStageChange = async (nextStage: string) => {
    if (sessionId == null || stage === nextStage) return;
    try {
      const res = await fetch(`/api/gallery-walk/${sessionId}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: nextStage }),
      });
      if (res.ok !== true) {
        throw new Error('Failed to update stage');
      }
      const data = (await res.json()) as { stage?: string };
      setStage(data.stage || nextStage);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to update stage'));
    }
  };

  const handleSort = (field: SortField) => {
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

  const hasUnsavedChanges = sessionId != null && currentSignature !== exportSignature;

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
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

  const renderTableHeaderCell = (label: string, field: SortField): ReactNode => (
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

  const renderFeedbackTable = (): ReactNode => (
    <GalleryWalkFeedbackTable
      feedback={sortedFeedback}
      reviewees={reviewees as GalleryWalkReviewees}
      reviewers={reviewers as GalleryWalkReviewers}
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
    if (sessionId == null) return;
    try {
      const res = await fetch(`/api/gallery-walk/${sessionId}/export`);
      if (res.ok !== true) throw new Error('Unable to export session data');
      const data = (await res.json()) as {
        reviewees?: unknown;
        reviewers?: unknown;
        feedback?: unknown;
        config?: { title?: string };
      };
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
      setError(getErrorMessage(err, 'Unable to export session data'));
    }
  };

  const feedbackByReviewee = useMemo(() => {
    const map: Record<string, GalleryWalkFeedbackEntry[]> = {};
    feedback.forEach((entry) => {
      const targetId = typeof entry.to === 'string' ? entry.to : '';
      if (targetId == null || targetId === '') return;
      map[targetId] = map[targetId] || [];
      map[targetId]?.push(entry);
    });
    return map;
  }, [feedback]);

  const renderNotesView = (): ReactNode => {
    if (showNotesView !== true) return null;
    return (
      <GalleryWalkNotesView
        reviewees={reviewees as GalleryWalkReviewees}
        feedbackByReviewee={feedbackByReviewee}
        selectedReviewee={notesReviewee}
        onSelectReviewee={setNotesReviewee}
        selectId="notesSelect"
        containerClassName="rounded-lg border border-gray-200 bg-white p-4 shadow"
        filterClassName="notes-actions"
        hideFilterOnPrint
        gridClassName="mt-4 grid-cols-1 xl:grid-cols-2"
        cardClassName="manager-notes-card"
        emptySelectionText="No participants selected for notes view."
        noFeedbackText="No feedback yet."
        includeAllRevieweesWhenAllSelected={false}
        printTitle={sessionTitle || 'Gallery Walk Feedback'}
      />
    );
  };

  return (
    <div
      className={`manager-page p-6${hasUnsavedChanges ? ' pb-28' : ''}`}
      data-print-title={!showNotesView ? (sessionTitle || 'Gallery Walk Feedback') : undefined}
    >
      <div className="print:hidden">
        <SessionHeader activityName="Gallery Walk" sessionId={sessionId ?? 'unknown'} />
      </div>
      {!showNotesView && (
        <p className="manager-print-title hidden print:block text-center text-lg font-semibold mb-4">
          {sessionTitle || 'Gallery Walk Feedback'}
        </p>
      )}
      {sessionId == null ? (
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
                <TitleEditor
                  value={sessionTitle}
                  onChange={setSessionTitle}
                  isSaving={isSavingTitle}
                  error={titleSaveError}
                />
                <StageControls stage={stage} onChange={handleStageChange} />
              </div>
              <div className="md:w-64">
                <div className="h-full rounded border border-gray-200 bg-gray-50 px-4 py-4 text-right flex flex-col justify-center">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Connected participants</p>
                  <p className="text-2xl font-semibold text-gray-900">{Object.keys(reviewees).length}</p>
                </div>
              </div>
            </div>
          </div>
          <FeedbackViewSwitcher
            showNotesView={showNotesView}
            onToggleView={() => setShowNotesView((prev) => !prev)}
            toggleButtonVariant={showNotesView ? 'default' : 'outline'}
            actionsClassName={[
              'print:hidden',
              showNotesView ? 'print:block' : 'print:hidden',
            ].filter(Boolean).join(' ')}
            actionButtons={[
              {
                key: 'download',
                content: (
                  <Button type="button" onClick={handleDownloadExport} disabled={!feedback.length}>
                    Download feedback
                  </Button>
                ),
              },
              {
                key: 'print',
                content: (
                  <Button type="button" variant="outline" onClick={() => window.print()}>
                    Print
                  </Button>
                ),
              },
            ]}
            error={error}
            isLoading={isLoading}
            loadingText="Loading session data…"
            tableView={renderFeedbackTable()}
            notesView={renderNotesView()}
          />
        </div>
      )}
      {hasUnsavedChanges && (
        <div className="fixed bottom-4 left-0 right-0 flex justify-center">
          <div className="rounded border border-yellow-400 bg-yellow-50 px-4 py-2 text-sm text-yellow-800 shadow-lg">
            Feedback collected since the last download will be lost when the session ends. <b>Download feedback</b> to save it.
          </div>
        </div>
      )}
    </div>
  );
}
