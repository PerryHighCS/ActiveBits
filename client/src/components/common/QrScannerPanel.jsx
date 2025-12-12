import React, {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useZxing } from 'react-zxing';
import Button from '@src/components/ui/Button';

export default function QrScannerPanel({ onDetected, onError, onClose }) {
  const [errorCode, setErrorCode] = useState(null);
  const [hasDetected, setHasDetected] = useState(false);
  const headingId = useId();
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const previouslyFocusedElement = useRef(null);

  const constraints = useMemo(() => ({
    video: {
      facingMode: { ideal: 'environment' },
    },
  }), []);

  const { ref } = useZxing({
    paused: hasDetected,
    constraints,
    onDecodeResult: (result) => {
      if (!result) return;
      setHasDetected(true);
      onDetected?.(result.getText());
    },
    onError: (err) => {
      if (hasDetected) return;
      if (err?.name === 'NotAllowedError') {
        setErrorCode('camera-error');
      } else if (err?.name === 'NotFoundException') {
        setErrorCode('scanner-error');
      } else {
        setErrorCode('scanner-unavailable');
      }
      onError?.(err);
    },
  });

  const renderMessage = () => {
    switch (errorCode) {
      case 'camera-error':
        return 'Unable to access the camera. Check permissions and try again.';
      case 'scanner-error':
        return 'Scanning failed. Please close and try again.';
      case 'scanner-unavailable':
      default:
        return 'In-page scanning is not supported on this browser. Use your camera app instead.';
    }
  };

  useEffect(() => {
    previouslyFocusedElement.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeButtonRef.current?.focus();
    return () => {
      previouslyFocusedElement.current?.focus?.();
    };
  }, []);

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose?.();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusableElements = dialogRef.current?.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusableElements || focusableElements.length === 0) {
      event.preventDefault();
      return;
    }
    const focusableArray = Array.from(focusableElements);
    const first = focusableArray[0];
    const last = focusableArray[focusableArray.length - 1];
    const activeElement = document.activeElement;
    if (event.shiftKey) {
      if (activeElement === first || !dialogRef.current?.contains(activeElement)) {
        event.preventDefault();
        last.focus();
      }
    } else if (activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl relative"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 id={headingId} className="text-lg font-semibold">Scan QR Code</h2>
          <Button
            ref={closeButtonRef}
            type="button"
            variant="outline"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
        {!errorCode ? (
          <video
            ref={ref}
            className="w-full rounded-md"
            playsInline
            muted
            tabIndex={0}
          />
        ) : (
          <div
            className="rounded border border-dashed border-gray-300 p-6 text-center text-gray-600"
            tabIndex={0}
          >
            {renderMessage()}
          </div>
        )}
      </div>
    </div>
  );
}
