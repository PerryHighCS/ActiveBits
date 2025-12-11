import React, { useEffect, useRef, useState } from 'react';
import Button from '@src/components/ui/Button';

/**
 * Lightweight QR scanner overlay built on BarcodeDetector.
 * Falls back gracefully when the API or camera is unavailable.
 */
export default function QrScannerPanel({ onDetected, onError, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const hasDetectedRef = useRef(false);
  const [status, setStatus] = useState('loading');
  const [errorCode, setErrorCode] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia || typeof window.BarcodeDetector === 'undefined') {
      setStatus('error');
      setErrorCode('scanner-unavailable');
      onError?.(new Error('scanner-unavailable'));
      return () => {};
    }

    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) return;
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        setStatus('ready');

        const scanFrame = async () => {
          if (cancelled) return;
          const vid = videoRef.current;
          const canvas = canvasRef.current;
          if (!vid || !canvas || vid.readyState < 2) {
            rafRef.current = requestAnimationFrame(scanFrame);
            return;
          }

          try {
            canvas.width = vid.videoWidth;
            canvas.height = vid.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
            const results = await detector.detect(canvas);
            if (!hasDetectedRef.current && Array.isArray(results) && results.length > 0) {
              hasDetectedRef.current = true;
              onDetected?.(results[0].rawValue);
              return;
            }
          } catch (err) {
            if (!cancelled) {
              setStatus('error');
              setErrorCode('scanner-error');
              onError?.(err);
            }
            return;
          }
          rafRef.current = requestAnimationFrame(scanFrame);
        };

        scanFrame();
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setErrorCode('camera-error');
        onError?.(err);
      }
    };

    start();

    return () => {
      cancelled = true;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, [onDetected, onError]);

  const renderMessage = () => {
    switch (errorCode) {
      case 'scanner-unavailable':
        return 'In-page scanning is not supported on this browser. Use your camera app instead.';
      case 'camera-error':
        return 'Unable to access the camera. Check permissions and try again.';
      case 'scanner-error':
        return 'Scanning failed. Please close and try again.';
      default:
        return 'Initializing camera…';
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
        {status === 'ready' ? (
          <div className="relative">
            <video
              ref={videoRef}
              className="w-full rounded-md"
              playsInline
              muted
            />
            <canvas ref={canvasRef} className="hidden" />
          </div>
        ) : (
          <div className="rounded border border-dashed border-gray-300 p-6 text-center text-gray-600">
            {renderMessage()}
          </div>
        )}
      </div>
    </div>
  );
}
