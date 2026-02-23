import { useCallback, useEffect, useRef, useState, type FC } from 'react'
import { useParams } from 'react-router-dom'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler'
import ConnectionStatusDot from '../components/ConnectionStatusDot.js'

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

interface RevealSyncEnvelope {
  type?: unknown
  version?: unknown
  action?: unknown
  deckId?: unknown
  role?: unknown
  source?: unknown
  payload?: unknown
}

const WS_OPEN_READY_STATE = 1

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function toRevealCommandMessage(rawPayload: unknown): Record<string, unknown> | null {
  if (!isPlainObject(rawPayload)) {
    return null
  }

  const message = rawPayload as RevealSyncEnvelope
  if (message.type !== 'reveal-sync') {
    return null
  }

  if (message.action === 'command') {
    return rawPayload
  }

  if (message.action !== 'state' || !isPlainObject(message.payload)) {
    return null
  }

  const statePayload = message.payload as {
    revealState?: unknown
    indices?: { h?: unknown; v?: unknown; f?: unknown }
  }

  const revealState = isPlainObject(statePayload.revealState) ? statePayload.revealState : null
  const indices = isPlainObject(statePayload.indices) ? statePayload.indices : null
  const fallbackState = {
    indexh: typeof indices?.h === 'number' ? indices.h : 0,
    indexv: typeof indices?.v === 'number' ? indices.v : 0,
    indexf: typeof indices?.f === 'number' ? indices.f : 0,
  }

  return {
    type: 'reveal-sync',
    version: typeof message.version === 'string' ? message.version : '1.0.0',
    action: 'command',
    deckId: typeof message.deckId === 'string' ? message.deckId : null,
    role: 'instructor',
    source: 'reveal-iframe-sync',
    ts: Date.now(),
    payload: {
      name: 'setState',
      payload: {
        state: revealState ?? fallbackState,
      },
    },
  }
}

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
  const [isWaitingForConfiguration, setIsWaitingForConfiguration] = useState(false)
  const [statusMessage, setStatusMessage] = useState('Waiting for instructor sync…')
  const [connectionState, setConnectionState] = useState<'connected' | 'disconnected'>('disconnected')
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

        const revealCommand = toRevealCommandMessage(parsed.payload)
        if (revealCommand == null) {
          return
        }

        setStatusMessage('Receiving instructor sync…')
        sendPayloadToIframe(revealCommand)
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
      onOpen: () => {
        setConnectionState('connected')
        setStatusMessage('Connected. Waiting for instructor sync…')
      },
      onClose: () => {
        setConnectionState('disconnected')
        setStatusMessage('Reconnecting to instructor sync…')
      },
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
            setIsWaitingForConfiguration(true)
            setError(null)
            setIsLoading(false)
          }
          return
        }

        if (!isCancelled) {
          setPresentationUrl(configuredPresentationUrl)
          setIsWaitingForConfiguration(false)
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
    if (!sessionId || !isWaitingForConfiguration) {
      return
    }

    let isCancelled = false

    const checkConfiguration = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/session/${sessionId}`)
        if (!response.ok || isCancelled) {
          return
        }

        const payload = (await response.json()) as SessionResponsePayload
        const configuredPresentationUrl = payload.session?.data?.presentationUrl
        if (typeof configuredPresentationUrl !== 'string' || !validatePresentationUrl(configuredPresentationUrl)) {
          return
        }

        if (!isCancelled) {
          setPresentationUrl(configuredPresentationUrl)
          setIsWaitingForConfiguration(false)
          setConnectionState('disconnected')
          setStatusMessage('Waiting for instructor sync…')
        }
      } catch {
        return
      }
    }

    const intervalId = setInterval(() => {
      void checkConfiguration()
    }, 3000)
    void checkConfiguration()

    return () => {
      isCancelled = true
      clearInterval(intervalId)
    }
  }, [sessionId, isWaitingForConfiguration])

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

  if (isWaitingForConfiguration) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-3">
        <h1 className="text-2xl font-bold">SyncDeck</h1>
        <p className="text-sm text-gray-700">Waiting for instructor to configure the presentation…</p>
      </div>
    )
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
    <div className="fixed inset-0 z-10 bg-white flex flex-col overflow-hidden">
      <div className="bg-white border-b border-gray-200 w-full px-6 py-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-800">SyncDeck</h1>
        <div className="flex items-center gap-4 min-w-0">
          <ConnectionStatusDot state={connectionState} tooltip={statusMessage} />
          <p className="text-sm text-gray-600 whitespace-nowrap">
            Join Code: <span className="font-mono font-bold text-xl text-gray-800">{sessionId}</span>
          </p>
        </div>
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
