import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import { storeCreateSessionBootstrapPayload } from '@src/components/common/manageDashboardUtils'
import { resolvePersistentSessionEntryPolicy, type PersistentSessionEntryPolicy } from '../../../../types/waitingRoom.js'
import { runSyncDeckPresentationPreflight } from '../shared/presentationPreflight.js'
import {
  getStudentPresentationCompatibilityError,
} from '../shared/presentationUrlCompatibility.js'
import { isSyncDeckDebugEnabled } from '../shared/syncDebug.js'
import { shouldRelayRevealSyncPayloadToSession } from '../shared/revealSyncRelayPolicy.js'
import {
  deriveEmbeddedOverlayVerticalNavigationCapabilities,
  resolveEmbeddedOverlayVerticalMoveAllowed,
  resolveOptimisticEmbeddedOverlayIndices,
} from '../shared/embeddedOverlayNavigation.js'
import {
  REVEAL_SYNC_PROTOCOL_VERSION,
  assessRevealSyncProtocolCompatibility,
} from '../../shared/revealSyncProtocol.js'
import { useCallback, useEffect, useMemo, useRef, useState, type FC, type FormEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import ConnectionStatusDot from '../components/ConnectionStatusDot.js'

const SYNCDECK_PASSCODE_KEY_PREFIX = 'syncdeck_instructor_'
const SYNCDECK_CHALKBOARD_OPEN_KEY_PREFIX = 'syncdeck_chalkboard_open_'
const WS_OPEN_READY_STATE = 1
const DISCONNECTED_STATUS_DELAY_MS = 250
const CANONICAL_BOUNDARY_FRAGMENT_INDEX = -1
const RESTORE_SUPPRESSION_TIMEOUT_MS = 2500
const PRESENTATION_URL_ERROR_ID = 'syncdeck-presentation-url-error'
interface SessionResponsePayload {
  session?: {
    data?: {
      presentationUrl?: unknown
      embeddedActivities?: unknown
    }
  }
}

interface InstructorPasscodeResponsePayload {
  instructorPasscode?: unknown
  persistentPresentationUrl?: unknown
  persistentUrlHash?: unknown
  persistentEntryPolicy?: unknown
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

interface SyncDeckEmbeddedActivityRecord {
  childSessionId: string
  activityId: string
  startedAt: number
  owner: string
}

type SyncDeckEmbeddedActivitiesMap = Record<string, SyncDeckEmbeddedActivityRecord>

interface SyncDeckInstructorAuthMessage {
  type: 'authenticate'
  instructorPasscode: string
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

interface RevealActivityRequestPayload {
  activityId?: unknown
  instanceKey?: unknown
  indices?: unknown
  stackRequests?: unknown
  activityOptions?: unknown
}

interface SyncDeckEmbeddedActivityStartResponse {
  childSessionId?: unknown
  instanceKey?: unknown
  managerBootstrap?: unknown
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

export function buildSyncDeckInstructorWsUrl(params: {
  sessionId: string | null | undefined
  location: Pick<Location, 'protocol' | 'host'> | null | undefined
  isConfigurePanelOpen: boolean
}): string | null {
  if (!params.sessionId || params.location == null || params.isConfigurePanelOpen) {
    return null
  }

  const protocol = params.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const query = new URLSearchParams({
    sessionId: params.sessionId,
    role: 'instructor',
  })
  return `${protocol}//${params.location.host}/ws/syncdeck?${query.toString()}`
}

export function createSyncDeckInstructorWsAuthMessage(
  instructorPasscode: string | null | undefined,
): string | null {
  if (typeof instructorPasscode !== 'string' || instructorPasscode.length === 0) {
    return null
  }

  const message: SyncDeckInstructorAuthMessage = {
    type: 'authenticate',
    instructorPasscode,
  }
  return JSON.stringify(message)
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

interface SyncDeckEmbeddedInstancePosition {
  h: number
  v: number
}

interface SyncDeckEmbeddedLifecyclePayload {
  type: 'embedded-activity-start' | 'embedded-activity-end'
  instanceKey: string
  activityId?: string
  childSessionId: string
}

type SyncDeckManagerOverlayNavigationDirection = 'left' | 'right' | 'up' | 'down' | 'slide'

interface SyncDeckActivityPickerEntry {
  activityId: string
  name: string
  description: string
  supportsReport: boolean
}

interface SyncDeckActivityLaunchRequest {
  activityId: string
  instanceKey: string
  activityOptions?: Record<string, unknown>
}

interface SyncDeckActivityConfigModule {
  default?: {
    id?: string
    name?: string
    title?: string
    description?: string
    reportEndpoint?: string
  }
}

const activityPickerConfigModules =
  (import.meta.env?.DEV || import.meta.env?.PROD)
    ? import.meta.glob<SyncDeckActivityConfigModule>('../../../*/activity.config.{js,ts}', { eager: true })
    : {}

interface SyncDeckManagerNavigationCapabilities {
  canGoBack: boolean
  canGoForward: boolean
  canGoUp: boolean
  canGoDown: boolean
}

function buildSyncDeckPasscodeKey(sessionId: string): string {
  return `${SYNCDECK_PASSCODE_KEY_PREFIX}${sessionId}`
}

function buildSyncDeckChalkboardOpenKey(sessionId: string): string {
  return `${SYNCDECK_CHALKBOARD_OPEN_KEY_PREFIX}${sessionId}`
}

export function normalizeStoredInstructorPasscode(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
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
  const normalizedRecovered = recoveredValue?.trim() ?? ''
  if (
    validatePresentationUrl(normalizedCurrent, hostProtocol, userAgent)
    || normalizedRecovered.length === 0
  ) {
    return normalizedCurrent
  }

  return normalizedRecovered
}

function buildRevealCommandMessage(name: string, payload: RevealCommandPayload): Record<string, unknown> {
  return {
    type: 'reveal-sync',
    version: REVEAL_SYNC_PROTOCOL_VERSION,
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

function normalizeEmbeddedActivityRecord(value: unknown): SyncDeckEmbeddedActivityRecord | null {
  if (!isPlainObject(value)) {
    return null
  }

  const childSessionId = typeof value.childSessionId === 'string' ? value.childSessionId.trim() : ''
  const activityId = typeof value.activityId === 'string' ? value.activityId.trim() : ''
  if (!childSessionId || !activityId) {
    return null
  }

  return {
    childSessionId,
    activityId,
    startedAt: typeof value.startedAt === 'number' && Number.isFinite(value.startedAt) ? value.startedAt : Date.now(),
    owner: typeof value.owner === 'string' ? value.owner : 'syncdeck-instructor',
  }
}

export function normalizeSyncDeckEmbeddedActivities(value: unknown): SyncDeckEmbeddedActivitiesMap {
  if (!isPlainObject(value)) {
    return {}
  }

  const normalized: SyncDeckEmbeddedActivitiesMap = {}
  for (const [instanceKey, record] of Object.entries(value)) {
    if (typeof instanceKey !== 'string' || instanceKey.trim().length === 0) {
      continue
    }

    const normalizedRecord = normalizeEmbeddedActivityRecord(record)
    if (!normalizedRecord) {
      continue
    }

    normalized[instanceKey] = normalizedRecord
  }

  return normalized
}

export function resolvePersistentUrlHashForConfigure(
  queryUrlHash: string | null | undefined,
  persistentUrlHashFallback: string | null | undefined,
): string | null {
  const normalizedQueryUrlHash = typeof queryUrlHash === 'string' && queryUrlHash.trim().length > 0
    ? queryUrlHash.trim()
    : null
  const normalizedPersistentUrlHashFallback = typeof persistentUrlHashFallback === 'string' && persistentUrlHashFallback.trim().length > 0
    ? persistentUrlHashFallback.trim()
    : null

  // Prefer the server-verified/cookie-recovered hash to avoid stale query params forcing configure failures.
  return normalizedPersistentUrlHashFallback ?? normalizedQueryUrlHash
}

export function resolvePersistentEntryPolicyForConfigure(
  queryUrlHash: string | null | undefined,
  queryEntryPolicy: string | null | undefined,
  persistentUrlHashFallback: string | null | undefined,
  persistentEntryPolicyFallback: PersistentSessionEntryPolicy | null | undefined,
): PersistentSessionEntryPolicy {
  const normalizedQueryUrlHash = typeof queryUrlHash === 'string' && queryUrlHash.trim().length > 0
    ? queryUrlHash.trim()
    : null
  const normalizedPersistentUrlHashFallback = typeof persistentUrlHashFallback === 'string' && persistentUrlHashFallback.trim().length > 0
    ? persistentUrlHashFallback.trim()
    : null

  if (normalizedPersistentUrlHashFallback) {
    return resolvePersistentSessionEntryPolicy(persistentEntryPolicyFallback)
  }

  if (normalizedQueryUrlHash) {
    return resolvePersistentSessionEntryPolicy(queryEntryPolicy)
  }

  const hasExplicitQueryEntryPolicy = typeof queryEntryPolicy === 'string' && queryEntryPolicy.trim().length > 0
  if (hasExplicitQueryEntryPolicy) {
    return resolvePersistentSessionEntryPolicy(queryEntryPolicy)
  }

  return resolvePersistentSessionEntryPolicy(persistentEntryPolicyFallback)
}

function parseSyncDeckEmbeddedInstancePosition(instanceKey: string): SyncDeckEmbeddedInstancePosition | null {
  const segments = instanceKey.split(':')
  if (segments.length < 3) {
    return null
  }

  const hSegment = segments.at(-2)
  const vSegment = segments.at(-1)
  if (typeof hSegment !== 'string' || typeof vSegment !== 'string') {
    return null
  }

  const h = Number.parseInt(hSegment, 10)
  const v = Number.parseInt(vSegment, 10)
  if (!Number.isFinite(h) || !Number.isFinite(v)) {
    return null
  }

  return { h, v }
}

function parseEmbeddedLifecyclePayload(payload: unknown): SyncDeckEmbeddedLifecyclePayload | null {
  if (!isPlainObject(payload)) {
    return null
  }

  const payloadType = payload.type
  if (payloadType !== 'embedded-activity-start' && payloadType !== 'embedded-activity-end') {
    return null
  }

  const instanceKey = typeof payload.instanceKey === 'string' ? payload.instanceKey.trim() : ''
  const childSessionId = typeof payload.childSessionId === 'string' ? payload.childSessionId.trim() : ''
  if (!instanceKey || !childSessionId) {
    return null
  }

  const activityId = typeof payload.activityId === 'string' ? payload.activityId.trim() : undefined
  return {
    type: payloadType,
    instanceKey,
    activityId,
    childSessionId,
  }
}

export function applySyncDeckEmbeddedLifecyclePayload(
  current: SyncDeckEmbeddedActivitiesMap,
  payload: SyncDeckEmbeddedLifecyclePayload,
): SyncDeckEmbeddedActivitiesMap {
  if (payload.type === 'embedded-activity-end') {
    const next = { ...current }
    delete next[payload.instanceKey]
    return next
  }

  if (!payload.activityId) {
    return current
  }

  return {
    ...current,
    [payload.instanceKey]: {
      childSessionId: payload.childSessionId,
      activityId: payload.activityId,
      startedAt: Date.now(),
      owner: 'syncdeck-instructor',
    },
  }
}

export function resolveManagerActiveEmbeddedInstanceKey(
  embeddedActivities: SyncDeckEmbeddedActivitiesMap,
  instructorIndices: { h: number; v: number; f: number } | null,
): string | null {
  if (!instructorIndices) {
    return null
  }

  let selected: string | null = null
  for (const [instanceKey, record] of Object.entries(embeddedActivities)) {
    const position = parseSyncDeckEmbeddedInstancePosition(instanceKey)
    if (!position) {
      continue
    }
    if (position.h !== instructorIndices.h || position.v !== instructorIndices.v) {
      continue
    }

    const selectedRecord = selected ? embeddedActivities[selected] : null
    if (!selectedRecord || record.startedAt > selectedRecord.startedAt) {
      selected = instanceKey
    }
  }

  return selected
}

export function resolveManagerEmbeddedInstanceStatus(
  instanceKey: string,
  activeInstanceKey: string | null,
): 'active' | 'idle' {
  return activeInstanceKey != null && instanceKey === activeInstanceKey ? 'active' : 'idle'
}

export function buildManagerOverlayNavigationCommand(
  direction: SyncDeckManagerOverlayNavigationDirection,
): Record<string, unknown> {
  return buildRevealCommandMessage(direction, {})
}

export function buildManagerOverlaySetStateCommand(
  indices: { h: number; v: number; f: number },
): Record<string, unknown> {
  return buildRevealCommandMessage('setState', {
    state: {
      indexh: indices.h,
      indexv: indices.v,
      indexf: indices.f,
    },
  })
}

export function buildManagerResyncCommandForInstanceKey(instanceKey: string): Record<string, unknown> | null {
  const position = parseSyncDeckEmbeddedInstancePosition(instanceKey)
  if (!position) {
    return null
  }

  return buildManagerOverlaySetStateCommand({
    h: position.h,
    v: position.v,
    f: 0,
  })
}

export function resolveManagerOverlayNavigationBaseIndices(params: {
  currentIndices: { h: number; v: number; f: number } | null
  activeEmbeddedInstanceKey: string | null
}): { h: number; v: number; f: number } | null {
  if (params.currentIndices) {
    return params.currentIndices
  }

  if (!params.activeEmbeddedInstanceKey) {
    return null
  }

  const position = parseSyncDeckEmbeddedInstancePosition(params.activeEmbeddedInstanceKey)
  if (!position) {
    return null
  }

  return {
    h: position.h,
    v: position.v,
    f: 0,
  }
}

export function resolveManagerCurrentSlideNavigationCapability(params: {
  iframeCapability: boolean | null
  capabilityIndices: { h: number; v: number; f: number } | null
  currentIndices: { h: number; v: number; f: number } | null
}): boolean | null {
  if (!params.currentIndices || !params.capabilityIndices) {
    return null
  }

  // Overlay arrows follow slide-stack position, so fragment-only changes should not invalidate
  // a vertical capability payload for the current h/v slide anchor.
  return params.capabilityIndices.h === params.currentIndices.h
    && params.capabilityIndices.v === params.currentIndices.v
    ? params.iframeCapability
    : null
}

export function extractManagerNavigationCapabilitiesFromRevealMessage(
  rawPayload: unknown,
): SyncDeckManagerNavigationCapabilities | null {
  const envelope = parseRevealSyncEnvelope(rawPayload)
  if (!envelope || (envelope.action !== 'state' && envelope.action !== 'ready') || !isPlainObject(envelope.payload)) {
    return null
  }

  const payload = envelope.payload as Record<string, unknown>
  const navigation = isPlainObject(payload.navigation) ? (payload.navigation as Record<string, unknown>) : null
  const capabilities = isPlainObject(payload.capabilities) ? (payload.capabilities as Record<string, unknown>) : null
  const source = navigation ?? capabilities

  if (!source) {
    return null
  }

  const canGoBack = typeof source.canGoLeft === 'boolean' ? source.canGoLeft
    : typeof source.canGoBack === 'boolean' ? source.canGoBack : null
  const canGoForward = typeof source.canGoRight === 'boolean' ? source.canGoRight
    : typeof source.canGoForward === 'boolean' ? source.canGoForward : null
  const canGoUp = typeof source.canGoUp === 'boolean' ? source.canGoUp : null
  const canGoDown = typeof source.canGoDown === 'boolean' ? source.canGoDown : null

  if (canGoBack === null && canGoForward === null && canGoUp === null && canGoDown === null) {
    return null
  }

  return {
    canGoBack: canGoBack ?? true,
    canGoForward: canGoForward ?? true,
    canGoUp: canGoUp ?? true,
    canGoDown: canGoDown ?? true,
  }
}

export function resolveNextPendingEmbeddedEndConfirmation(
  currentPending: string | null,
  targetInstanceKey: string,
): { nextPending: string | null; shouldEnd: boolean } {
  if (currentPending === targetInstanceKey) {
    return { nextPending: null, shouldEnd: true }
  }

  return { nextPending: targetInstanceKey, shouldEnd: false }
}

export function activitySupportsEmbeddedReport(
  activityId: string,
  activityEntries: SyncDeckActivityPickerEntry[],
): boolean {
  return activityEntries.some((entry) => entry.activityId === activityId && entry.supportsReport)
}

export function parseDownloadFilenameFromContentDisposition(headerValue: string | null): string | null {
  if (typeof headerValue !== 'string' || headerValue.trim().length === 0) {
    return null
  }

  const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      return utf8Match[1]
    }
  }

  const plainMatch = headerValue.match(/filename="([^"]+)"|filename=([^;]+)/i)
  const candidate = plainMatch?.[1] ?? plainMatch?.[2] ?? null
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null
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
    compareIndices(params.instructorIndices, params.restoreTargetIndices) === 0

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
    f: CANONICAL_BOUNDARY_FRAGMENT_INDEX,
  }
}

function isWithinReleasedVerticalStack(
  indices: { h: number; v: number; f: number },
  explicitBoundary: { h: number; v: number; f: number },
): boolean {
  return indices.h === explicitBoundary.h && indices.v > explicitBoundary.v
}

function isAtOrBehindExplicitBoundary(
  instructorIndices: { h: number; v: number; f: number },
  explicitBoundary: { h: number; v: number; f: number },
): boolean {
  if (isWithinReleasedVerticalStack(instructorIndices, explicitBoundary)) {
    return false
  }

  if (instructorIndices.h !== explicitBoundary.h) {
    return instructorIndices.h < explicitBoundary.h
  }

  if (instructorIndices.v !== explicitBoundary.v) {
    return instructorIndices.v < explicitBoundary.v
  }

  if (explicitBoundary.f === CANONICAL_BOUNDARY_FRAGMENT_INDEX) {
    return true
  }

  return instructorIndices.f <= explicitBoundary.f
}

function hasExceededExplicitBoundary(
  instructorIndices: { h: number; v: number; f: number },
  explicitBoundary: { h: number; v: number; f: number },
): boolean {
  if (isWithinReleasedVerticalStack(instructorIndices, explicitBoundary)) {
    return false
  }

  if (instructorIndices.h !== explicitBoundary.h) {
    return instructorIndices.h > explicitBoundary.h
  }

  if (instructorIndices.v !== explicitBoundary.v) {
    return instructorIndices.v > explicitBoundary.v
  }

  if (explicitBoundary.f === CANONICAL_BOUNDARY_FRAGMENT_INDEX) {
    return false
  }

  return instructorIndices.f > explicitBoundary.f
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

  return isAtOrBehindExplicitBoundary(instructorIndices, explicitBoundary)
}

export function shouldClearExplicitBoundary(
  instructorIndices: { h: number; v: number; f: number } | null,
  explicitBoundary: { h: number; v: number; f: number } | null,
): boolean {
  if (!instructorIndices || !explicitBoundary) {
    return false
  }

  return hasExceededExplicitBoundary(instructorIndices, explicitBoundary)
}

export function buildBoundaryClearedPayload(
  instructorIndices: { h: number; v: number; f: number },
): Record<string, unknown> {
  return {
    type: 'reveal-sync',
    version: REVEAL_SYNC_PROTOCOL_VERSION,
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

function normalizeActivityId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function buildAnchoredInstanceKey(activityId: string, indices: { h: number; v: number; f: number }): string {
  return `${activityId}:${indices.h}:${indices.v}`
}

function normalizeActivityOptions(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined
}

export function resolveManagerActivityRequestStartInput(
  rawPayload: unknown,
  fallbackInstructorIndices: { h: number; v: number; f: number } | null,
): SyncDeckActivityLaunchRequest | null {
  if (!isPlainObject(rawPayload)) {
    return null
  }

  const payload = rawPayload as RevealActivityRequestPayload
  const activityId = normalizeActivityId(payload.activityId)
  if (!activityId) {
    return null
  }
  const activityOptions = normalizeActivityOptions(payload.activityOptions)

  const requestedInstanceKey = typeof payload.instanceKey === 'string' ? payload.instanceKey.trim() : ''
  if (requestedInstanceKey.length > 0) {
    return {
      activityId,
      instanceKey: requestedInstanceKey,
      ...(activityOptions ? { activityOptions } : {}),
    }
  }

  const requestedIndices = normalizeIndices(payload.indices)
  const resolvedIndices = requestedIndices ?? fallbackInstructorIndices
  if (!resolvedIndices) {
    return {
      activityId,
      instanceKey: `${activityId}:global`,
      ...(activityOptions ? { activityOptions } : {}),
    }
  }

  return {
    activityId,
    instanceKey: buildAnchoredInstanceKey(activityId, resolvedIndices),
    ...(activityOptions ? { activityOptions } : {}),
  }
}

export function resolveManagerActivityRequestBatchInputs(
  rawPayload: unknown,
  fallbackInstructorIndices: { h: number; v: number; f: number } | null,
): SyncDeckActivityLaunchRequest[] {
  if (!isPlainObject(rawPayload)) {
    return []
  }

  const payload = rawPayload as RevealActivityRequestPayload
  const primary = resolveManagerActivityRequestStartInput(payload, fallbackInstructorIndices)

  const parsedStackRequests = Array.isArray(payload.stackRequests)
    ? payload.stackRequests
      .map((entry) => resolveManagerActivityRequestStartInput(entry, fallbackInstructorIndices))
      .filter((entry): entry is SyncDeckActivityLaunchRequest => entry != null)
    : []

  const byInstanceKey = new Map<string, SyncDeckActivityLaunchRequest>()
  if (primary) {
    byInstanceKey.set(primary.instanceKey, primary)
  }
  for (const request of parsedStackRequests) {
    byInstanceKey.set(request.instanceKey, request)
  }

  return [...byInstanceKey.values()]
}

export function resolveSyncDeckActivityPickerEntries(
  entries: Array<{ id: string; name: string; description: string; reportEndpoint?: string }>,
): SyncDeckActivityPickerEntry[] {
  return entries
    .filter((entry) => entry.id !== 'syncdeck')
    .map((entry) => ({
      activityId: entry.id,
      name: entry.name,
      description: entry.description,
      supportsReport: typeof entry.reportEndpoint === 'string' && entry.reportEndpoint.trim().length > 0,
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function isRevealSyncEnvelopeData(data: unknown): data is RevealSyncEnvelope {
  const envelope = parseRevealSyncEnvelope(data)
  return envelope?.type === 'reveal-sync'
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
      version: typeof envelope.version === 'string' ? envelope.version : REVEAL_SYNC_PROTOCOL_VERSION,
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
    version: typeof envelope?.version === 'string' ? envelope.version : REVEAL_SYNC_PROTOCOL_VERSION,
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
    version: typeof envelope?.version === 'string' ? envelope.version : REVEAL_SYNC_PROTOCOL_VERSION,
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
        version: REVEAL_SYNC_PROTOCOL_VERSION,
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
    version: typeof envelope.version === 'string' ? envelope.version : REVEAL_SYNC_PROTOCOL_VERSION,
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

export function buildForceSyncToInstructorCommandMessage(indices: { h: number; v: number; f: number }): Record<string, unknown> {
  return buildRevealCommandMessage('syncToInstructor', {
    state: {
      indexh: indices.h,
      indexv: indices.v,
      indexf: indices.f,
    },
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
  const [persistentEntryPolicyFallback, setPersistentEntryPolicyFallback] = useState<PersistentSessionEntryPolicy | null>(null)
  const [isPasscodeReady, setIsPasscodeReady] = useState(false)
  const [hasAutoStarted, setHasAutoStarted] = useState(false)
  const [instructorConnectionState, setInstructorConnectionState] = useState<'connected' | 'disconnected'>('disconnected')
  const [instructorConnectionTooltip, setInstructorConnectionTooltip] = useState('Not connected to sync server')
  const [isInstructorSyncEnabled, setIsInstructorSyncEnabled] = useState(true)
  const [connectedStudentCount, setConnectedStudentCount] = useState(0)
  const [students, setStudents] = useState<SyncDeckStudentPresence[]>([])
  const [isStudentsPanelOpen, setIsStudentsPanelOpen] = useState(false)
  const [embeddedActivities, setEmbeddedActivities] = useState<SyncDeckEmbeddedActivitiesMap>({})
  const [isEmbeddedPanelOpen, setIsEmbeddedPanelOpen] = useState(false)
  const [isActivityPickerOpen, setIsActivityPickerOpen] = useState(false)
  const [endingEmbeddedInstanceKey, setEndingEmbeddedInstanceKey] = useState<string | null>(null)
  const [pendingEmbeddedEndConfirmInstanceKey, setPendingEmbeddedEndConfirmInstanceKey] = useState<string | null>(null)
  const [downloadingEmbeddedReportInstanceKey, setDownloadingEmbeddedReportInstanceKey] = useState<string | null>(null)
  const [isDownloadingSessionReport, setIsDownloadingSessionReport] = useState(false)
  const [overlayNavigationCapabilities, setOverlayNavigationCapabilities] = useState<SyncDeckManagerNavigationCapabilities | null>(null)
  const [overlayNavigationCapabilityIndices, setOverlayNavigationCapabilityIndices] =
    useState<{ h: number; v: number; f: number } | null>(null)
  const [instructorIndicesState, setInstructorIndicesState] = useState<{ h: number; v: number; f: number } | null>(null)
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
  const syncDebugEnabledRef = useRef(isSyncDeckDebugEnabled())

  useEffect(() => {
    syncDebugEnabledRef.current = isSyncDeckDebugEnabled()
  }, [location.search])

  const traceSync = useCallback((event: string, details: Record<string, unknown>): void => {
    if (!syncDebugEnabledRef.current) {
      return
    }

    console.info('[SyncDeck][Manager]', {
      event,
      ...details,
    })
  }, [])

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
  const queryEntryPolicy = new URLSearchParams(location.search).get('entryPolicy')
  const urlHash = resolvePersistentUrlHashForConfigure(queryUrlHash, persistentUrlHashFallback)
  const entryPolicy = resolvePersistentEntryPolicyForConfigure(
    queryUrlHash,
    queryEntryPolicy,
    persistentUrlHashFallback,
    persistentEntryPolicyFallback,
  )
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
    if (typeof window === 'undefined') {
      return null
    }

    return buildSyncDeckInstructorWsUrl({
      sessionId,
      location: window.location,
      isConfigurePanelOpen,
    })
  }, [sessionId, isConfigurePanelOpen])

  const { connect: connectInstructorWs, disconnect: disconnectInstructorWs, socketRef: instructorSocketRef } =
    useResilientWebSocket({
      buildUrl: buildInstructorWsUrl,
      shouldReconnect: Boolean(sessionId && instructorPasscode && !isConfigurePanelOpen),
      onOpen: (_event, ws) => {
        const authMessage = createSyncDeckInstructorWsAuthMessage(instructorPasscode)
        if (authMessage != null) {
          ws.send(authMessage)
        }

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
            const embeddedLifecyclePayload = parseEmbeddedLifecyclePayload(statePayload)
            if (embeddedLifecyclePayload) {
              if (embeddedLifecyclePayload.type === 'embedded-activity-end') {
                setPendingEmbeddedEndConfirmInstanceKey((current) =>
                  current === embeddedLifecyclePayload.instanceKey ? null : current,
                )
              }
              setEmbeddedActivities((current) =>
                applySyncDeckEmbeddedLifecyclePayload(current, embeddedLifecyclePayload),
              )
              return
            }

            const revealSyncStatePayload = isRevealSyncEnvelopeData(statePayload) ? statePayload : null
            if (revealSyncStatePayload) {
              const compatibility = assessRevealSyncProtocolCompatibility(revealSyncStatePayload.version)
              if (!compatibility.compatible) {
                traceSync('warn_inbound_server_payload_incompatible_protocol', {
                  reason: compatibility.reason,
                  expectedVersion: compatibility.expectedVersion,
                  receivedVersion: compatibility.receivedVersion,
                  action: revealSyncStatePayload.action,
                })
              }
            }

            if (!isInstructorSyncEnabledRef.current) {
              traceSync('drop_inbound_server_payload_sync_disabled', {
                type: revealSyncStatePayload ? revealSyncStatePayload.type : typeof statePayload,
              })
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
            traceSync('apply_inbound_server_payload', {
              commandName,
              action: revealSyncStatePayload ? revealSyncStatePayload.action : null,
            })
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
              setInstructorIndicesState(currentIndices)
              lastInstructorStatePayloadRef.current = statePayload
            }
            console.info('[SyncDeck][ManagerInboundServerPayload]', {
              action: revealSyncStatePayload ? revealSyncStatePayload.action : null,
              commandName,
              currentIndices,
            })
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
            traceSync('ignore_non_student_presence_payload', {
              messageType: message.type as string | undefined,
            })
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
        const existingEmbeddedActivities = normalizeSyncDeckEmbeddedActivities(payload.session?.data?.embeddedActivities)
        const existingPresentationUrl = payload.session?.data?.presentationUrl

        if (!isCancelled) {
          setEmbeddedActivities(existingEmbeddedActivities)
        }

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
      setPersistentUrlHashFallback(null)
      setPersistentEntryPolicyFallback(null)
      setIsPasscodeReady(true)
      return
    }

    let isCancelled = false

    const loadInstructorPasscode = async (): Promise<void> => {
      const cachedPasscode = normalizeStoredInstructorPasscode(
        window.sessionStorage.getItem(buildSyncDeckPasscodeKey(sessionId)),
      )

      if (!isCancelled) {
        setInstructorPasscode(cachedPasscode)
        setPersistentUrlHashFallback(null)
        setPersistentEntryPolicyFallback(null)
      }

      try {
        const response = await fetch(`/api/syncdeck/${sessionId}/instructor-passcode`, {
          credentials: 'include',
        })
        if (!response.ok) {
          if (!isCancelled) {
            if (!cachedPasscode) {
              setInstructorPasscode(null)
            }
            setPersistentUrlHashFallback(null)
            setPersistentEntryPolicyFallback(null)
          }
          return
        }

        const payload = (await response.json()) as InstructorPasscodeResponsePayload
        if (typeof payload.instructorPasscode === 'string' && payload.instructorPasscode.length > 0) {
          window.sessionStorage.setItem(buildSyncDeckPasscodeKey(sessionId), payload.instructorPasscode)
          if (!isCancelled) {
            setInstructorPasscode(payload.instructorPasscode)
          }
        } else if (!isCancelled && !cachedPasscode) {
          setInstructorPasscode(null)
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
          const persistentEntryPolicy = resolvePersistentSessionEntryPolicy(payload.persistentEntryPolicy)

          if (persistentPresentationUrl) {
            setPresentationUrl((current) => {
              return resolveRecoveredPresentationUrl(current, persistentPresentationUrl, hostProtocol, userAgent)
            })
          }
          setPersistentUrlHashFallback(persistentUrlHash)
          setPersistentEntryPolicyFallback(persistentEntryPolicy)
        }
      } catch {
        if (!isCancelled) {
          if (!cachedPasscode) {
            setInstructorPasscode(null)
          }
          setPersistentUrlHashFallback(null)
          setPersistentEntryPolicyFallback(null)
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
  }, [hostProtocol, sessionId, userAgent])

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
            payload: buildForceSyncToInstructorCommandMessage(currentInstructorIndices),
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
        version: REVEAL_SYNC_PROTOCOL_VERSION,
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

  const launchEmbeddedActivityFromRequest = useCallback(
    async (request: SyncDeckActivityLaunchRequest): Promise<void> => {
      if (!sessionId) {
        setStartError('Cannot launch embedded activity without a SyncDeck session id.')
        setStartSuccess(null)
        return
      }

      if (!instructorPasscode) {
        setStartError('Instructor passcode missing. Refresh SyncDeck manager and try again.')
        setStartSuccess(null)
        return
      }

      try {
        const response = await fetch(`/api/syncdeck/${encodeURIComponent(sessionId)}/embedded-activity/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instructorPasscode,
            activityId: request.activityId,
            instanceKey: request.instanceKey,
            ...(request.activityOptions ? { activityOptions: request.activityOptions } : {}),
          }),
        })

        if (!response.ok) {
          let message = 'Unable to launch embedded activity.'
          try {
            const payload = (await response.json()) as { error?: string }
            if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
              message = payload.error
            }
          } catch {
            // keep default message
          }
          setStartError(message)
          setStartSuccess(null)
          return
        }

        const payload = (await response.json()) as SyncDeckEmbeddedActivityStartResponse
        const childSessionId = typeof payload.childSessionId === 'string' ? payload.childSessionId.trim() : ''
        if (childSessionId && isPlainObject(payload.managerBootstrap)) {
          storeCreateSessionBootstrapPayload(request.activityId, childSessionId, payload.managerBootstrap)
        }

        setStartError(null)
        setStartSuccess(`Launched ${request.activityId} (${request.instanceKey}).`)
      } catch {
        setStartError('Unable to launch embedded activity.')
        setStartSuccess(null)
      }
    },
    [sessionId, instructorPasscode],
  )

  const handleResolvedActivityRequests = useCallback((startRequests: SyncDeckActivityLaunchRequest[]): void => {
    const primaryStartRequest = startRequests[0] ?? null
    if (!primaryStartRequest) {
      setStartError('Ignored activity request with missing activity id.')
      setStartSuccess(null)
      return
    }

    if (startRequests.length === 1 && embeddedActivities[primaryStartRequest.instanceKey]) {
      const resyncCommand = buildManagerResyncCommandForInstanceKey(primaryStartRequest.instanceKey)
      if (resyncCommand && presentationOrigin) {
        presentationIframeRef.current?.contentWindow?.postMessage(resyncCommand, presentationOrigin)
        relayInstructorPayload(resyncCommand)
        setInstructorIndicesState(extractIndicesFromRevealPayload(resyncCommand))
      }
      console.info('[SyncDeck][ManagerActivityRequestSkippedExisting]', {
        startRequest: primaryStartRequest,
        embeddedActivityKeys: Object.keys(embeddedActivities),
        resyncCommandName: extractRevealCommandName(resyncCommand),
      })
      setStartError(null)
      setStartSuccess(null)
      return
    }

    console.info('[SyncDeck][ManagerActivityRequestLaunch]', {
      startRequests,
    })
    void (async () => {
      for (const startRequest of startRequests) {
        if (embeddedActivities[startRequest.instanceKey]) {
          continue
        }
        await launchEmbeddedActivityFromRequest(startRequest)
      }
    })()
  }, [embeddedActivities, launchEmbeddedActivityFromRequest, presentationOrigin, relayInstructorPayload])

  const handleActivityPickerLaunch = useCallback((activityId: string): void => {
    const startRequests = resolveManagerActivityRequestBatchInputs(
      { activityId, indices: lastInstructorIndicesRef.current },
      lastInstructorIndicesRef.current,
    )
    setIsActivityPickerOpen(false)
    handleResolvedActivityRequests(startRequests)
  }, [handleResolvedActivityRequests])

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
          entryPolicy,
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
    entryPolicy,
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

  const activityPickerEntries = useMemo(
    () => resolveSyncDeckActivityPickerEntries(
      Object.values(activityPickerConfigModules)
        .map((moduleExports) => moduleExports.default)
        .filter((entry): entry is NonNullable<SyncDeckActivityConfigModule['default']> => entry != null)
        .map((entry) => ({
          id: typeof entry.id === 'string' ? entry.id : '',
          name: typeof entry.title === 'string' && entry.title.trim().length > 0
            ? entry.title
            : typeof entry.name === 'string'
              ? entry.name
              : '',
          description: typeof entry.description === 'string' ? entry.description : '',
          reportEndpoint: typeof entry.reportEndpoint === 'string' ? entry.reportEndpoint : undefined,
        }))
        .filter((entry) => entry.id.length > 0 && entry.name.length > 0 && entry.description.length > 0),
    ),
    [],
  )

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

      const envelope = parseRevealSyncEnvelope(event.data)
      if (envelope?.type === 'reveal-sync') {
        const compatibility = assessRevealSyncProtocolCompatibility(envelope.version)
        if (!compatibility.compatible) {
          traceSync('warn_inbound_iframe_payload_incompatible_protocol', {
            reason: compatibility.reason,
            expectedVersion: compatibility.expectedVersion,
            receivedVersion: compatibility.receivedVersion,
            action: envelope.action,
          })
        }

        if (envelope.action === 'activityRequest') {
          const startRequests = resolveManagerActivityRequestBatchInputs(
            envelope.payload,
            lastInstructorIndicesRef.current,
          )
          console.info('[SyncDeck][ManagerActivityRequestInbound]', {
            rawPayload: envelope.payload,
            resolvedStartRequests: startRequests,
            instructorIndices: lastInstructorIndicesRef.current,
            embeddedActivityKeys: Object.keys(embeddedActivities),
          })
          handleResolvedActivityRequests(startRequests)
          return
        }
      }

      const nextOverlayNavigationCapabilities = extractManagerNavigationCapabilitiesFromRevealMessage(event.data)
      if (nextOverlayNavigationCapabilities) {
        setOverlayNavigationCapabilities(nextOverlayNavigationCapabilities)
        setOverlayNavigationCapabilityIndices(extractIndicesFromRevealPayload(event.data))
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

      if (!hasSeenInstructorIframeReadySignalRef.current && envelope?.type === 'reveal-sync') {
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
        if (!isInstructorSyncEnabledRef.current) {
          traceSync('drop_outbound_iframe_payload_sync_disabled', {
            action: envelope?.action,
          })
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
          traceSync('relay_outbound_chalkboard_payload', {
            action: extractRevealCommandName(outboundChalkboardRelayCommand),
          })
          return
        }

        const instructorIndices = extractIndicesFromRevealPayload(event.data)
        if (instructorIndices) {
          lastInstructorIndicesRef.current = instructorIndices
          setInstructorIndicesState(instructorIndices)
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
            traceSync('drop_outbound_iframe_state_restore_suppression', {
              action: envelope.action,
            })
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
          traceSync('drop_outbound_iframe_state_explicit_boundary', {
            action: envelope.action,
          })
          return
        }

        if (
          envelope?.type === 'reveal-sync' &&
          envelope.action === 'state' &&
          shouldClearExplicitBoundary(lastInstructorIndicesRef.current, explicitBoundaryRef.current)
        ) {
          const instructorIndicesAtClear = lastInstructorIndicesRef.current
          if (!instructorIndicesAtClear) {
            return
          }

          const targetWindow = presentationIframeRef.current?.contentWindow
          if (targetWindow && presentationOrigin) {
            targetWindow.postMessage(buildClearBoundaryCommandMessage(), presentationOrigin)
          }

          const boundaryClearedPayload = buildBoundaryClearedPayload(instructorIndicesAtClear)
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
        const sanitizedIndices = extractIndicesFromRevealPayload(sanitizedPayload)
        lastInstructorPayloadRef.current = sanitizedPayload
        if (envelope?.type === 'reveal-sync' && envelope.action === 'state') {
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
          traceSync('drop_outbound_iframe_payload_relay_policy', {
            action: envelope?.action,
          })
          return
        }

        socket.send(
          JSON.stringify({
            type: 'syncdeck-state-update',
            payload: sanitizedPayload,
          }),
        )
        console.info('[SyncDeck][ManagerRelayOutbound]', {
          action: envelope?.action,
          commandName: extractRevealCommandName(event.data),
          instructorIndices,
          sanitizedIndices,
          explicitBoundary: explicitBoundaryRef.current,
          pausedState,
        })
        traceSync('relay_outbound_iframe_payload', {
          action: envelope?.action,
        })
      } catch {
        return
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [
    embeddedActivities,
    handleResolvedActivityRequests,
    isConfigurePanelOpen,
    presentationOrigin,
    requestChalkboardStateFromInstructor,
    applyDrawingToolModeToInstructorIframe,
    armRestoreSuppression,
    releaseRestoreSuppression,
    traceSync,
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
  const runningEmbeddedActivityCount = Object.keys(embeddedActivities).length
  const activeEmbeddedInstanceKey = resolveManagerActiveEmbeddedInstanceKey(embeddedActivities, instructorIndicesState)
  const activeEmbeddedActivity = activeEmbeddedInstanceKey ? embeddedActivities[activeEmbeddedInstanceKey] ?? null : null
  const currentOverlayIndices = instructorIndicesState ?? lastInstructorIndicesRef.current
  const overlayNavigationBaseIndices = resolveManagerOverlayNavigationBaseIndices({
    currentIndices: currentOverlayIndices,
    activeEmbeddedInstanceKey,
  })
  const overlayVerticalNavigationCapabilities = deriveEmbeddedOverlayVerticalNavigationCapabilities(
    Object.keys(embeddedActivities),
    overlayNavigationBaseIndices,
  )
  const canMoveBack =
    overlayNavigationCapabilities?.canGoBack === true
    || (overlayNavigationBaseIndices ? overlayNavigationBaseIndices.h > 0 : false)
  const canMoveForward =
    overlayNavigationCapabilities?.canGoForward !== false
  const canMoveUp =
    resolveEmbeddedOverlayVerticalMoveAllowed({
      direction: 'up',
      iframeCapability: resolveManagerCurrentSlideNavigationCapability({
        iframeCapability: overlayNavigationCapabilities?.canGoUp ?? null,
        capabilityIndices: overlayNavigationCapabilityIndices,
        currentIndices: overlayNavigationBaseIndices,
      }),
      derivedCapabilities: overlayVerticalNavigationCapabilities,
      fallbackAllowed: overlayNavigationBaseIndices ? overlayNavigationBaseIndices.v > 0 : false,
    })
  const canMoveDown =
    resolveEmbeddedOverlayVerticalMoveAllowed({
      direction: 'down',
      iframeCapability: resolveManagerCurrentSlideNavigationCapability({
        iframeCapability: overlayNavigationCapabilities?.canGoDown ?? null,
        capabilityIndices: overlayNavigationCapabilityIndices,
        currentIndices: overlayNavigationBaseIndices,
      }),
      derivedCapabilities: overlayVerticalNavigationCapabilities,
      fallbackAllowed: overlayNavigationBaseIndices ? overlayNavigationBaseIndices.v === 0 : false,
    })

  const sendEmbeddedOverlayNavigation = (direction: 'left' | 'right' | 'up' | 'down'): void => {
    const targetWindow = presentationIframeRef.current?.contentWindow
    if (!targetWindow || !presentationOrigin) {
      return
    }

    const optimisticIndices = resolveOptimisticEmbeddedOverlayIndices(
      Object.keys(embeddedActivities),
      overlayNavigationBaseIndices,
      direction,
    )

    console.info('[SyncDeck][ManagerOverlayNav]', {
      direction,
      currentOverlayIndices,
      overlayNavigationBaseIndices,
      optimisticIndices,
      commandName: optimisticIndices ? 'setState' : null,
    })

    if (!optimisticIndices) {
      return
    }

    armRestoreSuppression(optimisticIndices)
    setInstructorIndicesState(optimisticIndices)
    const setStateCommand = buildManagerOverlaySetStateCommand(optimisticIndices)
    targetWindow.postMessage(
      setStateCommand,
      presentationOrigin,
    )
    relayInstructorPayload(setStateCommand)
  }

  const endEmbeddedActivity = async (instanceKey: string): Promise<void> => {
    if (!sessionId || !instructorPasscode) {
      return
    }

    setEndingEmbeddedInstanceKey(instanceKey)
    try {
      const response = await fetch(`/api/syncdeck/${encodeURIComponent(sessionId)}/embedded-activity/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instructorPasscode,
          instanceKey,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to end embedded activity')
      }

      setEmbeddedActivities((current) => {
        const next = { ...current }
        delete next[instanceKey]
        return next
      })
      setPendingEmbeddedEndConfirmInstanceKey((current) => (current === instanceKey ? null : current))
    } catch {
      // Keep UI stable if end fails; WS lifecycle update will eventually reconcile.
    } finally {
      setEndingEmbeddedInstanceKey(null)
    }
  }

  const downloadEmbeddedActivityReport = async (instanceKey: string): Promise<void> => {
    if (!sessionId || !instructorPasscode) {
      return
    }

    setDownloadingEmbeddedReportInstanceKey(instanceKey)
    try {
      const response = await fetch(
        `/api/syncdeck/${encodeURIComponent(sessionId)}/embedded-activity/report/${encodeURIComponent(instanceKey)}`,
        {
          headers: {
            'x-syncdeck-instructor-passcode': instructorPasscode,
          },
        },
      )
      if (!response.ok) {
        throw new Error('Failed to download embedded activity report')
      }

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const downloadLink = document.createElement('a')
      downloadLink.href = objectUrl
      downloadLink.download =
        parseDownloadFilenameFromContentDisposition(response.headers.get('Content-Disposition'))
        ?? `${instanceKey}.html`
      document.body.appendChild(downloadLink)
      downloadLink.click()
      document.body.removeChild(downloadLink)
      URL.revokeObjectURL(objectUrl)
    } catch {
      // Keep the confirmation state visible so the instructor can retry the download.
    } finally {
      setDownloadingEmbeddedReportInstanceKey(null)
    }
  }

  const downloadSessionReport = async (): Promise<void> => {
    if (!sessionId || !instructorPasscode) {
      return
    }

    setIsDownloadingSessionReport(true)
    try {
      const response = await fetch(
        `/api/syncdeck/${encodeURIComponent(sessionId)}/report`,
        {
          headers: {
            'x-syncdeck-instructor-passcode': instructorPasscode,
          },
        },
      )
      if (!response.ok) {
        throw new Error('Failed to download SyncDeck session report')
      }

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const downloadLink = document.createElement('a')
      downloadLink.href = objectUrl
      downloadLink.download =
        parseDownloadFilenameFromContentDisposition(response.headers.get('Content-Disposition'))
        ?? `syncdeck-${sessionId}.html`
      document.body.appendChild(downloadLink)
      downloadLink.click()
      document.body.removeChild(downloadLink)
      URL.revokeObjectURL(objectUrl)
    } catch {
      // Keep the session toolbar stable if the download fails so the instructor can retry.
    } finally {
      setIsDownloadingSessionReport(false)
    }
  }

  const handleEmbeddedEndControlClick = (instanceKey: string): void => {
    const next = resolveNextPendingEmbeddedEndConfirmation(pendingEmbeddedEndConfirmInstanceKey, instanceKey)
    setPendingEmbeddedEndConfirmInstanceKey(next.nextPending)
    if (!next.shouldEnd) {
      return
    }

    void endEmbeddedActivity(instanceKey)
  }

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
                onClick={() => setIsEmbeddedPanelOpen((current) => !current)}
                className="px-2 py-1 rounded border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
                aria-expanded={isEmbeddedPanelOpen}
                aria-controls="syncdeck-running-activities-panel"
              >
                Running activities: {runningEmbeddedActivityCount}
              </button>
              <button
                type="button"
                onClick={() => setIsActivityPickerOpen((current) => !current)}
                className="px-2 py-1 rounded border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-expanded={isActivityPickerOpen}
                aria-controls="syncdeck-activity-picker-panel"
                disabled={isConfigurePanelOpen}
              >
                Activities
              </button>
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
              type="button"
              onClick={() => {
                void downloadSessionReport()
              }}
              disabled={isDownloadingSessionReport || !instructorPasscode}
              className="px-3 py-2 rounded border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDownloadingSessionReport ? 'Downloading report…' : 'Download Session Report'}
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

        {isEmbeddedPanelOpen && (
          <div
            id="syncdeck-running-activities-panel"
            className="absolute right-6 top-full mt-2 w-80 rounded border border-gray-200 bg-white shadow-lg p-3 z-30"
          >
            <h2 className="text-sm font-semibold text-gray-800 mb-2">Running Activities</h2>
            {runningEmbeddedActivityCount === 0 ? (
              <p className="text-sm text-gray-600">No embedded activities running.</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(embeddedActivities).map(([instanceKey, record]) => (
                  <div key={instanceKey} className="rounded border border-gray-200 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-gray-800">{record.activityId}</p>
                      {resolveManagerEmbeddedInstanceStatus(instanceKey, activeEmbeddedInstanceKey) === 'active' ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-700" aria-label="Active overlay">
                          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500" aria-label="Idle overlay">
                          <span className="inline-block h-2 w-2 rounded-full bg-gray-400" />
                          Idle
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-600">{instanceKey}</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-600 truncate">{record.childSessionId}</span>
                      <div className="flex items-center gap-2">
                        {pendingEmbeddedEndConfirmInstanceKey === instanceKey && activitySupportsEmbeddedReport(record.activityId, activityPickerEntries) && (
                          <button
                            type="button"
                            onClick={() => {
                              void downloadEmbeddedActivityReport(instanceKey)
                            }}
                            disabled={downloadingEmbeddedReportInstanceKey === instanceKey}
                            className="px-2 py-1 rounded border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                          >
                            {downloadingEmbeddedReportInstanceKey === instanceKey ? 'Downloading…' : 'Download report'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            handleEmbeddedEndControlClick(instanceKey)
                          }}
                          disabled={endingEmbeddedInstanceKey === instanceKey}
                          className="px-2 py-1 rounded border border-red-600 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
                        >
                          {endingEmbeddedInstanceKey === instanceKey
                            ? 'Ending…'
                            : pendingEmbeddedEndConfirmInstanceKey === instanceKey
                              ? 'Confirm end'
                              : 'End'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {isActivityPickerOpen && (
          <div
            id="syncdeck-activity-picker-panel"
            className="absolute right-32 top-full mt-2 w-96 rounded border border-gray-200 bg-white shadow-lg p-3 z-30"
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-800">Launch Activity</h2>
              <button
                type="button"
                onClick={() => setIsActivityPickerOpen(false)}
                className="text-xs text-gray-500 hover:text-gray-800"
              >
                Close
              </button>
            </div>
            <p className="mb-3 text-xs text-gray-600">
              Launches the selected activity on your current slide anchor using the same embedded start flow as deck activity requests.
            </p>
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {activityPickerEntries.map((entry) => (
                <button
                  key={entry.activityId}
                  type="button"
                  onClick={() => {
                    handleActivityPickerLaunch(entry.activityId)
                  }}
                  className="w-full rounded border border-gray-200 px-3 py-2 text-left hover:bg-gray-50"
                >
                  <span className="block text-sm font-medium text-gray-800">{entry.name}</span>
                  <span className="mt-1 block text-xs text-gray-600">{entry.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}
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
              <div className="w-full h-full min-h-0 bg-white overflow-hidden relative">
                <iframe
                  ref={presentationIframeRef}
                  title="SyncDeck Presentation"
                  src={presentationUrl}
                  className="w-full h-full"
                  allow="fullscreen"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                  onLoad={handlePresentationIframeLoad}
                />

                {activeEmbeddedActivity && (
                  <div className="absolute inset-0 z-20 bg-white overflow-hidden">
                    <div className="absolute left-4 top-4 z-30 max-w-[calc(100%-8rem)] rounded-md bg-white/92 px-3 py-2 shadow-sm ring-1 ring-black/5 backdrop-blur-sm">
                      <p className="text-sm font-semibold text-gray-800 truncate">
                        Embedded Manager: {activeEmbeddedActivity.activityId}
                      </p>
                      <p className="text-xs text-gray-600 truncate">{activeEmbeddedInstanceKey}</p>
                    </div>
                    <div className="absolute inset-0 p-14">
                      <div className="w-full h-full rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
                        <iframe
                          title={`Embedded ${activeEmbeddedActivity.activityId} manager`}
                          src={`/manage/${encodeURIComponent(activeEmbeddedActivity.activityId)}/${encodeURIComponent(activeEmbeddedActivity.childSessionId)}`}
                          className="w-full h-full"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      className="absolute left-3 top-1/2 -translate-y-1/2 z-30 rounded-full border border-white/20 bg-black/60 px-3 py-2 text-white shadow-sm hover:bg-black/75 disabled:cursor-not-allowed disabled:border-white/45 disabled:bg-transparent disabled:text-white/65"
                          onClick={() => sendEmbeddedOverlayNavigation('left')}
                      aria-label="Move left"
                      title="Move left"
                      disabled={!canMoveBack}
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      className="absolute top-3 left-1/2 -translate-x-1/2 z-30 rounded-full border border-white/20 bg-black/60 px-3 py-2 text-white shadow-sm hover:bg-black/75 disabled:cursor-not-allowed disabled:border-white/45 disabled:bg-transparent disabled:text-white/65"
                      onClick={() => sendEmbeddedOverlayNavigation('up')}
                      aria-label="Move up"
                      title="Move up"
                      disabled={!canMoveUp}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 z-30 rounded-full border border-white/20 bg-black/60 px-3 py-2 text-white shadow-sm hover:bg-black/75 disabled:cursor-not-allowed disabled:border-white/45 disabled:bg-transparent disabled:text-white/65"
                          onClick={() => sendEmbeddedOverlayNavigation('right')}
                      aria-label="Move right"
                      title="Move right"
                      disabled={!canMoveForward}
                    >
                      ▶
                    </button>
                    <button
                      type="button"
                      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 rounded-full border border-white/20 bg-black/60 px-3 py-2 text-white shadow-sm hover:bg-black/75 disabled:cursor-not-allowed disabled:border-white/45 disabled:bg-transparent disabled:text-white/65"
                      onClick={() => sendEmbeddedOverlayNavigation('down')}
                      aria-label="Move down"
                      title="Move down"
                      disabled={!canMoveDown}
                    >
                      ▼
                    </button>
                  </div>
                )}
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
