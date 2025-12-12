import React from 'react';
import Button from '@src/components/ui/Button';
import GalleryWalkNotesView from './GalleryWalkNotesView.jsx';

export default function FeedbackView({
  revieweeRecord,
  sessionTitle,
  sessionClosed,
  onDownload,
  studentReviewees,
  studentFeedbackByReviewee,
  isLoadingFeedback,
}) {
  return (
    <div className="rounded-lg border border-indigo-200 bg-white p-6 shadow space-y-4 print:border-0 print:shadow-none print:p-0">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold print:hidden">Your feedback</h2>
          <p className="text-gray-600 print:hidden">
            The teacher switched to review mode. Read through the comments that were left for you.
          </p>
          {revieweeRecord?.name && (
            <div className="student-name-print hidden text-gray-800 print:block">
              <p className="text-sm uppercase tracking-wide text-gray-500">{sessionTitle || 'Gallery Walk Feedback'}</p>
              <p>{revieweeRecord.name}</p>
              {revieweeRecord?.projectTitle && <p>{revieweeRecord?.projectTitle}</p>}
            </div>
          )}
        </div>
      </div>
      {sessionClosed && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          This session has ended. You can still view and print your feedback.
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-3 print:hidden">
        <Button type="button" variant="outline" onClick={onDownload}>
          Download feedback
        </Button>
        <Button type="button" onClick={() => window.print()} variant="outline">
          Print my feedback
        </Button>
      </div>
      <GalleryWalkNotesView
        reviewees={studentReviewees}
        feedbackByReviewee={studentFeedbackByReviewee}
        selectedReviewee="all"
        filterClassName="hidden"
        containerClassName="pt-2 print:pt-0"
        gridClassName="grid-cols-1"
        cardClassName="print:break-after-page"
        hideCardHeaderOnPrint
        noFeedbackText={isLoadingFeedback ? 'Loading feedback…' : 'No feedback yet.'}
        emptySelectionText={isLoadingFeedback ? 'Loading feedback…' : 'No feedback yet.'}
        printTitle=""
      />
    </div>
  );
}
