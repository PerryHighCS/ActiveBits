import { useCallback, useRef, useState } from 'react';

export function useBroadcastToggles({ sessionId } = {}) {
  const [broadcastIds, setBroadcastIds] = useState([]);
  const [broadcastSnapshot, setBroadcastSnapshot] = useState([]);
  const didInitRef = useRef(false);

  const handleBroadcastMessage = useCallback((message) => {
    if (message.type === 'broadcastUpdate') {
      setBroadcastSnapshot(message.payload?.routes || []);
      return;
    }
    if (message.type === 'clearBroadcast') {
      if (broadcastIds.length > 0) {
        return;
      }
      setBroadcastSnapshot([]);
      return;
    }
    if (message.type === 'problemUpdate') {
      setBroadcastSnapshot([]);
    }
  }, [broadcastIds.length]);

  const setBroadcasts = useCallback(async (next) => {
    setBroadcastIds(next);
    if (!sessionId) return;
    await fetch(`/api/traveling-salesman/${sessionId}/set-broadcasts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ broadcasts: next })
    });
  }, [sessionId]);

  const initializeBroadcasts = useCallback((next) => {
    if (!Array.isArray(next)) return;
    if (didInitRef.current) return;
    didInitRef.current = true;
    setBroadcastIds(next);
  }, []);

  return {
    broadcastIds,
    broadcastSnapshot,
    setBroadcasts,
    initializeBroadcasts,
    handleBroadcastMessage
  };
}
