import React, { useCallback } from 'react';
import QrScannerPanel, { type QrScannerPanelProps } from '@src/components/common/QrScannerPanel';

const galleryWalkScannerFormats: NonNullable<QrScannerPanelProps['formats']> = ['qr_code'];
const galleryWalkScannerErrorMessage =
  'Unable to scan from this browser. Use your camera app to open the QR code instead.';

interface ScannerSuccessData {
  pathname: string;
  hash: string;
  reviewee: string;
}

interface ReviewerScannerProps {
  isOpen: boolean;
  sessionId?: string | null;
  onClose: () => void;
  onSuccess: (data: ScannerSuccessData) => void;
  onError: (code: 'scanner-invalid' | 'scanner-unavailable' | null) => void;
}

export default function ReviewerScanner({
  isOpen,
  sessionId,
  onClose,
  onSuccess,
  onError,
}: ReviewerScannerProps): React.JSX.Element | null {
  const validateAndHandle = useCallback((content: string) => {
    onClose();
    onError(null);
    try {
      const target = new URL(content);
      if (sessionId == null || target.origin !== window.location.origin) {
        onError('scanner-invalid');
        return;
      }
      const pathSegments = target.pathname.split('/').filter(Boolean);
      const lastSegment = pathSegments[pathSegments.length - 1];
      if (lastSegment !== sessionId) {
        onError('scanner-invalid');
        return;
      }
      const reviewee = target.searchParams.get('reviewee');
      if (reviewee == null || reviewee === '') {
        onError('scanner-invalid');
        return;
      }
      onSuccess({
        pathname: target.pathname,
        hash: target.hash || '',
        reviewee,
      });
    } catch {
      onError('scanner-invalid');
    }
  }, [onClose, onError, onSuccess, sessionId]);

  const handleScannerError = useCallback<NonNullable<QrScannerPanelProps['onError']>>((_code, _error) => {
    onError('scanner-unavailable');
  }, [onError]);

  if (isOpen !== true) return null;

  return (
    <QrScannerPanel
      title="Scan review QR code"
      errorMessage={galleryWalkScannerErrorMessage}
      formats={galleryWalkScannerFormats}
      onDetected={validateAndHandle}
      onError={handleScannerError}
      onClose={onClose}
      timeBetweenDecodingAttempts={300}
    />
  );
}
