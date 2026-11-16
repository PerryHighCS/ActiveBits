import { useEffect, useMemo } from 'react'
import { useLocation, useParams, useNavigate } from 'react-router'
import SessionHeader from '@src/components/common/SessionHeader'
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler'
import { useManagerSession } from '../hooks/useCommissionedIdeasSession.js'
import PhaseControls from './PhaseControls.js'
import PresentationDashboard from './PresentationDashboard.js'
import RegistrationDashboard from './RegistrationDashboard.js'
import VotingDashboard from './VotingDashboard.js'
import { resolveCommissionedIdeasInstructorPasscode } from './passcode.js'

export default function CommissionedIdeasManager() {
  const { sessionId } = useParams<{ sessionId?: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const attachSessionEndedHandler = useSessionEndedHandler()
  const instructorPasscode = useMemo(
    () => resolveCommissionedIdeasInstructorPasscode({ sessionId, locationState: location.state }),
    [sessionId, location.state],
  )

  const { snapshot, connect, disconnect } = useManagerSession({
    sessionId: sessionId ?? null,
    instructorPasscode,
    attachSessionEndedHandler,
  })

  useEffect(() => {
    if (!sessionId || !instructorPasscode) return
    connect()
    return () => disconnect()
  }, [sessionId, instructorPasscode, connect, disconnect])

  const handleEndSession = async () => {
    if (sessionId) {
      await fetch(`/api/session/${sessionId}`, { method: 'DELETE' })
    }
    void navigate('/manage')
  }

  const phase = snapshot?.phase ?? 'registration'

  if (!sessionId) {
    return <div className="p-6 text-gray-500">No active session.</div>
  }

  if (!instructorPasscode) {
    return (
      <div className="p-6 text-gray-500">
        Instructor passcode not found. Re-open from the session creation link.
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SessionHeader
        activityName="Commissioned Ideas"
        sessionId={sessionId}
        onEndSession={() => { void handleEndSession() }}
      />

      <div className="max-w-3xl mx-auto px-4 py-6">
        {!snapshot && <p className="text-gray-400">Connecting…</p>}

        {snapshot && (
          <div className="mb-6">
            <PhaseControls sessionId={sessionId} instructorPasscode={instructorPasscode} snapshot={snapshot} />
          </div>
        )}

        {snapshot && phase === 'registration' && (
          <RegistrationDashboard
            sessionId={sessionId}
            instructorPasscode={instructorPasscode}
            snapshot={snapshot}
          />
        )}

        {snapshot && phase === 'presentation' && (
          <PresentationDashboard
            sessionId={sessionId}
            instructorPasscode={instructorPasscode}
            snapshot={snapshot}
          />
        )}

        {snapshot && phase === 'voting' && (
          <VotingDashboard snapshot={snapshot} />
        )}

        {snapshot && phase === 'results' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-gray-600">
            <p className="font-medium">Results phase — podium reveal coming in Phase 7.</p>
          </div>
        )}
      </div>
    </div>
  )
}
