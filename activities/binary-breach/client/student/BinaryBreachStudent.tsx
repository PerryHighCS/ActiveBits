import { useCallback, useEffect, useMemo, useState, type DragEvent, type FormEvent } from 'react'
import {
  persistSessionParticipantIdentity,
  resolveInitialEntryParticipantIdentity,
} from '@src/components/common/entryParticipantIdentityUtils'
import type {
  BinaryBreachChallenge,
  BinaryBreachFeedback,
  BinaryBreachProgress,
} from '../../binaryBreachTypes.js'
import {
  DEFAULT_BINARY_BREACH_SETTINGS,
  createBinaryBreachChallenge,
  createMissionSeed,
  getHintForChallenge,
} from '../../shared/challengeGenerator.js'
import { validateBinaryBreachAnswer } from '../../shared/challengeValidation.js'
import { applyAnswerResult, applyHintUse, createInitialProgress } from '../../shared/scoring.js'
import PlaceValueChart from '../components/PlaceValueChart'

interface BinaryBreachStudentProps {
  sessionData?: {
    sessionId?: string
  }
}

interface RegisterResponse {
  studentId: string
  studentName: string
  challenge: BinaryBreachChallenge | null
  progress: BinaryBreachProgress
}

interface AnswerResponse {
  feedback: BinaryBreachFeedback
  progress: BinaryBreachProgress
  challenge: BinaryBreachChallenge | null
}

function isSoloSession(sessionId: string | undefined): boolean {
  return !sessionId || sessionId.startsWith('solo-')
}

function moveValue(values: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction
  if (target < 0 || target >= values.length) return values
  const next = [...values]
  const currentValue = next[index]
  const targetValue = next[target]
  if (currentValue == null || targetValue == null) return values
  next[index] = targetValue
  next[target] = currentValue
  return next
}

function BitCells({ value }: { value: string }) {
  return (
    <div className="bb-binary-display" aria-label={`Binary value: ${value}`}>
      {value.split('').map((bit, index) => (
        <span key={index} className={`bb-bit bb-bit--${bit}`} aria-hidden="true">
          {bit}
        </span>
      ))}
    </div>
  )
}

function SignalBits({ value }: { value: string }) {
  return (
    <div className="bb-signal-bits" aria-hidden="true">
      {value.split('').map((bit, index) => (
        <span key={index} className={`bb-bit bb-bit--${bit}`}>
          {bit}
        </span>
      ))}
    </div>
  )
}

