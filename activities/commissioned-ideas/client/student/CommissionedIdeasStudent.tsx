import { useEffect, useRef, useState } from 'react'
import {
  persistSessionParticipantIdentity,
  resolveInitialEntryParticipantIdentity,
} from '@src/components/common/entryParticipantIdentityUtils'
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler'
import { useStudentSession } from '../hooks/useCommissionedIdeasSession'
import RegistrationForm from './RegistrationForm'
import PresentationView from './PresentationView'
import { useParticipantApi } from './useParticipantApi'
import VotingBallot from './VotingBallot'
import StudentRoster from './StudentRoster'

interface SessionData {
  sessionId?: string
  data?: Record<string, unknown>
}

/** localStorage key for the activity-specific participant token. */
function tokenKey(sessionId: string): string {
  return `ci:${sessionId}:token`
}

export default function CommissionedIdeasStudent({ sessionData }: { sessionData: SessionData }) {
  const sessionId = sessionData?.sessionId ?? null
  const attachSessionEndedHandler = useSessionEndedHandler()
  const mountedRef = useRef(true)

  // ── Identity state ──────────────────────────────────────────────────────────
  const [studentName, setStudentName] = useState('')
  const [studentId, setStudentId] = useState<string | null>(null)
  const [participantToken, setParticipantToken] = useState<string | null>(null)
  const [nameSubmitted, setNameSubmitted] = useState(false)
  const [registered, setRegistered] = useState(false)
  const [identityResolved, setIdentityResolved] = useState(false)

  // ── Resolve stored identity from localStorage (reconnect support) ───────────
  useEffect(() => {
    if (!sessionId) return
    mountedRef.current = true

    void (async () => {
      try {
        const identity = await resolveInitialEntryParticipantIdentity({
          activityName: 'commissioned-ideas',
          sessionId,
          isSoloSession: false,
          localStorage: window.localStorage,
          sessionStorage: window.sessionStorage,
        })
        if (!mountedRef.current) return
        setStudentName(identity.studentName)
        setStudentId(identity.studentId)
        setNameSubmitted(identity.nameSubmitted)
        // Restore the participant token so team actions remain authenticated.
        // If the token is absent (cleared storage, new device), leave registered=false
        // so the form re-appears with the pre-filled name. Submitting it calls
        // register-participant with the stored participantId, which returns the same
        // token from the server and restores full team-action capability.
        if (identity.studentId) {
          const stored = window.localStorage.getItem(tokenKey(sessionId))
          if (stored) {
            setParticipantToken(stored)
            setRegistered(true)
          }
        }
      } catch {
        // non-fatal — fall through to RegistrationForm
      } finally {
        if (mountedRef.current) setIdentityResolved(true)
      }
    })()

    return () => {
      mountedRef.current = false
    }
  }, [sessionId])

  // ── WS connection (only after registered) ───────────────────────────────────
  const { snapshot, connect, disconnect } = useStudentSession({
    sessionId: registered ? sessionId : null,
    participantId: studentId,
    attachSessionEndedHandler,
  })

  useEffect(() => {
    if (!registered || !sessionId) return
    connect()
    return () => disconnect()
  }, [registered, sessionId, connect, disconnect])

  const ballotApi = useParticipantApi(sessionId ?? '', studentId ?? '', participantToken ?? '')

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleRegistered = (participantId: string, name: string, token: string) => {
    setStudentId(participantId)
    setStudentName(name)
    setParticipantToken(token)
    setNameSubmitted(true)
    setRegistered(true)
    if (sessionId) {
      persistSessionParticipantIdentity(window.localStorage, sessionId, name, participantId)
      window.localStorage.setItem(tokenKey(sessionId), token)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!sessionId) {
    return <div className="p-6 text-gray-500">Loading session…</div>
  }

  if (!identityResolved) {
    return <div className="p-6 text-gray-500">Loading…</div>
  }

  if (!nameSubmitted || !registered) {
    return (
      <RegistrationForm
        sessionId={sessionId}
        initialName={studentName}
        initialParticipantId={studentId}
        onRegistered={handleRegistered}
      />
    )
  }

  const phase = snapshot?.phase ?? 'registration'
  const participants = snapshot?.participantRoster ?? {}
  const teams = snapshot?.teams ?? {}
  const studentGroupingLocked = snapshot?.studentGroupingLocked ?? false
  const groupingMode = snapshot?.groupingMode ?? 'manual'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-xl font-bold text-gray-800">Commissioned Ideas</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Joined as <span className="font-medium text-amber-700">{studentName}</span>
        </p>
      </div>

      <div className="max-w-2xl mx-auto">
        {phase === 'registration' && (
          <StudentRoster
            participants={participants}
            teams={teams}
            myParticipantId={studentId ?? ''}
            participantToken={participantToken ?? ''}
            sessionId={sessionId}
            studentGroupingLocked={studentGroupingLocked}
            namingLocked={snapshot?.namingLocked ?? false}
            groupingMode={groupingMode}
            maxTeamSize={snapshot?.maxTeamSize ?? 4}
          />
        )}

        {phase === 'presentation' && (
          <PresentationView
            teams={teams}
            participants={participants}
            currentTeamId={snapshot?.currentPresentationTeamId ?? null}
            round={snapshot?.presentationRound ?? 1}
            history={snapshot?.presentationHistory ?? []}
            myTeamId={studentId ? (participants[studentId]?.teamId ?? null) : null}
          />
        )}

        {phase === 'voting' && (
          <>
            {ballotApi.error && (
              <div role="alert" className="mx-4 mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-2">
                <span>{ballotApi.error}</span>
                <button type="button" onClick={ballotApi.clearError} aria-label="Dismiss error" className="text-red-400 hover:text-red-600">×</button>
              </div>
            )}
            <VotingBallot
              teams={teams}
              myTeamId={studentId ? (participants[studentId]?.teamId ?? null) : null}
              myBallot={snapshot?.myBallot ?? null}
              busy={ballotApi.busy}
              onSubmit={(allocations) => ballotApi.post('ballot', { allocations })}
            />
          </>
        )}

        {phase === 'results' && (
          <div className="p-6 text-gray-600">
            <p className="font-medium">Results are being revealed — podium coming in Phase 7.</p>
          </div>
        )}
      </div>
    </div>
  )
}
