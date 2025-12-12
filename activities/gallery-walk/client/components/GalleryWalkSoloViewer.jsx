import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
} from 'react';
import Button from '@src/components/ui/Button';
import FeedbackCards from './FeedbackCards.jsx';
import GalleryWalkFeedbackTable from './GalleryWalkFeedbackTable.jsx';
import GalleryWalkNotesView from './GalleryWalkNotesView.jsx';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export default function GalleryWalkSoloViewer() {
  const fileInputRef = useRef(null);
  const [fileResult, setFileResult] = useState(null);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState('notes');
  const [tableSortField, setTableSortField] = useState('createdAt');
  const [tableSortDirection, setTableSortDirection] = useState('desc');
  const [notesReviewee, setNotesReviewee] = useState('all');
  const [showFileMeta, setShowFileMeta] = useState(false);

  useEffect(() => {
    if (!fileResult) return;
    setViewMode(fileResult.type === 'teacher' ? 'table' : 'notes');
    setTableSortField('createdAt');
    setTableSortDirection('desc');
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
        config: isPlainObject(data.config) ? data.config : {},
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

  const reviewees = fileResult?.data?.reviewees || {};
  const reviewers = fileResult?.data?.reviewers || {};
  const sessionTitle = fileResult?.data?.config?.title || 'Gallery Walk Feedback';

  const tableFeedback = useMemo(() => {
    const entries = [...sortedFeedback];
    const directionFactor = tableSortDirection === 'asc' ? 1 : -1;
    const normalizeString = (value) => (value || '').toString().toLowerCase();
    const getRecipientLabel = (entry) => (
      reviewees[entry.to]?.name
      || reviewees[entry.to]?.projectTitle
      || entry.to
      || ''
    );
    const getAuthorLabel = (entry) => (
      entry.fromNameSnapshot
      || reviewers[entry.from]?.name
      || ''
    );
    entries.sort((a, b) => {
      let aValue;
      let bValue;
      switch (tableSortField) {
        case 'to':
          aValue = normalizeString(getRecipientLabel(a));
          bValue = normalizeString(getRecipientLabel(b));
          break;
        case 'from':
          aValue = normalizeString(getAuthorLabel(a));
          bValue = normalizeString(getAuthorLabel(b));
          break;
        case 'createdAt':
        default:
          aValue = a.createdAt || 0;
          bValue = b.createdAt || 0;
          break;
      }
      if (aValue < bValue) return -1 * directionFactor;
      if (aValue > bValue) return 1 * directionFactor;
      return 0;
    });
    return entries;
  }, [sortedFeedback, tableSortDirection, tableSortField, reviewees, reviewers]);

  const handleTableSortToggle = useCallback((field) => {
    setTableSortDirection((prevDirection) => {
      if (tableSortField === field) {
        return prevDirection === 'asc' ? 'desc' : 'asc';
      }
      return 'asc';
    });
    setTableSortField(field);
  }, [tableSortField]);

  const summaryText = useMemo(() => {
    if (!fileResult) return null;
    const exportedAt = new Date(fileResult.data.exportedAt);
    return exportedAt.toString() !== 'Invalid Date'
      ? exportedAt.toLocaleString()
      : null;
  }, [fileResult]);

  const renderFileMetaDetails = (variant = 'card') => {
    if (!fileResult) return null;
    const wrapperClass = variant === 'card'
      ? 'rounded border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700'
      : 'text-xs text-gray-500 space-y-1';
    return (
      <div className={wrapperClass}>
        <p className="font-semibold">{fileResult.fileName || 'Uploaded file'}</p>
        <p>Session ID: {fileResult.data.sessionId}</p>
        {summaryText && <p>Exported: {summaryText}</p>}
        <p>Feedback entries: {sortedFeedback.length}</p>
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
            {showFileMeta ? (
              <div className="mt-1">
                {renderFileMetaDetails('inline')}
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                {fileResult?.fileName || 'Uploaded file'}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <Button
                type="button"
                aria-label={showFileMeta ? 'Hide file info' : 'Show file info'}
                variant="outline"
                // className="inline-flex h-8 w-8 items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                onClick={() => setShowFileMeta((prev) => !prev)}
              >
                File info
            </Button>
            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
              Upload another file
            </Button>
            <Button type="button" variant="outline" onClick={() => window.print()}>
              Print
            </Button>
          </div>
        </div>
        <FeedbackCards entries={sortedFeedback} isLoading={false} />
      </div>
    );
  };

  const renderLoadedContent = () => {
    if (!fileResult) return null;
    return (
      <div className="space-y-4 solo-feedback-loaded">
        {showFileMeta && fileResult.type !== 'student' && renderFileMetaDetails('card')}
        {fileResult.type === 'teacher' ? (
          <>
            <div className="flex flex-wrap items-center gap-3 print:hidden">
              <div className="me-auto">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setViewMode((prev) => (prev === 'table' ? 'notes' : 'table'))}
                >
                  {viewMode === 'table' ? 'Notes view' : 'Table view'}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  aria-label={showFileMeta ? 'Hide file info' : 'Show file info'}
                  variant="outline"
                  onClick={() => setShowFileMeta((prev) => !prev)}
                >
                  File info
                </Button>
                <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  Upload another file
                </Button>
                <Button type="button" variant="outline" onClick={() => window.print()}>
                  Print
                </Button>
              </div>
            </div>
            {viewMode === 'table' ? (
              <GalleryWalkFeedbackTable
                feedback={tableFeedback}
                reviewees={reviewees}
                reviewers={reviewers}
                containerClassName="mt-4"
                emptyMessage="No feedback entries in this file."
                headerOverrides={{
                  to: (
                    <>
                      <button
                        type="button"
                        className="flex items-center gap-1 text-left font-semibold text-gray-700 text-sm print:hidden"
                        onClick={() => handleTableSortToggle('to')}
                      >
                        To
                        {tableSortField === 'to' && (
                          <span className="text-xs text-gray-500">
                            {tableSortDirection === 'asc' ? '▲' : '▼'}
                          </span>
                        )}
                      </button>
                      <span className="hidden print:inline font-semibold">To</span>
                    </>
                  ),
                  from: (
                    <>
                      <button
                        type="button"
                        className="flex items-center gap-1 text-left font-semibold text-gray-700 text-sm print:hidden"
                        onClick={() => handleTableSortToggle('from')}
                      >
                        From
                        {tableSortField === 'from' && (
                          <span className="text-xs text-gray-500">
                            {tableSortDirection === 'asc' ? '▲' : '▼'}
                          </span>
                        )}
                      </button>
                      <span className="hidden print:inline font-semibold">From</span>
                    </>
                  ),
                  posted: (
                    <>
                      <button
                        type="button"
                        className="flex items-center gap-1 text-left font-semibold text-gray-700 text-sm print:hidden"
                        onClick={() => handleTableSortToggle('createdAt')}
                      >
                        Posted
                        {tableSortField === 'createdAt' && (
                          <span className="text-xs text-gray-500">
                            {tableSortDirection === 'asc' ? '▲' : '▼'}
                          </span>
                        )}
                      </button>
                      <span className="hidden print:inline font-semibold">Posted</span>
                    </>
                  ),
                }}
              />
            ) : (
              <GalleryWalkNotesView
                reviewees={reviewees}
                feedbackByReviewee={feedbackByReviewee}
                selectedReviewee={notesReviewee}
                onSelectReviewee={setNotesReviewee}
                selectId="solo-notes-select"
                gridClassName="grid-cols-1"
                cardClassName="print:break-after-page"
                emptySelectionText="No students found in this export."
                noFeedbackText="No feedback for this student in the file."
                printTitle={sessionTitle}
              />
            )}
          </>
        ) : (
          renderStudentView(showFileMeta, setShowFileMeta)
        )}
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow space-y-4 solo-feedback-viewer print:border-0 print:p-0 print:shadow-none print:bg-transparent">
      <div className={"flex flex-wrap items-start justify-center gap-4 print:hidden" + (fileResult ? " hidden" : "")} >
        {!fileResult && (
          <Button type="button" onClick={() => fileInputRef.current?.click()}>
            Upload feedback (.gw)
          </Button>
        )}
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
          <p>Upload the `.gw` file exported during a Gallery Walk to view or print comments.</p>
        </div>
      )}
    </div>
  );
}
