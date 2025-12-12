import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Button from '@src/components/ui/Button';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';
import QrScannerPanel from '@src/components/common/QrScannerPanel';
import ProjectStationCard from '../components/ProjectStationCard';
import LocalReviewerForm from '../components/LocalReviewerForm';
import GalleryWalkSoloViewer from '../components/GalleryWalkSoloViewer.jsx';
import GalleryWalkNotesView from '../components/GalleryWalkNotesView.jsx';
import ReviewerIdentityForm from '../components/ReviewerIdentityForm';
import ReviewerFeedbackForm from '../components/ReviewerFeedbackForm';
import { DEFAULT_NOTE_STYLE_ID, isNoteStyleId } from '../../shared/noteStyles.js';
import { generateShortId } from '../../shared/id.js';

const REVIEWEE_ID_PATTERN = /^[A-Z0-9]{6}$/;
const REVIEWER_ID_PATTERN = /^[A-Z0-9]{6,12}$/;
const REVIEWER_NAME_MAX_LENGTH = 200;

function GalleryWalkLiveStudentPage({ sessionData }) {
  const sessionId = sessionData?.sessionId || null;
  const location = useLocation();
  const navigate = useNavigate();

  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const requestedReviewee = query.get('reviewee');
  const isReviewerMode = Boolean(requestedReviewee);

  const kioskStoragePrefix = sessionId ? `gallery-walk:${sessionId}` : null;
  const reviewerStoragePrefix = sessionId ? `gallery-walk:${sessionId}:reviewer` : null;

  const [stage, setStage] = useState(() => sessionData?.data?.stage || 'gallery');
  const [sessionClosed, setSessionClosed] = useState(false);

  // Kiosk state
  const [revieweeId, setRevieweeId] = useState(null);
  const [revieweeRecord, setRevieweeRecord] = useState(null);
  const [registrationName, setRegistrationName] = useState('');
  const [registrationProject, setRegistrationProject] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [registrationError, setRegistrationError] = useState(null);

  const [localReviewerName, setLocalReviewerName] = useState('');
  const [localMessage, setLocalMessage] = useState('');
  const [isSubmittingLocal, setIsSubmittingLocal] = useState(false);
  const [localFormNotice, setLocalFormNotice] = useState(null);
  const [stageChangePending, setStageChangePending] = useState(false);
  const [showFeedbackView, setShowFeedbackView] = useState(stage === 'review');
  const [revieweeFeedback, setRevieweeFeedback] = useState([]);
  const [isLoadingFeedback, setIsLoadingFeedback] = useState(false);
  const [localStyleId, setLocalStyleId] = useState(DEFAULT_NOTE_STYLE_ID);
  const [sessionTitle, setSessionTitle] = useState('');
  const studentReviewees = useMemo(() => {
    if (!revieweeId) return {};
    return { [revieweeId]: revieweeRecord || {} };
  }, [revieweeId, revieweeRecord]);
  const studentFeedbackByReviewee = useMemo(() => {
    if (!revieweeId) return {};
    return { [revieweeId]: revieweeFeedback };
  }, [revieweeId, revieweeFeedback]);

  // Reviewer state
  const [reviewerId, setReviewerId] = useState(null);
  const [reviewerName, setReviewerName] = useState('');
  const [reviewerNameInput, setReviewerNameInput] = useState('');
  const [reviewerNameError, setReviewerNameError] = useState(null);
  const [isSavingReviewerName, setIsSavingReviewerName] = useState(false);
  const [reviewerMessage, setReviewerMessage] = useState('');
  const [reviewerNotice, setReviewerNotice] = useState(null);
  const [isSubmittingReviewerFeedback, setIsSubmittingReviewerFeedback] = useState(false);
  const [canScanNext, setCanScanNext] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState(null);
  const [reviewerStyleId, setReviewerStyleId] = useState(DEFAULT_NOTE_STYLE_ID);
  const handleLocalFeedbackCancel = () => {
    setLocalReviewerName('');
    setLocalMessage('');
    setLocalFormNotice(null);
    setLocalStyleId(DEFAULT_NOTE_STYLE_ID);
  };
  const handleReviewerMessageChange = useCallback((value) => {
    if (canScanNext) setCanScanNext(false);
    setReviewerMessage(value);
  }, [canScanNext]);

  const handleReviewerStyleChange = useCallback((value) => {
    if (!isNoteStyleId(value)) return;
    setReviewerStyleId(value);
    if (reviewerStoragePrefix) {
      localStorage.setItem(`${reviewerStoragePrefix}:styleId`, value);
    }
  }, [reviewerStoragePrefix]);
  const handleStudentDownload = useCallback(() => {
    if (!sessionId || !revieweeId) return;
    const payload = {
      version: 1,
      exportedAt: Date.now(),
      sessionId,
      revieweeId,
      reviewee: revieweeRecord || null,
      config: { title: sessionTitle || undefined },
      feedback: revieweeFeedback,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const slugSource = revieweeRecord?.name || revieweeRecord?.projectTitle || revieweeId || 'student';
    const slug = slugSource.toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'student';
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `gallery-walk-${sessionId}-${slug}-${timestamp}.gw`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [revieweeFeedback, revieweeRecord, revieweeId, sessionId, sessionTitle]);

  const kioskJoinUrl = useMemo(() => {
    if (!sessionId || !revieweeId || typeof window === 'undefined') return '';
    return `${window.location.origin}/${sessionId}?reviewee=${encodeURIComponent(revieweeId)}`;
  }, [sessionId, revieweeId]);

  // Hydrate kiosk/reviewer IDs from storage
  useEffect(() => {
    if (!kioskStoragePrefix) return;
    const storedId = localStorage.getItem(`${kioskStoragePrefix}:revieweeId`);
    if (storedId) {
      const safeId = storedId.trim();
      if (REVIEWEE_ID_PATTERN.test(safeId)) {
        setRevieweeId(safeId);
      } else {
        localStorage.removeItem(`${kioskStoragePrefix}:revieweeId`);
      }
    }
  }, [kioskStoragePrefix]);

  useEffect(() => {
    if (!isReviewerMode || !reviewerStoragePrefix) return;
    const cachedId = localStorage.getItem(`${reviewerStoragePrefix}:reviewerId`);
    const cachedName = localStorage.getItem(`${reviewerStoragePrefix}:reviewerName`);
    const cachedStyle = localStorage.getItem(`${reviewerStoragePrefix}:styleId`);
    if (cachedId && REVIEWER_ID_PATTERN.test(cachedId.trim())) {
      setReviewerId(cachedId.trim());
    } else if (cachedId) {
      localStorage.removeItem(`${reviewerStoragePrefix}:reviewerId`);
    }
    if (cachedName) {
      const safeName = cachedName.trim();
      if (safeName && safeName.length <= REVIEWER_NAME_MAX_LENGTH) {
        setReviewerName(safeName);
        setReviewerNameInput(safeName);
      } else {
        localStorage.removeItem(`${reviewerStoragePrefix}:reviewerName`);
      }
    }
    if (cachedStyle && isNoteStyleId(cachedStyle)) {
      setReviewerStyleId(cachedStyle);
    }
  }, [isReviewerMode, reviewerStoragePrefix]);

  const fetchSessionSnapshot = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/gallery-walk/${sessionId}/feedback`);
      if (!res.ok) throw new Error('Failed to fetch snapshot');
      const data = await res.json();
      setStage(data.stage || 'gallery');
      setSessionTitle(data.config?.title || '');
      if (revieweeId) {
        const revieweeSnapshot = data.reviewees?.[revieweeId];
        if (revieweeSnapshot) {
          setRevieweeRecord(revieweeSnapshot);
        } else {
          setRevieweeId(null);
          setRevieweeRecord(null);
          if (kioskStoragePrefix) {
            localStorage.removeItem(`${kioskStoragePrefix}:revieweeId`);
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch gallery walk snapshot', err);
    }
  }, [sessionId, revieweeId, kioskStoragePrefix]);

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
      if (data.reviewee) setRevieweeRecord(data.reviewee);
      if (data.config?.title) setSessionTitle(data.config.title);
    } catch (err) {
      console.error('Failed to fetch reviewee feedback', err);
    } finally {
      setIsLoadingFeedback(false);
    }
  }, [sessionId, revieweeId]);

  useEffect(() => {
    if (showFeedbackView) fetchRevieweeFeedback();
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
        throw new Error(data.error || 'Unable to register');
      }
      const data = await res.json();
      const assignedId = data.revieweeId || newId;
      setRevieweeId(assignedId);
      if (kioskStoragePrefix) {
        localStorage.setItem(`${kioskStoragePrefix}:revieweeId`, assignedId);
      }
      const latestRecord = data.reviewees?.[assignedId] || { name: trimmedName, projectTitle: trimmedProject };
      setRevieweeRecord(latestRecord);
    } catch (err) {
      setRegistrationError(err.message);
    } finally {
      setIsRegistering(false);
    }
  };

  const handleLocalFeedbackSubmit = async (event) => {
    event.preventDefault();
    if (!sessionId || !revieweeId) return;
    const reviewerNameInput = localReviewerName.trim();
    const message = localMessage.trim();
    if (!reviewerNameInput || !message) {
      setLocalFormNotice('Please provide both a name and feedback message.');
      return;
    }
    setIsSubmittingLocal(true);
    setLocalFormNotice(null);
    const kioskReviewerId = generateShortId(8);
    try {
      await fetch(`/api/gallery-walk/${sessionId}/reviewer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewerId: kioskReviewerId, name: reviewerNameInput }),
      });
      const res = await fetch(`/api/gallery-walk/${sessionId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revieweeId, reviewerId: kioskReviewerId, message, styleId: localStyleId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to submit feedback');
      }
      setLocalReviewerName('');
      setLocalMessage('');
      setLocalStyleId(DEFAULT_NOTE_STYLE_ID);
      setLocalFormNotice('Feedback submitted. Thank you!');
      if (stage === 'review' && stageChangePending) {
        setStageChangePending(false);
        setShowFeedbackView(true);
        fetchRevieweeFeedback();
      }
    } catch (err) {
      setLocalFormNotice(err.message);
    } finally {
      setIsSubmittingLocal(false);
    }
  };

  // Stage transitions for kiosk
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
        if (showFeedbackView || isReviewerMode) {
          setSessionClosed(true);
        } else {
          navigate('/session-ended');
        }
        return;
      }
      if (message.type === 'reviewees-updated' && revieweeId) {
        const updated = message.reviewees?.[revieweeId] || message.payload?.reviewees?.[revieweeId];
        if (updated) setRevieweeRecord(updated);
      }
      if (message.type === 'feedback-added') {
        const payload = message.payload || {};
        if (payload.feedback?.to === revieweeId && showFeedbackView) {
          fetchRevieweeFeedback();
        }
      }
    } catch {
      // ignore non-JSON payloads
    }
  }, [fetchRevieweeFeedback, navigate, revieweeId, showFeedbackView, isReviewerMode]);

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

  const renderRegistrationForm = () => (
    <form onSubmit={handleRevieweeRegistration} className="space-y-4 bg-white shadow rounded-lg p-6">
      <div>
        <h2 className="text-xl font-semibold">Prepare for review</h2>
        <p className="text-gray-600 mt-1">
          Enter your name(s) (and optional project title). This information is sent to the teacher.
        </p>
      </div>
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1" htmlFor="reviewee-name-input">Your name</label>
        <input
          id="reviewee-name-input"
          type="text"
          className="w-full rounded border border-gray-300 px-3 py-2"
          value={registrationName}
          onChange={(e) => setRegistrationName(e.target.value)}
          placeholder="Student name"
          aria-required="true"
          aria-invalid={Boolean(registrationError)}
          aria-describedby={registrationError ? 'reviewee-name-error' : undefined}
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
        <p id="reviewee-name-error" className="text-sm text-red-600" aria-live="polite">
          {registrationError}
        </p>
      )}
      <Button type="submit" disabled={isRegistering}>
        {isRegistering ? 'Registering…' : 'Save and continue'}
      </Button>
    </form>
  );

  const renderFeedbackView = () => (
    <div className="rounded-lg border border-indigo-200 bg-white p-6 shadow space-y-4 print:border-0 print:shadow-none print:p-0">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold print:hidden">Your feedback</h2>
          <p className="text-gray-600 print:hidden">The teacher switched to review mode. Read through the comments that were left for you.</p>
          {revieweeRecord?.name && (
            <div className="student-name-print hidden text-gray-800 print:block">
              <p className="text-sm uppercase tracking-wide text-gray-500">{sessionTitle || 'Gallery Walk Feedback'}</p>
              <p>{revieweeRecord.name}</p>
              {revieweeRecord?.projectTitle && <p>{revieweeRecord?.projectTitle}</p>}
            </div>
          )}
        </div>
      </div>
      {sessionClosed && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          This session has ended. You can still view and print your feedback.
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-3 print:hidden">
        <Button type="button" variant="outline" onClick={handleStudentDownload}>
          Download feedback
        </Button>
        <Button type="button" onClick={() => window.print()} variant="outline">
          Print my feedback
        </Button>
      </div>
      <GalleryWalkNotesView
        reviewees={studentReviewees}
        feedbackByReviewee={studentFeedbackByReviewee}
        selectedReviewee="all"
        filterClassName="hidden"
        containerClassName="pt-2 print:pt-0"
        gridClassName="grid-cols-1"
        cardClassName="print:break-after-page"
        noFeedbackText={isLoadingFeedback ? 'Loading feedback…' : 'No feedback yet.'}
        emptySelectionText={isLoadingFeedback ? 'Loading feedback…' : 'No feedback yet.'}
        printTitle={sessionTitle || 'Gallery Walk Feedback'}
      />
    </div>
  );

  const handleReviewerIdentitySave = async () => {
    if (!sessionId || !requestedReviewee) return;
    const trimmed = reviewerNameInput.trim();
    if (!trimmed) {
      setReviewerNameError('Name is required.');
      return;
    }
    setReviewerNameError(null);
    setIsSavingReviewerName(true);
    const nextId = reviewerId || generateShortId(8);
    try {
      const res = await fetch(`/api/gallery-walk/${sessionId}/reviewer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewerId: nextId, name: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Unable to save reviewer info');
      }
      setReviewerId(nextId);
      setReviewerName(trimmed);
      if (reviewerStoragePrefix) {
        localStorage.setItem(`${reviewerStoragePrefix}:reviewerId`, nextId);
        localStorage.setItem(`${reviewerStoragePrefix}:reviewerName`, trimmed);
      }
    } catch (err) {
      setReviewerNameError(err.message);
    } finally {
      setIsSavingReviewerName(false);
    }
  };

  const handleReviewerFeedbackSubmit = async (event) => {
    event.preventDefault();
    if (!sessionId || !requestedReviewee) {
      setReviewerNotice('Invalid project link. Please rescan the QR code.');
      return;
    }
    if (!reviewerId || !reviewerName) {
      setReviewerNotice('Enter your name before leaving feedback.');
      return;
    }
    const trimmed = reviewerMessage.trim();
    if (!trimmed) {
      setReviewerNotice('Please type your feedback first.');
      return;
    }
    setIsSubmittingReviewerFeedback(true);
    setReviewerNotice(null);
    try {
      const res = await fetch(`/api/gallery-walk/${sessionId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revieweeId: requestedReviewee, reviewerId, message: trimmed, styleId: reviewerStyleId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to submit feedback');
      }
      setReviewerMessage('');
      setReviewerNotice('Feedback submitted. Thank you!');
      setCanScanNext(true);
    } catch (err) {
      setReviewerNotice(err.message);
    } finally {
      setIsSubmittingReviewerFeedback(false);
    }
  };

  const handleReviewerCancel = () => {
    if (reviewerMessage.trim()) {
      setReviewerMessage('');
      setReviewerNotice('Feedback draft cleared.');
    }
    setCanScanNext(true);
  };

  const handleScannerDetected = (content) => {
    setIsScannerOpen(false);
    setScannerError(null);
    try {
      const target = new URL(content);
      if (!sessionId || target.origin !== window.location.origin) {
        setScannerError('scanner-invalid');
        return;
      }
      const pathSegments = target.pathname.split('/').filter(Boolean);
      const lastSegment = pathSegments[pathSegments.length - 1];
      if (lastSegment !== sessionId) {
        setScannerError('scanner-invalid');
        return;
      }
      const reviewee = target.searchParams.get('reviewee');
      if (!reviewee || !REVIEWEE_ID_PATTERN.test(reviewee)) {
        setScannerError('scanner-invalid');
        return;
      }
      setCanScanNext(false);
      setReviewerMessage('');
      setReviewerNotice(null);
      navigate(`${target.pathname}?reviewee=${encodeURIComponent(reviewee)}${target.hash}`);
    } catch {
      setScannerError('scanner-invalid');
    }
  };

  const handleScannerError = () => {
    setScannerError('scanner-unavailable');
    setIsScannerOpen(false);
  };

  const renderReviewerContent = () => {
    if (!requestedReviewee) {
      return <p className="text-red-600">Missing project reference. Please scan a valid QR code.</p>;
    }
    return (
      <div className="space-y-6">
        {!reviewerName && (
          <ReviewerIdentityForm
            nameInput={reviewerNameInput}
            onNameChange={setReviewerNameInput}
            error={reviewerNameError}
            hasExistingName={Boolean(reviewerId)}
            isSaving={isSavingReviewerName}
            onSubmit={(event) => {
              event.preventDefault();
              handleReviewerIdentitySave();
            }}
          />
        )}
        {reviewerName && !canScanNext && (
          <ReviewerFeedbackForm
            projectTitle={revieweeRecord?.projectTitle}
            message={reviewerMessage}
            onMessageChange={handleReviewerMessageChange}
            notice={reviewerNotice}
            isSubmitting={isSubmittingReviewerFeedback}
            onSubmit={handleReviewerFeedbackSubmit}
            onCancel={handleReviewerCancel}
            onScan={() => {
              setScannerError(null);
              setIsScannerOpen(true);
            }}
            scannerError={scannerError}
            canScan={false}
            styleId={reviewerStyleId}
            onStyleChange={handleReviewerStyleChange}
          />
        )}
        {reviewerName && canScanNext && (
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow space-y-4 sm:p-6">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Ready for the next project?</h2>
              <p className="text-gray-600">To leave feedback for another project, scan its QR code.</p>
            </div>
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setScannerError(null);
                  setIsScannerOpen(true);
                }}
              >
                Scan next QR code
              </Button>
            </div>
            {scannerError === 'scanner-unavailable' && (
              <p className="text-sm text-red-600">
                Your browser will not open the scanner. Use your phone’s camera app to scan the next code.
              </p>
            )}
            {scannerError === 'scanner-invalid' && (
              <p className="text-sm text-red-600">
                That QR code was not for this session. Make sure you scan the code shown on this station.
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderModeContent = () => {
    if (!sessionId) {
      return <p className="text-red-600">Missing session information.</p>;
    }
    if (isReviewerMode) {
      return renderReviewerContent();
    }
    if (!revieweeId) {
      return renderRegistrationForm();
    }
    if (showFeedbackView) {
      return renderFeedbackView();
    }
    const fallbackForm =
      stage !== 'review' ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow">
          <h3 className="text-lg font-semibold mb-2">No phone? No problem.</h3>
          <p className="text-gray-600 mb-4">Type your name and feedback below.</p>
          <LocalReviewerForm
            reviewerName={localReviewerName}
            message={localMessage}
            onNameChange={setLocalReviewerName}
            onMessageChange={setLocalMessage}
            onSubmit={handleLocalFeedbackSubmit}
            onCancel={handleLocalFeedbackCancel}
            styleId={localStyleId}
            onStyleChange={(value) => {
              if (isNoteStyleId(value)) setLocalStyleId(value);
            }}
            disabled={stage === 'review' && showFeedbackView}
            notice={localFormNotice}
            isSubmitting={isSubmittingLocal}
          />
        </div>
      ) : null;
    return (
      <ProjectStationCard
        projectTitle={revieweeRecord?.projectTitle}
        joinUrl={kioskJoinUrl}
        fallbackForm={fallbackForm}
      />
    );
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6 student-page">
      <header className="student-header space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="student-title text-3xl font-bold">Gallery Walk</h1>
          </div>
          <p className="text-gray-600 student-session">
            Session ID: <span className="font-mono">{sessionId}</span>
          </p>
        </div>
      </header>
      {renderModeContent()}
      {stage === 'review' && !showFeedbackView && !isReviewerMode && (
        <p className="text-center text-sm text-gray-600">
          Review mode has started. Finish the current comment to see collected feedback.
        </p>
      )}
      {sessionClosed && isReviewerMode && (
        <p className="text-center text-sm text-gray-600">
          This session has ended. You can still leave notes for yourself, but new feedback will not reach the teacher.
        </p>
      )}
      {isScannerOpen && (
        <QrScannerPanel
          onDetected={handleScannerDetected}
          onError={handleScannerError}
          onClose={() => setIsScannerOpen(false)}
        />
      )}
    </div>
  );
}

export default function StudentPage({ sessionData }) {
  const sessionId = sessionData?.sessionId || null;
  const isSoloMode = typeof sessionId === 'string' && sessionId.startsWith('solo-gallery-walk');
  if (isSoloMode) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6 student-page">
        <header className="student-header space-y-2">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="student-title text-3xl font-bold">Review Gallery Walk Feedback</h1>
            </div>
          </div>
        </header>
        <GalleryWalkSoloViewer />
      </div>
    );
  }
  return <GalleryWalkLiveStudentPage sessionData={sessionData} />;
}