export default function BinaryBreachStudent({ sessionData }: BinaryBreachStudentProps) {
  const sessionId = sessionData?.sessionId
  const solo = isSoloSession(sessionId)
  const [studentName, setStudentName] = useState('')
  const [studentId, setStudentId] = useState<string | null>(null)
  const [identityReady, setIdentityReady] = useState(false)
  const [challenge, setChallenge] = useState<BinaryBreachChallenge | null>(null)
  const [progress, setProgress] = useState<BinaryBreachProgress>(() => createInitialProgress())
  const [textAnswer, setTextAnswer] = useState('')
  const [choiceAnswer, setChoiceAnswer] = useState<'left' | 'right' | null>(null)
  const [orderAnswer, setOrderAnswer] = useState<string[]>([])
  const [feedback, setFeedback] = useState<BinaryBreachFeedback | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [localSeed] = useState(() => createMissionSeed())
  const [localIndex, setLocalIndex] = useState(0)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const missionLength = DEFAULT_BINARY_BREACH_SETTINGS.missionLength

  const accuracy = progress.attempts === 0 ? 100 : Math.round((progress.correct / progress.attempts) * 100)
  const progressPct = Math.min(100, Math.round((progress.systemsRestored / missionLength) * 100))

  const resetAnswerState = useCallback((nextChallenge: BinaryBreachChallenge | null) => {
    setTextAnswer('')
    setChoiceAnswer(null)
    setOrderAnswer(nextChallenge?.type === 'order-binary' ? nextChallenge.values : [])
    setHint(null)
    setFeedback(null)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (typeof window === 'undefined') return undefined
    void (async () => {
      try {
        const identity = await resolveInitialEntryParticipantIdentity({
          activityName: 'binary-breach',
          sessionId,
          isSoloSession: solo,
          localStorage: window.localStorage,
          sessionStorage: window.sessionStorage,
          soloDisplayName: 'Solo Technician',
        })
        if (cancelled) return
        setStudentName(identity.studentName)
        setStudentId(identity.studentId ?? null)
        if (sessionId && !solo) {
          const response = await fetch(`/api/binary-breach/${sessionId}/student/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              studentName: identity.studentName,
              studentId: identity.studentId,
            }),
          })
          if (!response.ok) throw new Error('Failed to join mission')
          const payload = await response.json() as RegisterResponse
          if (cancelled) return
          setStudentId(payload.studentId)
          setStudentName(payload.studentName)
          setChallenge(payload.challenge)
          setProgress(payload.progress)
          resetAnswerState(payload.challenge)
          persistSessionParticipantIdentity(window.localStorage, sessionId, payload.studentName, payload.studentId)
        } else {
          const firstChallenge = createBinaryBreachChallenge(DEFAULT_BINARY_BREACH_SETTINGS, localSeed, 0)
          setChallenge(firstChallenge)
          resetAnswerState(firstChallenge)
        }
      } catch (err) {
        console.error('Failed to start Binary Breach mission:', err)
        if (!cancelled) setError('Mission console failed to initialize. Try rejoining from the activity link.')
      } finally {
        if (!cancelled) setIdentityReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [localSeed, resetAnswerState, sessionId, solo])

  const canSubmit = useMemo(() => {
    if (!challenge || progress.completed) return false
    if (challenge.type === 'compare-binary') return choiceAnswer != null
    if (challenge.type === 'order-binary') return orderAnswer.length === challenge.values.length
    return textAnswer.trim().length > 0
  }, [challenge, choiceAnswer, orderAnswer, progress.completed, textAnswer])

  const submitAnswer = async (event: FormEvent) => {
    event.preventDefault()
    if (!challenge || !canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const answer = challenge.type === 'binary-to-decimal'
        ? { decimal: textAnswer }
        : challenge.type === 'decimal-to-binary'
          ? { binary: textAnswer }
          : challenge.type === 'compare-binary'
            ? { choice: choiceAnswer }
            : { values: orderAnswer }

      if (sessionId && !solo) {
        const response = await fetch(`/api/binary-breach/${sessionId}/student/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentName, studentId, answer }),
        })
        if (!response.ok) throw new Error('Failed to submit answer')
        const payload = await response.json() as AnswerResponse
        setFeedback(payload.feedback)
        setProgress(payload.progress)
        setChallenge(payload.challenge)
        resetAnswerState(payload.challenge)
      } else {
        const localFeedback = validateBinaryBreachAnswer(challenge, { type: challenge.type, ...answer } as never)
        const nextProgress = applyAnswerResult(progress, localFeedback.correct, missionLength)
        const nextIndex = localIndex + 1
        const nextChallenge = nextProgress.completed
          ? null
          : createBinaryBreachChallenge(DEFAULT_BINARY_BREACH_SETTINGS, localSeed, nextIndex)
        setFeedback(localFeedback)
        setProgress(nextProgress)
        setLocalIndex(nextIndex)
        setChallenge(nextChallenge)
        resetAnswerState(nextChallenge)
      }
    } catch (err) {
      console.error('Binary Breach answer submit failed:', err)
      setError('The system rejected the transmission. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const requestHint = async () => {
    if (!challenge) return
    if (sessionId && !solo) {
      const response = await fetch(`/api/binary-breach/${sessionId}/student/hint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentName, studentId }),
      })
      if (!response.ok) {
        setError('No hint is available for this system.')
        return
      }
      const payload = await response.json() as { hint: string; progress: BinaryBreachProgress; challenge: BinaryBreachChallenge }
      setHint(payload.hint)
      setProgress(payload.progress)
      setChallenge(payload.challenge)
    } else {
      setHint(getHintForChallenge(challenge))
      setProgress((current) => applyHintUse(current))
    }
  }

  const handleDragStart = (index: number) => {
    setDragIndex(index)
    setDragOverIndex(index)
  }

  const handleDragOver = (event: DragEvent, index: number) => {
    event.preventDefault()
    setDragOverIndex(index)
  }

  const handleDrop = (event: DragEvent, dropIndex: number) => {
    event.preventDefault()
    if (dragIndex == null || dragIndex === dropIndex) {
      setDragIndex(null)
      setDragOverIndex(null)
      return
    }
    setOrderAnswer((current) => {
      const next = [...current]
      const moved = next.splice(dragIndex, 1)[0]
      if (moved == null) return current
      next.splice(dropIndex, 0, moved)
      return next
    })
    setDragIndex(null)
    setDragOverIndex(null)
  }

  const handleDragEnd = () => {
    setDragIndex(null)
    setDragOverIndex(null)
  }

  const traceDanger = progress.traceLevel >= 3
  const streakHot = progress.streak >= 3

  return (
    <div className="binary-breach-shell">
      <header className="bb-mission-header">
        <span className="bb-header-badge">BINARY BREACH</span>
        <span className="bb-header-sep">//</span>
        <span className="bb-header-title">SYSTEM OVERRIDE</span>
        <span className="bb-header-tech">TECH: {studentName || '...'}</span>
      </header>

      <main className="bb-page">
        <section className="bb-stats" aria-label="Mission stats">
          <div className="bb-stat bb-stat--accent">
            <div className="bb-stat-label">SYSTEMS</div>
            <div className="bb-stat-value">{progress.systemsRestored}</div>
          </div>
          <div className="bb-stat">
            <div className="bb-stat-label">ACCURACY</div>
            <div className="bb-stat-value">{accuracy}%</div>
          </div>
          <div className={`bb-stat ${streakHot ? 'bb-stat--success' : ''}`}>
            <div className="bb-stat-label">STREAK</div>
            <div className="bb-stat-value">{progress.streak}</div>
          </div>
          <div className={`bb-stat ${traceDanger ? 'bb-stat--danger' : ''}`}>
            <div className="bb-stat-label">TRACE LVL</div>
            <div className="bb-stat-value">{progress.traceLevel}</div>
          </div>
          <div className="bb-stat">
            <div className="bb-stat-label">SCORE</div>
            <div className="bb-stat-value">{progress.score}</div>
          </div>
        </section>

        <div className="bb-progress-bar" aria-hidden="true">
          <div className="bb-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>

        {error && (
          <div className="bb-feedback bb-feedback--error" role="alert">{error}</div>
        )}

        {feedback && !progress.completed && (
          <div
            className={`bb-feedback ${feedback.correct ? 'bb-feedback--correct' : 'bb-feedback--incorrect'}`}
            aria-live="polite"
          >
            {feedback.message}
          </div>
        )}

        {!identityReady && (
          <div className="bb-loading">Connecting to mission console...</div>
        )}

        {identityReady && progress.completed && (
          <section className="bb-mission-complete" aria-label="Mission complete">
            <div className="bb-mission-complete-header">
              <div className="bb-mission-complete-title">ROGUE PROCESS CONTAINED</div>
              <div className="bb-mission-complete-sub">MISSION STATUS: SUCCESS</div>
            </div>
            <div className="bb-mission-complete-body">
              <div className="bb-mission-stats">
                <div className="bb-stat bb-stat--accent">
                  <div className="bb-stat-label">SYSTEMS RESTORED</div>
                  <div className="bb-stat-value">{progress.systemsRestored}</div>
                </div>
                <div className="bb-stat">
                  <div className="bb-stat-label">ACCURACY</div>
                  <div className="bb-stat-value">{accuracy}%</div>
                </div>
                <div className="bb-stat bb-stat--success">
                  <div className="bb-stat-label">BEST STREAK</div>
                  <div className="bb-stat-value">{progress.bestStreak}</div>
                </div>
                <div className="bb-stat">
                  <div className="bb-stat-label">HINTS USED</div>
                  <div className="bb-stat-value">{progress.hintsUsed}</div>
                </div>
                <div className={`bb-stat ${traceDanger ? 'bb-stat--danger' : ''}`}>
                  <div className="bb-stat-label">TRACE LEVEL</div>
                  <div className="bb-stat-value">{progress.traceLevel}</div>
                </div>
                <div className="bb-stat bb-stat--accent">
                  <div className="bb-stat-label">FINAL SCORE</div>
                  <div className="bb-stat-value">{progress.score}</div>
                </div>
              </div>
            </div>
          </section>
        )}

        {identityReady && challenge && !progress.completed && (
          <form className="bb-terminal" onSubmit={submitAnswer} noValidate>
            <div className="bb-terminal-titlebar">
              <span className="bb-terminal-sys">{challenge.systemName}</span>
              <span className="bb-terminal-locked">STATUS: LOCKED</span>
            </div>
            <div className="bb-terminal-body">
              <div className="bb-prompt">INCOMING TRANSMISSION</div>
              <div className="bb-challenge-text">{challenge.prompt}</div>

              {challenge.type === 'binary-to-decimal' && (
                <>
                  <BitCells value={challenge.binary} />
                  <PlaceValueChart bits={challenge.maxBits} value={challenge.binary} />
                </>
              )}

              {challenge.type === 'decimal-to-binary' && (
                <>
                  <div className="bb-decimal-display">
                    <span className="bb-decimal-label">PACKET VALUE</span>
                    <span className="bb-decimal-value" aria-label={`Decimal value: ${challenge.decimal}`}>
                      {challenge.decimal}
                    </span>
                  </div>
                  <PlaceValueChart bits={challenge.maxBits} value={textAnswer} />
                </>
              )}

              {(challenge.type === 'binary-to-decimal' || challenge.type === 'decimal-to-binary') && (
                <div className="bb-input-block">
                  <label htmlFor="bb-answer-input">
                    <span className="bb-input-label">
                      {challenge.type === 'binary-to-decimal' ? 'DECIMAL ACCESS CODE' : 'BINARY UPLOAD CODE'}
                    </span>
                  </label>
                  <input
                    id="bb-answer-input"
                    className="bb-input"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={challenge.type === 'binary-to-decimal' ? 'e.g. 45' : 'e.g. 101101'}
                    value={textAnswer}
                    onChange={(event) => setTextAnswer(event.target.value)}
                    aria-describedby="bb-answer-hint"
                  />
                  <span id="bb-answer-hint" className="bb-input-hint">
                    {challenge.type === 'binary-to-decimal'
                      ? 'Enter the decimal equivalent.'
                      : 'Enter only 0s and 1s.'}
                  </span>
                </div>
              )}

              {challenge.type === 'compare-binary' && (
                <>
                  <PlaceValueChart bits={challenge.maxBits} />
                  <div
                    className="bb-compare-grid"
                    role="group"
                    aria-label={`Choose the ${challenge.target} signal`}
                  >
                    <button
                      type="button"
                      className="bb-signal-panel"
                      aria-pressed={choiceAnswer === 'left'}
                      onClick={() => setChoiceAnswer('left')}
                    >
                      <div className="bb-signal-id">SIGNAL A</div>
                      <SignalBits value={challenge.left} />
                    </button>
                    <button
                      type="button"
                      className="bb-signal-panel"
                      aria-pressed={choiceAnswer === 'right'}
                      onClick={() => setChoiceAnswer('right')}
                    >
                      <div className="bb-signal-id">SIGNAL B</div>
                      <SignalBits value={challenge.right} />
                    </button>
                  </div>
                </>
              )}

              {challenge.type === 'order-binary' && (
                <>
                  <PlaceValueChart bits={challenge.maxBits} />
                  <div
                    className="bb-order-list"
                    aria-label="Binary values in selected order"
                  >
                    {orderAnswer.map((value, index) => (
                      <div
                        key={value}
                        className={[
                          'bb-order-item',
                          dragIndex === index ? 'bb-order-item--dragging' : '',
                          dragOverIndex === index && dragIndex !== index ? 'bb-order-item--drag-over' : '',
                        ].join(' ').trim()}
                        draggable
                        onDragStart={() => handleDragStart(index)}
                        onDragOver={(event) => handleDragOver(event, index)}
                        onDrop={(event) => handleDrop(event, index)}
                        onDragEnd={handleDragEnd}
                      >
                        <span className="bb-drag-handle" aria-hidden="true">⠿</span>
                        <span className="bb-order-pos" aria-hidden="true">[{index + 1}]</span>
                        <span className="bb-order-value">{value}</span>
                        <div className="bb-order-controls">
                          <button
                            type="button"
                            className="bb-btn bb-btn--icon bb-btn--secondary"
                            disabled={index === 0}
                            aria-label={`Move ${value} up`}
                            onClick={() => setOrderAnswer((current) => moveValue(current, index, -1))}
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            className="bb-btn bb-btn--icon bb-btn--secondary"
                            disabled={index === orderAnswer.length - 1}
                            aria-label={`Move ${value} down`}
                            onClick={() => setOrderAnswer((current) => moveValue(current, index, 1))}
                          >
                            ▼
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {hint != null && (
                <div className="bb-feedback bb-feedback--hint" aria-live="polite">
                  {hint}
                </div>
              )}

              <div className="bb-action-row">
                <button
                  className="bb-btn bb-btn--primary"
                  type="submit"
                  disabled={!canSubmit || submitting}
                >
                  {submitting ? 'TRANSMITTING...' : 'SUBMIT OVERRIDE'}
                </button>
                <button
                  className="bb-btn bb-btn--secondary"
                  type="button"
                  onClick={requestHint}
                  disabled={challenge == null}
                >
                  REQUEST HINT
                </button>
              </div>
            </div>
          </form>
        )}
      </main>
    </div>
  )
}
