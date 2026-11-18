import { useEffect, useState } from 'react'
import {
  persistSessionParticipantIdentity,
  resolveInitialEntryParticipantIdentity,
} from '@src/components/common/entryParticipantIdentityUtils'
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler'
import { useStudentSession } from '../hooks/useCommissionedIdeasSession'
import RegistrationForm from './RegistrationForm'
import PresentationView from './PresentationView'
import ResultsView from './ResultsView'
import { useParticipantApi } from './useParticipantApi'
import VotingBallot from './VotingBallot'
import StudentRoster from './StudentRoster'
import {
  clearParticipantToken,
  lateArrivalNotice,
  readParticipantToken,
  saveParticipantToken,
} from './studentIdentity'

interface SessionData {
  sessionId?: string
  data?: Record<string, unknown>
}

const REFUSED_CREDENTIAL_NOTICE = 'We couldn’t restore your earlier sign-in for this session. Join again to continue.'
const STORAGE_WARNING = 'Your browser didn’t let us save your sign-in. If you reload this page you will need to join again.'

export default function CommissionedIdeasStudent({ sessionData }: { sessionData: SessionData }) {
  const sessionId = sessionData?.sessionId ?? null
  if (!sessionId) {
    return <div className="p-6 text-gray-500" role="status">Loading session…</div>
  }
  // Keyed so each session gets its own identity state and stored-identity lookup:
  // switching sessions in place must never reuse another session's participant or token.
  return <StudentSessionView key={sessionId} sessionId={sessionId} />
}

