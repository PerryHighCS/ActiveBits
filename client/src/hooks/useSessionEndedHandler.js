import { useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * useSessionEndedHandler - Custom hook to handle session-ended WebSocket messages
 * Automatically redirects to /session-ended when the session is terminated
 * 
 * Usage in student components:
 * ```
 * const wsRef = useRef(null);
 * const attachSessionEndedHandler = useSessionEndedHandler();
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
export function useSessionEndedHandler() {
  const navigate = useNavigate();
  const cleanupRef = useRef(null);

  return useCallback((ws) => {
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
      } catch {
        // Ignore parse errors or non-JSON messages
      }
    };

    // Add listener
    ws.addEventListener('message', handleMessage);
    
    // Store cleanup function
    cleanupRef.current = () => {
      ws.removeEventListener('message', handleMessage);
    };
  }, [navigate]);
}
