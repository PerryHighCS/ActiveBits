import { useState, useEffect, useCallback } from 'react';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';

export default function useGalleryWalkSession(sessionId, options = {}) {
  const {
    initialData = null,
  } = options;

  const [stage, setStage] = useState(initialData?.stage || 'gallery');
  const [feedback, setFeedback] = useState(
    Array.isArray(initialData?.feedback) ? initialData.feedback : [],
  );
  const [reviewees, setReviewees] = useState(initialData?.reviewees || {});
  const [reviewers, setReviewers] = useState(initialData?.reviewers || {});
  const [sessionTitle, setSessionTitle] = useState(initialData?.config?.title || '');
  const [isLoading, setIsLoading] = useState(!initialData);
  const [error, setError] = useState(null);
  const [lastMessage, setLastMessage] = useState(null);

  useEffect(() => {
    if (!initialData) return;
    setStage(initialData.stage || 'gallery');
    setFeedback(Array.isArray(initialData.feedback) ? initialData.feedback : []);
    setReviewees(initialData.reviewees || {});
    setReviewers(initialData.reviewers || {});
    setSessionTitle(initialData.config?.title || '');
    setIsLoading(false);
  }, [initialData]);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setStage('gallery');
      setFeedback([]);
      setReviewees({});
      setReviewers({});
      setSessionTitle('');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/gallery-walk/${sessionId}/feedback`);
      if (!res.ok) {
        throw new Error('Failed to load session data');
      }
      const data = await res.json();
      setStage(data.stage || 'gallery');
      setFeedback(Array.isArray(data.feedback) ? data.feedback : []);
      setReviewees(data.reviewees || {});
      setReviewers(data.reviewers || {});
      setSessionTitle(data.config?.title || '');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const buildWsUrl = useCallback(() => {
    if (!sessionId) return null;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/gallery-walk?sessionId=${sessionId}`;
  }, [sessionId]);

  const handleWsMessage = useCallback((event) => {
    try {
      const message = JSON.parse(event.data);
      setLastMessage(message);
      if (message.type === 'stage-changed') {
        setStage(message.payload?.stage || message.stage || 'gallery');
        return;
      }
      if (message.type === 'session-ended') {
        return;
      }
      if (message.type === 'reviewees-updated') {
        setReviewees(message.payload?.reviewees || {});
        return;
      }
      if (message.type === 'feedback-added') {
        const entry = message.payload?.feedback;
        if (entry) {
          setFeedback((prev) => [...prev, entry]);
        }
        return;
      }
    } catch {
      // ignore malformed events
    }
  }, []);

  const { connect: connectWs, disconnect: disconnectWs } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(sessionId),
    onMessage: handleWsMessage,
  });

  useEffect(() => {
    if (!sessionId) return undefined;
    connectWs();
    return () => disconnectWs();
  }, [sessionId, connectWs, disconnectWs]);

  return {
    stage,
    setStage,
    feedback,
    setFeedback,
    reviewees,
    setReviewees,
    reviewers,
    setReviewers,
    sessionTitle,
    setSessionTitle,
    isLoading,
    error,
    setError,
    refresh,
    lastMessage,
  };
}
