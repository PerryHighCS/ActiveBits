import React from 'react';
import Button from '@src/components/ui/Button';
import ReviewerIdentityForm from './ReviewerIdentityForm.jsx';
import ReviewerFeedbackForm from './ReviewerFeedbackForm.jsx';

export default function ReviewerPanel({
  reviewerName,
  reviewerNameInput,
  reviewerNameError,
  hasExistingName,
  isSavingReviewerName,
  onNameChange,
  onSaveIdentity,
  projectTitle,
  reviewerMessage,
  onMessageChange,
  reviewerNotice,
  isSubmittingFeedback,
  onSubmitFeedback,
  onCancelFeedback,
  onOpenScanner,
  scannerError,
  canScanNext,
  reviewerStyleId,
  onStyleChange,
}) {
  return (
    <div className="space-y-6">
      {!reviewerName && (
        <ReviewerIdentityForm
          nameInput={reviewerNameInput}
          onNameChange={onNameChange}
          error={reviewerNameError}
          hasExistingName={hasExistingName}
          isSaving={isSavingReviewerName}
          onSubmit={(event) => {
            event.preventDefault();
            onSaveIdentity();
          }}
        />
      )}
      {reviewerName && !canScanNext && (
        <ReviewerFeedbackForm
          projectTitle={projectTitle}
          message={reviewerMessage}
          onMessageChange={onMessageChange}
          notice={reviewerNotice}
          isSubmitting={isSubmittingFeedback}
          onSubmit={onSubmitFeedback}
          onCancel={onCancelFeedback}
          onScan={() => {
            onOpenScanner();
          }}
          scannerError={scannerError}
          canScan={false}
          styleId={reviewerStyleId}
          onStyleChange={onStyleChange}
        />
      )}
      {reviewerName && canScanNext && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow space-y-4 sm:p-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Ready for the next project?</h2>
            <p className="text-gray-600">To leave feedback for another project, scan its QR code.</p>
          </div>
          <div className="flex justify-center">
            <Button
              type="button"
              variant="outline"
              onClick={onOpenScanner}
            >
              Scan next QR code
            </Button>
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
      )}
    </div>
  );
}
