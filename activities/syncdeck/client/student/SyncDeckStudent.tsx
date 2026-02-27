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

type ChalkboardRelayAction = 'chalkboardStroke' | 'chalkboardState'

interface RevealCommandPayload {
  [key: string]: unknown
}

interface RevealSyncStatePayload {
  capabilities?: unknown
  navigation?: unknown
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
  navigation?: unknown
  studentBoundary?: unknown
}

type SyncDeckDrawingToolMode = 'none' | 'chalkboard' | 'pen'
type SyncDeckNavigationDirection = 'left' | 'right' | 'up' | 'down'

interface SyncDeckNavigationCapabilities {
  canNavigateBack: boolean
  canNavigateForward: boolean
  canNavigateUp?: boolean
  canNavigateDown?: boolean
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

function buildDirectionalSlideIndices(
  current: { h: number; v: number; f: number } | null,
  direction: SyncDeckNavigationDirection,
): { h: number; v: number; f: number } | null {
  if (!current) {
    return null
  }

  if (direction === 'left') {
    if (current.h <= 0) {
      return null
    }
    return { h: current.h - 1, v: current.v, f: 0 }
  }

  if (direction === 'right') {
    return { h: current.h + 1, v: current.v, f: 0 }
  }

  if (direction === 'up') {
    if (current.v <= 0) {
      return null
    }
    return { h: current.h, v: current.v - 1, f: 0 }
  }

  return { h: current.h, v: current.v + 1, f: 0 }
}

export function extractNavigationCapabilities(payload: unknown): SyncDeckNavigationCapabilities | null {
  if (!isPlainObject(payload)) {
    return null
  }

  const message = payload as RevealSyncEnvelope
  if (message.type !== 'reveal-sync' || (message.action !== 'ready' && message.action !== 'state') || !isPlainObject(message.payload)) {
    return null
  }

  const statePayload = message.payload as { capabilities?: unknown; navigation?: unknown }
  if (isPlainObject(statePayload.capabilities)) {
    const capabilities = statePayload.capabilities as {
      canNavigateBack?: unknown
      canNavigateForward?: unknown
      canNavigateUp?: unknown
      canNavigateDown?: unknown
    }
    if (typeof capabilities.canNavigateBack !== 'boolean' || typeof capabilities.canNavigateForward !== 'boolean') {
      return null
    }

    return {
      canNavigateBack: capabilities.canNavigateBack,
      canNavigateForward: capabilities.canNavigateForward,
      ...(typeof capabilities.canNavigateUp === 'boolean' ? { canNavigateUp: capabilities.canNavigateUp } : {}),
      ...(typeof capabilities.canNavigateDown === 'boolean' ? { canNavigateDown: capabilities.canNavigateDown } : {}),
    }
  }

  if (!isPlainObject(statePayload.navigation)) {
    return null
  }

  const navigation = statePayload.navigation as {
    canGoBack?: unknown
    canGoForward?: unknown
  }
  if (typeof navigation.canGoBack !== 'boolean' || typeof navigation.canGoForward !== 'boolean') {
    return null
  }

  return {
    canNavigateBack: navigation.canGoBack,
    canNavigateForward: navigation.canGoForward,
  }
}

function isRevealSyncMessage(value: unknown): value is RevealSyncEnvelope {
  if (!isPlainObject(value)) {
    return false
  }

  return value.type === 'reveal-sync' && typeof value.action === 'string'
}

function isChalkboardRelayAction(action: unknown): action is ChalkboardRelayAction {
  return action === 'chalkboardStroke' || action === 'chalkboardState'
}

function toChalkboardCommandMessage(rawPayload: unknown): RevealCommandMessage | null {
  if (!isPlainObject(rawPayload)) {
    return null
  }

  const message = rawPayload as RevealSyncEnvelope
  const action = message.action
  const topLevelName = (rawPayload as { name?: unknown }).name

  if (message.type === 'reveal-sync' && action === 'command' && isPlainObject(message.payload)) {
    const commandPayload = message.payload as { name?: unknown; payload?: unknown }
    if (isChalkboardRelayAction(commandPayload.name)) {
      return buildBoundaryCommandEnvelope(message, commandPayload.name, isPlainObject(commandPayload.payload) ? commandPayload.payload : {})
    }
  }

  const resolvedAction =
    (isChalkboardRelayAction(action) ? action : null) ??
    (isChalkboardRelayAction(topLevelName) ? topLevelName : null)

  if (!resolvedAction) {
    return null
  }

  return buildBoundaryCommandEnvelope(
    message,
    resolvedAction,
    isPlainObject(message.payload) ? (message.payload as Record<string, unknown>) : {},
  )
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

export function extractIndicesFromRevealStateMessage(rawPayload: unknown): { h: number; v: number; f: number } | null {
  if (!isPlainObject(rawPayload)) {
    return null
  }

  const legacyMessage = rawPayload as { type?: unknown; payload?: unknown }
  if (legacyMessage.type === 'slidechanged' && isPlainObject(legacyMessage.payload)) {
    const legacyPayload = legacyMessage.payload as { h?: unknown; v?: unknown; f?: unknown }
    return normalizeIndices({
      h: legacyPayload.h,
      v: legacyPayload.v,
      f: legacyPayload.f,
    })
  }

  const message = rawPayload as RevealSyncEnvelope
  if (message.type !== 'reveal-sync') {
    return null
  }

  if (!isPlainObject(message.payload)) {
    return null
  }

  if (message.action === 'command') {
    const commandPayload = message.payload as { name?: unknown; payload?: unknown }
    if (commandPayload.name === 'setState' && isPlainObject(commandPayload.payload)) {
      const statePayload = commandPayload.payload as { state?: unknown }
      if (isPlainObject(statePayload.state)) {
        const state = statePayload.state as { indexh?: unknown; indexv?: unknown; indexf?: unknown }
        return normalizeIndices({
          h: state.indexh,
          v: state.indexv,
          f: state.indexf,
        })
      }
    }
  }

  if (message.action !== 'state' && message.action !== 'ready') {
    return null
  }

  const payload = message.payload as RevealStateIndicesPayload
  return normalizeIndices(payload.indices)
    ?? (isPlainObject(payload.navigation)
      ? normalizeIndices((payload.navigation as { current?: unknown }).current)
      : null)
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

export function toRevealCommandMessage(rawPayload: unknown): Record<string, unknown> | RevealCommandMessage | null {
  const chalkboardCommand = toChalkboardCommandMessage(rawPayload)
  if (chalkboardCommand != null) {
    return chalkboardCommand
  }

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

  if (message.action === 'paused') {
    return buildBoundaryCommandEnvelope(message, 'setState', {
      state: {
        paused: true,
      },
    })
  }

  if (message.action === 'resumed') {
    return buildBoundaryCommandEnvelope(message, 'setState', {
      state: {
        paused: false,
      },
    })
  }

  if (message.action !== 'state' || !isPlainObject(message.payload)) {
    return null
  }

  const statePayload = message.payload as {
    revealState?: unknown
    indices?: { h?: unknown; v?: unknown; f?: unknown }
    paused?: unknown
  }

  const revealState = isPlainObject(statePayload.revealState) ? statePayload.revealState : null
  const indices = isPlainObject(statePayload.indices) ? statePayload.indices : null
  const pausedFromPayload = typeof statePayload.paused === 'boolean' ? statePayload.paused : null
  const pausedFromRevealState =
    typeof (revealState as { paused?: unknown } | null)?.paused === 'boolean'
      ? ((revealState as { paused?: unknown }).paused as boolean)
      : null
  const pausedState = pausedFromPayload ?? pausedFromRevealState
  const mergedState = {
    ...(revealState ?? {}),
    indexh: typeof indices?.h === 'number' ? indices.h : (revealState as { indexh?: unknown } | null)?.indexh ?? 0,
    indexv: typeof indices?.v === 'number' ? indices.v : (revealState as { indexv?: unknown } | null)?.indexv ?? 0,
    indexf: typeof indices?.f === 'number' ? indices.f : (revealState as { indexf?: unknown } | null)?.indexf ?? 0,
    ...(typeof pausedState === 'boolean' ? { paused: pausedState } : {}),
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

function parseDrawingToolModePayload(payload: unknown): SyncDeckDrawingToolMode | null {
  if (!isPlainObject(payload) || payload.type !== 'syncdeck-tool-mode') {
    return null
  }

  if (payload.mode === 'chalkboard' || payload.mode === 'pen' || payload.mode === 'none') {
    return payload.mode
  }

  return null
}

export function buildStudentWebSocketUrl(params: {
  sessionId?: string | null
  presentationUrl?: string | null
  studentId?: string | null
  studentName?: string | null
  protocol?: string | null
  host?: string | null
}): string | null {
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId.trim() : ''
  const presentationUrl = typeof params.presentationUrl === 'string' ? params.presentationUrl.trim() : ''
  const studentId = typeof params.studentId === 'string' ? params.studentId.trim() : ''
  const studentName = typeof params.studentName === 'string' ? params.studentName.trim() : ''
  const protocol = typeof params.protocol === 'string' ? params.protocol : ''
  const host = typeof params.host === 'string' ? params.host.trim() : ''

  if (!sessionId || !presentationUrl || !studentId || !host) {
    return null
  }

  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:'
  const queryParams = new URLSearchParams({
    sessionId,
    studentId,
    studentName: studentName || 'Student',
  })

  return `${wsProtocol}//${host}/ws/syncdeck?${queryParams.toString()}`
}

export function resolveIframePostMessageTargetOrigin(params: {
  observedOrigin?: string | null
  configuredOrigin?: string | null
  iframeRuntimeOrigin?: string | null
}): string | null {
  const observedOrigin = typeof params.observedOrigin === 'string' ? params.observedOrigin.trim() : ''
  const configuredOrigin = typeof params.configuredOrigin === 'string' ? params.configuredOrigin.trim() : ''
  const iframeRuntimeOrigin = typeof params.iframeRuntimeOrigin === 'string' ? params.iframeRuntimeOrigin.trim() : ''

  if (observedOrigin && observedOrigin !== 'null') {
    return observedOrigin
  }

  if (iframeRuntimeOrigin && iframeRuntimeOrigin !== 'null') {
    return iframeRuntimeOrigin
  }

  return configuredOrigin || null
}

function getStoredStudentName(sessionId: string): string {
  if (typeof window === 'undefined') {
    return ''
  }

  const stored = window.sessionStorage.getItem(`syncdeck_student_name_${sessionId}`)
  return typeof stored === 'string' ? stored.trim() : ''
}

function getStoredStudentId(sessionId: string): string {
  if (typeof window === 'undefined') {
    return ''
  }

  const stored = window.sessionStorage.getItem(`syncdeck_student_id_${sessionId}`)
  return typeof stored === 'string' ? stored.trim() : ''
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

export function isForwardNavigationLocked(
  studentHasBacktrackOptOut: boolean,
  studentPosition: { h: number; v: number; f: number } | null,
  maxPosition: { h: number; v: number; f: number } | null,
): boolean {
  if (studentHasBacktrackOptOut || !studentPosition || !maxPosition) {
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
  const [navigationIndices, setNavigationIndices] = useState<{ h: number; v: number; f: number } | null>(null)
  const [navigationCapabilities, setNavigationCapabilities] = useState<SyncDeckNavigationCapabilities | null>(null)
  const [effectiveMaxPosition, setEffectiveMaxPosition] = useState<{ h: number; v: number; f: number } | null>(null)
  const [studentNameInput, setStudentNameInput] = useState('')
  const [registeredStudentName, setRegisteredStudentName] = useState('')
  const [registeredStudentId, setRegisteredStudentId] = useState('')
  const [isRegisteringStudent, setIsRegisteringStudent] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const pendingPayloadQueueRef = useRef<unknown[]>([])
  const localStudentIndicesRef = useRef<{ h: number; v: number; f: number } | null>(null)
  const lastInstructorIndicesRef = useRef<{ h: number; v: number; f: number } | null>(null)
  const lastEffectiveMaxPositionRef = useRef<{ h: number; v: number; f: number } | null>(null)
  const latestInstructorPayloadRef = useRef<unknown>(null)
  const activeDrawingToolModeRef = useRef<SyncDeckDrawingToolMode>('none')
  const pendingDrawingToolModeRef = useRef<SyncDeckDrawingToolMode | null>(null)
  const hasSeenIframeReadySignalRef = useRef(false)
  const lastObservedIframeOriginRef = useRef<string | null>(null)
  const studentBacktrackOptOutRef = useRef(false)
  const attachSessionEndedHandler = useSessionEndedHandler()

  useEffect(() => {
    if (!sessionId) {
      return
    }

    const storedName = getStoredStudentName(sessionId)
    const storedStudentId = getStoredStudentId(sessionId)
    setStudentNameInput(storedName)

    if (storedName.length > 0 && storedStudentId.length > 0) {
      setRegisteredStudentName(storedName)
      setRegisteredStudentId(storedStudentId)
    }
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

  const getIframeRuntimeOrigin = useCallback((): string | null => {
    try {
      const runtimeOrigin = iframeRef.current?.contentWindow?.location.origin
      return typeof runtimeOrigin === 'string' ? runtimeOrigin : null
    } catch {
      return null
    }
  }, [])

  const sendPayloadToIframe = useCallback((payload: unknown) => {
    if (!presentationOrigin) {
      pendingPayloadQueueRef.current.push(payload)
      return
    }

    const target = iframeRef.current?.contentWindow
    if (!target) {
      pendingPayloadQueueRef.current.push(payload)
      return
    }

    const targetOrigin = resolveIframePostMessageTargetOrigin({
      observedOrigin: lastObservedIframeOriginRef.current,
      configuredOrigin: presentationOrigin,
      iframeRuntimeOrigin: getIframeRuntimeOrigin(),
    })
    if (!targetOrigin) {
      pendingPayloadQueueRef.current.push(payload)
      return
    }

    try {
      target.postMessage(payload, targetOrigin)
    } catch {
      pendingPayloadQueueRef.current.push(payload)
    }
  }, [getIframeRuntimeOrigin, presentationOrigin])

  const setBacktrackOptOut = useCallback((value: boolean) => {
    studentBacktrackOptOutRef.current = value
    setIsBacktrackOptOut(value)
  }, [])

  const applyDrawingToolModeToIframe = useCallback(
    (nextMode: SyncDeckDrawingToolMode): void => {
      const target = iframeRef.current?.contentWindow
      if (!target || !presentationOrigin || !hasSeenIframeReadySignalRef.current) {
        pendingDrawingToolModeRef.current = nextMode
        return
      }

      const currentMode = activeDrawingToolModeRef.current
      if (currentMode === nextMode) {
        pendingDrawingToolModeRef.current = null
        return
      }

      const postToolToggle = (method: 'toggleChalkboard' | 'toggleNotesCanvas') => {
        const targetOrigin = resolveIframePostMessageTargetOrigin({
          observedOrigin: lastObservedIframeOriginRef.current,
          configuredOrigin: presentationOrigin,
          iframeRuntimeOrigin: getIframeRuntimeOrigin(),
        })
        if (!targetOrigin) {
          return
        }

        try {
          target.postMessage(
            buildRevealCommandMessage('chalkboardCall', {
              method,
              args: [],
            }),
            targetOrigin,
          )
        } catch {
          pendingDrawingToolModeRef.current = nextMode
        }
      }

      if (currentMode === 'chalkboard') {
        postToolToggle('toggleChalkboard')
      } else if (currentMode === 'pen') {
        postToolToggle('toggleNotesCanvas')
      }

      if (nextMode === 'chalkboard') {
        postToolToggle('toggleChalkboard')
      } else if (nextMode === 'pen') {
        postToolToggle('toggleNotesCanvas')
      }

      activeDrawingToolModeRef.current = nextMode
      pendingDrawingToolModeRef.current = null
    },
    [getIframeRuntimeOrigin, presentationOrigin],
  )

  const handleWsMessage = useCallback(
    (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as SyncDeckWsMessage
        if (parsed.type !== 'syncdeck-state') {
          return
        }

        const drawingToolMode = parseDrawingToolModePayload(parsed.payload)
        if (drawingToolMode) {
          applyDrawingToolModeToIframe(drawingToolMode)
          return
        }

        const instructorIndices = extractIndicesFromRevealStateMessage(parsed.payload)
        if (instructorIndices) {
          latestInstructorPayloadRef.current = parsed.payload
          lastInstructorIndicesRef.current = instructorIndices
          if (localStudentIndicesRef.current == null) {
            setNavigationIndices(instructorIndices)
          }
        }

        if (isForceSyncBoundaryCommand(parsed.payload) && studentBacktrackOptOutRef.current) {
          setBacktrackOptOut(false)
        }

        const boundaryDetails = computeBoundaryDetails(
          parsed.payload,
          localStudentIndicesRef.current,
          lastInstructorIndicesRef.current,
        )
        lastEffectiveMaxPositionRef.current = boundaryDetails?.effectiveBoundary ?? null
        setEffectiveMaxPosition(lastEffectiveMaxPositionRef.current)

        if (
          shouldResetBacktrackOptOutByMaxPosition(
            studentBacktrackOptOutRef.current,
            localStudentIndicesRef.current,
            lastEffectiveMaxPositionRef.current,
          )
        ) {
          setBacktrackOptOut(false)
        }

        const boundaryCommand = toRevealBoundaryCommandMessage(
          parsed.payload,
          localStudentIndicesRef.current,
          lastInstructorIndicesRef.current,
        )
        if (boundaryCommand != null) {
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
          if (!suppressForwardSync) {
            sendPayloadToIframe(revealCommand)
          }
        }

        setStatusMessage('Receiving instructor sync…')
      } catch {
        return
      }
    },
    [applyDrawingToolModeToIframe, sendPayloadToIframe, setBacktrackOptOut],
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
      sendPayloadToIframe(boundaryCommand)
    }

    const revealCommand = toRevealCommandMessage(payload)
    if (revealCommand != null) {
      sendPayloadToIframe(revealCommand)
    }
  }, [sendPayloadToIframe])

  useEffect(() => {
    const handleIframeMessage = (event: MessageEvent) => {
      const iframeWindow = iframeRef.current?.contentWindow
      if (!iframeWindow || event.source !== iframeWindow) {
        return
      }

      if (typeof event.origin === 'string' && event.origin.length > 0 && event.origin !== 'null') {
        lastObservedIframeOriginRef.current = event.origin
      }

      const storyboardDisplayed = extractStoryboardDisplayed(event.data)
      if (typeof storyboardDisplayed === 'boolean') {
        setIsStoryboardOpen(storyboardDisplayed)
      }

      const localIndices = extractIndicesFromRevealStateMessage(event.data)
      if (localIndices) {
        const previousLocalIndices = localStudentIndicesRef.current
        localStudentIndicesRef.current = localIndices
        setNavigationIndices(localIndices)

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
        }

        if (shouldResetBacktrackOptOutByMaxPosition(studentBacktrackOptOutRef.current, localIndices, maxPosition)) {
          setBacktrackOptOut(false)
        }
      }

      const nextNavigationCapabilities = extractNavigationCapabilities(event.data)
      if (nextNavigationCapabilities) {
        setNavigationCapabilities(nextNavigationCapabilities)
      }

      if (!hasSeenIframeReadySignalRef.current && isRevealSyncMessage(event.data)) {
        hasSeenIframeReadySignalRef.current = true
        if (pendingPayloadQueueRef.current.length > 0) {
          const queuedPayloads = [...pendingPayloadQueueRef.current]
          pendingPayloadQueueRef.current = []
          for (const queuedPayload of queuedPayloads) {
            sendPayloadToIframe(queuedPayload)
          }
        }
        if (pendingDrawingToolModeRef.current != null) {
          applyDrawingToolModeToIframe(pendingDrawingToolModeRef.current)
        }
        replayLatestInstructorSyncToIframe()
      }
    }

    window.addEventListener('message', handleIframeMessage)
    return () => {
      window.removeEventListener('message', handleIframeMessage)
    }
  }, [applyDrawingToolModeToIframe, replayLatestInstructorSyncToIframe, sendPayloadToIframe, setBacktrackOptOut])

  const buildStudentWsUrl = useCallback((): string | null => {
    if (typeof window === 'undefined') {
      return null
    }

    return buildStudentWebSocketUrl({
      sessionId,
      presentationUrl,
      studentId: registeredStudentId,
      studentName: registeredStudentName,
      protocol: window.location.protocol,
      host: window.location.host,
    })
  }, [sessionId, presentationUrl, registeredStudentId, registeredStudentName])

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
  }, [sessionId, presentationUrl, registeredStudentName, registeredStudentId, connectStudentWs, disconnectStudentWs])

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

      const payload = (await response.json()) as { studentId?: unknown; name?: unknown }
      const nextStudentId = typeof payload.studentId === 'string' ? payload.studentId.trim() : ''
      const nextStudentName =
        typeof payload.name === 'string' && payload.name.trim().length > 0
          ? payload.name.trim().slice(0, 80)
          : normalized

      if (nextStudentId.length === 0) {
        setJoinError('Unable to join this presentation right now. Please try again.')
        return
      }

      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(`syncdeck_student_name_${sessionId}`, nextStudentName)
        window.sessionStorage.setItem(`syncdeck_student_id_${sessionId}`, nextStudentId)
      }

      setRegisteredStudentName(nextStudentName)
      setRegisteredStudentId(nextStudentId)
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

    if (studentSocketRef.current?.readyState === WS_OPEN_READY_STATE) {
      setStatusMessage('Connected to instructor sync')
    }
  }, [sendPayloadToIframe, studentSocketRef])

