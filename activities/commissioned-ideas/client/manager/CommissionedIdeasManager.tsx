import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import SessionHeader from '@src/components/common/SessionHeader'
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler'
import { consumeCreateSessionBootstrapPayload } from '@src/components/common/manageDashboardUtils'
import { useManagerSession } from '../hooks/useCommissionedIdeasSession.js'
import RegistrationDashboard from './RegistrationDashboard.js'

function resolvePasscode(sessionId: string): string | null {
  const bootstrap = consumeCreateSessionBootstrapPayload('commissioned-ideas', sessionId)
  if (bootstrap !== null && typeof bootstrap.instructorPasscode === 'string' && bootstrap.instructorPasscode.length > 0) {
    return bootstrap.instructorPasscode
  }

  return null
}

export default function CommissionedIdeasManager() {
  const { sessionId } = useParams<{ sessionId?: string }>()
  const navigate = useNavigate()
  const attachSessionEndedHandler = useSessionEndedHandler()

  const [instructorPasscode, setInstructorPasscode] = useState<string | null>(null)
  const [passcodeResolved, setPasscodeResolved] = useState(false)

  useEffect(() => {
    if (!sessionId) return
    const passcode = resolvePasscode(sessionId)
    setInstructorPasscode(passcode)
    setPasscodeResolved(true)
  }, [sessionId])

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

  if (!passcodeResolved) {
    return <div className="p-6 text-gray-400">Loading…</div>
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

        {snapshot && phase === 'registration' && (
          <RegistrationDashboard
            sessionId={sessionId}
            instructorPasscode={instructorPasscode}
            snapshot={snapshot}
          />
        )}

        {snapshot && phase === 'presentation' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-gray-600">
            <p className="font-medium">Presentation phase — controls coming in Phase 4.</p>
          </div>
        )}

        {snapshot && phase === 'voting' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-gray-600">
            <p className="font-medium">Voting phase — ballot controls coming in Phase 5.</p>
          </div>
        )}

        {snapshot && phase === 'results' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-gray-600">
            <p className="font-medium">Results phase — podium reveal coming in Phase 6.</p>
          </div>
        )}
      </div>
    </div>
  )
}
