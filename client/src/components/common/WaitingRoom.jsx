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
  const [autoAuthAttempted, setAutoAuthAttempted] = useState(false);
  const hasNavigatedRef = useRef(false); // Use ref to persist across re-renders
  const wsRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    // Connect to WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/persistent-session?hash=${hash}&activityName=${activityName}`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Connected to waiting room');
      
      // If teacher has cookie, immediately try to auto-authenticate
      if (hasTeacherCookie && !autoAuthAttempted) {
        setAutoAuthAttempted(true);
        console.log('Attempting auto-authentication as teacher');
        
        fetch(`/api/persistent-session/${hash}/teacher-code?activityName=${activityName}`, { credentials: 'include' })
          .then(res => res.json())
          .then(data => {
            if (data.teacherCode) {
              console.log('Got teacher code from cookie, authenticating');
              ws.send(JSON.stringify({
                type: 'verify-teacher-code',
                teacherCode: data.teacherCode,
              }));
            } else {
              console.log('No teacher code found in cookie response:', data);
            }
          })
          .catch(err => {
            console.error('Failed to fetch teacher code:', err);
          });
      }
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
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
        hasNavigatedRef.current = true;
        navigate(`/${message.sessionId}`);
      } else if (message.type === 'teacher-authenticated') {
        // This client is the teacher, redirect to manage page
        console.log('Redirecting to teacher manage page:', message.sessionId);
        hasNavigatedRef.current = true;
        navigate(`/manage/${activityName}/${message.sessionId}`);
      } else if (message.type === 'teacher-code-error') {
        setError(message.error);
        setIsSubmitting(false);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setError('Connection error. Please refresh the page.');
    };

    ws.onclose = () => {
      console.log('Disconnected from waiting room');
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [activityName, hash, navigate, hasTeacherCookie, autoAuthAttempted]);

  const handleTeacherCodeSubmit = (e) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'verify-teacher-code',
        teacherCode: teacherCode.trim(),
      }));
    } else {
      setError('Not connected. Please refresh the page.');
      setIsSubmitting(false);
    }
  };

  const getActivityDisplayName = () => {
    const names = {
      'raffle': 'Raffle',
      'www-sim': 'WWW Simulator',
      'java-string-practice': 'Java String Practice',
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
          <p className="text-2xl font-bold text-blue-600">
            {waiterCount === 0 && 'You are the first one here!'}
            {waiterCount === 1 && 'You and 1 other person waiting'}
            {waiterCount > 1 && `You and ${waiterCount} others waiting`}
          </p>
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
