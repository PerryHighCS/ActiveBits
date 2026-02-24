import { useCallback, useEffect, useMemo, useRef, useState, type FC, type FormEvent } from 'react'
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
  studentBoundary?: unknown
}

interface RevealStateIndicesPayload {
  indices?: unknown
  studentBoundary?: unknown
}

const SLIDE_END_FRAGMENT_INDEX = Number.MAX_SAFE_INTEGER

function compareIndices(a: { h: number; v: number; f: number }, b: { h: number; v: number; f: number }): number {
  if (a.h !== b.h) return a.h - b.h
  if (a.v !== b.v) return a.v - b.v
  return a.f - b.f
}

function toSlideEndBoundary(indices: { h: number; v: number; f: number }): { h: number; v: number; f: number } {
  return {
    h: indices.h,
    v: indices.v,
    f: SLIDE_END_FRAGMENT_INDEX,
  }
}

function resolveEffectiveBoundary(
  instructorIndices: { h: number; v: number; f: number } | null,
  setBoundary: { h: number; v: number; f: number } | null,
): { h: number; v: number; f: number } | null {
  if (!instructorIndices) {
    return setBoundary
  }
  if (!setBoundary) {
    return instructorIndices
  }

  return compareIndices(instructorIndices, setBoundary) >= 0 ? instructorIndices : setBoundary
}

interface RevealCommandMessage {
  type: 'reveal-sync'
  version: string
  action: 'command'
  deckId: string | null
  role: 'instructor'
  source: 'reveal-iframe-sync'
  ts: number
  payload: {
    name: string
    payload?: Record<string, unknown>
  }
}

const WS_OPEN_READY_STATE = 1

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isRevealSyncMessage(value: unknown): value is RevealSyncEnvelope {
  if (!isPlainObject(value)) {
    return false
  }

  return value.type === 'reveal-sync' && typeof value.action === 'string'
}

function normalizeIndices(value: unknown): { h: number; v: number; f: number } | null {
  if (!isPlainObject(value)) {
    return null
  }

  const h = value.h
  const v = value.v
  const f = value.f

  if (typeof h !== 'number' || !Number.isFinite(h)) {
    return null
  }

  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return null
  }

  const fragment = typeof f === 'number' && Number.isFinite(f) ? f : 0

  return {
    h,
    v,
    f: fragment,
  }
}

function buildBoundaryCommandEnvelope(
  message: RevealSyncEnvelope,
  name: string,
  payload?: Record<string, unknown>,
): RevealCommandMessage {
  return {
    type: 'reveal-sync',
    version: typeof message.version === 'string' ? message.version : '1.0.0',
    action: 'command',
    deckId: typeof message.deckId === 'string' ? message.deckId : null,
    role: 'instructor',
    source: 'reveal-iframe-sync',
    ts: Date.now(),
    payload: payload ? { name, payload } : { name },
  }
}

function shouldSnapBackToBoundary(
  studentIndices: { h: number; v: number; f: number } | null,
  boundary: { h: number; v: number; f: number },
): boolean {
  if (!studentIndices) {
    return true
  }

  return compareIndices(studentIndices, boundary) > 0
}

function buildSetStudentBoundaryCommand(
  message: RevealSyncEnvelope,
  studentIndices: { h: number; v: number; f: number } | null = null,
  fallbackInstructorIndices: { h: number; v: number; f: number } | null = null,
): RevealCommandMessage | null {
  const role = message.role
  if (typeof role === 'string' && role !== 'instructor') {
    return null
  }

  const payload = isPlainObject(message.payload) ? (message.payload as RevealStateIndicesPayload) : null
  if (!payload) {
    return null
  }

  const instructorIndices = normalizeIndices(payload.indices) ?? fallbackInstructorIndices
  const rawSetBoundary = normalizeIndices(payload.studentBoundary)
  const setBoundary = rawSetBoundary ? toSlideEndBoundary(rawSetBoundary) : null
  const effectiveBoundary = resolveEffectiveBoundary(instructorIndices, setBoundary)
  if (!effectiveBoundary) {
    return null
  }

  return buildBoundaryCommandEnvelope(message, 'setStudentBoundary', {
    indices: effectiveBoundary,
    syncToBoundary: shouldSnapBackToBoundary(studentIndices, effectiveBoundary),
  })
}

