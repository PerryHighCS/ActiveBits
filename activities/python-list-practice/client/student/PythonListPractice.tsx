import type { FC } from 'react'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import '../styles.css'
import NameForm from './components/NameForm.js'
import ControlsPanel from './components/ControlsPanel.js'
import QuestionPanel from './components/QuestionPanel.js'
import SessionHeader from './components/SessionHeader.js'
import {
  createChallengeForTypes,
  OPERATIONS,
  QUESTION_LABELS,
  getHintDefinition,
  buildAnswerDetails,
  sanitizeName,
} from './challengeGenerator.js'
import { normalizeListAnswer, normalizeExpected } from './utils/componentUtils.js'
import usePersistentStats from './hooks/usePersistentStats.js'
import useSequenceSelection from './hooks/useSequenceSelection.js'
import type { PythonListPracticeStats } from '../../pythonListPracticeTypes.js'

interface SessionData {
  sessionId?: string
}

interface WebSocketMessage {
  type: string
  payload?: Record<string, unknown>
}

interface StudentProps {
  sessionData: SessionData
}

const PythonListPractice: FC<StudentProps> = ({ sessionData }) => {
  const [studentName, setStudentName] = useState('')
  const [submittedName, setSubmittedName] = useState<string | undefined>(undefined)
  const [studentId, setStudentId] = useState<string | undefined>(undefined)
  const attachSessionEndedHandler = useSessionEndedHandler()
  const sessionId = sessionData?.sessionId
  const isSolo = !sessionId || sessionId.startsWith('solo-')
  const [allowedTypes, setAllowedTypes] = useState(() => new Set(['all']))
  const [challenge, setChallenge] = useState<Record<string, unknown> | null>(null)
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState<{ isCorrect: boolean; message: string } | null>(null)
  const [showNext, setShowNext] = useState(false)
  const { stats, setStats, sendStats } = usePersistentStats({
    sessionId,
    studentId,
    submittedName,
    isSolo,
  })
  const [_loading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const answerInputRef = useRef<HTMLInputElement | null>(null)
  const [insertSelections, setInsertSelections] = useState<unknown[]>([])
  const [hintStage, setHintStage] = useState<'none' | 'definition' | 'answer'>('none')

  const allowedTypeList = useMemo(() => {
    if (allowedTypes.has('all')) {
      return ['all']
    }
    return OPERATIONS.filter((type) => allowedTypes.has(type))
  }, [allowedTypes])

  const soloQuestionTypes = useMemo(
    () => [
      { id: 'all', label: 'All question types' },
      ...OPERATIONS.filter((t: string) => t !== 'all').map((type: string) => ({
        id: type,
        label: QUESTION_LABELS[type as keyof typeof QUESTION_LABELS] || type,
      })),
    ],
    [],
  )

  const applySelectedTypes = useCallback((types: string[]) => {
    const normalized = Array.isArray(types) && types.length > 0 ? types : ['all']
    const nextSet = new Set(normalized)
    setAllowedTypes(nextSet)
    setChallenge(createChallengeForTypes(nextSet) as Record<string, unknown>)
    setAnswer('')
    setFeedback(null)
    setShowNext(false)
  }, [])

  const handleSoloToggleType = useCallback(
    (typeId: string) => {
      const next = new Set(allowedTypes)
      if (typeId === 'all') {
        next.clear()
        next.add('all')
      } else {
        if (next.has('all')) {
          next.clear()
        }
        if (next.has(typeId)) {
          next.delete(typeId)
        } else {
          next.add(typeId)
        }
        if (next.size === 0) {
          next.add('all')
        }
      }
      applySelectedTypes(Array.from(next))
    },
    [allowedTypes, applySelectedTypes],
  )

  useEffect(() => {
    if (nameRef.current) {
      nameRef.current.focus()
    }
  }, [])

  useEffect(() => {
    if (!sessionId) return
    const storedName = localStorage.getItem(`python-list-practice-name-${sessionId}`)
    const storedId = localStorage.getItem(`python-list-practice-id-${sessionId}`)
    if (storedName) {
      setStudentName(storedName)
    }
    if (storedName && storedId) {
      setSubmittedName(storedName)
      setStudentId(storedId)
    } else if (storedId && !storedName) {
      setStudentId(storedId)
    }
  }, [sessionId])

  useEffect(() => {
    if (!showNext && answerInputRef.current) {
      answerInputRef.current.focus()
    }
  }, [challenge, showNext])

  useEffect(() => {
    if (!sessionId || isSolo) return undefined
    let ignore = false
    const fetchConfig = async () => {
      try {
        const res = await fetch(`/api/python-list-practice/${sessionId}`)
        if (!res.ok) throw new Error('Failed to load session')
        const data = (await res.json()) as Record<string, unknown>
        if (!ignore) {
          const types = Array.isArray(data.selectedQuestionTypes) ? data.selectedQuestionTypes : ['all']
          applySelectedTypes(types as string[])
        }
      } catch (err) {
        console.error('Failed to load session config', err)
      }
    }
    fetchConfig()
    return () => {
      ignore = true
    }
  }, [sessionId, applySelectedTypes, isSolo])

  const ensureStudentId = useCallback(() => {
    if (studentId) return studentId
    const generated =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `stu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    setStudentId(generated)
    if (sessionId) {
      localStorage.setItem(`python-list-practice-id-${sessionId}`, generated)
    }
    return generated
  }, [studentId, sessionId])

  const submitName = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      const sanitized = sanitizeName(studentName)
      if (!sanitized) {
        setError('Enter a valid name')
        return
      }
      setSubmittedName(sanitized)
      const id = ensureStudentId()
      if (sessionId) {
        localStorage.setItem(`python-list-practice-name-${sessionId}`, sanitized)
        localStorage.setItem(`python-list-practice-id-${sessionId}`, id)
      }
      setError(null)
    },
    [studentName, sessionId, ensureStudentId],
  )

  const handleStudentMessage = useCallback(
    (evt: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(evt.data) as WebSocketMessage
        if (msg.type === 'questionTypesUpdate') {
          const types = Array.isArray((msg.payload as Record<string, unknown>)?.selectedQuestionTypes)
            ? ((msg.payload as Record<string, unknown>)?.selectedQuestionTypes as string[])
            : ['all']
          applySelectedTypes(types)
        }
      } catch (err) {
        console.error('WS message error', err)
      }
    },
    [applySelectedTypes],
  )

  const handleStudentOpen = useCallback(() => {
    if (submittedName) {
      sendStats()
    }
  }, [submittedName, sendStats])

  const buildStudentWsUrl = useCallback(() => {
    if (!sessionId || isSolo) return null
    const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const encodedSession = encodeURIComponent(sessionId)
    const nameParam = submittedName ? `&studentName=${encodeURIComponent(submittedName)}` : ''
    const idParam = studentId ? `&studentId=${encodeURIComponent(studentId)}` : ''
    return `${proto}//${window.location.host}/ws/python-list-practice?sessionId=${encodedSession}${nameParam}${idParam}`
  }, [sessionId, submittedName, studentId, isSolo])

  const { connect: connectStudentWs, disconnect: disconnectStudentWs } = useResilientWebSocket({
    buildUrl: buildStudentWsUrl,
    shouldReconnect: Boolean(sessionId && !isSolo),
    onOpen: handleStudentOpen,
    onMessage: handleStudentMessage,
    onError: () => console.error('WS error'),
    attachSessionEndedHandler,
  })

  useEffect(() => {
    if (!sessionId || isSolo) {
      disconnectStudentWs()
      return undefined
    }
    connectStudentWs()
    return () => {
      disconnectStudentWs()
    }
  }, [sessionId, isSolo, connectStudentWs, disconnectStudentWs])

  const isListBuildVariant = challenge?.variant === 'insert-final' || challenge?.variant === 'list-final'

  const normalizedExpected = useMemo(() => normalizeExpected(challenge as any), [challenge])

  const hintDefinition = useMemo(() => getHintDefinition(challenge as any), [challenge])
  const answerDetails = useMemo(() => buildAnswerDetails(challenge as any), [challenge])

  const handleShowDefinitionHint = useCallback(() => {
    if (hintStage === 'none') {
      setHintStage('definition')
    }
  }, [hintStage])

  const handleShowAnswerHint = useCallback(() => {
    setHintStage('answer')
  }, [])

  const checkAnswer = useCallback(() => {
    let cleaned =
      challenge?.type === 'list'
        ? normalizeListAnswer(answer)
        : answer.trim()
    let expectedComparison = normalizedExpected

    const needsCommaTolerance =
      challenge?.type !== 'list' && (normalizedExpected.includes(',') || cleaned.includes(','))
    if (needsCommaTolerance) {
      cleaned = normalizeListAnswer(cleaned)
      expectedComparison = normalizeListAnswer(normalizedExpected)
    }

    const isCorrect = cleaned.length > 0 && cleaned === expectedComparison
    const hintsUsed = hintStage !== 'none'
    const streakIncrement = isCorrect && !hintsUsed ? stats.streak + 1 : 0
    const nextStats: PythonListPracticeStats = {
      total: stats.total + 1,
      correct: stats.correct + (isCorrect && !hintsUsed ? 1 : 0),
      streak: streakIncrement,
      longestStreak: Math.max(stats.longestStreak, streakIncrement),
    }
    setStats(nextStats)
    setFeedback({
      isCorrect,
      message: isCorrect ? 'Correct! 🎉' : `Not quite. Expected: ${challenge?.expected}`,
    })
    sendStats(nextStats)
    setShowNext(true)
  }, [challenge, answer, normalizedExpected, stats, hintStage, setStats, sendStats])

  const nextChallenge = useCallback(() => {
    setChallenge(createChallengeForTypes(allowedTypes))
    setAnswer('')
    setFeedback(null)
    setShowNext(false)
  }, [allowedTypes])

  const interactiveList = useMemo(() => {
    if ((challenge as any)?.choices) return (challenge as any).choices
    if (!challenge) return []
    if ((challenge as any)?.op === 'index-set' && Array.isArray((challenge as any)?.mutated)) {
      return (challenge as any).mutated
    }
    if (Array.isArray((challenge as any)?.list)) {
      return (challenge as any).list
    }
    if ((challenge as any)?.op === 'for-range') {
      const total = Math.max(0, (((challenge as any)?.stop as number) ?? 0) - (((challenge as any)?.start as number) ?? 0))
      return Array.from({ length: total }, (_, i) => (((challenge as any)?.start as number) ?? 0) + i)
    }
    return []
  }, [challenge])

  useEffect(() => {
    if (isListBuildVariant) {
      setAnswer(insertSelections.length ? `[${(insertSelections as string[]).join(', ')}]` : '')
    }
  }, [insertSelections, isListBuildVariant])

  const supportsSequenceSelection = !!(challenge && ['range-len', 'for-each'].includes(challenge.op as string))

  const getValueForIndex = useCallback(
    (idx: number) => {
      if (!challenge) return undefined
      if (
        Array.isArray(challenge.choices) &&
        (challenge.op === 'insert' ||
          ['list-final', 'value-selection', 'index-value', 'number-choice'].includes(challenge.variant as string) ||
          challenge.op === 'for-range')
      ) {
        return (challenge.choices as unknown[])[idx]
      }
      if (challenge.op === 'index-set' && Array.isArray(challenge.mutated)) {
        return (challenge.mutated as unknown[])[idx]
      }
      if (!Array.isArray(interactiveList) || idx < 0 || idx >= interactiveList.length) {
        return undefined
      }
      if (challenge.op === 'pop' && idx !== interactiveList.length - 1) {
        return undefined
      }
      return interactiveList[idx]
    },
    [challenge, interactiveList],
  )

  const sequenceSelection = useSequenceSelection({
    interactiveList,
    isListBuildVariant,
    supportsSequenceSelection,
    showNext,
    setAnswer,
    setInsertSelections,
    getValueForIndex,
    challengeOp: ((challenge as any)?.op as any) || null,
  } as any)

  const {
    selectedIndex,
    selectedValueIndex,
    selectedRange,
    selectedSequence,
    handleIndexClick,
    handleValueClick,
    clearSelection,
  } = sequenceSelection

  useEffect(() => {
    clearSelection()
    setInsertSelections([])
    setHintStage('none')
  }, [challenge, clearSelection])

  if (!submittedName && !isSolo) {
    return (
      <NameForm
        studentName={studentName}
        setStudentName={setStudentName}
        nameRef={nameRef}
        submitName={submitName}
        error={error}
      />
    )
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
            challenge={challenge as any}
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
            allowDuplicateValues={false}
            answer={answer}
            onAnswerChange={(value: string) => setAnswer(value)}
            answerRef={answerInputRef}
            disabled={showNext}
            loading={_loading}
            onSubmit={checkAnswer}
            onClear={() => {
              setAnswer('')
              setInsertSelections([])
            }}
            onNext={nextChallenge}
          />
        </div>
      </div>
    </div>
  )
}

export default PythonListPractice
