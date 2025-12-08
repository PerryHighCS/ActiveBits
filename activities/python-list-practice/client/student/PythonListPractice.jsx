import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Button from '@src/components/ui/Button';
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';
import '../styles.css';
// components consolidated into subcomponents: StatsPanel, ControlsPanel, QuestionPanel
import NameForm from './components/NameForm';
import ControlsPanel from './components/ControlsPanel';
import QuestionPanel from './components/QuestionPanel';
import SessionHeader from './components/SessionHeader';

import {
  createChallengeForTypes,
  OPERATIONS,
  QUESTION_LABELS,
  getHintDefinition,
  buildAnswerDetails,
  sanitizeName,
} from './challengeGenerator';
import { normalizeListAnswer, normalizeExpected } from './utils/componentUtils';
import usePersistentStats from './hooks/usePersistentStats';
import useSequenceSelection from './hooks/useSequenceSelection';

export default function PythonListPractice({ sessionData }) {
  const [studentName, setStudentName] = useState('');
  const [submittedName, setSubmittedName] = useState(null);
  const [studentId, setStudentId] = useState(null);
  const attachSessionEndedHandler = useSessionEndedHandler();
  const sessionId = sessionData?.sessionId;
  const isSolo = !sessionId || sessionId.startsWith('solo-');
  const [allowedTypes, setAllowedTypes] = useState(() => new Set(['all']));
  const [challenge, setChallenge] = useState(() => createChallengeForTypes(new Set(['all'])));
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [showNext, setShowNext] = useState(false);
  const { stats, setStats, sendStats, statsRef } = usePersistentStats({ sessionId, studentId, submittedName, isSolo });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const nameRef = useRef(null);
  const answerInputRef = useRef(null);
  // selection state is managed by useSequenceSelection
  const [insertSelections, setInsertSelections] = useState([]);
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

  

  const handleStudentMessage = useCallback((evt) => {
    try {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'questionTypesUpdate') {
        applySelectedTypes(msg.payload?.selectedQuestionTypes || ['all']);
      }
    } catch (err) {
      console.error('WS message error', err);
    }
  }, [applySelectedTypes]);

  const handleStudentOpen = useCallback(() => {
    if (submittedName) {
      sendStats();
    }
  }, [submittedName, sendStats]);

  const buildStudentWsUrl = useCallback(() => {
    if (!sessionId || isSolo) return null;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const encodedSession = encodeURIComponent(sessionId);
    const nameParam = submittedName ? `&studentName=${encodeURIComponent(submittedName)}` : '';
    const idParam = studentId ? `&studentId=${encodeURIComponent(studentId)}` : '';
    return `${proto}//${window.location.host}/ws/python-list-practice?sessionId=${encodedSession}${nameParam}${idParam}`;
  }, [sessionId, submittedName, studentId, isSolo]);

  const { connect: connectStudentWs, disconnect: disconnectStudentWs } = useResilientWebSocket({
    buildUrl: buildStudentWsUrl,
    shouldReconnect: Boolean(sessionId && !isSolo),
    onOpen: handleStudentOpen,
    onMessage: handleStudentMessage,
    onError: (err) => console.error('WS error', err),
    attachSessionEndedHandler,
  });

  useEffect(() => {
    if (!sessionId || isSolo) {
      disconnectStudentWs();
      return undefined;
    }
    connectStudentWs();
    return () => {
      disconnectStudentWs();
    };
  }, [sessionId, isSolo, connectStudentWs, disconnectStudentWs]);

  const isListBuildVariant = challenge?.variant === 'insert-final' || challenge?.variant === 'list-final';



  const normalizedExpected = useMemo(() => normalizeExpected(challenge), [challenge]);

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

  // selection reset is handled by the selection hook (see below)

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

  // wire up selection hook (handles clicks, shift-select ranges, and building answers)
  const sequenceSelection = useSequenceSelection({
    interactiveList,
    isListBuildVariant,
    supportsSequenceSelection,
    showNext,
    setAnswer,
    setInsertSelections,
    getValueForIndex,
    challengeOp: challenge?.op,
  });

  const {
    selectedIndex,
    selectedValueIndex,
    selectedRange,
    selectedSequence,
    handleIndexClick,
    handleValueClick,
    applyRangeSelection,
    handleSequenceSelectionClick,
    clearSelection,
  } = sequenceSelection;

  useEffect(() => {
    clearSelection();
    setInsertSelections([]);
    setHintStage('none');
  }, [challenge, clearSelection]);

  

  // index/value click handlers are provided by `useSequenceSelection`

  const QUESTION_OPTIONS = useMemo(() => OPERATIONS.filter((t) => t !== 'all'), []);

  if (!submittedName && !isSolo) {
    return (
      <NameForm
        studentName={studentName}
        setStudentName={setStudentName}
        nameRef={nameRef}
        submitName={submitName}
        error={error}
      />
    );
  }

  return (
    <div className="python-list-bg">
      <div className="python-list-container">
        <SessionHeader 
          submittedName={submittedName}
          sessionId={sessionId}
          stats={stats}
          simple={isSolo}
          activityName="Python List Practice"
        />

        <div className="python-list-content">
          <ControlsPanel
            isSolo={isSolo}
            soloQuestionTypes={soloQuestionTypes}
            allowedTypes={allowedTypes}
            handleSoloToggleType={handleSoloToggleType}
            allowedTypeList={allowedTypeList}
            QUESTION_LABELS={QUESTION_LABELS}
          />

          <QuestionPanel
            challenge={challenge}
            hintStage={hintStage}
            feedback={feedback}
            hintDefinition={hintDefinition}
            answerDetails={answerDetails}
            interactiveList={interactiveList}
            isListBuildVariant={isListBuildVariant}
            supportsSequenceSelection={supportsSequenceSelection}
            selectedRange={selectedRange}
            selectedSequence={selectedSequence}
            selectedIndex={selectedIndex}
            selectedValueIndex={selectedValueIndex}
            onIndexClick={handleIndexClick}
            onValueClick={handleValueClick}
            onShowHint={handleShowDefinitionHint}
            onShowAnswer={handleShowAnswerHint}
            answer={answer}
            onAnswerChange={(value) => setAnswer(value)}
            answerRef={answerInputRef}
            disabled={showNext}
            loading={loading}
            onSubmit={checkAnswer}
            onClear={() => { setAnswer(''); setInsertSelections([]); }}
            onNext={nextChallenge}
          />
        </div>
      </div>
    </div>
  );
}
