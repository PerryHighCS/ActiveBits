import { useParams, useNavigate } from 'react-router-dom'
import SessionHeader from '@src/components/common/SessionHeader'

export default function CommissionedIdeasManager() {
  const { sessionId } = useParams<{ sessionId?: string }>()
  const navigate = useNavigate()

  const handleEndSession = async () => {
    if (sessionId) {
      await fetch(`/api/session/${sessionId}`, { method: 'DELETE' })
    }
    void navigate('/manage')
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <SessionHeader
        activityName="Commissioned Ideas"
        sessionId={sessionId ?? ''}
        onEndSession={() => { void handleEndSession() }}
      />
      <div className="mt-8 text-center text-gray-500">
        <p>Commissioned Ideas — manager view coming in Phase 2+</p>
        {sessionId && (
          <p className="mt-2 text-sm font-mono text-gray-400">Session: {sessionId}</p>
        )}
      </div>
    </div>
  )
}
