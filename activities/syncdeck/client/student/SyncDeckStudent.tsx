import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react'
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

interface RevealCommandPayload {
  [key: string]: unknown
}

interface RevealSyncStatePayload {
  overview?: unknown
  storyboardDisplayed?: unknown
  open?: unknown
  isOpen?: unknown
  visible?: unknown
  revealState?: unknown
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

function buildRevealCommandMessage(name: string, payload: RevealCommandPayload): Record<string, unknown> {
  return {
    type: 'reveal-sync',
    version: '1.0.0',
    action: 'command',
    source: 'activebits-syncdeck-host',
    role: 'student',
    ts: Date.now(),
    payload: {
      name,
      payload,
    },
  }
}

function extractStoryboardDisplayed(data: unknown): boolean | null {
  const fromPayload = (payload: unknown): boolean | null => {
    if (payload == null || typeof payload !== 'object') {
      return null
    }

    const statePayload = payload as RevealSyncStatePayload
    if (typeof statePayload.overview === 'boolean') {
      return statePayload.overview
    }
    if (typeof statePayload.open === 'boolean') {
      return statePayload.open
    }
    if (typeof statePayload.isOpen === 'boolean') {
      return statePayload.isOpen
    }
    if (typeof statePayload.visible === 'boolean') {
      return statePayload.visible
    }
    if (typeof statePayload.storyboardDisplayed === 'boolean') {
      return statePayload.storyboardDisplayed
    }

    if (statePayload.revealState != null && typeof statePayload.revealState === 'object') {
      const revealState = statePayload.revealState as { storyboardDisplayed?: unknown }
      if (typeof revealState.storyboardDisplayed === 'boolean') {
        return revealState.storyboardDisplayed
      }
    }

    return null
  }

  const parseValue = (value: unknown): boolean | null => {
    if (value == null || typeof value !== 'object') {
      return null
    }

    const envelope = value as RevealSyncEnvelope
    if (envelope.type !== 'reveal-sync') {
      return null
    }

    if (envelope.action === 'storyboard-shown') {
      return true
    }
    if (envelope.action === 'storyboard-hidden') {
      return false
    }
    if (envelope.action === 'overview-shown') {
      return true
    }
    if (envelope.action === 'overview-hidden') {
      return false
    }

    if (envelope.action === 'state' || envelope.action === 'storyboard' || envelope.action === 'overview') {
      return fromPayload(envelope.payload)
    }

    return null
  }

  if (typeof data === 'string') {
    try {
      return parseValue(JSON.parse(data) as unknown)
    } catch {
      return null
    }
  }

  return parseValue(data)
}

function validatePresentationUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0
  } catch {
    return false
  }
}

function getStoredStudentName(sessionId: string): string {
  if (typeof window === 'undefined') {
    return ''
  }

  const stored = window.sessionStorage.getItem(`syncdeck_student_name_${sessionId}`)
  return typeof stored === 'string' ? stored.trim() : ''
}

