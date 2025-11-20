import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * useSessionEndedHandler - Custom hook to handle session-ended WebSocket messages
 * Automatically redirects to /session-ended when the session is terminated
 * 
 * Usage in student components:
 * ```
 * const wsRef = useRef(null);
 * useSessionEndedHandler(wsRef);
 * ```
 * 
 * @param {React.RefObject} wsRef - Reference to the WebSocket connection
 */
export function useSessionEndedHandler(wsRef) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!wsRef?.current) return;

    const ws = wsRef.current;
    
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

    // Add our listener (won't interfere with other message handlers)
    ws.addEventListener('message', handleMessage);

    return () => {
      ws.removeEventListener('message', handleMessage);
    };
  }, [wsRef, navigate]);
}
