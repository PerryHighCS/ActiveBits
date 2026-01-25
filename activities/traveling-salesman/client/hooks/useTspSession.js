import { useCallback, useEffect, useRef, useState } from 'react';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';

export function useTspSession({
  sessionId,
  buildWsUrl,
  shouldReconnect = Boolean(sessionId),
  refreshTypes = [],
  refreshDelay = 100,
  includeLeaderboard = false,
  onMessage,
  onOpen,
  onSession,
  attachSessionEndedHandler
}) {
  const [session, setSession] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const refreshTimeoutRef = useRef(null);

  const fetchSession = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/traveling-salesman/${sessionId}/session`);
      if (!res.ok) throw new Error('Failed to fetch session');
      const data = await res.json();
      setSession(data);
      onSession?.(data);
    } catch (err) {
      console.error('Failed to fetch session:', err);
    }
  }, [sessionId, onSession]);

  const fetchLeaderboard = useCallback(async () => {
    if (!sessionId || !includeLeaderboard) return;
    try {
      const res = await fetch(`/api/traveling-salesman/${sessionId}/leaderboard`);
      if (!res.ok) throw new Error('Failed to fetch leaderboard');
      const data = await res.json();
      setLeaderboard(data.leaderboard || []);
    } catch (err) {
      console.error('Failed to fetch leaderboard:', err);
    }
  }, [sessionId, includeLeaderboard]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) return;
    refreshTimeoutRef.current = setTimeout(() => {
      refreshTimeoutRef.current = null;
      fetchSession();
      fetchLeaderboard();
    }, refreshDelay);
  }, [fetchSession, fetchLeaderboard, refreshDelay]);

  const handleWsMessage = useCallback((event) => {
    try {
      const message = JSON.parse(event.data);
      onMessage?.(message);
      if (refreshTypes.includes(message.type)) {
        scheduleRefresh();
      }
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err);
    }
  }, [onMessage, refreshTypes, scheduleRefresh]);

  const { connect, disconnect } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect,
    onOpen: () => {
      fetchSession();
      fetchLeaderboard();
      onOpen?.();
    },
    onMessage: handleWsMessage,
    attachSessionEndedHandler
  });

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  return {
    session,
    leaderboard,
    fetchSession,
    fetchLeaderboard,
    scheduleRefresh,
    connect,
    disconnect,
    setSession,
    setLeaderboard
  };
}

