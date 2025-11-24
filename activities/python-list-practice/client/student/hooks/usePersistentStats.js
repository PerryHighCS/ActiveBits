import { useCallback, useEffect, useRef, useState } from 'react';

export default function usePersistentStats({ sessionId, studentId, submittedName, isSolo }) {
  const [stats, setStats] = useState({ total: 0, correct: 0, streak: 0, longestStreak: 0 });
  const statsRef = useRef(stats);
  const statsLoadedRef = useRef(false);

  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  const statsStorageKey = (() => {
    if (!sessionId || !studentId || isSolo) return null;
    return `python-list-practice-stats-${sessionId}-${studentId}`;
  })();

  const sendStats = useCallback(async (nextStats) => {
    const payload = nextStats || statsRef.current;
    if (!sessionId || !submittedName || !studentId) return;
    try {
      await fetch(`/api/python-list-practice/${sessionId}/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentName: submittedName, studentId, stats: payload }),
      });
    } catch (err) {
      // swallow network errors here; caller may log
      // eslint-disable-next-line no-console
      console.error('Failed to send stats', err);
    }
  }, [sessionId, studentId, submittedName]);

  useEffect(() => {
    if (!statsStorageKey || statsLoadedRef.current) return;
    try {
      const stored = localStorage.getItem(statsStorageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        setStats(parsed);
        statsRef.current = parsed;
        if (submittedName) {
          sendStats(parsed);
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Failed to load saved stats', err);
    } finally {
      statsLoadedRef.current = true;
    }
  }, [statsStorageKey, sendStats, submittedName]);

  useEffect(() => {
    if (!statsStorageKey || !statsLoadedRef.current) return;
    try {
      localStorage.setItem(statsStorageKey, JSON.stringify(stats));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Failed to save stats', err);
    }
  }, [stats, statsStorageKey]);

  return { stats, setStats, sendStats, statsRef };
}
