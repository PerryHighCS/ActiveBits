import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import { useCallback, useEffect, useMemo, useRef, useState, type FC, type FormEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import ConnectionStatusDot from '../components/ConnectionStatusDot.js'

const SYNCDECK_PASSCODE_KEY_PREFIX = 'syncdeck_instructor_'
const isDevMode = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true
const WS_OPEN_READY_STATE = 1
const DISCONNECTED_STATUS_DELAY_MS = 250

interface SessionResponsePayload {
  session?: {
    data?: {
      presentationUrl?: unknown
    }
  }
}

interface SyncDeckStudentPresenceMessage {
  type?: unknown
  payload?: {
    connectedCount?: unknown
    students?: unknown
  }
}

interface RevealCommandPayload {
  [key: string]: unknown
}

interface RevealSyncEnvelope {
  type?: unknown
  action?: unknown
  payload?: unknown
}

interface RevealSyncStatePayload {
  overview?: unknown
  storyboardDisplayed?: unknown
  open?: unknown
  isOpen?: unknown
  visible?: unknown
  revealState?: unknown
}

function stripOverviewFromStateEnvelope(data: unknown): unknown {
  if (
    data == null ||
    typeof data !== 'object' ||
    !('type' in data) ||
    (data as { type?: unknown }).type !== 'reveal-sync' ||
    !('action' in data) ||
    (data as { action?: unknown }).action !== 'state' ||
    !('payload' in data) ||
    (data as { payload?: unknown }).payload == null ||
    typeof (data as { payload?: unknown }).payload !== 'object'
  ) {
    return data
  }

  const envelope = data as {
    payload: {
      overview?: unknown
      storyboardDisplayed?: unknown
      revealState?: unknown
      [key: string]: unknown
    }
    [key: string]: unknown
  }

  let revealState = envelope.payload.revealState
  if (revealState != null && typeof revealState === 'object') {
    const mutableRevealState = {
      ...(revealState as Record<string, unknown>),
      overview: false,
    }
    if ('storyboardDisplayed' in mutableRevealState) {
      delete mutableRevealState.storyboardDisplayed
    }
    revealState = mutableRevealState
  }

  const nextPayload = {
    ...envelope.payload,
    overview: false,
    revealState,
  }

  if ('storyboardDisplayed' in nextPayload) {
    delete nextPayload.storyboardDisplayed
  }

  return {
    ...envelope,
    payload: nextPayload,
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

interface SyncDeckStudentPresence {
  studentId: string
  name: string
  connected: boolean
}

function buildPasscodeKey(sessionId: string): string {
  return `${SYNCDECK_PASSCODE_KEY_PREFIX}${sessionId}`
}

function validatePresentationUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0
  } catch {
    return false
  }
}

function formatDebugMessagePayload(data: unknown): string {
  const truncate = (value: string): string => (value.length > 220 ? `${value.slice(0, 220)}…` : value)

  const serialize = (value: unknown): string => {
    if (typeof value === 'string') {
      return truncate(value)
    }
    try {
      return truncate(JSON.stringify(value))
    } catch {
      return truncate(String(value))
    }
  }

  const extractPayload = (value: unknown): unknown => {
    if (value == null || typeof value !== 'object' || !('payload' in value)) {
      return value
    }
    return (value as { payload: unknown }).payload
  }

  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data) as unknown
      return serialize(extractPayload(parsed))
    } catch {
      return serialize(data)
    }
  }

  return serialize(extractPayload(data))
}

function buildRevealCommandMessage(name: string, payload: RevealCommandPayload): Record<string, unknown> {
  return {
    type: 'reveal-sync',
    version: '1.0.0',
    action: 'command',
    source: 'activebits-syncdeck-host',
    role: 'instructor',
    ts: Date.now(),
    payload: {
      name,
      payload,
    },
  }
}

