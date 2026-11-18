import { useEffect } from 'react'
import { useParams } from 'react-router'
import SessionHeader from '@src/components/common/SessionHeader'
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler'
import { useManagerSession } from '../hooks/useCommissionedIdeasSession.js'
import LateArrivalsPanel from './LateArrivalsPanel.js'
import PhaseControls from './PhaseControls.js'
import PresentationDashboard from './PresentationDashboard.js'
import RegistrationDashboard from './RegistrationDashboard.js'
import ResultsDashboard from './ResultsDashboard.js'
import VotingDashboard from './VotingDashboard.js'
import { useCommissionedIdeasInstructorPasscode } from './useInstructorPasscode.js'

export default function CommissionedIdeasManager() {
  const { sessionId } = useParams<{ sessionId?: string }>()
  const attachSessionEndedHandler = useSessionEndedHandler()
  const passcodeState = useCommissionedIdeasInstructorPasscode(sessionId)
  const instructorPasscode = passcodeState.passcode

  const { snapshot, authError, connect, disconnect } = useManagerSession({
    sessionId: sessionId ?? null,
    instructorPasscode,
    attachSessionEndedHandler,
  })

  useEffect(() => {
    if (!sessionId || !instructorPasscode) return
    connect()
    return () => disconnect()
  }, [sessionId, instructorPasscode, connect, disconnect])

  const phase = snapshot?.phase ?? 'registration'

  if (!sessionId) {
    return <div className="p-6 text-gray-500">No active session.</div>
  }

  if (passcodeState.status === 'loading') {
    return <div className="p-6 text-gray-400" role="status">Checking instructor access…</div>
  }

  if (passcodeState.status === 'retryable') {
    return (
      <div className="p-6 space-y-3" role="alert">
        <p className="text-gray-700">Checking instructor access took too long. Your access may already be restored.</p>
        <button
          type="button"
          onClick={passcodeState.retry}
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
        >
          Retry
        </button>
      </div>
    )
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
      />

      <div className="max-w-3xl mx-auto px-4 py-6">
        {!snapshot && authError && (
          <p role="alert" className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {authError}. Re-open this session from the dashboard or with Teacher Join.
          </p>
        )}
        {!snapshot && !authError && <p className="text-gray-400" role="status">Connecting…</p>}

        {snapshot && (
          <div className="mb-6">
            <PhaseControls sessionId={sessionId} instructorPasscode={instructorPasscode} snapshot={snapshot} />
          </div>
        )}

        {snapshot && phase !== 'registration' && (
          <div className="mb-6 empty:hidden">
            <LateArrivalsPanel sessionId={sessionId} instructorPasscode={instructorPasscode} snapshot={snapshot} />
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
          <ResultsDashboard sessionId={sessionId} instructorPasscode={instructorPasscode} snapshot={snapshot} />
        )}
      </div>
    </div>
  )
}
