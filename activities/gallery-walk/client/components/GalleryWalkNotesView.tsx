import { useMemo } from 'react';
import FeedbackCards from './FeedbackCards';

interface RevieweeInfo {
  name?: string;
  projectTitle?: string | null;
}

interface FeedbackEntry {
  id?: string;
  message?: string;
  fromNameSnapshot?: string;
  createdAt?: number;
  styleId?: string;
}

interface GalleryWalkNotesViewProps {
  reviewees?: Record<string, RevieweeInfo>;
  feedbackByReviewee?: Record<string, FeedbackEntry[]>;
  selectedReviewee: string;
  onSelectReviewee: (value: string) => void;
  allValue?: string;
  includeAllRevieweesWhenAllSelected?: boolean;
  containerClassName?: string;
  filterClassName?: string;
  gridClassName?: string;
  layout?: 'grid' | 'row';
  cardClassName?: string;
  selectId?: string;
  hideFilterOnPrint?: boolean;
  hideCardHeaderOnPrint?: boolean;
  emptySelectionText?: string;
  noFeedbackText?: string;
  allOptionLabel?: string;
  printTitle?: string;
}

export default function GalleryWalkNotesView({
  reviewees = {},
  feedbackByReviewee = {},
  selectedReviewee,
  onSelectReviewee,
  allValue = 'all',
  includeAllRevieweesWhenAllSelected = true,
  containerClassName = '',
  filterClassName = '',
  gridClassName = '',
  layout = 'grid',
  cardClassName = '',
  selectId = 'gallery-walk-notes-select',
  hideFilterOnPrint = true,
  hideCardHeaderOnPrint = false,
  emptySelectionText = 'No participants selected.',
  noFeedbackText = 'No feedback yet.',
  allOptionLabel = 'All participants',
  printTitle = '',
}: GalleryWalkNotesViewProps) {
  const revieweeEntries = useMemo(() => Object.entries(reviewees), [reviewees]);
  const allIds = useMemo(() => {
    if (includeAllRevieweesWhenAllSelected) {
      return revieweeEntries.map(([id]) => id);
    }
    return Object.keys(feedbackByReviewee);
  }, [includeAllRevieweesWhenAllSelected, revieweeEntries, feedbackByReviewee]);

  const selectedIds = useMemo(() => {
    if (selectedReviewee === allValue) return allIds;
    if (!selectedReviewee) return [];
    if (reviewees[selectedReviewee] || feedbackByReviewee[selectedReviewee]) return [selectedReviewee];
    return [];
  }, [selectedReviewee, allValue, allIds, reviewees, feedbackByReviewee]);

  const wrapperClassName = ['space-y-4', containerClassName, 'print:space-y-0 print:pt-0'].filter(Boolean).join(' ');
  const filterRowClassName = [
    'flex flex-wrap items-center gap-3',
    hideFilterOnPrint ? 'print:hidden' : '',
    filterClassName,
  ].filter(Boolean).join(' ');
  const cardsGridClassName = [
    'manager-notes-grid',
    layout === 'row' ? 'flex gap-4 overflow-x-auto pb-4' : 'grid gap-6',
    layout === 'row' ? 'flex-nowrap' : '',
    gridClassName,
  ].filter(Boolean).join(' ');

  return (
    <div className={wrapperClassName}>
      <div className={filterRowClassName}>
        <label htmlFor={selectId} className="text-sm font-semibold text-gray-700">Student view</label>
        <select
          id={selectId}
          className="rounded border border-gray-300 px-3 py-1 text-sm"
          value={selectedReviewee}
          onChange={(event) => onSelectReviewee(event.target.value)}
        >
          <option value={allValue}>{allOptionLabel}</option>
          {revieweeEntries.map(([id, info]) => (
            <option key={id} value={id}>
              {info?.name || info?.projectTitle || id}
            </option>
          ))}
        </select>
      </div>
      <div className={cardsGridClassName}>
        {selectedIds.map((id) => {
          const cards = feedbackByReviewee[id] || [];
          const info = reviewees[id];
          return (
            <div
              key={id}
              className={[
                'notes-student-card rounded border border-gray-100 bg-white p-4 shadow-sm print:border-0 print:shadow-none',
                cardClassName,
              ].filter(Boolean).join(' ')}
            >
              {printTitle && (
                <p className="notes-print-title hidden text-gray-800 print:block text-center text-sm font-semibold mb-2">
                  {printTitle}
                </p>
              )}
              <div className={['flex items-baseline justify-between', hideCardHeaderOnPrint ? 'print:hidden' : ''].filter(Boolean).join(' ')}>
                <div>
                  <p className="text-lg font-semibold text-gray-900">
                    {info?.name || info?.projectTitle || id}
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
                <p className="mt-3 text-sm text-gray-500">{noFeedbackText}</p>
              ) : (
                <div className="mt-4">
                  <FeedbackCards entries={cards} isLoading={false} />
                </div>
              )}
            </div>
          );
        })}
        {!selectedIds.length && (
          <p className="text-sm text-gray-500">{emptySelectionText}</p>
        )}
      </div>
    </div>
  );
}
