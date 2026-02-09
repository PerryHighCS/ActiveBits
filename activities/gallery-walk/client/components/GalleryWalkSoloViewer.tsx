import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
} from 'react';
import type { ReactNode } from 'react';
import Button from '@src/components/ui/Button';
import FeedbackCards from './FeedbackCards.js';
import GalleryWalkFeedbackTable from './GalleryWalkFeedbackTable.js';
import GalleryWalkNotesView from './GalleryWalkNotesView.js';
import FeedbackViewSwitcher from './FeedbackViewSwitcher.js';

type ViewerMode = 'notes' | 'table';
type SortField = 'to' | 'from' | 'createdAt';
type SortDirection = 'asc' | 'desc';

interface FeedbackEntry {
  id?: string;
  to?: string;
  from?: string;
  fromNameSnapshot?: string;
  message?: string;
  createdAt?: number;
  styleId?: string;
}

interface RevieweeInfo {
  name?: string;
  projectTitle?: string;
}

interface ReviewerInfo {
  name?: string;
}

interface BaseData {
  sessionId: string;
  exportedAt: number;
  feedback: FeedbackEntry[];
  config: Record<string, unknown> & { title?: string };
}

interface TeacherFileData extends BaseData {
  reviewees: Record<string, RevieweeInfo>;
  reviewers: Record<string, ReviewerInfo>;
}

interface StudentFileData extends BaseData {
  revieweeId: string;
  reviewee: RevieweeInfo | null;
}

interface TeacherFileResult {
  type: 'teacher';
  fileName: string;
  data: TeacherFileData;
}

interface StudentFileResult {
  type: 'student';
  fileName: string;
  data: StudentFileData;
}

type FileResult = TeacherFileResult | StudentFileResult;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeFeedback(value: unknown): FeedbackEntry[] {
  return Array.isArray(value) ? (value as FeedbackEntry[]) : [];
}

function normalizeReviewees(value: unknown): Record<string, RevieweeInfo> {
  return isPlainObject(value) ? (value as Record<string, RevieweeInfo>) : {};
}

function normalizeReviewers(value: unknown): Record<string, ReviewerInfo> {
  return isPlainObject(value) ? (value as Record<string, ReviewerInfo>) : {};
}

