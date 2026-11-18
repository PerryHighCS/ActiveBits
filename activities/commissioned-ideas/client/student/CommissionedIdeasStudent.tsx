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
import { lateArrivalNotice } from './studentIdentity'

interface SessionData {
  sessionId?: string
  data?: Record<string, unknown>
}

const REFUSED_CREDENTIAL_NOTICE = 'We couldn’t restore your earlier sign-in for this session. Join again to continue.'

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
  const [nameSubmitted, setNameSubmitted] = useState(false)
  const [registered, setRegistered] = useState(false)
  const [identityResolved, setIdentityResolved] = useState(false)
  const [registrationNotice, setRegistrationNotice] = useState<string | null>(null)

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
        // A stored participant ID means this browser joined before: connect, and
        // the socket proves identity with the httpOnly participant cookie. The ID
        // itself proves nothing; if the cookie is gone the server refuses and the
        // form re-appears with the name pre-filled.
        if (identity.studentId && identity.nameSubmitted) setRegistered(true)
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
  const { snapshot, authRefused, identityChanged, connect, disconnect } = useStudentSession({
    sessionId: registered ? sessionId : null,
    participantId: studentId,
    attachSessionEndedHandler,
  })

  useEffect(() => {
    if (!registered) return
    connect()
    return () => disconnect()
  }, [registered, connect, disconnect])

  // The server explicitly refused this browser's participant cookie (not a transient
  // failure): offer the registration form again, with the name pre-filled.
  useEffect(() => {
    if (!authRefused) return
    setRegistered(false)
    setRegistrationNotice(REFUSED_CREDENTIAL_NOTICE)
  }, [authRefused])

  // Bound identity for actions: the participant this tab is pinned to (its snapshot is
  // only rendered when the socket authenticated as that same participant).
  const ballotApi = useParticipantApi(sessionId, snapshot ? studentId : null)

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleRegistered = (participantId: string, name: string) => {
    setStudentId(participantId)
    setStudentName(name)
    setNameSubmitted(true)
    setRegistered(true)
    setRegistrationNotice(null)
    // Not secret: pre-fills the form and marks this browser as joined. Identity is
    // the httpOnly cookie, so losing this only means submitting the form again,
    // which reconnects the same participant while the cookie is valid.
    persistSessionParticipantIdentity(window.localStorage, sessionId, name, participantId)
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
        notice={registrationNotice}
        onRegistered={handleRegistered}
      />
    )
  }

  const phase = snapshot?.phase ?? null
  const participants = snapshot?.participantRoster ?? {}
  const teams = snapshot?.teams ?? {}
  // The server's view of who this socket is wins over the stored copy.
  const myId = snapshot?.viewerParticipantId ?? null
  const myName = (myId ? participants[myId]?.name : undefined) ?? studentName
  const myTeamId = myId ? (participants[myId]?.teamId ?? null) : null
  const notice = snapshot && phase && myTeamId === null ? lateArrivalNotice(phase) : null

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-xl font-bold text-gray-800">Commissioned Ideas</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Joined as <span className="font-medium text-amber-700">{myName}</span>
        </p>
      </div>

      <div className="max-w-2xl mx-auto">
        {identityChanged && (
          <div role="alert" data-testid="ci-identity-changed" className="mx-4 mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 space-y-2">
            <p>This browser is now signed in as a different student, probably from another tab. Reload this page to continue as that student.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md border border-amber-400 px-3 py-1 text-sm font-medium text-amber-900 hover:bg-amber-100"
            >
              Reload
            </button>
          </div>
        )}

        {/* Team controls depend on the phase and locks; never guess them before the first snapshot. */}
        {!snapshot && !identityChanged && (
          <p role="status" className="p-6 text-gray-500">Connecting…</p>
        )}

        {notice && (
          <p role="status" className="mx-4 mt-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
            {notice}
          </p>
        )}

        {snapshot && phase === 'registration' && (
          <StudentRoster
            // Request status and focus state belong to one participant.
            key={myId ?? ''}
            participants={participants}
            teams={teams}
            myParticipantId={myId ?? ''}
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
              // A different viewer gets a fresh draft; snapshots for the same viewer keep edits.
              key={myId ?? ''}
              teams={teams}
              myTeamId={myTeamId}
              myBallot={snapshot.myBallot ?? null}
              snapshotRevision={snapshot.revision}
              busy={ballotApi.busy}
              onSubmit={async (allocations) => {
                const data = await ballotApi.postForResult('ballot', { allocations })
                return data ? { replaced: data.replaced === true, revision: typeof data.revision === 'number' ? data.revision : 0 } : null
              }}
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