export function toRevealBoundaryCommandMessage(
  rawPayload: unknown,
  studentIndices: { h: number; v: number; f: number } | null = null,
  fallbackInstructorIndices: { h: number; v: number; f: number } | null = null,
): RevealCommandMessage | null {
  if (!isPlainObject(rawPayload)) {
    return null
  }

  const message = rawPayload as RevealSyncEnvelope
  if (message.type !== 'reveal-sync') {
    return null
  }

  if (message.action === 'state') {
    return buildSetStudentBoundaryCommand(message, studentIndices, fallbackInstructorIndices)
  }

  if (message.action === 'studentBoundaryChanged') {
    if (!isPlainObject(message.payload)) {
      return null
    }

    return buildSetStudentBoundaryCommand(message, studentIndices, fallbackInstructorIndices)
  }

  return null
}

function extractIndicesFromRevealStateMessage(rawPayload: unknown): { h: number; v: number; f: number } | null {
  if (!isPlainObject(rawPayload)) {
    return null
  }

  const message = rawPayload as RevealSyncEnvelope
  if (message.type !== 'reveal-sync' || !isPlainObject(message.payload)) {
    return null
  }

  const payload = message.payload as RevealStateIndicesPayload
  return normalizeIndices(payload.indices)
}

function extractRevealAction(rawPayload: unknown): string | null {
  if (!isPlainObject(rawPayload)) {
    return null
  }

  const message = rawPayload as RevealSyncEnvelope
  return typeof message.action === 'string' ? message.action : null
}

function computeBoundaryDetails(
  rawPayload: unknown,
  studentIndices: { h: number; v: number; f: number } | null,
  fallbackInstructorIndices: { h: number; v: number; f: number } | null,
): {
  instructorIndices: { h: number; v: number; f: number } | null
  setBoundary: { h: number; v: number; f: number } | null
  effectiveBoundary: { h: number; v: number; f: number } | null
  syncToBoundary: boolean
} | null {
  if (!isPlainObject(rawPayload)) {
    return null
  }

  const message = rawPayload as RevealSyncEnvelope
  if (message.type !== 'reveal-sync' || !isPlainObject(message.payload)) {
    return null
  }

  const payload = message.payload as RevealStateIndicesPayload
  const instructorIndices = normalizeIndices(payload.indices) ?? fallbackInstructorIndices
  const rawSetBoundary = normalizeIndices(payload.studentBoundary)
  const setBoundary = rawSetBoundary ? toSlideEndBoundary(rawSetBoundary) : null
  const effectiveBoundary = resolveEffectiveBoundary(instructorIndices, setBoundary)

  return {
    instructorIndices,
    setBoundary,
    effectiveBoundary,
    syncToBoundary: effectiveBoundary ? shouldSnapBackToBoundary(studentIndices, effectiveBoundary) : false,
  }
}