function buildStudentIdentity(sessionId: string, studentName: string): { studentId: string; studentName: string } | null {
  if (typeof window === 'undefined') {
    return null
  }

  const key = `syncdeck_student_id_${sessionId}`
  let studentId = window.sessionStorage.getItem(key)
  if (!studentId) {
    const generatedId = window.crypto?.randomUUID?.() ?? `student-${Date.now().toString(36)}`
    studentId = generatedId
    window.sessionStorage.setItem(key, generatedId)
  }

  return {
    studentId,
    studentName,
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
  const [isStoryboardOpen, setIsStoryboardOpen] = useState(false)
  const [studentNameInput, setStudentNameInput] = useState('')
  const [studentName, setStudentName] = useState('')
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const pendingPayloadRef = useRef<unknown>(null)
  const attachSessionEndedHandler = useSessionEndedHandler()

  useEffect(() => {
    if (!sessionId) {
      return
    }

    const storedName = getStoredStudentName(sessionId)
    setStudentName(storedName)
    setStudentNameInput(storedName)
  }, [sessionId])

  const studentIdentity = useMemo(() => {
    if (!sessionId || studentName.trim().length === 0) {
      return null
    }
    return buildStudentIdentity(sessionId, studentName)
  }, [sessionId, studentName])

  const presentationOrigin = useMemo(() => {
    if (!presentationUrl || !validatePresentationUrl(presentationUrl)) {
      return null
    }

    try {
      return new URL(presentationUrl).origin
    } catch {
      return null
    }
  }, [presentationUrl])

  const sendPayloadToIframe = useCallback((payload: unknown) => {
    if (!presentationOrigin) {
      pendingPayloadRef.current = payload
      return
    }

    const target = iframeRef.current?.contentWindow
    if (!target) {
      pendingPayloadRef.current = payload
      return
    }

    target.postMessage(payload, presentationOrigin)
  }, [presentationOrigin])

  useEffect(() => {
    const handleIframeMessage = (event: MessageEvent) => {
      const iframeWindow = iframeRef.current?.contentWindow
      if (!iframeWindow || event.source !== iframeWindow) {
        return
      }

      const storyboardDisplayed = extractStoryboardDisplayed(event.data)
      if (typeof storyboardDisplayed === 'boolean') {
        setIsStoryboardOpen(storyboardDisplayed)
      }
    }

    window.addEventListener('message', handleIframeMessage)
    return () => {
      window.removeEventListener('message', handleIframeMessage)
    }
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
    if (typeof window === 'undefined' || !sessionId || !presentationUrl || !studentIdentity) {
      return null
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const params = new URLSearchParams({
      sessionId,
      studentId: studentIdentity.studentId,
      studentName: studentIdentity.studentName,
    })
    return `${protocol}//${window.location.host}/ws/syncdeck?${params.toString()}`
  }, [sessionId, presentationUrl, studentIdentity])

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
    if (!sessionId || !presentationUrl || studentName.trim().length === 0) {
      disconnectStudentWs()
      return undefined
    }

    connectStudentWs()
    return () => {
      disconnectStudentWs()
    }
  }, [sessionId, presentationUrl, studentName, connectStudentWs, disconnectStudentWs])

  const handleNameSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!sessionId) {
      return
    }

    const normalized = studentNameInput.trim().slice(0, 80)
    if (normalized.length === 0) {
      return
    }

    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(`syncdeck_student_name_${sessionId}`, normalized)
    }
    setStudentName(normalized)
  }

  const handleIframeLoad = useCallback(() => {
    if (pendingPayloadRef.current !== null) {
      sendPayloadToIframe(pendingPayloadRef.current)
      pendingPayloadRef.current = null
    }

    if (studentSocketRef.current?.readyState === WS_OPEN_READY_STATE) {
      setStatusMessage('Connected to instructor sync')
    }
  }, [sendPayloadToIframe, studentSocketRef])

  const toggleStoryboard = useCallback(() => {
    sendPayloadToIframe(
      buildRevealCommandMessage('toggleOverview', {}),
    )
  }, [sendPayloadToIframe])

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

  if (studentName.trim().length === 0) {
    return (
      <div className="fixed inset-0 z-10 bg-white flex items-center justify-center p-6">
        <form onSubmit={handleNameSubmit} className="w-full max-w-md border border-gray-200 rounded p-4 space-y-3">
          <h1 className="text-xl font-bold text-gray-800">Join SyncDeck</h1>
          <label className="block text-sm text-gray-700">
            <span className="block font-semibold mb-1">Your Name</span>
            <input
              type="text"
              value={studentNameInput}
              onChange={(event) => setStudentNameInput(event.target.value)}
              className="w-full border-2 border-gray-300 rounded px-3 py-2"
              placeholder="Enter your name"
              maxLength={80}
              required
              autoFocus
            />
          </label>
          <button
            type="submit"
            className="px-3 py-2 rounded bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
          >
            Join Presentation
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-10 bg-white flex flex-col overflow-hidden">
      <div className="bg-white border-b border-gray-200 w-full px-6 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center">
          <h1 className="text-2xl font-bold text-gray-800">SyncDeck</h1>
          <button
            type="button"
            onClick={toggleStoryboard}
            className={`ml-3 px-2 py-1 rounded border text-gray-700 ${
              isStoryboardOpen
                ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                : 'border-gray-300 hover:bg-gray-50'
            }`}
            title={isStoryboardOpen ? 'Hide storyboard' : 'Show storyboard'}
            aria-label={isStoryboardOpen ? 'Hide storyboard' : 'Show storyboard'}
          >
            🎞️
          </button>
        </div>
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
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          onLoad={handleIframeLoad}
        />
      </div>
    </div>
  )
}

export default SyncDeckStudent
