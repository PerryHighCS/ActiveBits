import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import Button from '@src/components/ui/Button';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';

function generateShortId(length = 6) {
  const alphabet = 'BCDFGHJKLMNPQRSTVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return out;
}

const STAGE_LABELS = {
  gallery: 'Gallery Walk',
  review: 'Feedback Review',
};

export default function StudentPage({ sessionData }) {
  const sessionId = sessionData?.sessionId || null;
  const location = useLocation();
  const navigate = useNavigate();

  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const requestedReviewee = query.get('reviewee');
  const isReviewerMode = Boolean(requestedReviewee);

  const storagePrefix = sessionId ? `gallery-walk:${sessionId}` : null;
  const [stage, setStage] = useState(() => sessionData?.data?.stage || 'gallery');
  const [sessionClosed, setSessionClosed] = useState(false);

  // Reviewee (kiosk) state
  const [revieweeId, setRevieweeId] = useState(null);
  const [revieweeRecord, setRevieweeRecord] = useState(null);
  const [registrationName, setRegistrationName] = useState('');
  const [registrationProject, setRegistrationProject] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [registrationError, setRegistrationError] = useState(null);

  // Local fallback form state
  const [localReviewerName, setLocalReviewerName] = useState('');
  const [localMessage, setLocalMessage] = useState('');
  const [isSubmittingLocal, setIsSubmittingLocal] = useState(false);
  const [localFormNotice, setLocalFormNotice] = useState(null);

  const [stageChangePending, setStageChangePending] = useState(false);
  const [showFeedbackView, setShowFeedbackView] = useState(stage === 'review');

  const [revieweeFeedback, setRevieweeFeedback] = useState([]);
  const [isLoadingFeedback, setIsLoadingFeedback] = useState(false);

  const baseJoinUrl = useMemo(() => {
    if (!sessionId || !revieweeId || typeof window === 'undefined') return '';
    return `${window.location.origin}/${sessionId}?reviewee=${encodeURIComponent(revieweeId)}`;
  }, [sessionId, revieweeId]);

  useEffect(() => {
    if (!storagePrefix) return;
    const storedId = localStorage.getItem(`${storagePrefix}:revieweeId`);
    if (storedId) {
      setRevieweeId(storedId);
    }
  }, [storagePrefix]);

  const fetchSessionSnapshot = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/gallery-walk/${sessionId}/feedback`);
      if (!res.ok) throw new Error('Failed to fetch session snapshot');
      const data = await res.json();
      setStage(data.stage || 'gallery');
      if (revieweeId && data.reviewees?.[revieweeId]) {
        setRevieweeRecord(data.reviewees[revieweeId]);
      }
    } catch (err) {
      console.error('Failed to fetch gallery-walk snapshot:', err);
    }
  }, [sessionId, revieweeId]);

  useEffect(() => {
    fetchSessionSnapshot();
  }, [fetchSessionSnapshot]);

  const fetchRevieweeFeedback = useCallback(async () => {
    if (!sessionId || !revieweeId) return;
    try {
      setIsLoadingFeedback(true);
      const res = await fetch(`/api/gallery-walk/${sessionId}/feedback/${revieweeId}`);
      if (!res.ok) throw new Error('Failed to fetch feedback');
      const data = await res.json();
      setRevieweeFeedback(Array.isArray(data.feedback) ? data.feedback : []);
      if (data.reviewee) {
        setRevieweeRecord(data.reviewee);
      }
    } catch (err) {
      console.error('Failed to fetch reviewee feedback:', err);
    } finally {
      setIsLoadingFeedback(false);
    }
  }, [sessionId, revieweeId]);

  useEffect(() => {
    if (showFeedbackView) {
      fetchRevieweeFeedback();
    }
  }, [showFeedbackView, fetchRevieweeFeedback]);

  const handleRevieweeRegistration = async (event) => {
    event.preventDefault();
    if (!sessionId) return;
    const trimmedName = registrationName.trim();
    if (!trimmedName) {
      setRegistrationError('Please enter your name.');
      return;
    }
    const trimmedProject = registrationProject.trim();
    const newId = revieweeId || generateShortId();
    setIsRegistering(true);
    setRegistrationError(null);
    try {
      const res = await fetch(`/api/gallery-walk/${sessionId}/reviewee`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revieweeId: newId,
          name: trimmedName,
          projectTitle: trimmedProject || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Unable to register kiosk');
      }
      const data = await res.json();
      const assignedId = data.revieweeId || newId;
      setRevieweeId(assignedId);
      if (storagePrefix) {
        localStorage.setItem(`${storagePrefix}:revieweeId`, assignedId);
      }
      const latestRecord = data.reviewees?.[assignedId] || { name: trimmedName, projectTitle: trimmedProject };
      setRevieweeRecord(latestRecord);
    } catch (err) {
      console.error(err);
      setRegistrationError(err.message);
    } finally {
      setIsRegistering(false);
    }
  };

  const handleLocalFeedbackSubmit = async (event) => {
    event.preventDefault();
    if (!sessionId || !revieweeId) return;
    const reviewerName = localReviewerName.trim();
    const message = localMessage.trim();
    if (!reviewerName || !message) {
      setLocalFormNotice('Please provide both a name and feedback message.');
      return;
    }
    setIsSubmittingLocal(true);
    setLocalFormNotice(null);
    const reviewerId = generateShortId(8);
    try {
      await fetch(`/api/gallery-walk/${sessionId}/reviewer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewerId, name: reviewerName }),
      });
      const res = await fetch(`/api/gallery-walk/${sessionId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revieweeId, reviewerId, message }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to submit feedback');
      }
      setLocalReviewerName('');
      setLocalMessage('');
      setLocalFormNotice('Feedback submitted. Thank you!');
      if (stage === 'review' && stageChangePending) {
        setStageChangePending(false);
        setShowFeedbackView(true);
        fetchRevieweeFeedback();
      }
    } catch (err) {
      console.error(err);
      setLocalFormNotice(err.message);
    } finally {
      setIsSubmittingLocal(false);
    }
  };

  useEffect(() => {
    if (stage === 'review') {
      if (localMessage.trim().length > 0 || isSubmittingLocal) {
        setStageChangePending(true);
      } else {
        setStageChangePending(false);
        setShowFeedbackView(true);
      }
    } else {
      setStageChangePending(false);
      setShowFeedbackView(false);
    }
  }, [stage, localMessage, isSubmittingLocal]);

  useEffect(() => {
    if (stage === 'review' && stageChangePending && !localMessage.trim() && !isSubmittingLocal) {
      setStageChangePending(false);
      setShowFeedbackView(true);
    }
  }, [stage, stageChangePending, localMessage, isSubmittingLocal]);

  const handleWsMessage = useCallback((event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'stage-changed') {
        setStage(message.stage || message.payload?.stage || 'gallery');
        return;
      }
      if (message.type === 'session-ended') {
        if (showFeedbackView) {
          setSessionClosed(true);
        } else {
          navigate('/session-ended');
        }
        return;
      }
      if (message.type === 'reviewees-updated' && revieweeId) {
        const updated = message.reviewees?.[revieweeId] || message.payload?.reviewees?.[revieweeId];
        if (updated) {
          setRevieweeRecord(updated);
        }
      }
      if (message.type === 'feedback-added') {
        const payload = message.payload || {};
        if (payload.feedback?.to === revieweeId && showFeedbackView) {
          fetchRevieweeFeedback();
        }
      }
    } catch (err) {
      // Ignore non-JSON payloads
    }
  }, [fetchRevieweeFeedback, navigate, revieweeId, showFeedbackView]);

  const buildWsUrl = useCallback(() => {
    if (!sessionId) return null;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/gallery-walk?sessionId=${sessionId}`;
  }, [sessionId]);

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

  const renderStageBadge = () => (
    <span className="inline-flex items-center rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">
      {STAGE_LABELS[stage] || 'Gallery Walk'}
    </span>
  );

  const renderRegistrationForm = () => (
    <form onSubmit={handleRevieweeRegistration} className="space-y-4 bg-white shadow rounded-lg p-6">
      <div>
        <h2 className="text-xl font-semibold">Set up your kiosk</h2>
        <p className="text-gray-600 mt-1">
          Enter your name (and optional project title). This information is sent to the teacher but
          the kiosk screen stays anonymous.
        </p>
      </div>
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">Your name</label>
        <input
          type="text"
          className="w-full rounded border border-gray-300 px-3 py-2"
          value={registrationName}
          onChange={(e) => setRegistrationName(e.target.value)}
          placeholder="Student name"
        />
      </div>
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">Project title (optional)</label>
        <input
          type="text"
          className="w-full rounded border border-gray-300 px-3 py-2"
          value={registrationProject}
          onChange={(e) => setRegistrationProject(e.target.value)}
          placeholder="Project title"
        />
      </div>
      {registrationError && (
        <p className="text-sm text-red-600">{registrationError}</p>
      )}
      <Button type="submit" disabled={isRegistering}>
        {isRegistering ? 'Registering...' : 'Save kiosk'}
      </Button>
    </form>
  );

  const renderLocalReviewerForm = () => (
    <form onSubmit={handleLocalFeedbackSubmit} className="space-y-3">
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">Reviewer name</label>
        <input
          type="text"
          className="w-full rounded border border-gray-300 px-3 py-2"
          value={localReviewerName}
          onChange={(e) => setLocalReviewerName(e.target.value)}
          placeholder="Enter your name"
          disabled={stage === 'review' && showFeedbackView}
        />
      </div>
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">Feedback message</label>
        <textarea
          className="w-full rounded border border-gray-300 px-3 py-2"
          rows={4}
          value={localMessage}
          onChange={(e) => setLocalMessage(e.target.value)}
          placeholder="Leave your feedback here"
          disabled={stage === 'review' && showFeedbackView}
        />
      </div>
      {localFormNotice && (
        <p className="text-sm text-indigo-700">{localFormNotice}</p>
      )}
      <Button type="submit" disabled={isSubmittingLocal || (stage === 'review' && showFeedbackView)}>
        {isSubmittingLocal ? 'Sending...' : 'Submit feedback'}
      </Button>
    </form>
  );

  const renderKioskPanel = () => (
    <div className="grid gap-6">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Welcome!</h2>
            <p className="text-gray-600">
              Share this QR code so classmates can review your project.
            </p>
          </div>
          {renderStageBadge()}
        </div>
        <div className="mt-6 flex flex-col items-center gap-4">
          {baseJoinUrl ? (
            <>
              <QRCodeSVG value={baseJoinUrl} size={240} />
              <code className="rounded bg-gray-100 px-3 py-1 text-sm break-all">{baseJoinUrl}</code>
            </>
          ) : (
            <p className="text-gray-500">Preparing QR code...</p>
          )}
          <p className="text-sm text-gray-600">
            Reviewers can also scan with their own phone camera.
          </p>
        </div>
      </div>
      {stage !== 'review' && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow">
          <h3 className="text-lg font-semibold mb-2">No phone? No problem.</h3>
          <p className="text-gray-600 mb-4">
            Reviewers can type their name and feedback below.
          </p>
          {renderLocalReviewerForm()}
        </div>
      )}
    </div>
  );

  const renderFeedbackCards = () => {
    if (isLoadingFeedback) {
      return <p className="text-center text-gray-600">Loading feedback...</p>;
    }
    if (!revieweeFeedback.length) {
      return <p className="text-center text-gray-600">No feedback yet.</p>;
    }
    return (
      <div className="grid gap-4">
        {revieweeFeedback.map((entry) => (
          <div key={entry.id} className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 shadow-sm">
            <p className="text-sm font-semibold text-yellow-900">{entry.fromNameSnapshot || 'Reviewer'}</p>
            <p className="mt-1 text-gray-800 whitespace-pre-wrap">{entry.message}</p>
            {entry.createdAt && (
              <p className="mt-2 text-xs text-gray-500">
                {new Date(entry.createdAt).toLocaleString()}
              </p>
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderFeedbackView = () => (
    <div className="rounded-lg border border-indigo-200 bg-white p-6 shadow space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Your feedback</h2>
          <p className="text-gray-600">
            The teacher switched to review mode. Read through the comments gathered earlier.
          </p>
        </div>
        {renderStageBadge()}
      </div>
      {sessionClosed && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          This session has ended. You can still view and print your feedback.
        </p>
      )}
      <Button onClick={() => window.print()} variant="outline">
        Print my feedback
      </Button>
      {renderFeedbackCards()}
    </div>
  );

  const renderModeContent = () => {
    if (!sessionId) {
      return <p className="text-red-600">Missing session information.</p>;
    }

    if (isReviewerMode) {
      return (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow">
          <h2 className="text-xl font-semibold mb-2">Reviewer mode</h2>
          <p className="text-gray-600">
            The reviewer experience is coming soon. In the meantime, please use the kiosk screen or
            enter feedback manually on that device.
          </p>
        </div>
      );
    }

    if (!revieweeId) {
      return renderRegistrationForm();
    }

    if (showFeedbackView) {
      return renderFeedbackView();
    }

    return renderKioskPanel();
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Gallery Walk</h1>
        <p className="text-gray-600">
          Session ID: <span className="font-mono">{sessionId}</span>
        </p>
        {revieweeRecord?.projectTitle && (
          <p className="text-gray-600">
            Project: <span className="font-semibold">{revieweeRecord.projectTitle}</span>
          </p>
        )}
      </header>
      {renderModeContent()}
      {stage === 'review' && !showFeedbackView && (
        <p className="text-center text-sm text-gray-600">
          Review mode has started. Finish the current comment to see collected feedback.
        </p>
      )}
    </div>
  );
}
