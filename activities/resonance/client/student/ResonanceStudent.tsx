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

interface RegisterResponse {
  studentId?: string
  name?: string
  error?: string
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

  const mountedRef = useRef(true)

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

  const { snapshot, loading: sessionLoading, error: sessionError } = useResonanceSession(
    registered && sessionId ? sessionId : null,
    studentId,
  )

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
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">Resonance</h1>
          {studentName !== null && (
            <span className="text-sm text-gray-500">{studentName}</span>
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

        {/* Active question */}
        {snapshot !== null && snapshot.activeQuestion !== null && studentId !== null && (
          <section aria-label="Current question">
            <QuestionView
              key={snapshot.activeQuestion.id}
              question={snapshot.activeQuestion}
              sessionId={sessionId}
              studentId={studentId}
            />
          </section>
        )}

        {/* Waiting state */}
        {snapshot !== null && snapshot.activeQuestion === null && snapshot.reveals.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-8">
            Waiting for the instructor to activate a question…
          </p>
        )}

        {/* Shared responses / reveals */}
        {snapshot !== null && snapshot.reveals.length > 0 && (
          <SharedResponseFeed
            reveals={snapshot.reveals}
            revealedQuestions={snapshot.revealedQuestions}
          />
        )}
      </div>
    </div>
  )
}
