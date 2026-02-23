import Button from '@src/components/ui/Button';
import React from 'react';
import ReviewerFeedbackForm from './ReviewerFeedbackForm.js';
import ReviewerIdentityForm from './ReviewerIdentityForm.js';

interface ReviewerPanelProps {
  reviewerName: string;
  reviewerNameInput: string;
  reviewerNameError?: string | null;
  hasExistingName?: boolean;
  isSavingReviewerName?: boolean;
  onNameChange: (value: string) => void;
  onSaveIdentity: () => void;
  projectTitle?: string | null;
  reviewerMessage: string;
  onMessageChange: (value: string) => void;
  reviewerNotice?: string | null;
  isSubmittingFeedback?: boolean;
  onSubmitFeedback: (event: React.FormEvent<HTMLFormElement>) => void;
  onCancelFeedback?: (() => void) | null;
  onOpenScanner: () => void;
  scannerError?: string | null;
  canScanNext?: boolean;
  reviewerStyleId?: string;
  onStyleChange: (value: string) => void;
}

export default function ReviewerPanel({
  reviewerName,
  reviewerNameInput,
  reviewerNameError,
  hasExistingName = false,
  isSavingReviewerName = false,
  onNameChange,
  onSaveIdentity,
  projectTitle,
  reviewerMessage,
  onMessageChange,
  reviewerNotice,
  isSubmittingFeedback = false,
  onSubmitFeedback,
  onCancelFeedback,
  onOpenScanner,
  scannerError,
  canScanNext = false,
  reviewerStyleId,
  onStyleChange,
}: ReviewerPanelProps): React.JSX.Element {
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
