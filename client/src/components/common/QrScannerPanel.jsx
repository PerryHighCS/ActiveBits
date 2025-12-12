import React, { useMemo, useState } from 'react';
import { useZxing } from 'react-zxing';
import Button from '@src/components/ui/Button';

export default function QrScannerPanel({ onDetected, onError, onClose }) {
  const [errorCode, setErrorCode] = useState(null);
  const [hasDetected, setHasDetected] = useState(false);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl relative">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Scan QR Code</h2>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
        {!errorCode ? (
          <video
            ref={ref}
            className="w-full rounded-md"
            playsInline
            muted
          />
        ) : (
          <div className="rounded border border-dashed border-gray-300 p-6 text-center text-gray-600">
            {renderMessage()}
          </div>
        )}
      </div>
    </div>
  );
}
