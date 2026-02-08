import React, { useCallback } from 'react';
import QrScannerPanel from '@src/components/common/QrScannerPanel';

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
  onError: (code: string | null) => void;
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
      if (!sessionId || target.origin !== window.location.origin) {
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
      if (!reviewee) {
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

  const handleScannerError = useCallback(() => {
    onClose();
    onError('scanner-unavailable');
  }, [onClose, onError]);

  if (!isOpen) return null;

  return (
    <QrScannerPanel
      onDetected={validateAndHandle}
      onError={handleScannerError}
      onClose={onClose}
    />
  );
}
