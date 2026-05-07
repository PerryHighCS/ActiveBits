import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
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

  const accuracy = progress.attempts === 0 ? 100 : Math.round((progress.correct / progress.attempts) * 100)

  const resetAnswerState = useCallback((nextChallenge: BinaryBreachChallenge | null) => {
    setTextAnswer('')
    setChoiceAnswer(null)
    setOrderAnswer(nextChallenge?.type === 'order-binary' ? nextChallenge.values : [])
    setHint(null)
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
        const nextProgress = applyAnswerResult(progress, localFeedback.correct, DEFAULT_BINARY_BREACH_SETTINGS.missionLength)
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

  return (
    <div className="binary-breach-shell">
      <main className="binary-breach-page">
        <div className="mb-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-cyan-800">Binary Breach</p>
          <h1 className="text-3xl font-bold">System Override</h1>
          <p className="text-gray-600">Technician: {studentName || 'Connecting...'}</p>
        </div>

        <section className="binary-breach-grid mb-5" aria-label="Mission stats">
          <div className="binary-breach-stat"><span>Systems Restored</span><strong>{progress.systemsRestored}</strong></div>
          <div className="binary-breach-stat"><span>Accuracy</span><strong>{accuracy}%</strong></div>
          <div className="binary-breach-stat"><span>Streak</span><strong>{progress.streak}</strong></div>
          <div className="binary-breach-stat"><span>Trace Level</span><strong>{progress.traceLevel}</strong></div>
          <div className="binary-breach-stat"><span>Score</span><strong>{progress.score}</strong></div>
        </section>

        {error && <div className="binary-breach-feedback incorrect mb-4" role="alert">{error}</div>}
        {feedback && (
          <div className={`binary-breach-feedback ${feedback.correct ? 'correct' : 'incorrect'} mb-4`} aria-live="polite">
            {feedback.message}
          </div>
        )}

        {!identityReady && <div className="binary-breach-card">Connecting to mission console...</div>}

        {identityReady && progress.completed && (
          <section className="binary-breach-panel p-6">
            <h2 className="text-2xl font-bold mb-3">Rogue process contained</h2>
            <p className="mb-4">You restored {progress.systemsRestored} systems with {accuracy}% accuracy.</p>
            <div className="binary-breach-grid">
              <div className="binary-breach-stat"><span>Best Streak</span><strong>{progress.bestStreak}</strong></div>
              <div className="binary-breach-stat"><span>Hints Used</span><strong>{progress.hintsUsed}</strong></div>
              <div className="binary-breach-stat"><span>Final Score</span><strong>{progress.score}</strong></div>
            </div>
          </section>
        )}

        {identityReady && challenge && !progress.completed && (
          <form className="binary-breach-panel p-6" onSubmit={submitAnswer}>
            <div className="mb-4">
              <p className="text-sm font-semibold uppercase tracking-wide text-cyan-800">{challenge.systemName}</p>
              <h2 className="text-2xl font-bold">{challenge.prompt}</h2>
            </div>

            <div className="mb-5">
              <PlaceValueChart bits={challenge.maxBits} />
            </div>

            {(challenge.type === 'binary-to-decimal' || challenge.type === 'decimal-to-binary') && (
              <label className="block mb-5">
                <span className="block mb-2 font-semibold">
                  {challenge.type === 'binary-to-decimal' ? 'Decimal access code' : 'Binary upload code'}
                </span>
                <input
                  className="binary-breach-input"
                  inputMode="numeric"
                  value={textAnswer}
                  onChange={(event) => setTextAnswer(event.target.value)}
                  aria-describedby="binary-breach-answer-help"
                />
                <span id="binary-breach-answer-help" className="text-sm text-gray-600">
                  {challenge.type === 'binary-to-decimal' ? 'Enter digits like 45.' : 'Enter only 0s and 1s.'}
                </span>
              </label>
            )}

            {challenge.type === 'compare-binary' && (
              <div className="grid gap-3 md:grid-cols-2 mb-5" role="group" aria-label={`Choose the ${challenge.target} signal`}>
                <button type="button" className="binary-breach-choice" aria-pressed={choiceAnswer === 'left'} onClick={() => setChoiceAnswer('left')}>
                  {challenge.left}
                </button>
                <button type="button" className="binary-breach-choice" aria-pressed={choiceAnswer === 'right'} onClick={() => setChoiceAnswer('right')}>
                  {challenge.right}
                </button>
              </div>
            )}

            {challenge.type === 'order-binary' && (
              <div className="space-y-2 mb-5" aria-label="Binary values in selected order">
                {orderAnswer.map((value, index) => (
                  <div className="binary-breach-order-row" key={value}>
                    <span className="font-mono text-lg">{value}</span>
                    <button type="button" className="binary-breach-button secondary" disabled={index === 0} aria-label={`Move ${value} up`} onClick={() => setOrderAnswer((current) => moveValue(current, index, -1))}>
                      Up
                    </button>
                    <button type="button" className="binary-breach-button secondary" disabled={index === orderAnswer.length - 1} aria-label={`Move ${value} down`} onClick={() => setOrderAnswer((current) => moveValue(current, index, 1))}>
                      Down
                    </button>
                  </div>
                ))}
              </div>
            )}

            {hint != null && <div className="binary-breach-feedback correct mb-4" aria-live="polite">{hint}</div>}

            <div className="flex flex-wrap gap-3">
              <button className="binary-breach-button" type="submit" disabled={!canSubmit || submitting}>
                {submitting ? 'Transmitting...' : 'Submit Override'}
              </button>
              <button className="binary-breach-button secondary" type="button" onClick={requestHint} disabled={challenge == null}>
                Request Hint
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  )
}
