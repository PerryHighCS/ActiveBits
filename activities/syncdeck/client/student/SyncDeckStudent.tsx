import { useCallback, useEffect, useRef, useState, type FC } from 'react'
import { useParams } from 'react-router-dom'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler'

interface SessionResponsePayload {
  session?: {
    data?: {
      presentationUrl?: unknown
    }
  }
}

interface SyncDeckWsMessage {
  type?: unknown
  payload?: unknown
}

const WS_OPEN_READY_STATE = 1

function validatePresentationUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const SyncDeckStudent: FC = () => {
  const { sessionId } = useParams<{ sessionId?: string }>()
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [presentationUrl, setPresentationUrl] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('Waiting for instructor sync…')
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const pendingPayloadRef = useRef<unknown>(null)
  const attachSessionEndedHandler = useSessionEndedHandler()

  const sendPayloadToIframe = useCallback((payload: unknown) => {
    const target = iframeRef.current?.contentWindow
    if (!target) {
      pendingPayloadRef.current = payload
      return
    }

    target.postMessage(payload, '*')
  }, [])

  const handleWsMessage = useCallback(
    (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as SyncDeckWsMessage
        if (parsed.type !== 'syncdeck-state') {
          return
        }

        setStatusMessage('Receiving instructor sync…')
        sendPayloadToIframe(parsed.payload)
      } catch {
        return
      }
    },
    [sendPayloadToIframe],
  )

  const buildStudentWsUrl = useCallback((): string | null => {
    if (typeof window === 'undefined' || !sessionId || !presentationUrl) {
      return null
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const params = new URLSearchParams({ sessionId })
    return `${protocol}//${window.location.host}/ws/syncdeck?${params.toString()}`
  }, [sessionId, presentationUrl])

  const { connect: connectStudentWs, disconnect: disconnectStudentWs, socketRef: studentSocketRef } =
    useResilientWebSocket({
      buildUrl: buildStudentWsUrl,
      shouldReconnect: Boolean(sessionId && presentationUrl),
      onMessage: handleWsMessage,
      attachSessionEndedHandler,
    })

  useEffect(() => {
    if (!sessionId) {
      setError('Missing session id')
      setIsLoading(false)
      return
    }

    let isCancelled = false

    const loadSession = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/session/${sessionId}`)
        if (!response.ok) {
          if (!isCancelled) {
            setError('Invalid or missing session')
            setIsLoading(false)
          }
          return
        }

        const payload = (await response.json()) as SessionResponsePayload
        const configuredPresentationUrl = payload.session?.data?.presentationUrl
        if (typeof configuredPresentationUrl !== 'string' || !validatePresentationUrl(configuredPresentationUrl)) {
          if (!isCancelled) {
            setError('Instructor has not configured this SyncDeck session yet.')
            setIsLoading(false)
          }
          return
        }

        if (!isCancelled) {
          setPresentationUrl(configuredPresentationUrl)
          setError(null)
          setIsLoading(false)
        }
      } catch {
        if (!isCancelled) {
          setError('Unable to load session data')
          setIsLoading(false)
        }
      }
    }

    void loadSession()

    return () => {
      isCancelled = true
    }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId || !presentationUrl) {
      disconnectStudentWs()
      return undefined
    }

    connectStudentWs()
    return () => {
      disconnectStudentWs()
    }
  }, [sessionId, presentationUrl, connectStudentWs, disconnectStudentWs])

  const handleIframeLoad = useCallback(() => {
    if (pendingPayloadRef.current !== null) {
      sendPayloadToIframe(pendingPayloadRef.current)
      pendingPayloadRef.current = null
    }

    if (studentSocketRef.current?.readyState === WS_OPEN_READY_STATE) {
      setStatusMessage('Connected to instructor sync')
    }
  }, [sendPayloadToIframe, studentSocketRef])

  if (!sessionId) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-3">
        <h1 className="text-2xl font-bold">SyncDeck</h1>
        <p className="text-sm text-red-600">Missing session id</p>
      </div>
    )
  }

  if (isLoading) {
    return <div className="p-6">Loading SyncDeck session…</div>
  }

  if (error || !presentationUrl) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-3">
        <h1 className="text-2xl font-bold">SyncDeck</h1>
        <p className="text-sm text-gray-700">{error || 'Session unavailable.'}</p>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 w-full px-6 py-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-800">SyncDeck</h1>
        <p className="text-sm text-blue-700 truncate">{statusMessage}</p>
      </div>

      <div className="flex-1 min-h-0 w-full overflow-hidden bg-white">
        <iframe
          ref={iframeRef}
          title="SyncDeck Student Presentation"
          src={presentationUrl}
          className="w-full h-full"
          allow="fullscreen"
          onLoad={handleIframeLoad}
        />
      </div>
    </div>
  )
}

export default SyncDeckStudent
