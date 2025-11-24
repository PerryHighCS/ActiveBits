import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Button from '@src/components/ui/Button';
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler';
import '../styles.css';
import SessionHeader from './components/SessionHeader';
import QuestionHintSection from './components/QuestionHintSection';
import FocusSummary from './components/FocusSummary';
import InteractiveListSection from './components/InteractiveListSection';
import AnswerPanel from './components/AnswerPanel';
import HintDisplay from './components/HintDisplay';

import {
  createChallengeForTypes,
  OPERATIONS,
  QUESTION_LABELS,
  getHintDefinition,
  buildAnswerDetails,
  sanitizeName,
} from './challengeGenerator';

export default function PythonListPractice({ sessionData }) {
  const [studentName, setStudentName] = useState('');
  const [submittedName, setSubmittedName] = useState(null);
  const [studentId, setStudentId] = useState(null);
  const wsRef = useRef(null);
  const attachSessionEndedHandler = useSessionEndedHandler(wsRef);
  const [allowedTypes, setAllowedTypes] = useState(() => new Set(['all']));
  const [challenge, setChallenge] = useState(() => createChallengeForTypes(new Set(['all'])));
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [showNext, setShowNext] = useState(false);
  const [stats, setStats] = useState({ total: 0, correct: 0, streak: 0, longestStreak: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const nameRef = useRef(null);
  const answerInputRef = useRef(null);
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [selectedValueIndex, setSelectedValueIndex] = useState(null);
  const [selectedRange, setSelectedRange] = useState(null);
  const [selectedSequence, setSelectedSequence] = useState([]);
  const [isDraggingRange, setIsDraggingRange] = useState(false);
  const rangeStartRef = useRef(null);
  const statsRef = useRef(stats);
  const [insertSelections, setInsertSelections] = useState([]);
  const statsLoadedRef = useRef(false);
  const sessionId = sessionData?.sessionId;
  const isSolo = !sessionId || sessionId.startsWith('solo-');
  const [hintStage, setHintStage] = useState('none');

  const allowedTypeList = useMemo(() => {
    if (allowedTypes.has('all')) {
      return ['all'];
    }
    return OPERATIONS.filter((type) => allowedTypes.has(type));
  }, [allowedTypes]);
  const soloQuestionTypes = useMemo(() => ([
    { id: 'all', label: 'All question types' },
    ...OPERATIONS.filter((t) => t !== 'all').map((type) => ({ id: type, label: QUESTION_LABELS[type] || type })),
  ]), []);
  const statsStorageKey = useMemo(() => {
    if (!sessionId || !studentId || isSolo) return null;
    return `python-list-practice-stats-${sessionId}-${studentId}`;
  }, [sessionId, studentId, isSolo]);
  const applySelectedTypes = useCallback((types) => {
    const normalized = Array.isArray(types) && types.length > 0 ? types : ['all'];
    const nextSet = new Set(normalized);
    setAllowedTypes(nextSet);
    setChallenge(createChallengeForTypes(nextSet));
    setAnswer('');
    setFeedback(null);
    setShowNext(false);
  }, []);
  const handleSoloToggleType = useCallback((typeId) => {
    const next = new Set(allowedTypes);
    if (typeId === 'all') {
      next.clear();
      next.add('all');
    } else {
      if (next.has('all')) {
        next.clear();
      }
      if (next.has(typeId)) {
        next.delete(typeId);
      } else {
        next.add(typeId);
      }
      if (next.size === 0) {
        next.add('all');
      }
    }
    applySelectedTypes(Array.from(next));
  }, [allowedTypes, applySelectedTypes]);

  useEffect(() => {
    if (nameRef.current) {
      nameRef.current.focus();
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    const storedName = localStorage.getItem(`python-list-practice-name-${sessionId}`);
    const storedId = localStorage.getItem(`python-list-practice-id-${sessionId}`);
    if (storedName) {
      setStudentName(storedName);
    }
    if (storedName && storedId) {
      setSubmittedName(storedName);
      setStudentId(storedId);
    } else if (storedId && !storedName) {
      setStudentId(storedId);
    }
  }, [sessionId]);
  useEffect(() => {
    if (!showNext && answerInputRef.current) {
      answerInputRef.current.focus();
    }
  }, [challenge, showNext]);

  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  // Connect to WebSocket after name submit to mark student as connected (for roster)
  useEffect(() => {
    if (!sessionId || isSolo) return undefined;
    let ignore = false;
    const fetchConfig = async () => {
      try {
        const res = await fetch(`/api/python-list-practice/${sessionId}`);
        if (!res.ok) throw new Error('Failed to load session');
        const data = await res.json();
        if (!ignore) {
          applySelectedTypes(data.selectedQuestionTypes || ['all']);
        }
      } catch (err) {
        console.error('Failed to load session config', err);
      }
    };
    fetchConfig();
    return () => {
      ignore = true;
    };
  }, [sessionId, applySelectedTypes, isSolo]);

  const ensureStudentId = () => {
    if (studentId) return studentId;
    const generated = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `stu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setStudentId(generated);
    if (sessionId) {
      localStorage.setItem(`python-list-practice-id-${sessionId}`, generated);
    }
    return generated;
  };

  const submitName = (e) => {
    e.preventDefault();
    const sanitized = sanitizeName(studentName);
    if (!sanitized) {
      setError('Enter a valid name');
      return;
    }
    setSubmittedName(sanitized);
    const id = ensureStudentId();
    if (sessionId) {
      localStorage.setItem(`python-list-practice-name-${sessionId}`, sanitized);
      localStorage.setItem(`python-list-practice-id-${sessionId}`, id);
    }
    setError(null);
  };

  const sendStats = useCallback(async (nextStats) => {
    if (!sessionId || !submittedName || !studentId) return;
    try {
      await fetch(`/api/python-list-practice/${sessionId}/stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentName: submittedName, studentId, stats: nextStats }),
      });
    } catch (err) {
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
      console.warn('Failed to save stats', err);
    }
  }, [stats, statsStorageKey]);

  useEffect(() => {
    if (!sessionId || isSolo) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const encodedSession = encodeURIComponent(sessionId);
    const nameParam = submittedName ? `&studentName=${encodeURIComponent(submittedName)}` : '';
    const idParam = studentId ? `&studentId=${encodeURIComponent(studentId)}` : '';
    const wsUrl = `${proto}//${window.location.host}/ws/python-list-practice?sessionId=${encodedSession}${nameParam}${idParam}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    attachSessionEndedHandler(ws);
    ws.onopen = () => {
      // send a zeroed stats payload on connect so the dashboard sees the student immediately
      if (submittedName) {
        sendStats(statsRef.current);
      }
    };
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'questionTypesUpdate') {
          applySelectedTypes(msg.payload?.selectedQuestionTypes || ['all']);
        }
      } catch (err) {
        console.error('WS message error', err);
      }
    };
    ws.onerror = (err) => console.error('WS error', err);
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId, submittedName, applySelectedTypes, sendStats, isSolo]);

  const isListBuildVariant = challenge?.variant === 'insert-final' || challenge?.variant === 'list-final';

  const normalizeListAnswer = useCallback((text) => {
    if (!text) return '';
    const trimmed = text.trim();
    if (!trimmed) return '';
    const noBrackets = trimmed.replace(/^\[|\]$/g, '');
    return noBrackets.split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
      .map((token) => token.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1'))
      .join(',');
  }, []);

  const normalizedExpected = useMemo(() => {
    if (challenge.type === 'list') return normalizeListAnswer(challenge.expected);
    return (challenge.expected || '').trim();
  }, [challenge, normalizeListAnswer]);

  const hintDefinition = useMemo(() => getHintDefinition(challenge), [challenge]);
  const answerDetails = useMemo(() => buildAnswerDetails(challenge), [challenge]);

  const handleShowDefinitionHint = () => {
    if (hintStage === 'none') {
      setHintStage('definition');
    }
  };

  const handleShowAnswerHint = () => {
    setHintStage('answer');
  };

  const checkAnswer = () => {
    let cleaned = challenge.type === 'list'
      ? normalizeListAnswer(answer)
      : answer.trim();
    let expectedComparison = normalizedExpected;

    const needsCommaTolerance = challenge.type !== 'list'
      && (normalizedExpected.includes(',') || cleaned.includes(','));
    if (needsCommaTolerance) {
      cleaned = normalizeListAnswer(cleaned);
      expectedComparison = normalizeListAnswer(normalizedExpected);
    }

    const isCorrect = cleaned.length > 0 && cleaned === expectedComparison;
    const hintsUsed = hintStage !== 'none';
    const streakIncrement = isCorrect && !hintsUsed ? stats.streak + 1 : 0;
    const nextStats = {
      total: stats.total + 1,
      correct: stats.correct + (isCorrect && !hintsUsed ? 1 : 0),
      streak: streakIncrement,
      longestStreak: Math.max(stats.longestStreak, streakIncrement),
    };
    setStats(nextStats);
    setFeedback({
      isCorrect,
      message: isCorrect ? 'Correct! 🎉' : `Not quite. Expected: ${challenge.expected}`,
    });
    sendStats(nextStats);
    setShowNext(true);
  };

  const nextChallenge = () => {
    setChallenge(createChallengeForTypes(allowedTypes));
    setAnswer('');
    setFeedback(null);
    setShowNext(false);
  };

  const interactiveList = useMemo(() => {
    if (challenge?.choices) return challenge.choices;
    if (!challenge) return [];
    if (challenge.op === 'index-set' && Array.isArray(challenge.mutated)) {
      return challenge.mutated;
    }
    if (Array.isArray(challenge.list)) {
      return challenge.list;
    }
    if (challenge.op === 'for-range') {
      const total = Math.max(0, (challenge.stop ?? 0) - (challenge.start ?? 0));
      return Array.from({ length: total }, (_, i) => (challenge.start ?? 0) + i);
    }
    return [];
  }, [challenge]);

  useEffect(() => {
    if (isListBuildVariant) {
      setAnswer(insertSelections.length ? `[${insertSelections.join(', ')}]` : '');
    }
  }, [insertSelections, isListBuildVariant]);

  const supportsSequenceSelection = !!(challenge && ['range-len', 'for-each'].includes(challenge.op));

  useEffect(() => {
    setSelectedIndex(null);
    setSelectedValueIndex(null);
    setSelectedRange(null);
    setSelectedSequence([]);
    rangeStartRef.current = null;
    setIsDraggingRange(false);
    setInsertSelections([]);
    setHintStage('none');
  }, [challenge]);

  const getValueForIndex = useCallback((idx) => {
    if (!challenge) return undefined;
    if (Array.isArray(challenge.choices)
      && (challenge.op === 'insert'
        || ['list-final', 'value-selection', 'index-value', 'number-choice'].includes(challenge.variant)
        || challenge.op === 'for-range')) {
      return challenge.choices[idx];
    }
    if (challenge.op === 'index-set' && Array.isArray(challenge.mutated)) {
      return challenge.mutated[idx];
    }
    if (!Array.isArray(interactiveList) || idx < 0 || idx >= interactiveList.length) {
      return undefined;
    }
    if (challenge.op === 'pop' && idx !== interactiveList.length - 1) {
      return undefined;
    }
    return interactiveList[idx];
  }, [challenge, interactiveList]);

  const applyRangeSelection = useCallback((startIdx, endIdx) => {
    if (!supportsSequenceSelection || !interactiveList.length) return;
    const rangeStart = Math.max(0, Math.min(startIdx, endIdx));
    const rangeEnd = Math.min(interactiveList.length - 1, Math.max(startIdx, endIdx));
    setSelectedRange([rangeStart, rangeEnd]);
    const indices = [];
    const direction = startIdx <= endIdx ? 1 : -1;
    for (let i = startIdx; direction > 0 ? i <= endIdx : i >= endIdx; i += direction) {
      if (i >= 0 && i < interactiveList.length) {
        indices.push(i);
      }
    }
    setSelectedSequence(indices);
    const slice = indices.map((idx) => interactiveList[idx]);
    if (isListBuildVariant) {
      const formatted = slice.map((item) => (typeof item === 'string' ? `'${item}'` : String(item)));
      setInsertSelections(formatted);
    } else {
      setAnswer(slice.map((item) => String(item)).join(', '));
    }
  }, [interactiveList, supportsSequenceSelection, isListBuildVariant]);

  const handleSequenceSelectionClick = useCallback((idx, event = null) => {
    if (!supportsSequenceSelection || showNext) return;
    if (isDraggingRange) return;
    if (event && event.shiftKey && selectedSequence.length > 0) {
      const last = selectedSequence[selectedSequence.length - 1];
      applyRangeSelection(last, idx);
      rangeStartRef.current = null;
      setIsDraggingRange(false);
      return;
    }
    const values = interactiveList[idx];
    if (isListBuildVariant) {
      const formatted = typeof values === 'string' ? `'${values}'` : String(values);
      setInsertSelections((prev) => [...prev, formatted]);
    } else {
      setAnswer((prev) => (prev ? `${prev}, ${String(values)}` : String(values)));
    }
  }, [applyRangeSelection, interactiveList, isDraggingRange, selectedSequence, showNext, supportsSequenceSelection, isListBuildVariant]);

  const startRangeSelection = useCallback((idx) => {
    if (!supportsSequenceSelection || showNext) return;
    rangeStartRef.current = idx;
    setIsDraggingRange(true);
    setSelectedRange([idx, idx]);
  }, [applyRangeSelection, showNext, supportsSequenceSelection]);

  const extendRangeSelection = useCallback((idx) => {
    if (!supportsSequenceSelection || rangeStartRef.current === null || showNext) return;
    applyRangeSelection(rangeStartRef.current, idx);
  }, [applyRangeSelection, showNext, supportsSequenceSelection]);

  const finishRangeSelection = useCallback(() => {
    if (!supportsSequenceSelection) return;
    rangeStartRef.current = null;
    setIsDraggingRange(false);
  }, [supportsSequenceSelection]);

  useEffect(() => {
    const handleMouseUp = () => {
      if (isDraggingRange) {
        finishRangeSelection();
      }
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [finishRangeSelection, isDraggingRange]);

  const handleIndexClick = (idx, event) => {
    if (!challenge || showNext) return;
    setSelectedIndex(idx);
    setSelectedValueIndex(null);
    setSelectedRange(null);
    rangeStartRef.current = null;
    if (challenge.op === 'pop' && idx !== interactiveList.length - 1) {
      // allow any selection for pop questions
    }
    const formatted = String(idx);
    setAnswer((prev) => (prev ? `${prev}, ${formatted}` : formatted));
  };

  const handleValueClick = (idx, event) => {
    if (!challenge || showNext) return;
    const value = getValueForIndex(idx);
    const resolvedValue = value !== undefined ? value : interactiveList[idx];
    setSelectedValueIndex(idx);
    setSelectedIndex(null);
    setSelectedRange(null);
    rangeStartRef.current = null;
    if (isListBuildVariant) {
      const formatted = typeof resolvedValue === 'string' ? `'${resolvedValue}'` : String(resolvedValue);
      setInsertSelections((prev) => [...prev, formatted]);
      return;
    }
    if (challenge.op === 'for-range') {
      if (resolvedValue !== undefined) {
        setAnswer((prev) => (prev ? `${prev}, ${String(resolvedValue)}` : String(resolvedValue)));
      }
      return;
    }
    if (supportsSequenceSelection) {
      handleSequenceSelectionClick(idx, event);
      return;
    }
    if (['index-get', 'index-set', 'pop'].includes(challenge.op)) {
      if (resolvedValue !== undefined) {
        setAnswer(String(resolvedValue));
      }
    } else if (['value-selection', 'number-choice', 'index-value'].includes(challenge.variant)) {
      if (resolvedValue !== undefined) {
        setAnswer(String(resolvedValue));
      }
    }
  };

  const QUESTION_OPTIONS = useMemo(() => OPERATIONS.filter((t) => t !== 'all'), []);

  if (!submittedName && !isSolo) {
    return (
      <div className="python-list-bg flex items-center justify-center px-4">
        <div className="python-list-join">
          <h1 className="text-2xl font-bold mb-4 text-center text-emerald-900">Join Python List Practice</h1>
          <p className="text-sm text-emerald-800 text-center mb-4">
            Practice indexing, loops, len, append/remove/insert/pop, and range.
          </p>
          <form onSubmit={submitName} className="space-y-3">
            <label className="python-list-label">
              Your Name
              <input
                ref={nameRef}
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                className="python-list-input mt-1"
                placeholder="Enter your name"
                required
              />
            </label>
            {error && <div className="text-sm text-red-600">{error}</div>}
            <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
              Start Practicing
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="python-list-bg">
      <div className="python-list-container">
        {!isSolo && <SessionHeader submittedName={submittedName} sessionId={sessionId} stats={stats} />}
        {isSolo && (
          <SessionHeader activityName="Python List Practice" stats={stats} simple />
        )}

        <div className="python-list-content">
          {isSolo && (
            <div className="python-list-card">
              <p className="text-sm font-semibold text-emerald-900 mb-2">Choose question types</p>
              <div className="flex flex-wrap gap-2">
                {soloQuestionTypes.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    className={`python-list-chip ${allowedTypes.has(type.id) ? 'selected' : ''}`}
                    onClick={() => handleSoloToggleType(type.id)}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="python-list-card">
            {!isSolo && (
              <FocusSummary allowedTypeList={allowedTypeList} allowedTypes={allowedTypes} labels={QUESTION_LABELS} />
            )}
            <QuestionHintSection
              challenge={challenge}
              hintStage={hintStage}
              showHintButtons={!feedback}
              onShowHint={handleShowDefinitionHint}
              onShowAnswer={handleShowAnswerHint}
              hintDefinition={hintDefinition}
              answerDetails={answerDetails}
              showHintBody={false}
            />
            <InteractiveListSection
              challenge={challenge}
              interactiveList={interactiveList}
              isListBuildVariant={isListBuildVariant}
              supportsSequenceSelection={supportsSequenceSelection}
              selectedRange={selectedRange}
              selectedSequence={selectedSequence}
              selectedIndex={selectedIndex}
              selectedValueIndex={selectedValueIndex}
              onIndexClick={handleIndexClick}
              onValueClick={handleValueClick}
              onStartRange={startRangeSelection}
              onExtendRange={(idx) => extendRangeSelection(idx)}
              onFinishRange={finishRangeSelection}
            />
            <HintDisplay
              hintStage={hintStage}
              hintDefinition={hintDefinition}
              answerDetails={answerDetails}
              expected={challenge?.expected}
            />
            <AnswerPanel
              answer={answer}
              onAnswerChange={(value) => setAnswer(value)}
              challenge={challenge}
              answerRef={answerInputRef}
              disabled={showNext}
              loading={loading}
              onSubmit={checkAnswer}
              onClear={() => {
                setAnswer('');
                setInsertSelections([]);
              }}
              feedback={feedback}
              onNext={nextChallenge}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
