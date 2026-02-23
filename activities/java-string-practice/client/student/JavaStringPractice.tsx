import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '@src/components/ui/Button'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler'
import type {
  FeedbackState,
  JavaStringAnswer,
  JavaStringChallenge,
  JavaStringMethodId,
  JavaStringStats,
} from '../../javaStringPracticeTypes.js'
import AnswerSection from '../components/AnswerSection'
import ChallengeQuestion from '../components/ChallengeQuestion'
import ChallengeSelector from '../components/ChallengeSelector'
import FeedbackDisplay from '../components/FeedbackDisplay'
import StatsPanel from '../components/StatsPanel'
import StringDisplay from '../components/StringDisplay'
import { generateChallenge, getExplanation, validateAnswer } from '../components/challengeLogic'
import '../components/styles.css'

interface JavaStringPracticeSessionData extends Record<string, unknown> {
  sessionId?: string
}

interface JavaStringPracticeProps {
  sessionData?: JavaStringPracticeSessionData
}

interface SessionResponse {
  selectedMethods?: unknown
}

interface IncomingMessage {
  type?: string
  payload?: Record<string, unknown>
}

function isMethodId(value: unknown): value is JavaStringMethodId {
  return ['all', 'substring', 'indexOf', 'equals', 'length', 'compareTo'].includes(String(value))
}

function normalizeMethods(value: unknown): JavaStringMethodId[] {
  if (!Array.isArray(value)) return ['all']
  const methods = value.filter(isMethodId)
  return methods.length > 0 ? methods : ['all']
}

const defaultStats: JavaStringStats = {
  total: 0,
  correct: 0,
  streak: 0,
  longestStreak: 0,
}