export default function GalleryWalkSoloViewer() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileResult, setFileResult] = useState<FileResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewerMode>('notes');
  const [tableSortField, setTableSortField] = useState<SortField>('createdAt');
  const [tableSortDirection, setTableSortDirection] = useState<SortDirection>('desc');
  const [notesReviewee, setNotesReviewee] = useState('all');
  const [showFileMeta, setShowFileMeta] = useState(false);

  useEffect(() => {
    if (fileResult == null) return;
    setViewMode(fileResult.type === 'teacher' ? 'table' : 'notes');
    setTableSortField('createdAt');
    setTableSortDirection('desc');
    setNotesReviewee('all');
  }, [fileResult]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file == null) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Record<string, unknown>;
      const feedback = normalizeFeedback(data.feedback);
      const base: BaseData = {
        sessionId: typeof data.sessionId === 'string' ? data.sessionId : 'unknown',
        exportedAt: typeof data.exportedAt === 'number' ? data.exportedAt : Date.now(),
        feedback,
        config: isPlainObject(data.config) ? (data.config as BaseData['config']) : {},
      };

      if (isPlainObject(data.reviewees)) {
        setFileResult({
          type: 'teacher',
          fileName: file.name,
          data: {
            ...base,
            reviewees: normalizeReviewees(data.reviewees),
            reviewers: normalizeReviewers(data.reviewers),
          },
        });
        setError(null);
        return;
      }

      const reviewees = normalizeReviewees(data.reviewees);
      const revieweeId =
        (typeof data.revieweeId === 'string' && data.revieweeId)
        || Object.keys(reviewees)[0]
        || 'student';
      const revieweeRecord = isPlainObject(data.reviewee)
        ? (data.reviewee as RevieweeInfo)
        : (reviewees[revieweeId] ?? null);

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
      event.target.value = '';
    }
  };

  const sortedFeedback = useMemo(() => {
    if (fileResult == null) return [];
    return [...fileResult.data.feedback].sort(
      (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
    );
  }, [fileResult]);

  const feedbackByReviewee = useMemo(() => {
    return sortedFeedback.reduce<Record<string, FeedbackEntry[]>>((acc, entry) => {
      if (entry?.to == null || entry.to === '') return acc;
      acc[entry.to] = acc[entry.to] || [];
      acc[entry.to]?.push(entry);
      return acc;
    }, {});
  }, [sortedFeedback]);

  const reviewees = fileResult?.type === 'teacher' ? fileResult.data.reviewees : {};
  const reviewers = fileResult?.type === 'teacher' ? fileResult.data.reviewers : {};
  const sessionTitle = (fileResult?.data?.config?.title as string | undefined) || 'Gallery Walk Feedback';

  const tableFeedback = useMemo(() => {
    const entries = [...sortedFeedback];
    const directionFactor = tableSortDirection === 'asc' ? 1 : -1;
    const normalizeString = (value: unknown) => (value ?? '').toString().toLowerCase();
    const getRecipientLabel = (entry: FeedbackEntry) => (
      reviewees[entry.to || '']?.name
      || reviewees[entry.to || '']?.projectTitle
      || entry.to
      || ''
    );
    const getAuthorLabel = (entry: FeedbackEntry) => (
      entry.fromNameSnapshot
      || reviewers[entry.from || '']?.name
      || ''
    );

    entries.sort((a, b) => {
      let aValue: number | string;
      let bValue: number | string;
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
          aValue = a.createdAt ?? 0;
          bValue = b.createdAt ?? 0;
          break;
      }
      if (aValue < bValue) return -1 * directionFactor;
      if (aValue > bValue) return 1 * directionFactor;
      return 0;
    });
    return entries;
  }, [sortedFeedback, tableSortDirection, tableSortField, reviewees, reviewers]);

  const handleTableSortToggle = useCallback((field: SortField) => {
    setTableSortDirection((prevDirection) => {
      if (tableSortField === field) {
        return prevDirection === 'asc' ? 'desc' : 'asc';
      }
      return 'asc';
    });
    setTableSortField(field);
  }, [tableSortField]);

  const summaryText = useMemo(() => {
    if (fileResult == null) return null;
    const exportedAt = new Date(fileResult.data.exportedAt);
    return exportedAt.toString() !== 'Invalid Date'
      ? exportedAt.toLocaleString()
      : null;
  }, [fileResult]);

  const renderFileMetaDetails = (variant: 'card' | 'inline' = 'card'): ReactNode => {
    if (fileResult == null) return null;
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
    const reviewee = fileResult?.type === 'student' ? fileResult.data.reviewee : null;
    return (
      <div className="space-y-4">
        <div className="text-center">
          <h2 className="text-xl font-semibold solo-student-title">
            {(fileResult?.data?.config?.title as string | undefined) || 'Gallery Walk Feedback'}
          </h2>
        </div>
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
    if (fileResult == null) return null;
    return (
      <div className="space-y-4 solo-feedback-loaded">
        {showFileMeta && fileResult.type !== 'student' && renderFileMetaDetails('card')}
        {fileResult.type === 'teacher' ? (
          <>
            <FeedbackViewSwitcher
              showNotesView={viewMode === 'notes'}
              onToggleView={() => setViewMode((prev) => (prev === 'table' ? 'notes' : 'table'))}
              toggleButtonVariant="outline"
              actionsClassName="print:hidden"
              actionButtons={[
                {
                  key: 'file-actions',
                  content: (
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
                  ),
                },
              ]}
              error={null}
              isLoading={false}
              tableView={(
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
              )}
              notesView={(
                <GalleryWalkNotesView
                  reviewees={reviewees}
                  feedbackByReviewee={feedbackByReviewee}
                  selectedReviewee={notesReviewee}
                  onSelectReviewee={setNotesReviewee}
                  selectId="solo-notes-select"
                  gridClassName="grid-cols-1"
                  cardClassName="print:break-after-page"
                  emptySelectionText="No participants found in this export."
                  noFeedbackText="No feedback for this participant in the file."
                  printTitle={sessionTitle}
                />
              )}
            />
          </>
        ) : (
          renderStudentView()
        )}
      </div>
    );
  };

  return (
    <div
      className="rounded-lg border border-gray-200 bg-white p-6 shadow space-y-4 solo-feedback-viewer print:border-0 print:p-0 print:shadow-none print:bg-transparent"
      data-print-title=""
    >
      {fileResult?.type === 'teacher' && (
        <div className="solo-print-title-container text-center mb-4">
          <h2
            className={[
              'solo-print-title text-xl font-semibold',
              viewMode === 'table' ? 'print:text-2xl' : 'print:hidden',
            ].join(' ')}
          >
            {(fileResult?.data?.config?.title as string | undefined) || 'Gallery Walk Feedback'}
          </h2>
        </div>
      )}
      <div
        className={[
          'flex flex-wrap items-start justify-center gap-4 print:hidden',
          fileResult && 'hidden',
        ].filter(Boolean).join(' ')}
      >
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
