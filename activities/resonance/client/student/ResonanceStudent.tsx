import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  persistSessionParticipantIdentity,
  resolveInitialEntryParticipantIdentity,
} from '@src/components/common/entryParticipantIdentityUtils'
import { useResonanceSession } from '../hooks/useResonanceSession.js'
import NameEntryForm from './NameEntryForm.js'
import QuestionView from './QuestionView.js'
import SharedResponseFeed from './SharedResponseFeed.js'
import type { AnswerPayload } from '../../shared/types.js'

interface RegisterResponse {
  studentId?: string
  name?: string
  error?: string
}

interface SubmissionAnnouncement {
  id: number
  message: string
}

export function resolveNextSelfPacedQuestionId(params: {
  questionIds: string[]
  submittedQuestionIds: Set<string>
  currentQuestionId: string | null
}): string | null {
  const { questionIds, submittedQuestionIds, currentQuestionId } = params
  if (questionIds.length === 0) {
    return null
  }

  const currentIndex = currentQuestionId ? questionIds.indexOf(currentQuestionId) : -1
  const orderedCandidates = currentIndex >= 0
    ? [...questionIds.slice(currentIndex + 1), ...questionIds.slice(0, currentIndex + 1)]
    : questionIds

  const nextUnsubmitted = orderedCandidates.find((questionId) => !submittedQuestionIds.has(questionId))
  if (nextUnsubmitted) {
    return nextUnsubmitted
  }

  return currentIndex >= 0 ? currentQuestionId : questionIds[0] ?? null
}

export function resolveSelfPacedSubmittedMessage(params: {
  questionIds: string[]
  submittedQuestionIds: Set<string>
  currentQuestionId: string | null
}): string {
  const nextQuestionId = resolveNextSelfPacedQuestionId(params)
  const hasUnsubmittedQuestion = params.questionIds.some((questionId) => !params.submittedQuestionIds.has(questionId))

  if (!hasUnsubmittedQuestion) {
    return 'All questions completed.'
  }

  return nextQuestionId !== params.currentQuestionId
    ? 'Answer submitted. Moving to the next question.'
    : 'Answer submitted.'
}

export function resolveSubmissionAnnouncement(params: {
  selfPacedMode: boolean
  questionIds: string[]
  submittedQuestionIds: Set<string>
  currentQuestionId: string | null
}): string {
  return params.selfPacedMode
    ? resolveSelfPacedSubmittedMessage(params)
    : 'Answer submitted.'
}