const SyncDeckManager: FC = () => {
  const { sessionId } = useParams<{ sessionId?: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const [copiedValue, setCopiedValue] = useState<string | null>(null)
  const [presentationUrl, setPresentationUrl] = useState(() => {
    const params = new URLSearchParams(location.search)
    return params.get('presentationUrl') ?? ''
  })
  const [isStartingSession, setIsStartingSession] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [startSuccess, setStartSuccess] = useState<string | null>(null)
  const [isConfigurePanelOpen, setIsConfigurePanelOpen] = useState(true)
  const [instructorPasscode, setInstructorPasscode] = useState<string | null>(null)
  const [isPasscodeReady, setIsPasscodeReady] = useState(false)
  const [hasAutoStarted, setHasAutoStarted] = useState(false)
  const [debugInstructorMessage, setDebugInstructorMessage] = useState<string | null>(null)
  const [instructorConnectionState, setInstructorConnectionState] = useState<'connected' | 'disconnected'>('disconnected')
  const [instructorConnectionTooltip, setInstructorConnectionTooltip] = useState('Not connected to sync server')
  const [connectedStudentCount, setConnectedStudentCount] = useState(0)
  const [students, setStudents] = useState<SyncDeckStudentPresence[]>([])
  const [isStudentsPanelOpen, setIsStudentsPanelOpen] = useState(false)
  const [isStoryboardOpen, setIsStoryboardOpen] = useState(false)
  const presentationIframeRef = useRef<HTMLIFrameElement | null>(null)
  const disconnectStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastInstructorPayloadRef = useRef<unknown>(null)

  const presentationOrigin = useMemo(() => {
    try {
      return new URL(presentationUrl).origin
    } catch {
      return null
    }
  }, [presentationUrl])

  const buildInstructorWsUrl = useCallback((): string | null => {
    if (typeof window === 'undefined' || !sessionId || !instructorPasscode || isConfigurePanelOpen) {
      return null
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const params = new URLSearchParams({
      sessionId,
      role: 'instructor',
      instructorPasscode,
    })
    return `${protocol}//${window.location.host}/ws/syncdeck?${params.toString()}`
  }, [sessionId, instructorPasscode, isConfigurePanelOpen])

  const { connect: connectInstructorWs, disconnect: disconnectInstructorWs, socketRef: instructorSocketRef } =
    useResilientWebSocket({
      buildUrl: buildInstructorWsUrl,
      shouldReconnect: Boolean(sessionId && instructorPasscode && !isConfigurePanelOpen),
      onOpen: () => {
        if (disconnectStatusTimeoutRef.current != null) {
          clearTimeout(disconnectStatusTimeoutRef.current)
          disconnectStatusTimeoutRef.current = null
        }
        setInstructorConnectionState('connected')
        setInstructorConnectionTooltip('Connected to sync server')
      },
      onClose: () => {
        if (disconnectStatusTimeoutRef.current != null) {
          clearTimeout(disconnectStatusTimeoutRef.current)
        }
        disconnectStatusTimeoutRef.current = setTimeout(() => {
          setInstructorConnectionState('disconnected')
          setInstructorConnectionTooltip('Disconnected from sync server')
          disconnectStatusTimeoutRef.current = null
        }, DISCONNECTED_STATUS_DELAY_MS)
      },
      onMessage: (event) => {
        try {
          const message = JSON.parse(event.data) as SyncDeckStudentPresenceMessage
          if (message.type !== 'syncdeck-students') {
            return
          }

          const connectedCount = message.payload?.connectedCount
          if (typeof connectedCount === 'number' && Number.isFinite(connectedCount) && connectedCount >= 0) {
            setConnectedStudentCount(connectedCount)
          }

          if (Array.isArray(message.payload?.students)) {
            const nextStudents = message.payload.students
              .filter(
                (entry): entry is { studentId?: unknown; name?: unknown; connected?: unknown } =>
                  entry != null && typeof entry === 'object',
              )
              .map((entry) => ({
                studentId: typeof entry.studentId === 'string' ? entry.studentId : 'unknown',
                name: typeof entry.name === 'string' && entry.name.trim().length > 0 ? entry.name.trim() : 'Student',
                connected: entry.connected === true,
              }))
            setStudents(nextStudents)
          }
        } catch {
          return
        }
      },
    })

  const studentJoinUrl = sessionId && typeof window !== 'undefined' ? `${window.location.origin}/${sessionId}` : ''
  const urlHash = new URLSearchParams(location.search).get('urlHash')

  useEffect(() => {
    if (!sessionId) {
      return
    }

    let isCancelled = false

    const loadExistingPresentation = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/session/${sessionId}`)
        if (!response.ok) {
          return
        }

        const payload = (await response.json()) as SessionResponsePayload
        const existingPresentationUrl = payload.session?.data?.presentationUrl
        if (typeof existingPresentationUrl !== 'string' || !validatePresentationUrl(existingPresentationUrl)) {
          return
        }

        if (!isCancelled) {
          setPresentationUrl(existingPresentationUrl)
          setIsConfigurePanelOpen(false)
          setStartSuccess('Presentation loaded. Session is ready.')
          setStartError(null)
        }
      } catch {
        return
      }
    }

    void loadExistingPresentation()

    return () => {
      isCancelled = true
    }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId || typeof window === 'undefined') {
      setInstructorPasscode(null)
      setIsPasscodeReady(true)
      return
    }

    let isCancelled = false

    const loadInstructorPasscode = async (): Promise<void> => {
      const fromStorage = window.sessionStorage.getItem(buildPasscodeKey(sessionId))
      if (fromStorage) {
        if (!isCancelled) {
          setInstructorPasscode(fromStorage)
          setIsPasscodeReady(true)
        }
        return
      }

      try {
        const response = await fetch(`/api/syncdeck/${sessionId}/instructor-passcode`, {
          credentials: 'include',
        })
        if (!response.ok) {
          if (!isCancelled) {
            setInstructorPasscode(null)
            setIsPasscodeReady(true)
          }
          return
        }

        const payload = (await response.json()) as { instructorPasscode?: string }
        if (typeof payload.instructorPasscode === 'string' && payload.instructorPasscode.length > 0) {
          window.sessionStorage.setItem(buildPasscodeKey(sessionId), payload.instructorPasscode)
          if (!isCancelled) {
            setInstructorPasscode(payload.instructorPasscode)
          }
        }
      } catch {
        if (!isCancelled) {
          setInstructorPasscode(null)
        }
      } finally {
        if (!isCancelled) {
          setIsPasscodeReady(true)
        }
      }
    }

    setIsPasscodeReady(false)
    void loadInstructorPasscode()

    return () => {
      isCancelled = true
    }
  }, [sessionId])

  const copyValue = async (value: string): Promise<void> => {
    if (!value || typeof navigator === 'undefined' || navigator.clipboard === undefined) {
      return
    }

    await navigator.clipboard.writeText(value)
    setCopiedValue(value)
    setTimeout(() => setCopiedValue((current) => (current === value ? null : current)), 1500)
  }

  const handleEndSession = async (): Promise<void> => {
    if (!sessionId) return

    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('End this session? All students will be disconnected.')
      if (!confirmed) return
    }

    await fetch(`/api/session/${sessionId}`, { method: 'DELETE' })
    void navigate('/manage')
  }

  const toggleStoryboard = (): void => {
    const targetWindow = presentationIframeRef.current?.contentWindow
    if (!targetWindow || !presentationOrigin) {
      return
    }

    targetWindow.postMessage(
      buildRevealCommandMessage('toggleOverview', {}),
      presentationOrigin,
    )
  }

  const handleForceSyncStudents = (): void => {
    const socket = instructorSocketRef.current
    if (!socket || socket.readyState !== WS_OPEN_READY_STATE) {
      setStartError('Cannot force sync while disconnected from sync server.')
      setStartSuccess(null)
      return
    }

    const targetWindow = presentationIframeRef.current?.contentWindow
    if (!targetWindow || !presentationOrigin) {
      setStartError('Presentation is not ready for force sync.')
      setStartSuccess(null)
      return
    }

    if (lastInstructorPayloadRef.current != null) {
      try {
        socket.send(
          JSON.stringify({
            type: 'syncdeck-state-update',
            payload: lastInstructorPayloadRef.current,
          }),
        )
      } catch {
        setStartError('Unable to send force sync update to students.')
        setStartSuccess(null)
        return
      }
    }

    targetWindow.postMessage(
      {
        type: 'reveal-sync',
        version: '1.0.0',
        action: 'requestState',
        source: 'activebits-syncdeck-host',
        role: 'instructor',
        ts: Date.now(),
        payload: {},
      },
      presentationOrigin,
    )

    setStartError(null)
    setStartSuccess('Force sync sent. Students are syncing to your current position.')
  }

  const startSession = useCallback(async (): Promise<void> => {
    if (!sessionId) return

    const normalizedUrl = presentationUrl.trim()
    if (!validatePresentationUrl(normalizedUrl)) {
      setStartError('Presentation URL must be a valid http(s) URL')
      setStartSuccess(null)
      return
    }

    if (!isPasscodeReady) {
      setStartError('Loading instructor credentials...')
      setStartSuccess(null)
      return
    }

    if (!instructorPasscode) {
      setStartError('Instructor passcode missing. Start a new SyncDeck session from the dashboard.')
      setStartSuccess(null)
      return
    }

    setIsStartingSession(true)
    setStartError(null)

    try {
      const response = await fetch(`/api/syncdeck/${sessionId}/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presentationUrl: normalizedUrl,
          instructorPasscode,
          ...(urlHash ? { urlHash } : {}),
        }),
      })

      if (!response.ok) {
        let errorMessage = 'Failed to configure SyncDeck session'
        try {
          const payload = (await response.json()) as { error?: string }
          if (payload.error) {
            errorMessage = payload.error
          }
        } catch {
          // Keep generic fallback if non-JSON response.
        }

        throw new Error(errorMessage)
      }

      setStartSuccess('SyncDeck session configured. Students will load this presentation when they join.')
      setIsConfigurePanelOpen(false)
    } catch (error) {
      setStartSuccess(null)
      setStartError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsStartingSession(false)
    }
  }, [sessionId, presentationUrl, isPasscodeReady, instructorPasscode, urlHash])

  const handleStartSession = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    await startSession()
  }

  useEffect(() => {
    if (hasAutoStarted || !sessionId || !isConfigurePanelOpen) {
      return
    }

    const normalizedUrl = presentationUrl.trim()
    if (!validatePresentationUrl(normalizedUrl)) {
      return
    }

    if (!isPasscodeReady || !instructorPasscode || isStartingSession) {
      return
    }

    setHasAutoStarted(true)
    void startSession()
  }, [
    hasAutoStarted,
    sessionId,
    isConfigurePanelOpen,
    presentationUrl,
    isPasscodeReady,
    instructorPasscode,
    isStartingSession,
    startSession,
  ])

  useEffect(() => {
    if (isConfigurePanelOpen || !sessionId || !instructorPasscode) {
      if (disconnectStatusTimeoutRef.current != null) {
        clearTimeout(disconnectStatusTimeoutRef.current)
        disconnectStatusTimeoutRef.current = null
      }
      setInstructorConnectionState('disconnected')
      setInstructorConnectionTooltip('Connects when presentation starts')
      disconnectInstructorWs()
      return undefined
    }

    connectInstructorWs()
    return () => {
      disconnectInstructorWs()
    }
  }, [isConfigurePanelOpen, sessionId, instructorPasscode, connectInstructorWs, disconnectInstructorWs])

  useEffect(
    () => () => {
      if (disconnectStatusTimeoutRef.current != null) {
        clearTimeout(disconnectStatusTimeoutRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    if (isConfigurePanelOpen) {
      return
    }

    const handleMessage = (event: MessageEvent) => {
      const iframeWindow = presentationIframeRef.current?.contentWindow
      if (!iframeWindow || event.source !== iframeWindow) {
        return
      }

      if (!presentationOrigin || event.origin !== presentationOrigin) {
        return
      }

      const storyboardDisplayed = extractStoryboardDisplayed(event.data)
      if (typeof storyboardDisplayed === 'boolean') {
        setIsStoryboardOpen(storyboardDisplayed)
      }

      if (isDevMode) {
        const payload = formatDebugMessagePayload(event.data)
        setDebugInstructorMessage(payload)
      }

      const socket = instructorSocketRef.current
      if (!socket || socket.readyState !== WS_OPEN_READY_STATE) {
        return
      }

      try {
        const sanitizedPayload = stripOverviewFromStateEnvelope(event.data)
        lastInstructorPayloadRef.current = sanitizedPayload
        socket.send(
          JSON.stringify({
            type: 'syncdeck-state-update',
            payload: sanitizedPayload,
          }),
        )
      } catch {
        return
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [isConfigurePanelOpen, presentationOrigin])

  if (!sessionId) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-3">
        <h1 className="text-2xl font-bold">SyncDeck</h1>
        <p className="text-sm text-gray-700">Create a live session or a permanent link to begin.</p>
      </div>
    )
  }

  const statusClassName = startError
    ? 'text-red-600'
    : startSuccess
      ? 'text-green-700'
      : !isPasscodeReady
        ? 'text-gray-600'
        : 'text-blue-700'

  const baseStatusMessage =
    startError || startSuccess || (!isPasscodeReady ? 'Loading instructor credentials…' : debugInstructorMessage)

  const mergedStatusMessage =
    !startError && isDevMode && debugInstructorMessage && baseStatusMessage !== debugInstructorMessage
      ? `${baseStatusMessage} • ${debugInstructorMessage}`
      : baseStatusMessage

  return (
    <div className={isConfigurePanelOpen ? 'min-h-screen flex flex-col' : 'h-screen flex flex-col overflow-hidden'}>
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 w-full">
        <div className="px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center min-w-0">
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
            <button
              type="button"
              onClick={handleForceSyncStudents}
              className="ml-2 px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Force sync students to current position"
              aria-label="Force sync students to current position"
              disabled={isConfigurePanelOpen || instructorConnectionState !== 'connected'}
            >
              📍
            </button>
          </div>

          {(startError || startSuccess || !isPasscodeReady || (isDevMode && debugInstructorMessage)) && (
            <p className={`text-sm ${statusClassName} flex-1 min-w-0 truncate`}>{mergedStatusMessage}</p>
          )}

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsStudentsPanelOpen((current) => !current)}
                className="px-2 py-1 rounded border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
              >
                Students: {connectedStudentCount}
              </button>
              <ConnectionStatusDot state={instructorConnectionState} tooltip={instructorConnectionTooltip} />
              <span className="text-sm text-gray-600">Join Code:</span>
              <code
                onClick={() => {
                  void copyValue(sessionId)
                }}
                className="px-3 py-1.5 rounded bg-gray-100 font-mono text-lg font-semibold text-gray-800 cursor-pointer hover:bg-gray-200 transition-colors"
                title="Click to copy"
              >
                {copiedValue === sessionId ? '✓ Copied!' : sessionId}
              </code>
            </div>
            <button
              onClick={() => {
                void copyValue(studentJoinUrl)
              }}
              className="px-3 py-2 rounded border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              {copiedValue === studentJoinUrl ? '✓ Copied!' : 'Copy Join URL'}
            </button>

            <button
              onClick={() => {
                void handleEndSession()
              }}
              className="px-3 py-2 rounded border border-red-600 text-sm font-semibold text-red-600 hover:bg-red-50"
            >
              End Session
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 min-h-0">
          <div className={isConfigurePanelOpen ? 'p-6 max-w-4xl mx-auto space-y-3 w-full' : 'h-full min-h-0 w-full'}>
            {isConfigurePanelOpen ? (
              <form onSubmit={handleStartSession} className="bg-white border border-gray-200 rounded p-4 space-y-3">
                <h2 className="text-lg font-semibold text-gray-800">Configure Presentation</h2>
                <label className="block text-sm text-gray-700">
                  <span className="block font-semibold mb-1">Presentation URL</span>
                  <input
                    type="url"
                    value={presentationUrl}
                    onChange={(event) => setPresentationUrl(event.target.value)}
                    className="w-full border-2 border-gray-300 rounded px-3 py-2"
                    placeholder="https://slides.example.com/deck"
                    required
                  />
                </label>
                <button
                  type="submit"
                  className="px-3 py-2 rounded bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
                  disabled={isStartingSession || !isPasscodeReady}
                >
                  {isStartingSession ? 'Starting…' : 'Start Session'}
                </button>
              </form>
              ) : null}

            {!isConfigurePanelOpen && validatePresentationUrl(presentationUrl) && (
              <div className="w-full h-full min-h-0 bg-white overflow-hidden">
                <iframe
                  ref={presentationIframeRef}
                  title="SyncDeck Presentation"
                  src={presentationUrl}
                  className="w-full h-full"
                  allow="fullscreen"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                />
              </div>
            )}

            {isConfigurePanelOpen && (
              <p className="text-sm text-gray-700">Presentation sync controls will be added in the next implementation pass.</p>
            )}
          </div>
        </div>

        <aside
          className={`h-full bg-white shadow-lg overflow-hidden transition-[width] duration-200 ${
            isStudentsPanelOpen ? 'w-80 border-l border-gray-200' : 'w-0 border-l-0'
          }`}
        >
          <div className="h-full flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">Connected Students</h2>
              <button
                type="button"
                onClick={() => setIsStudentsPanelOpen(false)}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {students.filter((student) => student.connected).length === 0 ? (
                <p className="text-sm text-gray-600">No connected students yet.</p>
              ) : (
                students
                  .filter((student) => student.connected)
                  .map((student) => (
                    <div key={student.studentId} className="px-3 py-2 rounded border border-gray-200 bg-gray-50">
                      <p className="text-sm font-medium text-gray-800 truncate">{student.name}</p>
                    </div>
                  ))
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

export default SyncDeckManager