export default function JavaStringPractice({ sessionData }: JavaStringPracticeProps) {
  const sessionId = sessionData?.sessionId
  const isSoloSession = sessionId ? sessionId.startsWith('solo-') : false
  const initializedRef = useRef(false)
  const studentIdRef = useRef<string | null>(null)
  const navigate = useNavigate()
  const attachSessionEndedHandler = useSessionEndedHandler()

  const [studentName, setStudentName] = useState('')
  const [studentId, setStudentId] = useState<string | null>(null)
  const [nameSubmitted, setNameSubmitted] = useState(false)
  const [currentChallenge, setCurrentChallenge] = useState<JavaStringChallenge | null>(null)
  const [selectedTypes, setSelectedTypes] = useState<Set<JavaStringMethodId>>(new Set(['all']))
  const [userAnswer, setUserAnswer] = useState('')
  const [selectedIndices, setSelectedIndices] = useState<number[]>([])
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectionType, setSelectionType] = useState<'letter' | 'index' | null>(null)
  const [feedback, setFeedback] = useState<FeedbackState | null>(null)
  const [hintShown, setHintShown] = useState(false)
  const [visualHintShown, setVisualHintShown] = useState(false)
  const [stats, setStats] = useState<JavaStringStats>(defaultStats)

  const resetChallengeState = useCallback(() => {
    setUserAnswer('')
    setSelectedIndices([])
    setIsSelecting(false)
    setSelectionType(null)
    setFeedback(null)
    setHintShown(false)
    setVisualHintShown(false)
  }, [])

  useEffect(() => {
    if (isSoloSession) {
      setStudentName('Solo Student')
      setNameSubmitted(true)
      return
    }

    if (sessionId == null) return
    const savedName = localStorage.getItem(`student-name-${sessionId}`)
    const savedId = localStorage.getItem(`student-id-${sessionId}`)
    if (savedName) {
      setStudentName(savedName)
      setStudentId(savedId)
      setNameSubmitted(true)
    }
  }, [isSoloSession, sessionId])

  useEffect(() => {
    studentIdRef.current = studentId
  }, [studentId])

  const fetchAllowedMethods = useCallback(async () => {
    if (sessionId == null) return
    try {
      const response = await fetch(`/api/java-string-practice/${sessionId}`)
      if (response.ok !== true) throw new Error('Failed to fetch session')
      const data = (await response.json()) as SessionResponse
      setSelectedTypes(new Set(normalizeMethods(data.selectedMethods)))
    } catch (error) {
      console.error('Failed to fetch allowed methods:', error)
    }
  }, [sessionId])

  const handleWsMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message = JSON.parse(String(event.data)) as IncomingMessage
        const payload = message.payload ?? {}
        if (message.type === 'session-ended') {
          void navigate('/session-ended')
          return
        }
        if (message.type === 'studentId') {
          const nextStudentId = typeof payload.studentId === 'string' ? payload.studentId : null
          setStudentId(nextStudentId)
          if (nextStudentId && sessionId) {
            localStorage.setItem(`student-id-${sessionId}`, nextStudentId)
          }
          return
        }
        if (message.type === 'methodsUpdate') {
          const nextMethods = new Set(normalizeMethods(payload.selectedMethods))
          setSelectedTypes(nextMethods)
          setCurrentChallenge(generateChallenge(nextMethods))
          resetChallengeState()
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error)
      }
    },
    [navigate, resetChallengeState, sessionId],
  )

  const handleWsOpen = useCallback(() => {
    void fetchAllowedMethods()
  }, [fetchAllowedMethods])

  const buildWsUrl = useCallback((): string | null => {
    if (nameSubmitted !== true || isSoloSession === true || sessionId == null || typeof window === 'undefined') return null
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const currentStudentId = studentIdRef.current
    const studentIdParam = currentStudentId ? `&studentId=${encodeURIComponent(currentStudentId)}` : ''
    return `${protocol}//${window.location.host}/ws/java-string-practice?sessionId=${sessionId}&studentName=${encodeURIComponent(studentName)}${studentIdParam}`
  }, [isSoloSession, nameSubmitted, sessionId, studentName])

  const { connect: connectStudentWs, disconnect: disconnectStudentWs } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(nameSubmitted && !isSoloSession),
    onOpen: handleWsOpen,
    onMessage: handleWsMessage,
    onError: (error) => console.error('WebSocket error:', error),
    onClose: () => console.log('WebSocket disconnected for session:', sessionId),
    attachSessionEndedHandler,
  })

  useEffect(() => {
    if (nameSubmitted !== true || isSoloSession === true) {
      disconnectStudentWs()
      return undefined
    }
    connectStudentWs()
    return () => {
      disconnectStudentWs()
    }
  }, [connectStudentWs, disconnectStudentWs, isSoloSession, nameSubmitted, sessionId])

  useEffect(() => {
    if (sessionId == null) return
    const saved = localStorage.getItem(`java-string-stats-${sessionId}`)
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<JavaStringStats>
        setStats({
          total: parsed.total ?? 0,
          correct: parsed.correct ?? 0,
          streak: parsed.streak ?? 0,
          longestStreak: parsed.longestStreak ?? 0,
        })
      } catch (error) {
        console.error('Failed to load stats', error)
      }
    }
  }, [sessionId])

  useEffect(() => {
    if (sessionId == null || stats.total <= 0) return
    localStorage.setItem(`java-string-stats-${sessionId}`, JSON.stringify(stats))

    if (isSoloSession !== true && nameSubmitted === true) {
      fetch(`/api/java-string-practice/${sessionId}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentName, studentId, stats }),
      }).catch((error) => console.error('Failed to send progress:', error))
    }
  }, [isSoloSession, nameSubmitted, sessionId, stats, studentId, studentName])

  const handleNewChallenge = useCallback(() => {
    setCurrentChallenge(generateChallenge(selectedTypes))
    resetChallengeState()
  }, [resetChallengeState, selectedTypes])

  const handleTypeSelection = useCallback(
    (type: JavaStringMethodId) => {
      const next = new Set(selectedTypes)
      if (type === 'all') {
        next.clear()
        next.add('all')
      } else {
        if (next.has('all')) {
          next.clear()
        }
        if (next.has(type)) {
          next.delete(type)
        } else {
          next.add(type)
        }
        if (next.size === 0) {
          next.add('all')
        }
      }
      setSelectedTypes(next)
      setCurrentChallenge(generateChallenge(next))
      resetChallengeState()
    },
    [resetChallengeState, selectedTypes],
  )

  useEffect(() => {
    if (initializedRef.current !== true && currentChallenge == null) {
      initializedRef.current = true
      handleNewChallenge()
    }
  }, [currentChallenge, handleNewChallenge])

  const handleSubmit = (answer: JavaStringAnswer): void => {
    if (currentChallenge == null) return
    const isCorrect = validateAnswer(currentChallenge, answer)
    const noHintsUsed = hintShown !== true && visualHintShown !== true
    const newStreak = isCorrect && noHintsUsed ? stats.streak + 1 : 0
    setStats((previous) => ({
      total: previous.total + 1,
      correct: previous.correct + (isCorrect && noHintsUsed ? 1 : 0),
      streak: newStreak,
      longestStreak: Math.max(previous.longestStreak, newStreak),
    }))

    setFeedback({
      isCorrect,
      message: isCorrect
        ? `🎉 Correct! The answer is "${currentChallenge.expectedAnswer}"`
        : `❌ Incorrect. The correct answer is "${currentChallenge.expectedAnswer}". ${getExplanation(currentChallenge)}`,
    })
  }

  if (isSoloSession !== true && nameSubmitted !== true) {
    return (
      <div className="java-string-container">
        <div className="java-string-header">
          <div className="game-title">Java String Methods Practice</div>
        </div>
        <div className="java-string-content">
          <div className="challenge-card" style={{ textAlign: 'center', padding: '40px' }}>
            <h3 className="text-xl font-semibold mb-4">Enter Your Name</h3>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (studentName.trim() && sessionId) {
                  localStorage.setItem(`student-name-${sessionId}`, studentName.trim())
                  setNameSubmitted(true)
                }
              }}
            >
              <input
                type="text"
                value={studentName}
                onChange={(event) => setStudentName(event.target.value)}
                placeholder="Your name"
                className="border border-gray-300 rounded px-4 py-2 text-lg mb-4 w-64"
                autoFocus
                required
              />
              <br />
              <Button type="submit">Start Practicing</Button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="java-string-container">
      <div className="java-string-header">
        <div className="game-title">Java String Methods Practice</div>
        <StatsPanel stats={stats} />
      </div>

      <div className="java-string-content">
        <div className="challenge-card">
          <div className="challenge-header">
            <ChallengeSelector selectedTypes={selectedTypes} onTypeSelect={isSoloSession ? handleTypeSelection : undefined} />
          </div>

          {currentChallenge && (
            <>
              <StringDisplay
                challenge={currentChallenge}
                selectedIndices={selectedIndices}
                visualHintShown={visualHintShown}
                selectionType={selectionType}
                onLetterClick={(index) => {
                  if (currentChallenge.type !== 'substring' && currentChallenge.type !== 'indexOf') return

                  if (isSelecting && selectionType === 'index') {
                    setSelectedIndices([index])
                    setSelectionType('letter')
                    setUserAnswer(currentChallenge.text.charAt(index))
                  } else if (!isSelecting) {
                    setSelectedIndices([index])
                    setIsSelecting(true)
                    setSelectionType('letter')
                    setUserAnswer(currentChallenge.text.charAt(index))
                  } else {
                    const anchor = selectedIndices[0] ?? index
                    const start = Math.min(anchor, index)
                    const end = Math.max(anchor, index) + 1
                    setSelectedIndices([start, end])
                    setIsSelecting(false)
                    setSelectionType(null)
                    setUserAnswer(currentChallenge.text.substring(start, end))
                  }
                }}
                onIndexClick={(index) => {
                  if (currentChallenge.type !== 'substring' && currentChallenge.type !== 'indexOf') return

                  if (isSelecting && selectionType === 'letter') {
                    setSelectedIndices([index])
                    setSelectionType('index')
                    setUserAnswer(index.toString())
                  } else if (!isSelecting) {
                    setSelectedIndices([index])
                    setIsSelecting(true)
                    setSelectionType('index')
                    setUserAnswer(index.toString())
                  } else {
                    const anchor = selectedIndices[0] ?? index
                    const start = Math.min(anchor, index)
                    const end = Math.max(anchor, index)
                    setSelectedIndices([start, end])
                    setIsSelecting(false)
                    setSelectionType(null)
                    setUserAnswer(`${start}, ${end}`)
                  }
                }}
              />

              <div className="question-hint-row">
                <ChallengeQuestion question={currentChallenge.question} />
                {!feedback && (
                  <div className="hint-controls">
                    {!hintShown && (
                      <Button onClick={() => setHintShown(true)} className="hint-btn">
                        💡 Show Hint
                      </Button>
                    )}
                    {hintShown && !visualHintShown && (
                      <Button onClick={() => setVisualHintShown(true)} className="visual-hint-btn">
                        🎯 Show Answer
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {hintShown && <div className="code-hint">{currentChallenge.hint}</div>}

              {!feedback && (
                <AnswerSection
                  challenge={currentChallenge}
                  userAnswer={userAnswer}
                  selectedIndices={selectedIndices}
                  onAnswerChange={setUserAnswer}
                  onSubmit={handleSubmit}
                />
              )}

              {feedback && <FeedbackDisplay feedback={feedback} onNewChallenge={handleNewChallenge} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
