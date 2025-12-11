import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import SessionHeader from '@src/components/common/SessionHeader';
import Button from '@src/components/ui/Button';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';
import { sortFeedbackEntries } from './feedbackUtils';

export default function ManagerPage() {
  const { sessionId } = useParams();
  const [stage, setStage] = useState('gallery');
  const [feedback, setFeedback] = useState([]);
  const [reviewees, setReviewees] = useState({});
  const [reviewers, setReviewers] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortField, setSortField] = useState('createdAt');
  const [sortDirection, setSortDirection] = useState('desc');

  const loadSnapshot = useCallback(async () => {
    if (!sessionId) return;
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
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  const handleStageChange = async (nextStage) => {
    if (!sessionId || stage === nextStage) return;
    try {
      const res = await fetch(`/api/gallery-walk/${sessionId}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: nextStage }),
      });
      if (!res.ok) {
        throw new Error('Failed to update stage');
      }
      const data = await res.json();
      setStage(data.stage || nextStage);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedFeedback = useMemo(
    () => sortFeedbackEntries(feedback, sortField, sortDirection),
    [feedback, sortField, sortDirection],
  );

  const buildWsUrl = useCallback(() => {
    if (!sessionId) return null;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/gallery-walk?sessionId=${sessionId}`;
  }, [sessionId]);

  const handleWsMessage = useCallback((event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'stage-changed') {
        setStage(message.payload?.stage || message.stage || 'gallery');
        return;
      }
      if (message.type === 'reviewees-updated') {
        setReviewees(message.payload?.reviewees || {});
        return;
      }
      if (message.type === 'feedback-added') {
        const entry = message.payload?.feedback;
        if (entry) {
          setFeedback((prev) => [entry, ...prev]);
        }
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

  const renderStageControls = () => (
    <div className="flex gap-3">
      <Button
        type="button"
        variant={stage === 'gallery' ? 'default' : 'outline'}
        onClick={() => handleStageChange('gallery')}
      >
        Gallery Walk mode
      </Button>
      <Button
        type="button"
        variant={stage === 'review' ? 'default' : 'outline'}
        onClick={() => handleStageChange('review')}
      >
        Feedback review mode
      </Button>
    </div>
  );

  const renderTableHeaderCell = (label, field) => (
    <button
      type="button"
      className="flex items-center gap-1 text-left text-sm font-semibold text-gray-700"
      onClick={() => handleSort(field)}
    >
      {label}
      {sortField === field && (
        <span className="text-xs text-gray-500">{sortDirection === 'asc' ? '▲' : '▼'}</span>
      )}
    </button>
  );

  const renderFeedbackTable = () => (
    <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200 bg-white shadow">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3">{renderTableHeaderCell('To', 'to')}</th>
            <th className="px-4 py-3">{renderTableHeaderCell('From', 'fromNameSnapshot')}</th>
            <th className="px-4 py-3">Message</th>
            <th className="px-4 py-3">{renderTableHeaderCell('Time', 'createdAt')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sortedFeedback.map((entry) => (
            <tr key={entry.id}>
              <td className="px-4 py-3">
                {reviewees[entry.to]?.projectTitle || reviewees[entry.to]?.name || entry.to || '—'}
              </td>
              <td className="px-4 py-3">{entry.fromNameSnapshot || reviewers[entry.from]?.name || '—'}</td>
              <td className="px-4 py-3">
                <p className="whitespace-pre-wrap">{entry.message}</p>
              </td>
              <td className="px-4 py-3 text-gray-600">
                {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '—'}
              </td>
            </tr>
          ))}
          {!sortedFeedback.length && (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                No feedback yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="p-6">
      <SessionHeader activityName="Gallery Walk" sessionId={sessionId || 'unknown'} />
      {!sessionId ? (
        <div className="mt-6 text-gray-600 space-y-2">
          <p>No session selected. Start a Gallery Walk from the dashboard to get a join code.</p>
          <Link to="/manage" className="text-blue-600 underline">
            Back to dashboard
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {renderStageControls()}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {isLoading ? (
            <p className="text-gray-600">Loading session data…</p>
          ) : (
            renderFeedbackTable()
          )}
        </div>
      )}
    </div>
  );
}
