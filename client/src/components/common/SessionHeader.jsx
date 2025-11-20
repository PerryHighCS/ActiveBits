import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

/**
 * SessionHeader - Reusable header for activity manager pages
 * Shows activity name, join code, join URL, and end session button
 * 
 * @param {object} props
 * @param {string} props.activityName - Display name of the activity
 * @param {string} props.sessionId - The session ID
 * @param {function} [props.onEndSession] - Optional callback invoked after the session is successfully ended. 
 *                                          Called after the DELETE request completes but before navigation to /manage.
 *                                          Use this for activity-specific cleanup (e.g., closing WebSocket connections).
 */
export default function SessionHeader({ activityName, sessionId, onEndSession }) {
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const navigate = useNavigate();

  const studentJoinUrl = sessionId ? `${window.location.origin}/${sessionId}` : '';

  const copyLink = async () => {
    if (!studentJoinUrl) return;
    try {
      await navigator.clipboard.writeText(studentJoinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      console.error('Failed to copy link');
    }
  };

  const copyCode = async () => {
    if (!sessionId) return;
    try {
      await navigator.clipboard.writeText(sessionId);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1500);
    } catch {
      console.error('Failed to copy code');
    }
  };

  const handleEndSession = async () => {
    setIsEnding(true);
    try {
      const res = await fetch(`/api/session/${sessionId}`, {
        method: 'DELETE',
      });
      
      if (!res.ok) throw new Error('Failed to end session');
      
      // Call custom callback if provided
      if (onEndSession) {
        await onEndSession();
      }
      
      // Navigate back to dashboard
      navigate('/manage');
    } catch (err) {
      console.error('Error ending session:', err);
      alert('Failed to end session. Please try again.');
      setIsEnding(false);
      setShowEndModal(false);
    }
  };

  return (
    <>
      <div className="bg-white border-b border-gray-200 px-6 py-4 mb-6">
        <div className="flex flex-col gap-3">
          {/* Activity Name */}
          <h1 className="text-2xl font-bold text-gray-800">{activityName}</h1>

          {/* Join Code and Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {/* Join Code */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Join Code:</span>
                  <code 
                    onClick={copyCode}
                    className="px-3 py-1.5 rounded bg-gray-100 font-mono text-lg font-semibold text-gray-800 cursor-pointer hover:bg-gray-200 transition-colors"
                    title="Click to copy"
                  >
                    {codeCopied ? '✓ Copied!' : sessionId}
                  </code>
                </div>

                {/* Copy URL Button */}
                <Button onClick={copyLink} variant="outline">
                  {copied ? '✓ Copied!' : 'Copy Join URL'}
                </Button>
              </div>

              {/* End Session Button */}
              <Button 
                onClick={() => setShowEndModal(true)}
                variant="outline"
                className="!border-red-600 !text-red-600 hover:!bg-red-50 hover:!text-red-700"
              >
              End Session
            </Button>
          </div>
        </div>
      </div>
      
      {/* End Session Confirmation Modal */}
      <Modal
        open={showEndModal}
        onClose={() => !isEnding && setShowEndModal(false)}
        title="End Session"
      >
        <div className="space-y-4">
          <p className="text-gray-700">
            Are you sure you want to end this session? All students will be disconnected and progress data will be cleared.
          </p>
          <p className="text-sm text-gray-600">
            Session ID: <code className="bg-gray-100 px-2 py-1 rounded">{sessionId}</code>
          </p>
          <div className="flex justify-end gap-3 pt-4">
            <Button
              onClick={() => setShowEndModal(false)}
              variant="outline"
              disabled={isEnding}
            >
              Cancel
            </Button>
            <Button
              onClick={handleEndSession}
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={isEnding}
            >
              {isEnding ? 'Ending...' : 'End Session'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