export function toRevealCommandMessage(rawPayload: unknown): Record<string, unknown> | null {
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
  const mergedState = {
    ...(revealState ?? {}),
    indexh: typeof indices?.h === 'number' ? indices.h : (revealState as { indexh?: unknown } | null)?.indexh ?? 0,
    indexv: typeof indices?.v === 'number' ? indices.v : (revealState as { indexv?: unknown } | null)?.indexv ?? 0,
    indexf: typeof indices?.f === 'number' ? indices.f : (revealState as { indexf?: unknown } | null)?.indexf ?? 0,
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
        state: mergedState,
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

export function buildStudentRoleCommandMessage(): Record<string, unknown> {
  return buildRevealCommandMessage('setRole', {
    role: 'student',
  })
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

function formatIndicesForLog(indices: { h: number; v: number; f: number } | null): string {
  if (!indices) {
    return 'null'
  }

  return `${indices.h}.${indices.v}.${indices.f}`
}

function isForceSyncBoundaryCommand(rawPayload: unknown): boolean {
  if (!isPlainObject(rawPayload)) {
    return false
  }

  const message = rawPayload as RevealSyncEnvelope
  if (message.type !== 'reveal-sync' || message.action !== 'command' || !isPlainObject(message.payload)) {
    return false
  }

  const payload = message.payload as {
    name?: unknown
    payload?: {
      syncToBoundary?: unknown
    }
  }

  return payload.name === 'setStudentBoundary' && payload.payload?.syncToBoundary === true
}

export function shouldSuppressForwardInstructorSync(
  studentHasBacktrackOptOut: boolean,
  studentPosition: { h: number; v: number; f: number } | null,
  instructorPosition: { h: number; v: number; f: number } | null,
): boolean {
  if (!studentHasBacktrackOptOut || !studentPosition || !instructorPosition) {
    return false
  }

  return compareIndices(instructorPosition, studentPosition) > 0
}

export function shouldResetBacktrackOptOutByMaxPosition(
  studentHasBacktrackOptOut: boolean,
  studentPosition: { h: number; v: number; f: number } | null,
  maxPosition: { h: number; v: number; f: number } | null,
): boolean {
  if (!studentHasBacktrackOptOut || !studentPosition || !maxPosition) {
    return false
  }

  return compareIndices(studentPosition, maxPosition) >= 0
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
  const [isBacktrackOptOut, setIsBacktrackOptOut] = useState(false)
  const [studentNameInput, setStudentNameInput] = useState('')
  const [registeredStudentName, setRegisteredStudentName] = useState('')
  const [isRegisteringStudent, setIsRegisteringStudent] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const pendingPayloadRef = useRef<unknown>(null)
  const localStudentIndicesRef = useRef<{ h: number; v: number; f: number } | null>(null)
  const lastInstructorIndicesRef = useRef<{ h: number; v: number; f: number } | null>(null)
  const lastEffectiveMaxPositionRef = useRef<{ h: number; v: number; f: number } | null>(null)
  const latestInstructorPayloadRef = useRef<unknown>(null)
  const hasSeenIframeReadySignalRef = useRef(false)
  const studentBacktrackOptOutRef = useRef(false)
  const attachSessionEndedHandler = useSessionEndedHandler()

  useEffect(() => {
    if (!sessionId) {
      return
    }

    const storedName = getStoredStudentName(sessionId)
    setStudentNameInput(storedName)
  }, [sessionId])

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

  const setBacktrackOptOut = useCallback((value: boolean) => {
    studentBacktrackOptOutRef.current = value
    setIsBacktrackOptOut(value)
  }, [])

  const handleWsMessage = useCallback(
    (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as SyncDeckWsMessage
        if (parsed.type !== 'syncdeck-state') {
          return
        }

        latestInstructorPayloadRef.current = parsed.payload
        const instructorIndices = extractIndicesFromRevealStateMessage(parsed.payload)
        if (instructorIndices) {
          lastInstructorIndicesRef.current = instructorIndices
        }

        if (isForceSyncBoundaryCommand(parsed.payload) && studentBacktrackOptOutRef.current) {
          setBacktrackOptOut(false)
          console.log('[SyncDeck][Student] backtrack opt-out reset by force sync', {
            currentPosition: formatIndicesForLog(localStudentIndicesRef.current),
            instructorPosition: formatIndicesForLog(lastInstructorIndicesRef.current),
          })
        }

        const action = extractRevealAction(parsed.payload)
        const boundaryDetails = computeBoundaryDetails(
          parsed.payload,
          localStudentIndicesRef.current,
          lastInstructorIndicesRef.current,
        )
        lastEffectiveMaxPositionRef.current = boundaryDetails?.effectiveBoundary ?? null

        if (
          shouldResetBacktrackOptOutByMaxPosition(
            studentBacktrackOptOutRef.current,
            localStudentIndicesRef.current,
            lastEffectiveMaxPositionRef.current,
          )
        ) {
            setBacktrackOptOut(false)
          console.log('[SyncDeck][Student] backtrack opt-out reset by max position update', {
            currentPosition: formatIndicesForLog(localStudentIndicesRef.current),
            maxPosition: formatIndicesForLog(lastEffectiveMaxPositionRef.current),
          })
        }

        if (action === 'state') {
          console.log('[SyncDeck][Student] instructor move/state', {
            currentPosition: formatIndicesForLog(localStudentIndicesRef.current),
            instructorPosition: formatIndicesForLog(boundaryDetails?.instructorIndices ?? null),
            computedBoundary: formatIndicesForLog(boundaryDetails?.effectiveBoundary ?? null),
            setBoundary: formatIndicesForLog(boundaryDetails?.setBoundary ?? null),
            syncToBoundary: boundaryDetails?.syncToBoundary === true,
          })
        }

        if (action === 'studentBoundaryChanged') {
          console.log('[SyncDeck][Student] boundary changed', {
            currentPosition: formatIndicesForLog(localStudentIndicesRef.current),
            instructorPosition: formatIndicesForLog(boundaryDetails?.instructorIndices ?? null),
            computedBoundary: formatIndicesForLog(boundaryDetails?.effectiveBoundary ?? null),
            setBoundary: formatIndicesForLog(boundaryDetails?.setBoundary ?? null),
            syncToBoundary: boundaryDetails?.syncToBoundary === true,
          })
        }

        const boundaryCommand = toRevealBoundaryCommandMessage(
          parsed.payload,
          localStudentIndicesRef.current,
          lastInstructorIndicesRef.current,
        )
        if (boundaryCommand != null) {
          const boundaryPayload = boundaryCommand.payload.payload as
            | { indices?: unknown; syncToBoundary?: unknown }
            | undefined
          const computedBoundary = normalizeIndices(boundaryPayload?.indices)
          console.log('[SyncDeck][Student] boundary command', {
            currentPosition: formatIndicesForLog(localStudentIndicesRef.current),
            computedBoundary: formatIndicesForLog(computedBoundary),
            syncToBoundary: boundaryPayload?.syncToBoundary === true,
          })
          sendPayloadToIframe(boundaryCommand)
        }

        const revealCommand = toRevealCommandMessage(parsed.payload)
        if (revealCommand == null) {
          if (boundaryCommand == null) {
            return
          }
        } else {
          const incomingInstructorIndices = extractIndicesFromRevealStateMessage(parsed.payload)
          const suppressForwardSync = shouldSuppressForwardInstructorSync(
            studentBacktrackOptOutRef.current,
            localStudentIndicesRef.current,
            incomingInstructorIndices,
          )
          console.log('[SyncDeck][Student] state command', {
            currentPosition: formatIndicesForLog(localStudentIndicesRef.current),
            instructorPosition: formatIndicesForLog(incomingInstructorIndices),
            suppressedByBacktrackOptOut: suppressForwardSync,
          })
          if (!suppressForwardSync) {
            sendPayloadToIframe(revealCommand)
          }
        }

        setStatusMessage('Receiving instructor sync…')
      } catch {
        return
      }
    },
    [sendPayloadToIframe, setBacktrackOptOut],
  )

  const replayLatestInstructorSyncToIframe = useCallback(() => {
    const payload = latestInstructorPayloadRef.current
    if (payload == null) {
      return
    }

    const boundaryCommand = toRevealBoundaryCommandMessage(
      payload,
      localStudentIndicesRef.current,
      lastInstructorIndicesRef.current,
    )
    if (boundaryCommand != null) {
      const boundaryPayload = boundaryCommand.payload.payload as
        | { indices?: unknown; syncToBoundary?: unknown }
        | undefined
      const computedBoundary = normalizeIndices(boundaryPayload?.indices)
      console.log('[SyncDeck][Student] replay boundary command', {
        currentPosition: formatIndicesForLog(localStudentIndicesRef.current),
        computedBoundary: formatIndicesForLog(computedBoundary),
        syncToBoundary: boundaryPayload?.syncToBoundary === true,
      })
      sendPayloadToIframe(boundaryCommand)
    }

    const revealCommand = toRevealCommandMessage(payload)
    if (revealCommand != null) {
      const incomingInstructorIndices = extractIndicesFromRevealStateMessage(payload)
      console.log('[SyncDeck][Student] replay state command', {
        currentPosition: formatIndicesForLog(localStudentIndicesRef.current),
        instructorPosition: formatIndicesForLog(incomingInstructorIndices),
      })
      sendPayloadToIframe(revealCommand)
    }
  }, [sendPayloadToIframe])

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

      const localIndices = extractIndicesFromRevealStateMessage(event.data)
      if (localIndices) {
        const previousLocalIndices = localStudentIndicesRef.current
        localStudentIndicesRef.current = localIndices

        const instructorIndices = lastInstructorIndicesRef.current
        const maxPosition = lastEffectiveMaxPositionRef.current ?? instructorIndices
        if (
          !studentBacktrackOptOutRef.current &&
          previousLocalIndices != null &&
          compareIndices(localIndices, previousLocalIndices) < 0 &&
          maxPosition != null &&
          compareIndices(localIndices, maxPosition) < 0
        ) {
          setBacktrackOptOut(true)
          console.log('[SyncDeck][Student] backtrack opt-out enabled', {
            currentPosition: formatIndicesForLog(localIndices),
            maxPosition: formatIndicesForLog(maxPosition),
          })
        }

        if (shouldResetBacktrackOptOutByMaxPosition(studentBacktrackOptOutRef.current, localIndices, maxPosition)) {
          setBacktrackOptOut(false)
          console.log('[SyncDeck][Student] backtrack opt-out reset by catch-up', {
            currentPosition: formatIndicesForLog(localIndices),
            maxPosition: formatIndicesForLog(maxPosition),
          })
        }
      }

      if (!hasSeenIframeReadySignalRef.current && isRevealSyncMessage(event.data)) {
        hasSeenIframeReadySignalRef.current = true
        console.log('[SyncDeck][Student] iframe ready signal received', {
          action: event.data.action,
          currentPosition: formatIndicesForLog(localStudentIndicesRef.current),
        })
        replayLatestInstructorSyncToIframe()
      }
    }

    window.addEventListener('message', handleIframeMessage)
    return () => {
      window.removeEventListener('message', handleIframeMessage)
    }
  }, [replayLatestInstructorSyncToIframe, setBacktrackOptOut])

  const buildStudentWsUrl = useCallback((): string | null => {
    if (typeof window === 'undefined' || !sessionId || !presentationUrl) {
      return null
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const params = new URLSearchParams({
      sessionId,
    })
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
    if (!sessionId || !presentationUrl || registeredStudentName.trim().length === 0) {
      disconnectStudentWs()
      return undefined
    }

    connectStudentWs()
    return () => {
      disconnectStudentWs()
    }
  }, [sessionId, presentationUrl, registeredStudentName, connectStudentWs, disconnectStudentWs])

  const handleNameSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!sessionId || !presentationUrl || isRegisteringStudent) {
      return
    }

    const normalized = studentNameInput.trim().slice(0, 80)
    if (normalized.length === 0) {
      setJoinError('Please enter your name before joining.')
      return
    }

    setIsRegisteringStudent(true)
    setJoinError(null)
    try {
      const response = await fetch(`/api/syncdeck/${sessionId}/register-student`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ name: normalized }),
      })

      if (!response.ok) {
        setJoinError('Unable to join this presentation right now. Please try again.')
        return
      }

      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(`syncdeck_student_name_${sessionId}`, normalized)
      }

      setRegisteredStudentName(normalized)
      setJoinError(null)
    } catch {
      setJoinError('Unable to join this presentation right now. Please try again.')
    } finally {
      setIsRegisteringStudent(false)
    }
  }

  const handleIframeLoad = useCallback(() => {
    hasSeenIframeReadySignalRef.current = false
    sendPayloadToIframe(buildStudentRoleCommandMessage())

    if (pendingPayloadRef.current !== null) {
      sendPayloadToIframe(pendingPayloadRef.current)
      pendingPayloadRef.current = null
    }

    if (studentSocketRef.current?.readyState === WS_OPEN_READY_STATE) {
      setStatusMessage('Connected to instructor sync')
    }
  }, [replayLatestInstructorSyncToIframe, sendPayloadToIframe, studentSocketRef])

  const toggleStoryboard = useCallback(() => {
    sendPayloadToIframe(
      buildRevealCommandMessage('toggleOverview', {}),
    )
  }, [sendPayloadToIframe])

  const handleFastForwardToInstructor = useCallback(() => {
    const instructorIndices = lastInstructorIndicesRef.current
    if (!instructorIndices) {
      return
    }

    sendPayloadToIframe(
      buildRevealCommandMessage('setState', {
        state: {
          indexh: instructorIndices.h,
          indexv: instructorIndices.v,
          indexf: instructorIndices.f,
        },
      }),
    )
    localStudentIndicesRef.current = instructorIndices
    setBacktrackOptOut(false)
    console.log('[SyncDeck][Student] fast-forwarded to instructor position', {
      instructorPosition: formatIndicesForLog(instructorIndices),
    })
  }, [sendPayloadToIframe, setBacktrackOptOut])

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

  if (registeredStudentName.trim().length === 0) {
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
          {joinError ? <p className="text-sm text-red-600">{joinError}</p> : null}
          <button
            type="submit"
            disabled={isRegisteringStudent}
            className="px-3 py-2 rounded bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
          >
            {isRegisteringStudent ? 'Joining…' : 'Join Presentation'}
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
          {isBacktrackOptOut ? (
            <button
              type="button"
              onClick={handleFastForwardToInstructor}
              className="ml-2 px-2 py-1 rounded border border-indigo-600 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
              title="Fast-forward to instructor"
              aria-label="Fast-forward to instructor"
            >
              ⏩
            </button>
          ) : null}
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