  const toggleStoryboard = useCallback(() => {
    sendPayloadToIframe(
      buildRevealCommandMessage('toggleOverview', {}),
    )
  }, [sendPayloadToIframe])

  const handleDirectionalNavigation = useCallback((direction: SyncDeckNavigationDirection) => {
    const canNavigateBack = navigationCapabilities?.canNavigateBack
      ?? Boolean(navigationIndices && (navigationIndices.h > 0 || navigationIndices.v > 0 || navigationIndices.f > 0))
    const canNavigateForward = navigationCapabilities?.canNavigateForward ?? true
    const forwardLocked = isForwardNavigationLocked(isBacktrackOptOut, navigationIndices, effectiveMaxPosition)

    if ((direction === 'left' || direction === 'up') && !canNavigateBack) {
      return
    }

    if ((direction === 'right' || direction === 'down') && (!canNavigateForward || forwardLocked)) {
      return
    }

    const targetIndices = buildDirectionalSlideIndices(navigationIndices, direction)
    if (!targetIndices) {
      return
    }

    sendPayloadToIframe(
      buildRevealCommandMessage('slide', targetIndices),
    )
    setNavigationIndices(targetIndices)
    localStudentIndicesRef.current = targetIndices
  }, [effectiveMaxPosition, isBacktrackOptOut, navigationCapabilities, navigationIndices, sendPayloadToIframe])

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
  }, [sendPayloadToIframe, setBacktrackOptOut])

  const canNavigateBack = navigationCapabilities?.canNavigateBack
    ?? Boolean(navigationIndices && (navigationIndices.h > 0 || navigationIndices.v > 0 || navigationIndices.f > 0))
  const canNavigateForward = navigationCapabilities?.canNavigateForward ?? true
  const forwardLocked = isForwardNavigationLocked(isBacktrackOptOut, navigationIndices, effectiveMaxPosition)
  const canNavigateLeft = Boolean(navigationIndices && navigationIndices.h > 0 && canNavigateBack)
  const canNavigateUp = Boolean(
    navigationIndices &&
    canNavigateBack &&
    (navigationCapabilities?.canNavigateUp ?? navigationIndices.v > 0),
  )
  const canNavigateRight = Boolean(navigationIndices && canNavigateForward && !forwardLocked)
  const canNavigateDown = Boolean(
    navigationIndices &&
    canNavigateForward &&
    !forwardLocked &&
    (navigationCapabilities?.canNavigateDown ?? false),
  )

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

      <div className="flex-1 min-h-0 w-full overflow-hidden bg-white relative">
        <iframe
          ref={iframeRef}
          title="SyncDeck Student Presentation"
          src={presentationUrl}
          className="w-full h-full"
          allow="fullscreen"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          onLoad={handleIframeLoad}
        />
        <button
          type="button"
          onClick={() => handleDirectionalNavigation('left')}
          disabled={!canNavigateLeft}
          aria-label="Previous horizontal slide"
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 px-3 py-2 rounded-full border border-gray-300 bg-white/85 text-gray-700 shadow hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ◀
        </button>
        <button
          type="button"
          onClick={() => handleDirectionalNavigation('right')}
          disabled={!canNavigateRight}
          aria-label={forwardLocked ? 'Next horizontal slide locked by instructor' : 'Next horizontal slide'}
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 px-3 py-2 rounded-full border border-gray-300 bg-white/85 text-gray-700 shadow hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ▶
        </button>
        <button
          type="button"
          onClick={() => handleDirectionalNavigation('up')}
          disabled={!canNavigateUp}
          aria-label="Previous vertical slide"
          className="absolute top-3 left-1/2 -translate-x-1/2 z-10 px-3 py-2 rounded-full border border-gray-300 bg-white/85 text-gray-700 shadow hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ▲
        </button>
        <button
          type="button"
          onClick={() => handleDirectionalNavigation('down')}
          disabled={!canNavigateDown}
          aria-label={forwardLocked ? 'Next vertical slide locked by instructor' : 'Next vertical slide'}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 px-3 py-2 rounded-full border border-gray-300 bg-white/85 text-gray-700 shadow hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ▼
        </button>
      </div>
    </div>
  )
}

export default SyncDeckStudent