function formatRemainingTime(deadlineAt: number | null, now: number): string | null {
  if (deadlineAt === null) {
    return null
  }

  const remainingMs = Math.max(0, deadlineAt - now)
  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/**
 * Main student-facing view for Resonance.
 *
 * Identity flow:
 * 1. Resolve identity from the platform waiting room (displayName field).
 * 2. If no name was collected (e.g. direct URL access), show NameEntryForm.
 * 3. Register with POST /api/resonance/:sessionId/register-student.
 * 4. Poll session state and show the active question + shared reveals.
 */
export default function ResonanceStudent() {
  const { sessionId } = useParams<{ sessionId?: string }>()

  const [identityResolved, setIdentityResolved] = useState(false)
  const [studentName, setStudentName] = useState<string | null>(null)
  const [studentId, setStudentId] = useState<string | null>(null)
  const [nameSubmitted, setNameSubmitted] = useState(false)
  const [registered, setRegistered] = useState(false)
  const [registerError, setRegisterError] = useState<string | null>(null)
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null)
  const [submittedQuestionIds, setSubmittedQuestionIds] = useState<Set<string>>(new Set())
  const [submittedAnswers, setSubmittedAnswers] = useState<Record<string, AnswerPayload>>({})
  const [submissionAnnouncement, setSubmissionAnnouncement] = useState<SubmissionAnnouncement | null>(null)
  const [countdownNow, setCountdownNow] = useState(() => Date.now())

  const mountedRef = useRef(true)
  const previousActiveQuestionIdsRef = useRef<string[]>([])
  const previousActiveQuestionRunStartedAtRef = useRef<number | null>(null)

  // Step 1: resolve entry participant identity from the waiting room.
  useEffect(() => {
    if (!sessionId) return
    mountedRef.current = true

    void (async () => {
      try {
        const identity = await resolveInitialEntryParticipantIdentity({
          activityName: 'resonance',
          sessionId,
          isSoloSession: false,
          localStorage: window.localStorage,
          sessionStorage: window.sessionStorage,
        })
        if (!mountedRef.current) return

        setStudentName(identity.studentName)
        setStudentId(identity.studentId)
        setNameSubmitted(identity.nameSubmitted)
      } catch {
        // Identity resolution failing is non-fatal; fall through to NameEntryForm.
      } finally {
        if (mountedRef.current) setIdentityResolved(true)
      }
    })()

    return () => {
      mountedRef.current = false
    }
  }, [sessionId])

  // Step 2: once we have a name and studentId, register with the session server.
  useEffect(() => {
    if (!sessionId || !nameSubmitted || registered || studentName === null) return

    void (async () => {
      try {
        const resp = await fetch(`/api/resonance/${sessionId}/register-student`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: studentName, studentId }),
        })

        const data = (await resp.json()) as RegisterResponse
        if (!mountedRef.current) return

        if (!resp.ok || !data.studentId) {
          setRegisterError(data.error ?? 'Failed to join session')
          return
        }

        // Use the server-assigned studentId (may differ if there was a conflict).
        setStudentId(data.studentId)
        persistSessionParticipantIdentity(
          window.localStorage,
          sessionId,
          studentName,
          data.studentId,
        )
        setRegistered(true)
      } catch {
        if (mountedRef.current) setRegisterError('Network error — could not join session')
      }
    })()
  }, [sessionId, nameSubmitted, registered, studentName, studentId])

  const { snapshot, loading: sessionLoading, error: sessionError, sendMessage } = useResonanceSession(
    registered && sessionId ? sessionId : null,
    studentId,
  )

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCountdownNow(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    if (snapshot === null) {
      return
    }

    setSubmittedAnswers((current) => ({
      ...snapshot.submittedAnswers,
      ...current,
    }))

    if (snapshot.selfPacedMode) {
      setSubmittedQuestionIds((current) => {
        const next = new Set(current)
        for (const questionId of Object.keys(snapshot.submittedAnswers)) {
          next.add(questionId)
        }
        return next
      })
      const availableIds = snapshot.activeQuestions.map((question) => question.id)
      previousActiveQuestionIdsRef.current = availableIds
      previousActiveQuestionRunStartedAtRef.current = snapshot.activeQuestionRunStartedAt

      if (availableIds.length === 0) {
        setSelectedQuestionId(null)
        return
      }

      setSelectedQuestionId((current) => (current && availableIds.includes(current) ? current : availableIds[0] ?? null))
      return
    }

    const activeRunStartedAt = snapshot.activeQuestionRunStartedAt
    const activeIds = snapshot.activeQuestions.map((question) => question.id)
    const previousActiveIds = previousActiveQuestionIdsRef.current
    const reactivatedIds = activeIds.filter((questionId) => !previousActiveIds.includes(questionId))
    const didRunRestart =
      activeIds.length > 0 &&
      activeRunStartedAt !== null &&
      previousActiveQuestionRunStartedAtRef.current !== null &&
      activeRunStartedAt !== previousActiveQuestionRunStartedAtRef.current

    if (reactivatedIds.length > 0 || didRunRestart) {
      setSubmittedQuestionIds((current) => {
        const next = new Set(current)
        for (const questionId of didRunRestart ? activeIds : reactivatedIds) {
          next.delete(questionId)
        }
        return next
      })
    }
    previousActiveQuestionIdsRef.current = activeIds
    previousActiveQuestionRunStartedAtRef.current = activeRunStartedAt

    if (activeIds.length === 0) {
      setSelectedQuestionId(null)
      return
    }

    setSelectedQuestionId((current) => (current && activeIds.includes(current) ? current : activeIds[0] ?? null))
  }, [snapshot])

  // Guard: no session
  if (!sessionId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <p className="text-gray-500">No active session.</p>
      </div>
    )
  }

  // Guard: identity not yet resolved
  if (!identityResolved) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <p className="text-gray-400 text-sm">Loading…</p>
      </div>
    )
  }

  // Guard: waiting for name entry (waiting room didn't collect one)
  if (!nameSubmitted) {
    return (
      <NameEntryForm
        sessionId={sessionId}
        onRegistered={(id, name) => {
          setStudentId(id)
          setStudentName(name)
          setNameSubmitted(true)
          setRegistered(true)
        }}
      />
    )
  }

  // Guard: registration in progress or failed
  if (!registered) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        {registerError !== null ? (
          <p className="text-red-600 text-sm">{registerError}</p>
        ) : (
          <p className="text-gray-400 text-sm">Joining session…</p>
        )}
      </div>
    )
  }

  // Main session view
  const activeQuestions = snapshot?.activeQuestions ?? []
  const activeQuestion = activeQuestions.find((question) => question.id === selectedQuestionId) ?? activeQuestions[0] ?? null
  const activeDeadlineAt = snapshot?.activeQuestionDeadlineAt ?? null
  const hasExpired = activeDeadlineAt !== null && activeDeadlineAt <= countdownNow
  const liveCountdown = formatRemainingTime(activeDeadlineAt, countdownNow)
  const submittedMessage = snapshot?.selfPacedMode && activeQuestion
    ? resolveSelfPacedSubmittedMessage({
      questionIds: activeQuestions.map((question) => question.id),
      submittedQuestionIds,
      currentQuestionId: activeQuestion.id,
    })
    : 'Answer submitted.'

  return (
    <div className="min-h-screen bg-gray-50">
      {submissionAnnouncement !== null && (
        <p key={submissionAnnouncement.id} className="sr-only" role="status" aria-live="polite">
          {submissionAnnouncement.message}
        </p>
      )}
      <div className="max-w-xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          {liveCountdown !== null && activeQuestions.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-right">
              <p className="text-[11px] uppercase tracking-wide text-amber-700">Time left</p>
              <p className="text-lg font-semibold text-amber-900">{liveCountdown}</p>
            </div>
          )}
        </header>

        {/* Session loading / error */}
        {sessionLoading && snapshot === null && (
          <p className="text-sm text-gray-400">Loading session…</p>
        )}
        {sessionError !== null && (
          <p className="text-sm text-red-500" role="alert">
            {sessionError}
          </p>
        )}

        {/* Active question(s) */}
        {snapshot !== null && activeQuestion !== null && studentId !== null && (
          <section aria-label="Current question" className="space-y-4">
            {activeQuestions.length > 1 && (
              <nav className="flex flex-wrap gap-2" aria-label="Active questions">
                {activeQuestions.map((question, index) => {
                  const isSelected = question.id === activeQuestion.id
                  const isSubmitted = submittedQuestionIds.has(question.id)
                  return (
                    <button
                      key={question.id}
                      type="button"
                      onClick={() => setSelectedQuestionId(question.id)}
                      className={`rounded-full border px-3 py-1.5 text-sm ${
                        isSelected
                          ? 'border-blue-400 bg-blue-50 text-blue-700'
                          : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                      aria-pressed={isSelected}
                    >
                      Q{index + 1}{isSubmitted ? ' Submitted' : ''}
                    </button>
                  )
                })}
              </nav>
            )}

            <QuestionView
              question={activeQuestion}
              sessionId={sessionId}
              studentId={studentId}
              initialAnswer={snapshot.submittedAnswers[activeQuestion.id] ?? submittedAnswers[activeQuestion.id] ?? null}
              disabled={hasExpired}
              isSubmitted={submittedQuestionIds.has(activeQuestion.id)}
              submittedMessage={submittedMessage}
              onSubmitted={(questionId, answer) => {
                setSubmittedAnswers((current) => ({
                  ...current,
                  [questionId]: answer,
                }))
                setSubmittedQuestionIds((current) => {
                  const nextSubmittedQuestionIds = new Set(current)
                  nextSubmittedQuestionIds.add(questionId)
                  setSubmissionAnnouncement((currentAnnouncement) => ({
                    id: (currentAnnouncement?.id ?? 0) + 1,
                    message: resolveSubmissionAnnouncement({
                      selfPacedMode: snapshot.selfPacedMode,
                      questionIds: activeQuestions.map((question) => question.id),
                      submittedQuestionIds: nextSubmittedQuestionIds,
                      currentQuestionId: questionId,
                    }),
                  }))
                  if (snapshot.selfPacedMode) {
                    setSelectedQuestionId((currentQuestionId) => resolveNextSelfPacedQuestionId({
                      questionIds: activeQuestions.map((question) => question.id),
                      submittedQuestionIds: nextSubmittedQuestionIds,
                      currentQuestionId: currentQuestionId ?? questionId,
                    }))
                  }
                  return nextSubmittedQuestionIds
                })
              }}
              sendMessage={sendMessage}
            />
          </section>
        )}

        {/* Waiting state */}
        {snapshot !== null && activeQuestions.length === 0 && snapshot.reveals.length === 0 && snapshot.reviewedResponses.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-8">
            Waiting for the instructor to activate a question…
          </p>
        )}

        {/* Shared responses / reveals / private feedback */}
        {snapshot !== null && (snapshot.reveals.length > 0 || snapshot.reviewedResponses.length > 0) && (
          <SharedResponseFeed
            reveals={snapshot.reveals}
            reviewedResponses={snapshot.reviewedResponses}
            revealedQuestions={snapshot.revealedQuestions}
            onReactToSharedResponse={(questionId, sharedResponseId, emoji) => {
              sendMessage('resonance:react-to-shared', {
                questionId,
                sharedResponseId,
                emoji,
              })
            }}
          />
        )}
      </div>
    </div>
  )
}
