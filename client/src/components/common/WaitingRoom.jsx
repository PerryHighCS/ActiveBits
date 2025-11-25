import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../ui/Button';

/**
 * WaitingRoom component for persistent sessions
 * Shows waiting students count and allows teacher to enter code to start session
 * 
 * @param {object} props
 * @param {string} props.activityName - The activity name
 * @param {string} props.hash - The persistent session hash
 * @param {boolean} props.hasTeacherCookie - Whether the user has the teacher cookie
 * @returns {React.Component}
 */
export default function WaitingRoom({ activityName, hash, hasTeacherCookie }) {
  const [waiterCount, setWaiterCount] = useState(0);
  const [teacherCode, setTeacherCode] = useState('');
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const autoAuthAttemptedRef = useRef(false); // Use ref to avoid re-triggering effect
  const hasNavigatedRef = useRef(false); // Use ref to persist across re-renders
  const teacherAuthRequestedRef = useRef(false); // Tracks teacher intent across renders
  const wsRef = useRef(null);
  const closedByCleanupRef = useRef(false); // Avoid treating deliberate closes as errors
  const navigate = useNavigate();

  useEffect(() => {
    // New link load: clear stale errors
    setError(null);
    // Reset teacher intent when changing links
    teacherAuthRequestedRef.current = false;

    // Connect to WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/persistent-session?hash=${hash}&activityName=${activityName}`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    closedByCleanupRef.current = false;
    const shouldIgnoreError = () => {
      const state = wsRef.current?.readyState;
      return closedByCleanupRef.current || hasNavigatedRef.current || state === WebSocket.CLOSING || state === WebSocket.CLOSED;
    };
    const navigateOnce = (path) => {
      if (hasNavigatedRef.current) return;
      hasNavigatedRef.current = true;
      // Close immediately to avoid handling additional messages mid-navigation
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      navigate(path);
    };

    ws.onopen = () => {
      console.log('Connected to waiting room');
      setError(null);
      
      // If teacher has cookie, immediately try to auto-authenticate
      if (hasTeacherCookie && !autoAuthAttemptedRef.current) {
        console.log('Attempting auto-authentication as teacher');
        
        fetch(`/api/persistent-session/${hash}/teacher-code?activityName=${activityName}`, { credentials: 'include' })
          .then(res => res.json())
          .then(data => {
            if (data.teacherCode) {
              console.log('Got teacher code from cookie, authenticating');
              try {
                ws.send(JSON.stringify({
                  type: 'verify-teacher-code',
                  teacherCode: data.teacherCode,
                }));
              } catch (sendErr) {
                console.error('Failed to send teacher code over WS:', sendErr);
              }
            } else {
              console.log('No teacher code found in cookie response:', data);
            }
          })
          .catch(err => {
            console.error('Failed to fetch teacher code:', err);
          })
          .finally(() => {
            // Mark as attempted after fetch completes (success or failure)
            // This prevents duplicate attempts on reconnection
            autoAuthAttemptedRef.current = true;
          });
      }
    };

    ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err, event.data);
        return; // Ignore malformed messages
      }
      
      console.log('Received WebSocket message:', message.type, message);
      
      // If already navigated, ignore all messages
      if (hasNavigatedRef.current) {
        console.log('Ignoring message, already navigated');
        return;
      }
      
      if (message.type === 'waiter-count') {
        setWaiterCount(message.count);
      } else if (message.type === 'session-started') {
        // Session was started by teacher, redirect to session
        console.log('Redirecting to student session:', message.sessionId);
        if (teacherAuthRequestedRef.current) {
          navigateOnce(`/manage/${activityName}/${message.sessionId}`);
        } else {
          navigateOnce(`/${message.sessionId}`);
        }
      } else if (message.type === 'teacher-authenticated') {
        // This client is the teacher, redirect to manage page
        console.log('Redirecting to teacher manage page:', message.sessionId);
        navigateOnce(`/manage/${activityName}/${message.sessionId}`);
      } else if (message.type === 'teacher-code-error') {
        setError(message.error);
        setIsSubmitting(false);
        teacherAuthRequestedRef.current = false;
      }
    };

    ws.onerror = (event) => {
      console.error('WebSocket error:', event);
      // Ignore errors from deliberate closes or post-navigation teardown (common in StrictMode double-mount)
      if (shouldIgnoreError()) return;
      setError('Connection error. Please refresh the page.');
    };

    ws.onclose = () => {
      console.log('Disconnected from waiting room');
    };

    return () => {
      // Ensure we tear down the socket even if it's still connecting (React StrictMode mounts twice)
      if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
        closedByCleanupRef.current = true;
        ws.close();
      }
    };
  }, [activityName, hash, navigate, hasTeacherCookie]);

  const handleTeacherCodeSubmit = (e) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    teacherAuthRequestedRef.current = true;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'verify-teacher-code',
        teacherCode: teacherCode.trim(),
      }));
    } else {
      setError('Not connected. Please refresh the page.');
      setIsSubmitting(false);
      teacherAuthRequestedRef.current = false;
    }
  };

  const getActivityDisplayName = () => {
    const names = {
      'raffle': 'Raffle',
      'www-sim': 'WWW Simulator',
      'java-string-practice': 'Java String Practice',
      'python-list-practice': 'Python List Practice',
    };
    return names[activityName] || activityName;
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] max-w-2xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg p-8 w-full border-2 border-gray-200">
        <h1 className="text-3xl font-bold text-center mb-2 text-gray-800">
          {getActivityDisplayName()}
        </h1>
        
        <div className="text-center mb-6">
          <p className="text-lg text-gray-600 mb-2">
            Waiting for teacher to start the activity
          </p>
          {(() => {
            const otherWaiters = Math.max(waiterCount - 1, 0);
            return (
          <p className="text-2xl font-bold text-blue-600">
            {otherWaiters === 0 && 'You are the first one here!'}
            {otherWaiters === 1 && 'You and 1 other person waiting'}
            {otherWaiters > 1 && `You and ${otherWaiters} others waiting`}
          </p>
            );
          })()}
        </div>

        <div className="border-t-2 border-gray-200 pt-6 mt-6">
          <p className="text-center text-gray-700 mb-4 font-semibold">
            Are you the teacher?
          </p>
          
          <form onSubmit={handleTeacherCodeSubmit} className="flex flex-col items-center gap-4">
            <input
              type="password"
              placeholder="Enter teacher code"
              value={teacherCode}
              onChange={(e) => setTeacherCode(e.target.value)}
              className="border-2 border-gray-300 rounded px-4 py-2 w-full max-w-xs text-center focus:outline-none focus:border-blue-500"
              disabled={isSubmitting}
              autoComplete="off"
            />
            
            {error && (
              <p className="text-red-600 text-sm">
                {error}
              </p>
            )}
            
            <Button 
              type="submit" 
              disabled={isSubmitting || !teacherCode.trim()}
            >
              {isSubmitting ? 'Verifying...' : 'Start Activity'}
            </Button>
          </form>

          {hasTeacherCookie && (
            <p className="text-xs text-gray-500 text-center mt-4">
              Tip: Your browser remembers your teacher code for this link
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 text-center text-sm text-gray-500">
        <p>Share this URL with your students:</p>
        <code className="bg-gray-100 px-3 py-1 rounded mt-1 inline-block text-xs">
          {window.location.href}
        </code>
      </div>
    </div>
  );
}