function StudentSessionView({ sessionId }: { sessionId: string }) {
  const attachSessionEndedHandler = useSessionEndedHandler()

  // ── Identity state ──────────────────────────────────────────────────────────
  const [studentName, setStudentName] = useState('')
  const [studentId, setStudentId] = useState<string | null>(null)
  const [participantToken, setParticipantToken] = useState<string | null>(null)
  const [nameSubmitted, setNameSubmitted] = useState(false)
  const [registered, setRegistered] = useState(false)
  const [identityResolved, setIdentityResolved] = useState(false)
  const [registrationNotice, setRegistrationNotice] = useState<string | null>(null)
  const [storageWarning, setStorageWarning] = useState(false)

  // ── Resolve stored identity from localStorage (reconnect support) ───────────
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const identity = await resolveInitialEntryParticipantIdentity({
          activityName: 'commissioned-ideas',
          sessionId,
          isSoloSession: false,
          localStorage: window.localStorage,
          sessionStorage: window.sessionStorage,
        })
        if (cancelled) return
        setStudentName(identity.studentName)
        setStudentId(identity.studentId)
        setNameSubmitted(identity.nameSubmitted)
        // A stored token restores the joined view; the socket then proves it.
        // Without a token the form re-appears with the name pre-filled. A saved
        // participant ID alone proves nothing, so submitting the form registers
        // a new participant; it does not restore the old token or team.
        if (identity.studentId) {
          const stored = readParticipantToken(window.localStorage, sessionId)
          if (stored) {
            setParticipantToken(stored)
            setRegistered(true)
          }
        }
      } catch {
        // non-fatal — fall through to RegistrationForm
      } finally {
        if (!cancelled) setIdentityResolved(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [sessionId])

  // ── WS connection (only after registered) ───────────────────────────────────
  const { snapshot, authRefused, connect, disconnect } = useStudentSession({
    sessionId: registered ? sessionId : null,
    participantId: studentId,
    participantToken,
    attachSessionEndedHandler,
  })

  useEffect(() => {
    if (!registered) return
    connect()
    return () => disconnect()
  }, [registered, connect, disconnect])

  // The server explicitly refused the stored credential (not a transient failure):
  // drop it and offer the registration form again, with the name pre-filled.
  useEffect(() => {
    if (!authRefused) return
    clearParticipantToken(window.localStorage, sessionId)
    setParticipantToken(null)
    setRegistered(false)
    setRegistrationNotice(REFUSED_CREDENTIAL_NOTICE)
  }, [authRefused, sessionId])

  const ballotApi = useParticipantApi(sessionId, studentId ?? '', participantToken ?? '')

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleRegistered = (participantId: string, name: string, token: string) => {
    setStudentId(participantId)
    setStudentName(name)
    setParticipantToken(token)
    setNameSubmitted(true)
    setRegistered(true)
    setRegistrationNotice(null)
    // Registration already succeeded; a storage failure only loses reload recovery.
    persistSessionParticipantIdentity(window.localStorage, sessionId, name, participantId)
    setStorageWarning(!saveParticipantToken(window.localStorage, sessionId, token))
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!identityResolved) {
    return <div className="p-6 text-gray-500" role="status">Loading…</div>
  }

  if (!nameSubmitted || !registered) {
    return (
      <RegistrationForm
        sessionId={sessionId}
        initialName={studentName}
        initialParticipantId={studentId}
        initialToken={participantToken}
        notice={registrationNotice}
        onRegistered={handleRegistered}
      />
    )
  }

  const phase = snapshot?.phase ?? null
  const participants = snapshot?.participantRoster ?? {}
  const teams = snapshot?.teams ?? {}
  const myTeamId = studentId ? (participants[studentId]?.teamId ?? null) : null
  const notice = snapshot && phase && myTeamId === null ? lateArrivalNotice(phase) : null

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-xl font-bold text-gray-800">Commissioned Ideas</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Joined as <span className="font-medium text-amber-700">{studentName}</span>
        </p>
      </div>

      <div className="max-w-2xl mx-auto">
        {storageWarning && (
          <p role="alert" data-testid="ci-storage-warning" className="mx-4 mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {STORAGE_WARNING}
          </p>
        )}

        {/* Team controls depend on the phase and locks; never guess them before the first snapshot. */}
        {!snapshot && (
          <p role="status" className="p-6 text-gray-500">Connecting…</p>
        )}

        {notice && (
          <p role="status" className="mx-4 mt-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
            {notice}
          </p>
        )}

        {snapshot && phase === 'registration' && (
          <StudentRoster
            participants={participants}
            teams={teams}
            myParticipantId={studentId ?? ''}
            participantToken={participantToken ?? ''}
            sessionId={sessionId}
            studentGroupingLocked={snapshot.studentGroupingLocked}
            namingLocked={snapshot.namingLocked}
            groupingMode={snapshot.groupingMode}
            maxTeamSize={snapshot.maxTeamSize}
          />
        )}

        {snapshot && phase === 'presentation' && (
          <PresentationView
            teams={teams}
            participants={participants}
            currentTeamId={snapshot.currentPresentationTeamId ?? null}
            round={snapshot.presentationRound}
            history={snapshot.presentationHistory}
            myTeamId={myTeamId}
          />
        )}

        {snapshot && phase === 'voting' && (
          <>
            {ballotApi.error && (
              <div role="alert" className="mx-4 mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-2">
                <span>{ballotApi.error}</span>
                <button type="button" onClick={ballotApi.clearError} aria-label="Dismiss error" className="text-red-400 hover:text-red-600">×</button>
              </div>
            )}
            <VotingBallot
              teams={teams}
              myTeamId={myTeamId}
              myBallot={snapshot.myBallot ?? null}
              busy={ballotApi.busy}
              onSubmit={(allocations) => ballotApi.post('ballot', { allocations })}
            />
          </>
        )}

        {snapshot && phase === 'results' && (
          <ResultsView
            teams={teams}
            podium={snapshot.podium ?? []}
            placeCount={snapshot.podiumPlaceCount ?? 0}
            step={snapshot.podiumRevealStep ?? 'hidden'}
            myTeamId={myTeamId}
          />
        )}
      </div>
    </div>
  )
}
