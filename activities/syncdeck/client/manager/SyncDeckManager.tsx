import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import { runSyncDeckPresentationPreflight } from '../shared/presentationPreflight.js'
import {
  getStudentPresentationCompatibilityError,
} from '../shared/presentationUrlCompatibility.js'
import { shouldRelayRevealSyncPayloadToSession } from '../shared/revealSyncRelayPolicy.js'
import { useCallback, useEffect, useMemo, useRef, useState, type FC, type FormEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import ConnectionStatusDot from '../components/ConnectionStatusDot.js'

const SYNCDECK_PASSCODE_KEY_PREFIX = 'syncdeck_instructor_'
const SYNCDECK_CHALKBOARD_OPEN_KEY_PREFIX = 'syncdeck_chalkboard_open_'
const WS_OPEN_READY_STATE = 1
const DISCONNECTED_STATUS_DELAY_MS = 250
const SLIDE_END_FRAGMENT_INDEX = Number.MAX_SAFE_INTEGER
const RESTORE_SUPPRESSION_TIMEOUT_MS = 2500
const PRESENTATION_URL_ERROR_ID = 'syncdeck-presentation-url-error'

interface SessionResponsePayload {
  session?: {
    data?: {
      presentationUrl?: unknown
    }
  }
}

interface InstructorPasscodeResponsePayload {
  instructorPasscode?: unknown
  persistentPresentationUrl?: unknown
  persistentUrlHash?: unknown
}

interface SyncDeckStudentPresenceMessage {
  type?: unknown
  payload?: {
    connectedCount?: unknown
    students?: unknown
  }
}

interface SyncDeckStateSnapshotMessage {
  type?: unknown
  payload?: unknown
}

interface RevealCommandPayload {
  [key: string]: unknown
}

interface RevealStatePayload {
  indices?: unknown
  navigation?: unknown
  revealState?: unknown
  indexh?: unknown
  indexv?: unknown
  indexf?: unknown
}

interface RevealSyncEnvelope {
  type?: unknown
  version?: unknown
  action?: unknown
  source?: unknown
  role?: unknown
  payload?: unknown
}

type ChalkboardRelayAction = 'chalkboardStroke' | 'chalkboardState'
interface RelayCommandPayloadEnvelope {
  name?: unknown
  payload?: unknown
}

type SyncDeckDrawingToolMode = 'none' | 'chalkboard' | 'pen'

interface RevealSyncStatePayload {
  capabilities?: unknown
  navigation?: unknown
  overview?: unknown
  paused?: unknown
  storyboardDisplayed?: unknown
  open?: unknown
  isOpen?: unknown
  visible?: unknown
  revealState?: unknown
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
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

function extractPausedState(data: unknown): boolean | null {
  const fromPayload = (payload: unknown): boolean | null => {
    if (payload == null || typeof payload !== 'object') {
      return null
    }

    const statePayload = payload as RevealSyncStatePayload
    if (typeof statePayload.paused === 'boolean') {
      return statePayload.paused
    }

    if (statePayload.revealState != null && typeof statePayload.revealState === 'object') {
      const revealState = statePayload.revealState as { paused?: unknown }
      if (typeof revealState.paused === 'boolean') {
        return revealState.paused
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

    if (envelope.action === 'paused') {
      return true
    }
    if (envelope.action === 'resumed') {
      return false
    }

    if (envelope.action === 'state') {
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

function extractPauseStateFromCommand(data: unknown): boolean | null {
  const envelope = parseRevealSyncEnvelope(data)
  if (!envelope || envelope.type !== 'reveal-sync') {
    return null
  }

  if (envelope.action !== 'command' || !isPlainObject(envelope.payload)) {
    return null
  }

  const commandName = envelope.payload.name
  if (commandName === 'pause') {
    return true
  }

  if (commandName === 'resume') {
    return false
  }

  return null
}

export function includePausedInStateEnvelope(data: unknown, fallbackPaused: boolean | null = null): unknown {
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
      revealState?: unknown
      [key: string]: unknown
    }
    [key: string]: unknown
  }

  const pausedFromPayload = extractPausedState(data)
  const resolvedPaused = typeof fallbackPaused === 'boolean' ? fallbackPaused : pausedFromPayload
  if (typeof resolvedPaused !== 'boolean') {
    return data
  }

  const revealState =
    envelope.payload.revealState != null && typeof envelope.payload.revealState === 'object'
      ? ({ ...(envelope.payload.revealState as Record<string, unknown>), paused: resolvedPaused } as Record<string, unknown>)
      : ({ paused: resolvedPaused } as Record<string, unknown>)

  return {
    ...envelope,
    payload: {
      ...envelope.payload,
      paused: resolvedPaused,
      revealState,
    },
  }
}

export function buildPausedSnapshotFromAction(
  actionPayload: unknown,
  lastStatePayload: unknown,
): unknown | null {
  if (!isPlainObject(actionPayload)) {
    return null
  }

  const envelope = actionPayload as RevealSyncEnvelope
  if (envelope.type !== 'reveal-sync') {
    return null
  }

  if (envelope.action !== 'paused' && envelope.action !== 'resumed') {
    return null
  }

  if (lastStatePayload == null) {
    return null
  }

  return includePausedInStateEnvelope(lastStatePayload, envelope.action === 'paused')
}

interface SyncDeckStudentPresence {
  studentId: string
  name: string
  connected: boolean
}

function buildSyncDeckPasscodeKey(sessionId: string): string {
  return `${SYNCDECK_PASSCODE_KEY_PREFIX}${sessionId}`
}

function buildSyncDeckChalkboardOpenKey(sessionId: string): string {
  return `${SYNCDECK_CHALKBOARD_OPEN_KEY_PREFIX}${sessionId}`
}

export function validatePresentationUrl(value: string, hostProtocol?: string | null, userAgent?: string | null): boolean {
  return value.trim().length > 0 && getStudentPresentationCompatibilityError({
    value,
    hostProtocol,
    userAgent,
  }) == null
}

export function shouldReopenConfigurePanel(isConfigurePanelOpen: boolean, presentationUrlError: string | null): boolean {
  return presentationUrlError != null && !isConfigurePanelOpen
}

export function shouldAutoActivatePresentationUrl(
  value: string,
  hostProtocol?: string | null,
  userAgent?: string | null,
): boolean {
  return validatePresentationUrl(value, hostProtocol, userAgent)
}

export function resolveRecoveredPresentationUrl(
  currentValue: string,
  recoveredValue: string | null,
  hostProtocol?: string | null,
  userAgent?: string | null,
): string {
  const normalizedCurrent = currentValue.trim()
  if (validatePresentationUrl(normalizedCurrent, hostProtocol, userAgent) || recoveredValue == null) {
    return normalizedCurrent
  }

  return recoveredValue
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

function normalizeIndices(value: unknown): { h: number; v: number; f: number } | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const candidate = value as { h?: unknown; v?: unknown; f?: unknown }
  if (typeof candidate.h !== 'number' || !Number.isFinite(candidate.h)) {
    return null
  }
  if (typeof candidate.v !== 'number' || !Number.isFinite(candidate.v)) {
    return null
  }

  const fragment = typeof candidate.f === 'number' && Number.isFinite(candidate.f) ? candidate.f : 0
  return {
    h: candidate.h,
    v: candidate.v,
    f: fragment,
  }
}

function compareIndices(a: { h: number; v: number; f: number }, b: { h: number; v: number; f: number }): number {
  if (a.h !== b.h) return a.h - b.h
  if (a.v !== b.v) return a.v - b.v
  return a.f - b.f
}

export function evaluateRestoreSuppressionForOutboundState(params: {
  suppressOutboundUntilRestore: boolean
  restoreTargetIndices: { h: number; v: number; f: number } | null
  instructorIndices: { h: number; v: number; f: number } | null
}): { shouldDrop: boolean; shouldRelease: boolean } {
  if (!params.suppressOutboundUntilRestore) {
    return { shouldDrop: false, shouldRelease: false }
  }

  const hasReachedRestoreTarget =
    params.restoreTargetIndices != null &&
    params.instructorIndices != null &&
    compareIndices(params.instructorIndices, params.restoreTargetIndices) >= 0

  if (!hasReachedRestoreTarget) {
    return { shouldDrop: true, shouldRelease: false }
  }

  // Drop the first outbound state that confirms restore completion to avoid instructor-to-instructor echo.
  return { shouldDrop: true, shouldRelease: true }
}

function toSlideEndBoundary(indices: { h: number; v: number; f: number }): { h: number; v: number; f: number } {
  return {
    h: indices.h,
    v: indices.v,
    f: SLIDE_END_FRAGMENT_INDEX,
  }
}

function extractIndicesFromRevealStateObject(value: unknown): { h: number; v: number; f: number } | null {
  if (!isPlainObject(value)) {
    return null
  }

  const candidate = value as {
    indexh?: unknown
    indexv?: unknown
    indexf?: unknown
    h?: unknown
    v?: unknown
    f?: unknown
  }

  if (typeof candidate.indexh === 'number' && Number.isFinite(candidate.indexh) && typeof candidate.indexv === 'number' && Number.isFinite(candidate.indexv)) {
    return {
      h: candidate.indexh,
      v: candidate.indexv,
      f: typeof candidate.indexf === 'number' && Number.isFinite(candidate.indexf) ? candidate.indexf : 0,
    }
  }

  if (typeof candidate.h === 'number' && Number.isFinite(candidate.h) && typeof candidate.v === 'number' && Number.isFinite(candidate.v)) {
    return {
      h: candidate.h,
      v: candidate.v,
      f: typeof candidate.f === 'number' && Number.isFinite(candidate.f) ? candidate.f : 0,
    }
  }

  return null
}

export function shouldSuppressInstructorStateBroadcast(
  instructorIndices: { h: number; v: number; f: number } | null,
  explicitBoundary: { h: number; v: number; f: number } | null,
): boolean {
  if (!instructorIndices || !explicitBoundary) {
    return false
  }

  return compareIndices(instructorIndices, explicitBoundary) <= 0
}

export function buildBoundaryClearedPayload(
  instructorIndices: { h: number; v: number; f: number },
): Record<string, unknown> {
  return {
    type: 'reveal-sync',
    version: '1.0.0',
    action: 'studentBoundaryChanged',
    source: 'activebits-syncdeck-host',
    role: 'instructor',
    ts: Date.now(),
    payload: {
      reason: 'instructorSet',
      studentBoundary: null,
      indices: instructorIndices,
    },
  }
}

function parseRevealSyncEnvelope(data: unknown): RevealSyncEnvelope | null {
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data) as unknown
      return parsed != null && typeof parsed === 'object' ? (parsed as RevealSyncEnvelope) : null
    } catch {
      return null
    }
  }

  return data != null && typeof data === 'object' ? (data as RevealSyncEnvelope) : null
}

function extractRevealCommandName(data: unknown): string | null {
  const envelope = parseRevealSyncEnvelope(data)
  if (!envelope || envelope.type !== 'reveal-sync') {
    return null
  }

  if (typeof envelope.action === 'string' && envelope.action !== 'command') {
    return envelope.action
  }

  if (envelope.action === 'command' && isPlainObject(envelope.payload) && typeof envelope.payload.name === 'string') {
    return envelope.payload.name
  }

  return null
}

function isInboundChalkboardReplayCommand(name: string | null): boolean {
  return name === 'chalkboardState' || name === 'chalkboardStroke'
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

function buildDrawingToolModePayload(mode: SyncDeckDrawingToolMode): Record<string, unknown> {
  return {
    type: 'syncdeck-tool-mode',
    mode,
  }
}

function isChalkboardRelayAction(action: unknown): action is ChalkboardRelayAction {
  return action === 'chalkboardStroke' || action === 'chalkboardState'
}

function toChalkboardAction(value: unknown): ChalkboardRelayAction | null {
  return isChalkboardRelayAction(value) ? value : null
}

function asRelayCommandPayloadEnvelope(value: unknown): RelayCommandPayloadEnvelope | null {
  return isPlainObject(value) ? (value as RelayCommandPayloadEnvelope) : null
}

export function toChalkboardRelayCommand(rawPayload: unknown): Record<string, unknown> | null {
  const envelope = parseRevealSyncEnvelope(rawPayload)
  const directAction = toChalkboardAction(envelope?.action)
  const directName = toChalkboardAction((rawPayload as { name?: unknown } | null)?.name)

  const commandEnvelope = asRelayCommandPayloadEnvelope(envelope?.payload)
  const commandName = toChalkboardAction(commandEnvelope?.name)
  if (envelope?.type === 'reveal-sync' && envelope.action === 'command' && commandName) {
    return {
      type: 'reveal-sync',
      version: typeof envelope.version === 'string' ? envelope.version : '1.0.0',
      action: 'command',
      source: 'activebits-syncdeck-host',
      role: 'instructor',
      ts: Date.now(),
      payload: {
        name: commandName,
        payload: commandEnvelope?.payload,
      },
    }
  }

  const topLevelAction = toChalkboardAction((rawPayload as { action?: unknown } | null)?.action)
  const topLevelName = toChalkboardAction((rawPayload as { name?: unknown } | null)?.name)
  const action = directAction ?? directName ?? topLevelAction ?? topLevelName
  if (!action) {
    return null
  }

  const payloadFromEnvelope = envelope?.payload
  const payloadFromRaw = (rawPayload as { payload?: unknown } | null)?.payload

  return {
    type: 'reveal-sync',
    version: typeof envelope?.version === 'string' ? envelope.version : '1.0.0',
    action: 'command',
    source: 'activebits-syncdeck-host',
    role: 'instructor',
    ts: Date.now(),
    payload: {
      name: action,
      payload: payloadFromEnvelope ?? payloadFromRaw,
    },
  }
}

function readChalkboardSnapshotStorage(payload: unknown): string | null {
  if (!isPlainObject(payload)) {
    return null
  }

  if (payload.type !== 'reveal-sync' || payload.action !== 'command' || !isPlainObject(payload.payload)) {
    return null
  }

  if (payload.payload.name !== 'chalkboardState' || !isPlainObject(payload.payload.payload)) {
    return null
  }

  const storage = payload.payload.payload.storage
  if (typeof storage !== 'string') {
    return null
  }

  return storage
}

function buildChalkboardStateRelayWithStorage(storage: string, template: unknown): Record<string, unknown> {
  const envelope = parseRevealSyncEnvelope(template)
  return {
    type: 'reveal-sync',
    version: typeof envelope?.version === 'string' ? envelope.version : '1.0.0',
    action: 'command',
    source: 'activebits-syncdeck-host',
    role: 'instructor',
    ts: Date.now(),
    payload: {
      name: 'chalkboardState',
      payload: {
        storage,
      },
    },
  }
}

export function applyChalkboardSnapshotFallback(
  relayPayload: unknown,
  cachedSnapshotStorage: string | null,
): { relayPayload: unknown; restoredSnapshotStorage: string | null } {
  const storage = readChalkboardSnapshotStorage(relayPayload)
  if (storage == null) {
    return {
      relayPayload,
      restoredSnapshotStorage: null,
    }
  }

  if (storage.trim().length > 0 || cachedSnapshotStorage == null || cachedSnapshotStorage.trim().length === 0) {
    return {
      relayPayload,
      restoredSnapshotStorage: null,
    }
  }

  return {
    relayPayload: buildChalkboardStateRelayWithStorage(cachedSnapshotStorage, relayPayload),
    restoredSnapshotStorage: cachedSnapshotStorage,
  }
}

export function buildRestoreCommandFromPayload(payload: unknown): unknown {
  if (isPlainObject(payload)) {
    const legacyMessage = payload as { type?: unknown; payload?: unknown }
    if (legacyMessage.type === 'slidechanged' && isPlainObject(legacyMessage.payload)) {
      const indices = extractIndicesFromRevealStateObject(legacyMessage.payload)
      if (!indices) {
        return payload
      }

      return {
        type: 'reveal-sync',
        version: '1.0.0',
        action: 'command',
        source: 'activebits-syncdeck-host',
        role: 'instructor',
        ts: Date.now(),
        payload: {
          name: 'setState',
          payload: {
            state: {
              indexh: indices.h,
              indexv: indices.v,
              indexf: indices.f,
            },
          },
        },
      }
    }
  }

  const envelope = parseRevealSyncEnvelope(payload)
  if (!envelope || envelope.type !== 'reveal-sync') {
    return payload
  }

  if (envelope.action === 'command') {
    return payload
  }

  if ((envelope.action !== 'state' && envelope.action !== 'ready') || !isPlainObject(envelope.payload)) {
    return payload
  }

  const statePayload = envelope.payload as {
    revealState?: unknown
    indices?: { h?: unknown; v?: unknown; f?: unknown }
    navigation?: unknown
    indexh?: unknown
    indexv?: unknown
    indexf?: unknown
  }

  const revealState = isPlainObject(statePayload.revealState) ? statePayload.revealState : null
  const indices = normalizeIndices(statePayload.indices)
    ?? (isPlainObject(statePayload.navigation)
      ? normalizeIndices((statePayload.navigation as { current?: unknown }).current)
      : null)
    ?? extractIndicesFromRevealStateObject(revealState)
    ?? extractIndicesFromRevealStateObject(statePayload)
  if (!indices) {
    return payload
  }

  const pausedState = extractPausedState(payload)
  const mergedState = {
    ...(revealState ?? {}),
    indexh: indices.h,
    indexv: indices.v,
    indexf: indices.f,
    ...(typeof pausedState === 'boolean' ? { paused: pausedState } : {}),
  }

  return {
    type: 'reveal-sync',
    version: typeof envelope.version === 'string' ? envelope.version : '1.0.0',
    action: 'command',
    source: 'activebits-syncdeck-host',
    role: 'instructor',
    ts: Date.now(),
    payload: {
      name: 'setState',
      payload: {
        state: mergedState,
      },
    },
  }
}

export function extractSyncDeckStatePayload(message: unknown): unknown | null {
  if (message == null || typeof message !== 'object') {
    return null
  }

  const candidate = message as SyncDeckStateSnapshotMessage
  if (candidate.type !== 'syncdeck-state') {
    return null
  }

  return candidate.payload ?? null
}

export function extractIndicesFromRevealPayload(payload: unknown): { h: number; v: number; f: number } | null {
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  const legacyMessage = payload as { type?: unknown; payload?: unknown }
  if (legacyMessage.type === 'slidechanged' && isPlainObject(legacyMessage.payload)) {
    return extractIndicesFromRevealStateObject(legacyMessage.payload)
  }

  const message = payload as { type?: unknown; action?: unknown; payload?: unknown }
  if (message.type !== 'reveal-sync') {
    return null
  }

  if (message.action === 'command' && isPlainObject(message.payload)) {
    const commandPayload = message.payload as { name?: unknown; payload?: unknown }
    if (commandPayload.name === 'setState' && isPlainObject(commandPayload.payload)) {
      const stateContainer = commandPayload.payload as { state?: unknown }
      return extractIndicesFromRevealStateObject(stateContainer.state)
    }
    return null
  }

  if (message.action !== 'state' && message.action !== 'ready') {
    return null
  }

  const messagePayload = message.payload as RevealStatePayload | undefined
  return normalizeIndices(messagePayload?.indices)
    ?? (isPlainObject(messagePayload?.navigation)
      ? normalizeIndices((messagePayload.navigation as { current?: unknown }).current)
      : null)
    ?? extractIndicesFromRevealStateObject(messagePayload?.revealState)
    ?? extractIndicesFromRevealStateObject(messagePayload)
}

export function attachInstructorIndicesToBoundaryChangePayload(
  payload: unknown,
  instructorIndices: { h: number; v: number; f: number } | null,
): unknown {
  if (!instructorIndices || !isPlainObject(payload)) {
    return payload
  }

  const envelope = payload as RevealSyncEnvelope
  if (envelope.type !== 'reveal-sync' || envelope.action !== 'studentBoundaryChanged' || !isPlainObject(envelope.payload)) {
    return payload
  }

  const boundaryPayload = envelope.payload as { indices?: unknown; [key: string]: unknown }
  if (normalizeIndices(boundaryPayload.indices)) {
    return payload
  }

  return {
    ...envelope,
    payload: {
      ...boundaryPayload,
      indices: instructorIndices,
    },
  }
}

export function buildForceSyncBoundaryCommandMessage(indices: { h: number; v: number; f: number }): Record<string, unknown> {
  return buildRevealCommandMessage('setStudentBoundary', {
    indices,
    syncToBoundary: true,
  })
}

export function buildClearBoundaryCommandMessage(): Record<string, unknown> {
  return buildRevealCommandMessage('clearBoundary', {})
}

export function buildInstructorRoleCommandMessage(): Record<string, unknown> {
  return buildRevealCommandMessage('setRole', {
    role: 'instructor',
  })
}

const SyncDeckManager: FC = () => {
  const { sessionId } = useParams<{ sessionId?: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const [copiedValue, setCopiedValue] = useState<string | null>(null)
  const [presentationUrl, setPresentationUrl] = useState(() => {
    const params = new URLSearchParams(location.search)
    const initial = params.get('presentationUrl') ?? ''
    return initial
  })
  const [isStartingSession, setIsStartingSession] = useState(false)
  const [, setStartError] = useState<string | null>(null)
  const [, setStartSuccess] = useState<string | null>(null)
  const [isConfigurePanelOpen, setIsConfigurePanelOpen] = useState(true)
  const [instructorPasscode, setInstructorPasscode] = useState<string | null>(null)
  const [persistentUrlHashFallback, setPersistentUrlHashFallback] = useState<string | null>(null)
  const [isPasscodeReady, setIsPasscodeReady] = useState(false)
  const [hasAutoStarted, setHasAutoStarted] = useState(false)
  const [instructorConnectionState, setInstructorConnectionState] = useState<'connected' | 'disconnected'>('disconnected')
  const [instructorConnectionTooltip, setInstructorConnectionTooltip] = useState('Not connected to sync server')
  const [isInstructorSyncEnabled, setIsInstructorSyncEnabled] = useState(true)
  const [connectedStudentCount, setConnectedStudentCount] = useState(0)
  const [students, setStudents] = useState<SyncDeckStudentPresence[]>([])
  const [isStudentsPanelOpen, setIsStudentsPanelOpen] = useState(false)
  const [isStoryboardOpen, setIsStoryboardOpen] = useState(false)
  const [isPresentationPaused, setIsPresentationPaused] = useState(false)
  const [isChalkboardOpen, setIsChalkboardOpen] = useState(false)
  const [isPenOverlayOpen, setIsPenOverlayOpen] = useState(false)
  const [isPreflightChecking, setIsPreflightChecking] = useState(false)
  const [preflightWarning, setPreflightWarning] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [preflightValidatedUrl, setPreflightValidatedUrl] = useState<string | null>(null)
  const [allowUnverifiedStartForUrl, setAllowUnverifiedStartForUrl] = useState<string | null>(null)
  const [confirmStartForUrl, setConfirmStartForUrl] = useState<string | null>(null)
  const presentationIframeRef = useRef<HTMLIFrameElement | null>(null)
  const disconnectStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastInstructorPayloadRef = useRef<unknown>(null)
  const lastInstructorStatePayloadRef = useRef<unknown>(null)
  const pendingRestorePayloadRef = useRef<unknown>(null)
  const pendingInstructorReplayCommandsRef = useRef<unknown[]>([])
  const pendingInstructorDrawingToolModeRef = useRef<SyncDeckDrawingToolMode | null>(null)
  const cachedChalkboardSnapshotStorageRef = useRef<string | null>(null)
  const activeInstructorDrawingToolModeRef = useRef<SyncDeckDrawingToolMode>('none')
  const connectedStudentIdsRef = useRef<Set<string>>(new Set())
  const pendingChalkboardStateRequestRef = useRef(false)
  const hasAppliedReloadChalkboardStateRef = useRef(false)
  const lastInstructorIndicesRef = useRef<{ h: number; v: number; f: number } | null>(null)
  const explicitBoundaryRef = useRef<{ h: number; v: number; f: number } | null>(null)
  const hasSeenInstructorIframeReadySignalRef = useRef(false)
  const suppressOutboundStateUntilRestoreRef = useRef(false)
  const restoreTargetIndicesRef = useRef<{ h: number; v: number; f: number } | null>(null)
  const isInstructorSyncEnabledRef = useRef(true)
  const restoreSuppressionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearRestoreSuppressionTimeout = useCallback((): void => {
    if (restoreSuppressionTimeoutRef.current != null) {
      clearTimeout(restoreSuppressionTimeoutRef.current)
      restoreSuppressionTimeoutRef.current = null
    }
  }, [])

  const releaseRestoreSuppression = useCallback((): void => {
    suppressOutboundStateUntilRestoreRef.current = false
    restoreTargetIndicesRef.current = null
    clearRestoreSuppressionTimeout()
  }, [clearRestoreSuppressionTimeout])

  const armRestoreSuppression = useCallback(
    (targetIndices: { h: number; v: number; f: number } | null): void => {
      suppressOutboundStateUntilRestoreRef.current = true
      restoreTargetIndicesRef.current = targetIndices
      clearRestoreSuppressionTimeout()
      restoreSuppressionTimeoutRef.current = setTimeout(() => {
        suppressOutboundStateUntilRestoreRef.current = false
        restoreTargetIndicesRef.current = null
        restoreSuppressionTimeoutRef.current = null
      }, RESTORE_SUPPRESSION_TIMEOUT_MS)
    },
    [clearRestoreSuppressionTimeout],
  )

  const presentationOrigin = useMemo(() => {
    try {
      return new URL(presentationUrl).origin
    } catch {
      return null
    }
  }, [presentationUrl])

  useEffect(() => {
    isInstructorSyncEnabledRef.current = isInstructorSyncEnabled
  }, [isInstructorSyncEnabled])

  const requestChalkboardStateFromInstructor = useCallback((): void => {
    const targetWindow = presentationIframeRef.current?.contentWindow
    if (!targetWindow || !presentationOrigin || !hasSeenInstructorIframeReadySignalRef.current) {
      pendingChalkboardStateRequestRef.current = true
      return
    }

    targetWindow.postMessage(
      buildRevealCommandMessage('requestChalkboardState', {}),
      presentationOrigin,
    )
    pendingChalkboardStateRequestRef.current = false
  }, [presentationOrigin])

  const applyDrawingToolModeToInstructorIframe = useCallback(
    (nextMode: SyncDeckDrawingToolMode): void => {
      const targetWindow = presentationIframeRef.current?.contentWindow
      if (!targetWindow || !presentationOrigin || !hasSeenInstructorIframeReadySignalRef.current) {
        pendingInstructorDrawingToolModeRef.current = nextMode
        return
      }

      const currentMode = activeInstructorDrawingToolModeRef.current
      if (currentMode === nextMode) {
        pendingInstructorDrawingToolModeRef.current = null
        return
      }

      const sendToggle = (method: 'toggleChalkboard' | 'toggleNotesCanvas') => {
        targetWindow.postMessage(
          buildRevealCommandMessage('chalkboardCall', {
            method,
            args: [],
          }),
          presentationOrigin,
        )
      }

      if (currentMode === 'chalkboard') {
        sendToggle('toggleChalkboard')
      } else if (currentMode === 'pen') {
        sendToggle('toggleNotesCanvas')
      }

      if (nextMode === 'chalkboard') {
        sendToggle('toggleChalkboard')
      } else if (nextMode === 'pen') {
        sendToggle('toggleNotesCanvas')
      }

      activeInstructorDrawingToolModeRef.current = nextMode
      pendingInstructorDrawingToolModeRef.current = null
    },
    [presentationOrigin],
  )

  const queryUrlHash = new URLSearchParams(location.search).get('urlHash')
  const urlHash = queryUrlHash ?? persistentUrlHashFallback
  const hostProtocol = typeof window !== 'undefined' ? window.location.protocol : null
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null
  const presentationUrlError = useMemo(() => {
    const normalizedUrl = presentationUrl.trim()
    if (normalizedUrl.length === 0) {
      return 'Presentation URL is required'
    }

    return getStudentPresentationCompatibilityError({
      value: normalizedUrl,
      hostProtocol,
      userAgent,
    })
  }, [hostProtocol, presentationUrl, userAgent])

  useEffect(() => {
    if (shouldReopenConfigurePanel(isConfigurePanelOpen, presentationUrlError)) {
      setIsConfigurePanelOpen(true)
    }
  }, [presentationUrlError, isConfigurePanelOpen])

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
          const statePayload = extractSyncDeckStatePayload(message)
          if (statePayload != null) {
            if (!isInstructorSyncEnabledRef.current) {
              return
            }

            const drawingToolMode = parseDrawingToolModePayload(statePayload)
            if (drawingToolMode) {
              setIsChalkboardOpen(drawingToolMode === 'chalkboard')
              setIsPenOverlayOpen(drawingToolMode === 'pen')

              if (sessionId && typeof window !== 'undefined') {
                window.sessionStorage.setItem(buildSyncDeckChalkboardOpenKey(sessionId), drawingToolMode === 'chalkboard' ? '1' : '0')
              }
              applyDrawingToolModeToInstructorIframe(drawingToolMode)
              return
            }

            lastInstructorPayloadRef.current = statePayload
            const commandName = extractRevealCommandName(statePayload)
            if (isInboundChalkboardReplayCommand(commandName)) {
              const replayStorage = readChalkboardSnapshotStorage(statePayload)
              if (replayStorage != null && replayStorage.trim().length > 0) {
                cachedChalkboardSnapshotStorageRef.current = replayStorage
              }
              const targetWindow = presentationIframeRef.current?.contentWindow
              if (targetWindow && presentationOrigin && hasSeenInstructorIframeReadySignalRef.current) {
                targetWindow.postMessage(statePayload, presentationOrigin)
              } else {
                pendingInstructorReplayCommandsRef.current.push(statePayload)
              }
              return
            }

            const currentIndices = extractIndicesFromRevealPayload(statePayload)
            if (currentIndices) {
              lastInstructorIndicesRef.current = currentIndices
              lastInstructorStatePayloadRef.current = statePayload
            }
            const paused = extractPausedState(statePayload)
            if (typeof paused === 'boolean') {
              setIsPresentationPaused(paused)
            }
            const pausedFromCommand = extractPauseStateFromCommand(statePayload)
            if (typeof pausedFromCommand === 'boolean') {
              setIsPresentationPaused(pausedFromCommand)
            }

            const targetWindow = presentationIframeRef.current?.contentWindow
            if (targetWindow && presentationOrigin && hasSeenInstructorIframeReadySignalRef.current) {
              if (currentIndices) {
                armRestoreSuppression(currentIndices)
                targetWindow.postMessage(buildRestoreCommandFromPayload(statePayload), presentationOrigin)
              }
            } else if (currentIndices) {
              pendingRestorePayloadRef.current = statePayload
              armRestoreSuppression(currentIndices)
            }
            return
          }

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

            const nextConnectedStudentIds = new Set(
              nextStudents
                .filter((entry) => entry.connected)
                .map((entry) => entry.studentId),
            )
            const hasNewlyConnectedStudent = Array.from(nextConnectedStudentIds).some(
              (studentId) => !connectedStudentIdsRef.current.has(studentId),
            )
            connectedStudentIdsRef.current = nextConnectedStudentIds

            if (hasNewlyConnectedStudent) {
              requestChalkboardStateFromInstructor()
            }

            setStudents(nextStudents)
          }
        } catch {
          return
        }
      },
    })

  const studentJoinUrl = sessionId && typeof window !== 'undefined' ? `${window.location.origin}/${sessionId}` : ''

  useEffect(() => {
    const normalizedUrl = presentationUrl.trim()
    if (!preflightValidatedUrl || normalizedUrl === preflightValidatedUrl) {
      return
    }

    setPreflightValidatedUrl(null)
    setAllowUnverifiedStartForUrl(null)
    setConfirmStartForUrl(null)
    setPreviewUrl(null)
    setPreflightWarning(null)
  }, [presentationUrl, preflightValidatedUrl])

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
        if (typeof existingPresentationUrl !== 'string') {
          return
        }

        if (!isCancelled) {
          setPresentationUrl(existingPresentationUrl)
          if (shouldAutoActivatePresentationUrl(existingPresentationUrl, hostProtocol, userAgent)) {
            setIsConfigurePanelOpen(false)
            setStartSuccess('Presentation loaded. Session is ready.')
            setStartError(null)
          } else {
            setIsConfigurePanelOpen(true)
            setStartSuccess(null)
            setStartError(null)
          }
        }
      } catch {
        return
      }
    }

    void loadExistingPresentation()

    return () => {
      isCancelled = true
    }
  }, [hostProtocol, sessionId, userAgent])

  useEffect(() => {
    if (!sessionId || typeof window === 'undefined') {
      setIsChalkboardOpen(false)
      return
    }

    const stored = window.sessionStorage.getItem(buildSyncDeckChalkboardOpenKey(sessionId))
    setIsChalkboardOpen(stored === '1')
  }, [sessionId])

  useEffect(() => {
    if (!sessionId || typeof window === 'undefined') {
      return
    }

    window.sessionStorage.setItem(buildSyncDeckChalkboardOpenKey(sessionId), isChalkboardOpen ? '1' : '0')
  }, [sessionId, isChalkboardOpen])

  useEffect(() => {
    if (!sessionId || typeof window === 'undefined') {
      setInstructorPasscode(null)
      setIsPasscodeReady(true)
      return
    }

    let isCancelled = false

    const loadInstructorPasscode = async (): Promise<void> => {
      const fromStorage = window.sessionStorage.getItem(buildSyncDeckPasscodeKey(sessionId))
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
            setPersistentUrlHashFallback(null)
            setIsPasscodeReady(true)
          }
          return
        }

        const payload = (await response.json()) as InstructorPasscodeResponsePayload
        if (typeof payload.instructorPasscode === 'string' && payload.instructorPasscode.length > 0) {
          window.sessionStorage.setItem(buildSyncDeckPasscodeKey(sessionId), payload.instructorPasscode)
          if (!isCancelled) {
            setInstructorPasscode(payload.instructorPasscode)
          }
        }

        if (!isCancelled) {
          const persistentPresentationUrl =
            typeof payload.persistentPresentationUrl === 'string'
            && payload.persistentPresentationUrl.trim().length > 0
              ? payload.persistentPresentationUrl.trim()
              : null
          const persistentUrlHash =
            typeof payload.persistentUrlHash === 'string' && payload.persistentUrlHash.trim().length > 0
              ? payload.persistentUrlHash
              : null

          if (persistentPresentationUrl) {
            setPresentationUrl((current) => {
              return resolveRecoveredPresentationUrl(current, persistentPresentationUrl, hostProtocol, userAgent)
            })
          }
          if (!queryUrlHash) {
            setPersistentUrlHashFallback(persistentUrlHash)
          }
        }
      } catch {
        if (!isCancelled) {
          setInstructorPasscode(null)
          setPersistentUrlHashFallback(null)
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
  }, [hostProtocol, sessionId, queryUrlHash, userAgent])

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

  const relayInstructorPayload = (payload: unknown): void => {
    if (!isInstructorSyncEnabledRef.current) {
      return
    }

    const socket = instructorSocketRef.current
    if (!socket || socket.readyState !== WS_OPEN_READY_STATE) {
      return
    }

    try {
      lastInstructorPayloadRef.current = payload
      socket.send(
        JSON.stringify({
          type: 'syncdeck-state-update',
          payload,
        }),
      )
    } catch {
      return
    }
  }

  const toggleChalkboard = (): void => {
    if (!presentationOrigin || !presentationIframeRef.current?.contentWindow) {
      setStartError('Presentation is not ready for chalkboard controls.')
      setStartSuccess(null)
      return
    }

    const currentMode = activeInstructorDrawingToolModeRef.current
    const nextDrawingToolMode: SyncDeckDrawingToolMode = currentMode === 'chalkboard' ? 'none' : 'chalkboard'
    applyDrawingToolModeToInstructorIframe(nextDrawingToolMode)
    relayInstructorPayload(buildDrawingToolModePayload(nextDrawingToolMode))

    setIsChalkboardOpen(nextDrawingToolMode === 'chalkboard')
    setIsPenOverlayOpen(false)
    if (sessionId && typeof window !== 'undefined') {
      const nextValue = nextDrawingToolMode === 'chalkboard'
      window.sessionStorage.setItem(buildSyncDeckChalkboardOpenKey(sessionId), nextValue ? '1' : '0')
    }
    setStartError(null)
  }

  const togglePresentationPause = (): void => {
    const targetWindow = presentationIframeRef.current?.contentWindow
    if (!targetWindow || !presentationOrigin) {
      setStartError('Presentation is not ready for pause controls.')
      setStartSuccess(null)
      return
    }

    const nextPaused = !isPresentationPaused
    const pauseCommand = buildRevealCommandMessage(nextPaused ? 'pause' : 'resume', {})

    targetWindow.postMessage(
      pauseCommand,
      presentationOrigin,
    )
    relayInstructorPayload(pauseCommand)
    setIsPresentationPaused(nextPaused)

    if (lastInstructorStatePayloadRef.current != null) {
      const pausedStatePayload = includePausedInStateEnvelope(lastInstructorStatePayloadRef.current, nextPaused)
      lastInstructorStatePayloadRef.current = pausedStatePayload
      lastInstructorPayloadRef.current = pausedStatePayload
      relayInstructorPayload(pausedStatePayload)
    }

    setStartError(null)
  }

  const togglePenOverlay = (): void => {
    if (!presentationOrigin || !presentationIframeRef.current?.contentWindow) {
      setStartError('Presentation is not ready for pen overlay controls.')
      setStartSuccess(null)
      return
    }

    const currentMode = activeInstructorDrawingToolModeRef.current
    const nextDrawingToolMode: SyncDeckDrawingToolMode = currentMode === 'pen' ? 'none' : 'pen'
    applyDrawingToolModeToInstructorIframe(nextDrawingToolMode)
    relayInstructorPayload(buildDrawingToolModePayload(nextDrawingToolMode))

    setIsPenOverlayOpen(nextDrawingToolMode === 'pen')
    setIsChalkboardOpen(false)
    if (sessionId && typeof window !== 'undefined') {
      const nextValue = false
      window.sessionStorage.setItem(buildSyncDeckChalkboardOpenKey(sessionId), nextValue ? '1' : '0')
    }
    setStartError(null)
  }

  const handleForceSyncStudents = (): void => {
    if (!isInstructorSyncEnabledRef.current) {
      setStartError('Enable instructor sync before forcing student sync.')
      setStartSuccess(null)
      return
    }

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

    const currentInstructorIndices = extractIndicesFromRevealPayload(lastInstructorPayloadRef.current)
    if (currentInstructorIndices != null) {
      try {
        socket.send(
          JSON.stringify({
            type: 'syncdeck-state-update',
            payload: buildForceSyncBoundaryCommandMessage(currentInstructorIndices),
          }),
        )
        setStartError(null)
        setStartSuccess('Force sync sent. Students are syncing to your current position.')
        return
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

  const toggleInstructorSync = useCallback((): void => {
    const nextEnabled = !isInstructorSyncEnabledRef.current
    isInstructorSyncEnabledRef.current = nextEnabled
    setIsInstructorSyncEnabled(nextEnabled)
    setStartError(null)

    if (nextEnabled) {
      setStartSuccess('Instructor sync enabled.')
      disconnectInstructorWs()
      connectInstructorWs()
      return
    }

    setStartSuccess('Instructor sync disabled. Local presentation updates are no longer sent or applied across instructors.')
  }, [connectInstructorWs, disconnectInstructorWs])

  const handlePresentationIframeLoad = useCallback((): void => {
    const targetWindow = presentationIframeRef.current?.contentWindow
    if (!targetWindow || !presentationOrigin) {
      return
    }

    hasSeenInstructorIframeReadySignalRef.current = false
    hasAppliedReloadChalkboardStateRef.current = false
    const queuedRestorePayload = pendingRestorePayloadRef.current ?? lastInstructorStatePayloadRef.current
    armRestoreSuppression(extractIndicesFromRevealPayload(queuedRestorePayload))

    targetWindow.postMessage(
      buildInstructorRoleCommandMessage(),
      presentationOrigin,
    )
  }, [presentationOrigin, armRestoreSuppression])

  const startSession = useCallback(async (options?: { automatic?: boolean }): Promise<void> => {
    const automaticStart = options?.automatic === true

    if (!sessionId) return

    const normalizedUrl = presentationUrl.trim()
    if (normalizedUrl.length === 0) {
      setStartError('Presentation URL is required')
      setStartSuccess(null)
      return
    }

    const validationError = getStudentPresentationCompatibilityError({
      value: normalizedUrl,
      hostProtocol,
      userAgent,
    })
    if (validationError != null) {
      setStartError(validationError)
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

    const canBypassPreflight = allowUnverifiedStartForUrl === normalizedUrl

    const shouldRunPreflight = !urlHash

    if (shouldRunPreflight && preflightValidatedUrl !== normalizedUrl && !canBypassPreflight) {
      setIsPreflightChecking(true)
      const preflightResult = await runSyncDeckPresentationPreflight(normalizedUrl)
      setIsPreflightChecking(false)

      if (preflightResult.valid) {
        setPreflightValidatedUrl(normalizedUrl)
        setAllowUnverifiedStartForUrl(null)
        setConfirmStartForUrl(automaticStart ? null : normalizedUrl)
        setPreviewUrl(normalizedUrl)
        setPreflightWarning(null)
        setStartError(null)
        setStartSuccess(null)
        if (!automaticStart) {
          return
        }
      } else {
        setPreflightValidatedUrl(null)
        setConfirmStartForUrl(null)
        setPreviewUrl(null)
        setPreflightWarning(preflightResult.warning)
        setAllowUnverifiedStartForUrl(normalizedUrl)
        setStartError(
          automaticStart ? null : 'Presentation sync validation failed. Click Start Session again to continue anyway.',
        )
        setStartSuccess(null)
        if (!automaticStart) {
          return
        }
      }
    }

    if (preflightValidatedUrl === normalizedUrl && confirmStartForUrl === normalizedUrl) {
      setConfirmStartForUrl(null)
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
  }, [
    sessionId,
    presentationUrl,
    hostProtocol,
    userAgent,
    isPasscodeReady,
    instructorPasscode,
    urlHash,
    preflightValidatedUrl,
    allowUnverifiedStartForUrl,
    confirmStartForUrl,
  ])

  const handleStartSession = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    await startSession()
  }

  useEffect(() => {
    if (hasAutoStarted || !sessionId || !isConfigurePanelOpen) {
      return
    }

    const normalizedUrl = presentationUrl.trim()
    if (!validatePresentationUrl(normalizedUrl, hostProtocol, userAgent)) {
      return
    }

    if (!isPasscodeReady || !instructorPasscode || isStartingSession) {
      return
    }

    setHasAutoStarted(true)
    void startSession({ automatic: true })
  }, [
    hasAutoStarted,
    sessionId,
    isConfigurePanelOpen,
    presentationUrl,
    hostProtocol,
    userAgent,
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

      const pausedState = extractPausedState(event.data)
      if (typeof pausedState === 'boolean') {
        setIsPresentationPaused(pausedState)
      }
      const pausedStateFromCommand = extractPauseStateFromCommand(event.data)
      if (typeof pausedStateFromCommand === 'boolean') {
        setIsPresentationPaused(pausedStateFromCommand)
      }

      const initialEnvelope = parseRevealSyncEnvelope(event.data)
      if (!hasSeenInstructorIframeReadySignalRef.current && initialEnvelope?.type === 'reveal-sync') {
        hasSeenInstructorIframeReadySignalRef.current = true
        const targetWindow = presentationIframeRef.current?.contentWindow
        if (targetWindow && presentationOrigin) {
          let restorePayload: unknown | null = null
          if (pendingRestorePayloadRef.current != null) {
            restorePayload = pendingRestorePayloadRef.current
            targetWindow.postMessage(buildRestoreCommandFromPayload(restorePayload), presentationOrigin)
            pendingRestorePayloadRef.current = null
          } else if (lastInstructorStatePayloadRef.current != null) {
            restorePayload = lastInstructorStatePayloadRef.current
            targetWindow.postMessage(buildRestoreCommandFromPayload(restorePayload), presentationOrigin)
          }

          restoreTargetIndicesRef.current = extractIndicesFromRevealPayload(restorePayload)
          if (restorePayload != null && restoreTargetIndicesRef.current != null) {
            armRestoreSuppression(restoreTargetIndicesRef.current)
          }

          if (pendingInstructorReplayCommandsRef.current.length > 0) {
            for (const replayCommand of pendingInstructorReplayCommandsRef.current) {
              targetWindow.postMessage(replayCommand, presentationOrigin)
            }
            pendingInstructorReplayCommandsRef.current = []
          }

          if (pendingInstructorDrawingToolModeRef.current != null) {
            applyDrawingToolModeToInstructorIframe(pendingInstructorDrawingToolModeRef.current)
          }
          hasAppliedReloadChalkboardStateRef.current = true

          requestChalkboardStateFromInstructor()
          if (pendingChalkboardStateRequestRef.current) {
            requestChalkboardStateFromInstructor()
          }
        }
      }

      const socket = instructorSocketRef.current
      if (!socket || socket.readyState !== WS_OPEN_READY_STATE) {
        return
      }

      try {
        const envelope = parseRevealSyncEnvelope(event.data)
        if (!isInstructorSyncEnabledRef.current) {
          return
        }

        const chalkboardRelayCommand = toChalkboardRelayCommand(event.data)
        if (chalkboardRelayCommand != null) {
          const relayWithFallback = applyChalkboardSnapshotFallback(
            chalkboardRelayCommand,
            cachedChalkboardSnapshotStorageRef.current,
          )
          const outboundChalkboardRelayCommand = relayWithFallback.relayPayload
          const outboundStorage = readChalkboardSnapshotStorage(outboundChalkboardRelayCommand)
          if (outboundStorage != null && outboundStorage.trim().length > 0) {
            cachedChalkboardSnapshotStorageRef.current = outboundStorage
          }

          if (relayWithFallback.restoredSnapshotStorage && presentationOrigin) {
            const targetWindow = presentationIframeRef.current?.contentWindow
            if (targetWindow) {
              targetWindow.postMessage(outboundChalkboardRelayCommand, presentationOrigin)
            }
          }

          lastInstructorPayloadRef.current = outboundChalkboardRelayCommand
          socket.send(
            JSON.stringify({
              type: 'syncdeck-state-update',
              payload: outboundChalkboardRelayCommand,
            }),
          )
          return
        }

        const instructorIndices = extractIndicesFromRevealPayload(event.data)
        if (instructorIndices) {
          lastInstructorIndicesRef.current = instructorIndices
        }

        if (envelope?.type === 'reveal-sync' && envelope.action === 'state') {
          const restoreSuppression = evaluateRestoreSuppressionForOutboundState({
            suppressOutboundUntilRestore: suppressOutboundStateUntilRestoreRef.current,
            restoreTargetIndices: restoreTargetIndicesRef.current,
            instructorIndices,
          })

          if (restoreSuppression.shouldRelease) {
            releaseRestoreSuppression()
          }
          if (restoreSuppression.shouldDrop) {
            return
          }
        }

        if (envelope?.type === 'reveal-sync' && isPlainObject(envelope.payload)) {
          const payload = envelope.payload as { studentBoundary?: unknown }
          const rawBoundary = normalizeIndices(payload.studentBoundary)
          if (rawBoundary) {
            explicitBoundaryRef.current = toSlideEndBoundary(rawBoundary)
          } else if (payload.studentBoundary === null) {
            explicitBoundaryRef.current = null
          }
        }

        if (
          envelope?.type === 'reveal-sync' &&
          envelope.action === 'state' &&
          shouldSuppressInstructorStateBroadcast(lastInstructorIndicesRef.current, explicitBoundaryRef.current)
        ) {
          return
        }

        if (
          envelope?.type === 'reveal-sync' &&
          envelope.action === 'state' &&
          lastInstructorIndicesRef.current != null &&
          explicitBoundaryRef.current != null &&
          compareIndices(lastInstructorIndicesRef.current, explicitBoundaryRef.current) > 0
        ) {
          const targetWindow = presentationIframeRef.current?.contentWindow
          if (targetWindow && presentationOrigin) {
            targetWindow.postMessage(buildClearBoundaryCommandMessage(), presentationOrigin)
          }

          const boundaryClearedPayload = buildBoundaryClearedPayload(lastInstructorIndicesRef.current)
          try {
            socket.send(
              JSON.stringify({
                type: 'syncdeck-state-update',
                payload: boundaryClearedPayload,
              }),
            )
            explicitBoundaryRef.current = null
          } catch {
            return
          }
        }

        const payloadWithInstructorIndices = attachInstructorIndicesToBoundaryChangePayload(
          event.data,
          lastInstructorIndicesRef.current,
        )
        const payloadWithPauseState = includePausedInStateEnvelope(payloadWithInstructorIndices, pausedState)
        const sanitizedPayload = stripOverviewFromStateEnvelope(payloadWithPauseState)
        lastInstructorPayloadRef.current = sanitizedPayload
        if (envelope?.type === 'reveal-sync' && envelope.action === 'state') {
          const sanitizedIndices = extractIndicesFromRevealPayload(sanitizedPayload)
          if (sanitizedIndices) {
            lastInstructorStatePayloadRef.current = sanitizedPayload
          }
        }

        const pausedStatePayload = buildPausedSnapshotFromAction(event.data, lastInstructorStatePayloadRef.current)
        if (pausedStatePayload != null) {
          lastInstructorStatePayloadRef.current = pausedStatePayload
          lastInstructorPayloadRef.current = pausedStatePayload
          socket.send(
            JSON.stringify({
              type: 'syncdeck-state-update',
              payload: pausedStatePayload,
            }),
          )
        }

        if (!shouldRelayRevealSyncPayloadToSession(sanitizedPayload)) {
          return
        }

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
  }, [
    isConfigurePanelOpen,
    presentationOrigin,
    requestChalkboardStateFromInstructor,
    applyDrawingToolModeToInstructorIframe,
    armRestoreSuppression,
    releaseRestoreSuppression,
  ])

  useEffect(
    () => () => {
      clearRestoreSuppressionTimeout()
    },
    [clearRestoreSuppressionTimeout],
  )

  if (!sessionId) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-3">
        <h1 className="text-2xl font-bold">SyncDeck</h1>
        <p className="text-sm text-gray-700">Create a live session or a permanent link to begin.</p>
      </div>
    )
  }

  const normalizedPresentationUrl = presentationUrl.trim()
  const showStartAnyway =
    Boolean(preflightWarning) &&
    allowUnverifiedStartForUrl === normalizedPresentationUrl &&
    preflightValidatedUrl !== normalizedPresentationUrl
  const showConfirmStart =
    preflightValidatedUrl === normalizedPresentationUrl &&
    confirmStartForUrl === normalizedPresentationUrl

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
              onClick={toggleInstructorSync}
              aria-pressed={isInstructorSyncEnabled}
              className={`ml-2 px-2 py-1 rounded border text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed ${
                isInstructorSyncEnabled
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                  : 'border-gray-300 hover:bg-gray-50'
              }`}
              title={isInstructorSyncEnabled ? 'Disable instructor sync' : 'Enable instructor sync'}
              aria-label={isInstructorSyncEnabled ? 'Disable instructor sync' : 'Enable instructor sync'}
              disabled={isConfigurePanelOpen}
            >
              🔗
            </button>
            <button
              type="button"
              onClick={handleForceSyncStudents}
              className="ml-2 px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Force sync students to current position"
              aria-label="Force sync students to current position"
              disabled={isConfigurePanelOpen || instructorConnectionState !== 'connected' || !isInstructorSyncEnabled}
            >
              📍
            </button>
            <button
              type="button"
              onClick={togglePresentationPause}
              className={`ml-2 px-2 py-1 rounded border text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed ${
                isPresentationPaused
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                  : 'border-gray-300 hover:bg-gray-50'
              }`}
              title={isPresentationPaused ? 'Resume presentation' : 'Pause presentation'}
              aria-label={isPresentationPaused ? 'Resume presentation' : 'Pause presentation'}
              disabled={isConfigurePanelOpen}
            >
              ⬛
            </button>
            <button
              type="button"
              onClick={toggleChalkboard}
              className={`ml-2 px-2 py-1 rounded border text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed ${
                isChalkboardOpen
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                  : 'border-gray-300 hover:bg-gray-50'
              }`}
              title="Toggle chalkboard screen"
              aria-label="Toggle chalkboard screen"
              disabled={isConfigurePanelOpen}
            >
              🖍️
            </button>
            <button
              type="button"
              onClick={togglePenOverlay}
              className={`ml-2 px-2 py-1 rounded border text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed ${
                isPenOverlayOpen
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                  : 'border-gray-300 hover:bg-gray-50'
              }`}
              title="Toggle pen overlay"
              aria-label="Toggle pen overlay"
              disabled={isConfigurePanelOpen}
            >
              ✏️
            </button>
          </div>

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
                    aria-invalid={presentationUrlError != null}
                    aria-describedby={presentationUrlError ? PRESENTATION_URL_ERROR_ID : undefined}
                    className={`w-full border-2 rounded px-3 py-2 ${
                      presentationUrlError ? 'border-red-400' : 'border-gray-300'
                    }`}
                    placeholder="https://slides.example.com/deck"
                    required
                  />
                </label>
                {presentationUrlError ? (
                  <p id={PRESENTATION_URL_ERROR_ID} className="text-sm text-red-600">
                    {presentationUrlError}
                  </p>
                ) : null}
                <button
                  type="submit"
                  className="px-3 py-2 rounded bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
                  disabled={isStartingSession || !isPasscodeReady || isPreflightChecking || presentationUrlError != null}
                >
                  {isPreflightChecking
                    ? 'Validating…'
                    : isStartingSession
                      ? 'Starting…'
                      : showStartAnyway
                        ? 'Start Anyway'
                        : showConfirmStart
                          ? 'Start Verified Session'
                          : 'Start Session'}
                </button>

                {preflightWarning && (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    {preflightWarning}
                  </p>
                )}

                {previewUrl && (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-gray-700">Deck preview (first visible slide)</p>
                    <div className="border border-gray-200 rounded overflow-hidden bg-white w-full max-w-md aspect-video">
                      <iframe
                        title="SyncDeck preflight preview"
                        src={previewUrl}
                        className="w-full h-full pointer-events-none"
                        sandbox="allow-scripts allow-same-origin"
                      />
                    </div>
                  </div>
                )}
              </form>
              ) : null}

            {!isConfigurePanelOpen && presentationUrlError && (
              <div className="p-6">
                <p className="text-sm text-red-600">{presentationUrlError}</p>
              </div>
            )}

            {!isConfigurePanelOpen && !presentationUrlError && validatePresentationUrl(presentationUrl, hostProtocol, userAgent) && (
              <div className="w-full h-full min-h-0 bg-white overflow-hidden">
                <iframe
                  ref={presentationIframeRef}
                  title="SyncDeck Presentation"
                  src={presentationUrl}
                  className="w-full h-full"
                  allow="fullscreen"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                  onLoad={handlePresentationIframeLoad}
                />
              </div>
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
