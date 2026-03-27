import { useEffect, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

interface ManagedSessionRouteProps {
  children: ReactNode
}

const SESSION_STATUS_POLL_INTERVAL_MS = 5000

function isMissingSessionStatus(status: number): boolean {
  return status === 404 || status === 410
}

export default function ManagedSessionRoute({ children }: ManagedSessionRouteProps) {
  const navigate = useNavigate()
  const { sessionId } = useParams()

  useEffect(() => {
    if (!sessionId) {
      return undefined
    }

    let isCancelled = false

    const checkSession = async () => {
      try {
        const response = await fetch(`/api/session/${encodeURIComponent(sessionId)}`, {
          cache: 'no-store',
        })
        if (!response.ok && isMissingSessionStatus(response.status) && !isCancelled) {
          void navigate('/session-ended', { replace: true })
        }
      } catch {
        return
      }
    }

    void checkSession()
    const intervalId = window.setInterval(() => {
      void checkSession()
    }, SESSION_STATUS_POLL_INTERVAL_MS)

    return () => {
      isCancelled = true
      window.clearInterval(intervalId)
    }
  }, [navigate, sessionId])

  return <>{children}</>
}
