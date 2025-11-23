import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * useSessionEndedHandler - Custom hook to handle session-ended WebSocket messages
 * Automatically redirects to /session-ended when the session is terminated
 * 
 * Usage in student components:
 * ```
 * const wsRef = useRef(null);
 * const attachSessionEndedHandler = useSessionEndedHandler(wsRef);
 * 
 * useEffect(() => {
 *   const ws = new WebSocket(url);
 *   wsRef.current = ws;
 *   attachSessionEndedHandler(ws); // Attach handler after creating WebSocket
 *   // ... rest of setup
 * }, []);
 * ```
 * 
 * @returns {function} - Function to attach handler to a WebSocket
 */
export function useSessionEndedHandler(wsRef = null) {
  const navigate = useNavigate();
  const cleanupRef = useRef(null);
  // Track last WebSocket to avoid adding multiple listeners to the same instance
  const lastWsRef = useRef(null);

  const attachHandler = useCallback((ws) => {
    if (!ws) return;
    
    // Clean up previous listener if any
    if (cleanupRef.current) {
      cleanupRef.current();
    }
    
    const handleMessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'session-ended') {
          navigate('/session-ended');
        }
      } catch (err) {
        // Silently ignore non-JSON messages (e.g., 'ping', 'pong') and JSON parse errors
        // This is expected behavior as WebSockets may receive various message formats
        // Log errors in development for debugging
        if (process.env.NODE_ENV === 'development') {
          console.debug('[useSessionEndedHandler] Ignored non-JSON message:', event.data, err);
        }
      }
    };

    // Add listener
    ws.addEventListener('message', handleMessage);
    lastWsRef.current = ws;
    
    // Store cleanup function
    cleanupRef.current = () => {
      ws.removeEventListener('message', handleMessage);
      if (lastWsRef.current === ws) {
        lastWsRef.current = null;
      }
    };
  }, [navigate]);

  // Optional auto-attach when a wsRef is provided and the underlying socket changes.
  // Using wsRef.current (not the ref object) keeps the dependency aligned with the actual socket instance.
  useEffect(() => {
    if (!wsRef || !wsRef.current) return undefined;
    if (wsRef.current === lastWsRef.current) return undefined;

    attachHandler(wsRef.current);
    return () => cleanupRef.current?.();
  }, [attachHandler, wsRef?.current]);

  // Ensure cleanup on unmount
  useEffect(() => () => cleanupRef.current?.(), []);

  return attachHandler;
}
