import { useCallback, useEffect, useMemo, useRef, useState, type FC, type MouseEvent, type PointerEvent } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler'
import {
  buildEntryParticipantStorageKey,
  buildSessionEntryParticipantStorageKey,
  hasValidEntryParticipantHandoffStorageValue,
  persistEntryParticipantToken,
} from '@src/components/common/entryParticipantStorage'
import {
  persistSessionParticipantIdentity,
  readStoredSessionParticipantIdentity,
  resolveInitialEntryParticipantIdentity,
} from '@src/components/common/entryParticipantIdentityUtils'
import {
  buildSessionEntryParticipantSubmitApiUrl,
} from '@src/components/common/entryParticipantStorage'
import { persistWaitingRoomServerBackedHandoff } from '@src/components/common/waitingRoomHandoffUtils'
import {
  REVEAL_SYNC_PROTOCOL_VERSION,
  assessRevealSyncProtocolCompatibility,
} from '../../shared/revealSyncProtocol.js'
import { resolveSyncDeckStudentCloseDecision } from './reconnectUtils.js'
import ConnectionStatusDot from '../components/ConnectionStatusDot.js'
import { getStudentPresentationCompatibilityError } from '../shared/presentationUrlCompatibility.js'
import { isSyncDeckDebugEnabled } from '../shared/syncDebug.js'
import {
  buildSyncDeckDocumentTitle,
  extractRevealMetadataTitle,
  isRevealIframeReadySignal,
} from '../shared/presentationMetadata.js'
import {
  consumeEmbeddedOverlayNavigationEvent,
  deriveEmbeddedOverlayVerticalNavigationCapabilities,
  resolveEmbeddedOverlayVerticalMoveAllowed,
  resolveOptimisticEmbeddedOverlayIndices,
} from '../shared/embeddedOverlayNavigation.js'
import { useEmbeddedOverlayNavigationInteraction } from '../shared/useEmbeddedOverlayNavigationInteraction.js'

interface SessionResponsePayload {
  session?: {
    data?: {
      presentationUrl?: unknown
      standaloneMode?: unknown
      embeddedActivities?: unknown
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

interface RevealActivityRequestPayload {
  activityId?: unknown
  indices?: unknown
  stackRequests?: unknown
  standaloneEntry?: unknown
  activityOptions?: unknown
}

type SyncDeckDrawingToolMode = 'none' | 'chalkboard' | 'pen'

interface SyncDeckEmbeddedActivityRecord {
  childSessionId: string
  activityId: string
  startedAt: number
  owner: string
}

type SyncDeckEmbeddedActivitiesMap = Record<string, SyncDeckEmbeddedActivityRecord>

interface SyncDeckEmbeddedInstancePosition {
  h: number
  v: number
}

interface SyncDeckEmbeddedLifecyclePayload {
  type: 'embedded-activity-start' | 'embedded-activity-end'
  instanceKey: string
  activityId?: string
  childSessionId: string
  entryParticipantToken?: string
}

interface SyncDeckEmbeddedEntryResponse {
  childSessionId?: unknown
  entryParticipantToken?: unknown
}

export function shouldPersistRecoveredEmbeddedEntryResponse(params: {
  response: SyncDeckEmbeddedEntryResponse
  activeEmbeddedChildSessionId: string
}): { childSessionId: string; entryParticipantToken: string } | null {
  const childSessionId = typeof params.response.childSessionId === 'string' ? params.response.childSessionId.trim() : ''
  const entryParticipantToken = typeof params.response.entryParticipantToken === 'string'
    ? params.response.entryParticipantToken.trim()
    : ''

  if (!childSessionId || !entryParticipantToken) {
    return null
  }

  if (childSessionId !== params.activeEmbeddedChildSessionId) {
    return null
  }

  return {
    childSessionId,
    entryParticipantToken,
  }
}

export type SyncDeckStudentSyncState = 'solo' | 'synchronized' | 'behind' | 'ahead' | 'vertical'

interface NavigationCapabilities {
  canGoBack: boolean
  canGoForward: boolean
  canGoUp: boolean
  canGoDown: boolean
}

interface SyncDeckSoloOverlayRecord {
  activityId: string
  src?: string
  notice?: string
  selectedOptions?: Record<string, unknown>
}

type SyncDeckSoloOverlaysMap = Record<string, SyncDeckSoloOverlayRecord>

interface SyncDeckSoloActivityRequest {
  activityId: string
  indices: {
    h: number
    v: number
    f: number
  }
  standaloneEntry?: {
    enabled: boolean
    supportsDirectPath: boolean
    supportsPermalink: boolean
  }
  selectedOptions?: Record<string, unknown>
}

const CANONICAL_BOUNDARY_FRAGMENT_INDEX = -1
const MAX_PENDING_IFRAME_PAYLOADS = 25
const selectedOptionsComparisonKeyCache = new WeakMap<Record<string, unknown>, string>()

function compareIndices(a: { h: number; v: number; f: number }, b: { h: number; v: number; f: number }): number {
  if (a.h !== b.h) return a.h - b.h
  if (a.v !== b.v) return a.v - b.v
  return a.f - b.f
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
  boundary: { h: number; v: number; f: number },
): boolean {
  return indices.h === boundary.h && indices.v > boundary.v
}

function hasExceededReleasedBoundary(
  indices: { h: number; v: number; f: number },
  boundary: { h: number; v: number; f: number },
): boolean {
  if (isWithinReleasedVerticalStack(indices, boundary)) {
    return false
  }

  if (indices.h !== boundary.h) {
    return indices.h > boundary.h
  }

  if (indices.v !== boundary.v) {
    return indices.v > boundary.v
  }

  if (boundary.f === CANONICAL_BOUNDARY_FRAGMENT_INDEX) {
    return false
  }

  return indices.f > boundary.f
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

  return hasExceededReleasedBoundary(instructorIndices, setBoundary) ? instructorIndices : setBoundary
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

function normalizeActivityId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function resolveSoloOverlaySlideKey(indices: { h: number; v: number }): string {
  return `${indices.h}:${indices.v}`
}

function normalizeStandaloneEntryContract(value: unknown): {
  enabled: boolean
  supportsDirectPath: boolean
  supportsPermalink: boolean
} | null {
  if (!isPlainObject(value)) {
    return null
  }

  return {
    enabled: value.enabled === true,
    supportsDirectPath: value.supportsDirectPath === true,
    supportsPermalink: value.supportsPermalink === true,
  }
}

function normalizeSelectedOptions(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }

  const entries = Object.entries(value)
    .filter(([, optionValue]) => optionValue != null)
    .map(([key, optionValue]) => {
      if (typeof optionValue === 'string') {
        const trimmed = optionValue.trim()
        return trimmed.length > 0 ? ([key, trimmed] as const) : null
      }

      return [key, optionValue] as const
    })
    .filter((entry): entry is readonly [string, unknown] => entry !== null)

  if (entries.length === 0) {
    return undefined
  }

  return Object.fromEntries(entries)
}

function getSelectedOptionsComparisonKey(value: Record<string, unknown> | null | undefined): string {
  if (!value) {
    return 'null'
  }

  const cached = selectedOptionsComparisonKeyCache.get(value)
  if (cached) {
    return cached
  }

  const preparedHash = typeof value.h === 'string' ? value.h.trim() : ''
  const nextKey = preparedHash.length > 0 ? `h:${preparedHash}` : JSON.stringify(value)
  selectedOptionsComparisonKeyCache.set(value, nextKey)
  return nextKey
}

export function resolveStudentSoloActivityRequestInputs(
  rawPayload: unknown,
  fallbackStudentIndices: { h: number; v: number; f: number } | null,
): SyncDeckSoloActivityRequest[] {
  if (!isPlainObject(rawPayload)) {
    return []
  }

  const payload = rawPayload as RevealActivityRequestPayload

  const parseRequest = (requestPayload: unknown): SyncDeckSoloActivityRequest | null => {
    if (!isPlainObject(requestPayload)) {
      return null
    }

    const request = requestPayload as RevealActivityRequestPayload
    const activityId = normalizeActivityId(request.activityId)
    if (!activityId) {
      return null
    }

    const indices = normalizeIndices(request.indices) ?? fallbackStudentIndices
    if (!indices) {
      return null
    }

    const standaloneEntry = normalizeStandaloneEntryContract(request.standaloneEntry)
    const selectedOptions = normalizeSelectedOptions(request.activityOptions)

    return {
      activityId,
      indices,
      ...(standaloneEntry ? { standaloneEntry } : {}),
      ...(selectedOptions ? { selectedOptions } : {}),
    }
  }

  const requests: SyncDeckSoloActivityRequest[] = []
  const primary = parseRequest(payload)
  if (primary) {
    requests.push(primary)
  }

  if (Array.isArray(payload.stackRequests)) {
    for (const stackRequest of payload.stackRequests) {
      const parsed = parseRequest(stackRequest)
      if (parsed) {
        requests.push(parsed)
      }
    }
  }

  const dedupedBySlide = new Map<string, SyncDeckSoloActivityRequest>()
  for (const request of requests) {
    dedupedBySlide.set(resolveSoloOverlaySlideKey(request.indices), request)
  }

  return [...dedupedBySlide.values()]
}

export function resolveStudentSoloActivityRequest(
  rawPayload: unknown,
  fallbackStudentIndices: { h: number; v: number; f: number } | null,
): SyncDeckSoloActivityRequest | null {
  const requests = resolveStudentSoloActivityRequestInputs(rawPayload, fallbackStudentIndices)
  if (requests.length === 0) {
    return null
  }

  if (fallbackStudentIndices) {
    const matchingCurrentSlide = requests.find(
      (request) => request.indices.h === fallbackStudentIndices.h && request.indices.v === fallbackStudentIndices.v,
    )
    if (matchingCurrentSlide) {
      return matchingCurrentSlide
    }
  }

  return requests[0] ?? null
}

export function applyResolvedStandaloneEntryToSoloRequest(
  request: SyncDeckSoloActivityRequest,
  resolvedStandaloneEntry: SyncDeckSoloActivityRequest['standaloneEntry'] | null | undefined,
): SyncDeckSoloActivityRequest {
  if (request.standaloneEntry || !resolvedStandaloneEntry) {
    return request
  }

  return {
    ...request,
    standaloneEntry: resolvedStandaloneEntry,
  }
}

export function shouldRenderStudentOverlayNavigation(params: {
  activeEmbeddedActivity: SyncDeckEmbeddedActivityRecord | null
  activeSoloOverlay: SyncDeckSoloOverlayRecord | null
}): boolean {
  return params.activeEmbeddedActivity != null || params.activeSoloOverlay != null
}

export function getStudentOverlayBackdropClass(): string {
  return 'bg-white'
}

export function buildStudentOverlayNavigationKeys(params: {
  embeddedActivities: SyncDeckEmbeddedActivitiesMap
  soloOverlays: SyncDeckSoloOverlaysMap
}): string[] {
  const embeddedKeys = Object.keys(params.embeddedActivities)
  const soloKeys = Object.entries(params.soloOverlays).flatMap(([slideKey, overlay]) => {
    const activityId = overlay.activityId.trim()
    return activityId.length > 0 ? [`${activityId}:${slideKey}`] : []
  })

  return [...new Set([...embeddedKeys, ...soloKeys])]
}

export function resolveCurrentSlideNavigationCapability(params: {
  iframeCapability: boolean | null
  capabilityIndices: { h: number; v: number; f: number } | null
  currentIndices: { h: number; v: number; f: number } | null
}): boolean | null {
  if (!params.currentIndices || !params.capabilityIndices) {
    return null
  }

  return params.capabilityIndices.h === params.currentIndices.h
    && params.capabilityIndices.v === params.currentIndices.v
    ? params.iframeCapability
    : null
}

export function applyStudentSoloActivityRequest(
  current: SyncDeckSoloOverlaysMap,
  request: SyncDeckSoloActivityRequest,
): SyncDeckSoloOverlaysMap {
  const slideKey = resolveSoloOverlaySlideKey(request.indices)
  const standaloneEntry = request.standaloneEntry
  const supportsDirectStandalone = standaloneEntry
    ? standaloneEntry.enabled && standaloneEntry.supportsDirectPath
    : true
  const supportsActivityOwnedStandaloneLaunch = standaloneEntry?.enabled === true && standaloneEntry.supportsPermalink === true

  const nextOverlay: SyncDeckSoloOverlayRecord = supportsDirectStandalone
    ? {
      activityId: request.activityId,
      src: `/solo/${encodeURIComponent(request.activityId)}`,
    }
    : supportsActivityOwnedStandaloneLaunch
      ? {
        activityId: request.activityId,
        notice: 'Launching solo activity…',
        ...(request.selectedOptions ? { selectedOptions: request.selectedOptions } : {}),
      }
    : {
      activityId: request.activityId,
      notice: 'This activity requires a live session.',
    }

  if (
    current[slideKey]?.activityId === nextOverlay.activityId
    && current[slideKey]?.src === nextOverlay.src
    && current[slideKey]?.notice === nextOverlay.notice
    && getSelectedOptionsComparisonKey(current[slideKey]?.selectedOptions) === getSelectedOptionsComparisonKey(nextOverlay.selectedOptions)
  ) {
    return current
  }

  return {
    ...current,
    [slideKey]: nextOverlay,
  }
}

export function resolveInboundPayloadType(rawPayload: unknown): string {
  if (isPlainObject(rawPayload)) {
    const payloadType = typeof rawPayload.type === 'string' ? rawPayload.type : null
    const payloadAction = typeof rawPayload.action === 'string' ? rawPayload.action : null

    if (payloadType && payloadAction) {
      return `${payloadType}:${payloadAction}`
    }

    if (payloadType) {
      return payloadType
    }

    if (payloadAction) {
      return payloadAction
    }

    return 'object'
  }

  if (Array.isArray(rawPayload)) {
    return 'array'
  }

  if (rawPayload === null) {
    return 'null'
  }

  return typeof rawPayload
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

function extractIndicesFromRevealStateObject(value: unknown): { h: number; v: number; f: number } | null {
  const normalized = normalizeIndices(value)
  if (normalized) {
    return normalized
  }

  if (!isPlainObject(value)) {
    return null
  }

  const indexh = value.indexh
  const indexv = value.indexv
  const indexf = value.indexf

  if (typeof indexh !== 'number' || !Number.isFinite(indexh)) {
    return null
  }

  if (typeof indexv !== 'number' || !Number.isFinite(indexv)) {
    return null
  }

  return {
    h: indexh,
    v: indexv,
    f: typeof indexf === 'number' && Number.isFinite(indexf) ? indexf : 0,
  }
}

function buildBoundaryCommandEnvelope(
  message: RevealSyncEnvelope,
  name: string,
  payload?: Record<string, unknown>,
): RevealCommandMessage {
  return {
    type: 'reveal-sync',
    version: typeof message.version === 'string' ? message.version : REVEAL_SYNC_PROTOCOL_VERSION,
    action: 'command',
    deckId: typeof message.deckId === 'string' ? message.deckId : null,
    role: 'instructor',
    source: 'reveal-iframe-sync',
    ts: Date.now(),
    payload: payload ? { name, payload } : { name },
  }
}

function buildInstructorStatePayload(
  payload: Record<string, unknown>,
  fallbackIndices: { h: number; v: number; f: number } | null = null,
): Record<string, unknown> | null {
  const revealState = isPlainObject(payload.revealState) ? payload.revealState : null
  const navigation = isPlainObject(payload.navigation) ? payload.navigation : null
  const indices = extractIndicesFromRevealStateObject(payload.indices)
    ?? extractIndicesFromRevealStateObject(navigation?.current)
    ?? extractIndicesFromRevealStateObject(revealState)
    ?? extractIndicesFromRevealStateObject(payload)
    ?? fallbackIndices

  if (!indices) {
    return null
  }

  const pausedFromPayload = typeof payload.paused === 'boolean' ? payload.paused : null
  const pausedFromRevealState =
    typeof (revealState as { paused?: unknown } | null)?.paused === 'boolean'
      ? ((revealState as { paused?: unknown }).paused as boolean)
      : null
  const pausedState = pausedFromPayload ?? pausedFromRevealState

  return {
    ...(revealState ?? {}),
    indexh: indices.h,
    indexv: indices.v,
    indexf: indices.f,
    ...(typeof pausedState === 'boolean' ? { paused: pausedState } : {}),
  }
}

function buildClearBoundaryCommand(message: RevealSyncEnvelope): RevealCommandMessage {
  return buildBoundaryCommandEnvelope(message, 'clearBoundary')
}

function buildOutboundSetStudentBoundaryCommand(
  indices: { h: number; v: number; f: number },
): Record<string, unknown> {
  return buildRevealCommandMessage('setStudentBoundary', {
    indices: {
      h: indices.h,
      v: 0,
      f: CANONICAL_BOUNDARY_FRAGMENT_INDEX,
    },
  })
}

function buildSetStudentBoundaryCommand(
  message: RevealSyncEnvelope,
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

  const rawSetBoundary = normalizeIndices(payload.studentBoundary)
  const setBoundary = rawSetBoundary ? toSlideEndBoundary(rawSetBoundary) : null

  if (!setBoundary) {
    if (message.action === 'studentBoundaryChanged') {
      return buildClearBoundaryCommand(message)
    }

    return null
  }

  const instructorIndices = normalizeIndices(payload.indices) ?? fallbackInstructorIndices
  const effectiveBoundary = resolveEffectiveBoundary(instructorIndices, setBoundary)
  if (!effectiveBoundary) {
    return null
  }

  return buildBoundaryCommandEnvelope(message, 'setStudentBoundary', {
    indices: effectiveBoundary,
  })
}

export function toRevealBoundaryCommandMessage(
  rawPayload: unknown,
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
    return buildSetStudentBoundaryCommand(message, fallbackInstructorIndices)
  }

  if (message.action === 'studentBoundaryChanged') {
    if (!isPlainObject(message.payload)) {
      return null
    }

    return buildSetStudentBoundaryCommand(message, fallbackInstructorIndices)
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
  fallbackInstructorIndices: { h: number; v: number; f: number } | null,
): {
  instructorIndices: { h: number; v: number; f: number } | null
  setBoundary: { h: number; v: number; f: number } | null
  effectiveBoundary: { h: number; v: number; f: number } | null
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

  const legacyMessage = rawPayload as { type?: unknown; payload?: unknown }
  if (legacyMessage.type === 'slidechanged') {
    const indices = extractIndicesFromRevealStateMessage(rawPayload)
    if (!indices) {
      return null
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

  const statePayload = message.payload as Record<string, unknown>

  const mergedState = buildInstructorStatePayload(statePayload)
  if (!mergedState) {
    return null
  }

  return {
    type: 'reveal-sync',
    version: typeof message.version === 'string' ? message.version : REVEAL_SYNC_PROTOCOL_VERSION,
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
    version: REVEAL_SYNC_PROTOCOL_VERSION,
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

export function buildStudentRoleCommandMessage(
  role: 'student' | 'standalone' = 'student',
): Record<string, unknown> {
  return buildRevealCommandMessage('setRole', {
    role,
  })
}

export function buildStandaloneBootstrapCommandMessages(): Record<string, unknown>[] {
  return [
    buildStudentRoleCommandMessage('standalone'),
    buildRevealCommandMessage('clearBoundary', {}),
  ]
}

export function shouldQueuePayloadUntilIframeReady(rawPayload: unknown): boolean {
  if (!isRevealSyncMessage(rawPayload) || rawPayload.action !== 'command' || !isPlainObject(rawPayload.payload)) {
    return false
  }

  return rawPayload.payload.name !== 'setRole'
}

function resolvePendingIframePayloadCoalesceKey(rawPayload: unknown): string | null {
  if (!isRevealSyncMessage(rawPayload) || rawPayload.action !== 'command' || !isPlainObject(rawPayload.payload)) {
    return null
  }

  const name = rawPayload.payload.name
  if (name === 'setState') {
    return 'setState'
  }

  if (name === 'setStudentBoundary' || name === 'clearBoundary') {
    return 'boundary'
  }

  return null
}

export function enqueuePendingIframePayload(
  queue: unknown[],
  payload: unknown,
  maxQueueLength = MAX_PENDING_IFRAME_PAYLOADS,
): {
  queue: unknown[]
  coalesced: boolean
  droppedCount: number
} {
  const coalesceKey = resolvePendingIframePayloadCoalesceKey(payload)
  let coalesced = false
  let nextQueue = queue

  if (coalesceKey != null) {
    const existingIndex = nextQueue.findIndex((entry) => resolvePendingIframePayloadCoalesceKey(entry) === coalesceKey)
    if (existingIndex >= 0) {
      nextQueue = nextQueue.filter((_, index) => index !== existingIndex)
      coalesced = true
    }
  }

  nextQueue = [...nextQueue, payload]

  const safeMaxQueueLength = Number.isFinite(maxQueueLength) && maxQueueLength > 0
    ? Math.floor(maxQueueLength)
    : MAX_PENDING_IFRAME_PAYLOADS
  const droppedCount = Math.max(0, nextQueue.length - safeMaxQueueLength)
  if (droppedCount > 0) {
    nextQueue = nextQueue.slice(-safeMaxQueueLength)
  }

  return {
    queue: nextQueue,
    coalesced,
    droppedCount,
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
  protocol?: string | null
  host?: string | null
}): string | null {
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId.trim() : ''
  const presentationUrl = typeof params.presentationUrl === 'string' ? params.presentationUrl.trim() : ''
  const studentId = typeof params.studentId === 'string' ? params.studentId.trim() : ''
  const protocol = typeof params.protocol === 'string' ? params.protocol : ''
  const host = typeof params.host === 'string' ? params.host.trim() : ''

  if (!sessionId || !presentationUrl || !studentId || !host) {
    return null
  }

  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:'
  const queryParams = new URLSearchParams({
    sessionId,
    studentId,
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

export function resolveConfiguredPresentationOrigin(params: {
  presentationUrl?: string | null
  presentationUrlError?: string | null
}): string | null {
  const presentationUrl = typeof params.presentationUrl === 'string' ? params.presentationUrl.trim() : ''
  if (!presentationUrl || params.presentationUrlError != null || !validatePresentationUrl(presentationUrl)) {
    return null
  }

  try {
    return new URL(presentationUrl).origin
  } catch {
    return null
  }
}

function isSyncToInstructorCommand(rawPayload: unknown): boolean {
  if (!isPlainObject(rawPayload)) {
    return false
  }

  const message = rawPayload as RevealSyncEnvelope
  if (message.type !== 'reveal-sync' || message.action !== 'command' || !isPlainObject(message.payload)) {
    return false
  }

  return (message.payload as { name?: unknown }).name === 'syncToInstructor'
}

function extractRevealCommandName(rawPayload: unknown): string | null {
  if (!isPlainObject(rawPayload)) {
    return null
  }

  const message = rawPayload as RevealSyncEnvelope
  if (message.type !== 'reveal-sync' || message.action !== 'command' || !isPlainObject(message.payload)) {
    return null
  }

  const name = (message.payload as { name?: unknown }).name
  return typeof name === 'string' ? name : null
}

export function resolveSemanticInstructorCommandName(rawPayload: unknown): string | null {
  const inboundCommandName = extractRevealCommandName(rawPayload)
  if (inboundCommandName != null) {
    return inboundCommandName
  }

  if (!isPlainObject(rawPayload)) {
    return null
  }

  const legacyMessage = rawPayload as { type?: unknown }
  if (legacyMessage.type === 'slidechanged') {
    return 'setState'
  }

  const message = rawPayload as RevealSyncEnvelope
  return isRevealSyncMessage(message) && message.action === 'state' ? 'setState' : null
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

export function shouldEnableBacktrackOptOutOnLocalMove(params: {
  studentHasBacktrackOptOut: boolean
  previousLocalPosition: { h: number; v: number; f: number } | null
  nextLocalPosition: { h: number; v: number; f: number } | null
  maxPosition: { h: number; v: number; f: number } | null
  instructorPosition: { h: number; v: number; f: number } | null
}): boolean {
  const {
    studentHasBacktrackOptOut,
    previousLocalPosition,
    nextLocalPosition,
    maxPosition,
    instructorPosition,
  } = params

  if (studentHasBacktrackOptOut || !previousLocalPosition || !nextLocalPosition || !maxPosition) {
    return false
  }

  // Only mark local backtrack when the student moved backward away from the effective instructor position.
  if (compareIndices(nextLocalPosition, previousLocalPosition) >= 0) {
    return false
  }

  if (compareIndices(nextLocalPosition, maxPosition) >= 0) {
    return false
  }

  if (instructorPosition && compareIndices(nextLocalPosition, instructorPosition) >= 0) {
    return false
  }

  return true
}

export function isExpectedInstructorDrivenLocalMove(
  expectedInstructorTarget: { h: number; v: number; f: number } | null,
  localPosition: { h: number; v: number; f: number } | null,
): boolean {
  if (!expectedInstructorTarget || !localPosition) {
    return false
  }

  return compareIndices(expectedInstructorTarget, localPosition) === 0
}

export function shouldSuppressInstructorVerticalSetStateSync(
  inboundCommandName: string | null,
  studentPosition: { h: number; v: number; f: number } | null,
  instructorPosition: { h: number; v: number; f: number } | null,
): boolean {
  if (inboundCommandName === 'up' || inboundCommandName === 'down') {
    return true
  }

  if (inboundCommandName !== 'setState' || !studentPosition || !instructorPosition) {
    return false
  }

  return instructorPosition.h === studentPosition.h && instructorPosition.v !== studentPosition.v
}

export function shouldSuppressInstructorRevealCommandForwarding(params: {
  semanticInstructorCommandName: string | null
  studentHasBacktrackOptOut: boolean
  localStudentPosition: { h: number; v: number; f: number } | null
  incomingInstructorIndices: { h: number; v: number; f: number } | null
}): {
  suppressForwardSync: boolean
  suppressForwardSyncByBacktrack: boolean
  suppressForwardSyncByVerticalIndependence: boolean
} {
  const suppressForwardSyncByBacktrack = shouldSuppressForwardInstructorSync(
    params.studentHasBacktrackOptOut,
    params.localStudentPosition,
    params.incomingInstructorIndices,
  )
  const suppressForwardSyncByVerticalIndependence = shouldSuppressInstructorVerticalSetStateSync(
    params.semanticInstructorCommandName,
    params.localStudentPosition,
    params.incomingInstructorIndices,
  )

  return {
    suppressForwardSync: suppressForwardSyncByBacktrack || suppressForwardSyncByVerticalIndependence,
    suppressForwardSyncByBacktrack,
    suppressForwardSyncByVerticalIndependence,
  }
}

export function shouldForceFollowInstructorSetState(params: {
  semanticInstructorCommandName: string | null
  studentHasBacktrackOptOut: boolean
  localStudentPosition: { h: number; v: number; f: number } | null
  previousInstructorPosition: { h: number; v: number; f: number } | null
  instructorPosition: { h: number; v: number; f: number } | null
  embeddedActivities: SyncDeckEmbeddedActivitiesMap
}): boolean {
  const {
    semanticInstructorCommandName,
    studentHasBacktrackOptOut,
    localStudentPosition,
    previousInstructorPosition,
    instructorPosition,
    embeddedActivities,
  } = params

  if (semanticInstructorCommandName !== 'setState' && semanticInstructorCommandName !== 'syncToInstructor') {
    return false
  }

  if (!instructorPosition) {
    return false
  }

  const isVerticalInstructorMoveWithinSameStack =
    previousInstructorPosition != null
    && previousInstructorPosition.h === instructorPosition.h
    && previousInstructorPosition.v !== instructorPosition.v

  if (isVerticalInstructorMoveWithinSameStack) {
    return false
  }

  if (shouldSuppressInstructorVerticalSetStateSync(semanticInstructorCommandName, localStudentPosition, instructorPosition)) {
    return false
  }

  if (!studentHasBacktrackOptOut) {
    return true
  }

  if (semanticInstructorCommandName === 'syncToInstructor') {
    return true
  }

  // Rejoin authoritative setState when it lands on an anchored embedded activity.
  if (resolveStudentActiveEmbeddedInstanceKey(embeddedActivities, instructorPosition) != null) {
    return true
  }

  if (!localStudentPosition) {
    return true
  }

  // Allow follow for non-forward corrections while opted out.
  return compareIndices(instructorPosition, localStudentPosition) <= 0
}

function normalizeEmbeddedActivityRecord(value: unknown): SyncDeckEmbeddedActivityRecord | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const candidate = value as Record<string, unknown>
  const childSessionId = typeof candidate.childSessionId === 'string' ? candidate.childSessionId.trim() : ''
  const activityId = typeof candidate.activityId === 'string' ? candidate.activityId.trim() : ''
  if (!childSessionId || !activityId) {
    return null
  }

  return {
    childSessionId,
    activityId,
    startedAt: typeof candidate.startedAt === 'number' && Number.isFinite(candidate.startedAt) ? candidate.startedAt : Date.now(),
    owner: typeof candidate.owner === 'string' ? candidate.owner : 'syncdeck-instructor',
  }
}

export function normalizeSyncDeckEmbeddedActivities(value: unknown): SyncDeckEmbeddedActivitiesMap {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const normalized: SyncDeckEmbeddedActivitiesMap = {}
  for (const [instanceKey, record] of Object.entries(value as Record<string, unknown>)) {
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
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  const candidate = payload as Record<string, unknown>
  const payloadType = candidate.type
  if (payloadType !== 'embedded-activity-start' && payloadType !== 'embedded-activity-end') {
    return null
  }

  const instanceKey = typeof candidate.instanceKey === 'string' ? candidate.instanceKey.trim() : ''
  const childSessionId = typeof candidate.childSessionId === 'string' ? candidate.childSessionId.trim() : ''
  if (!instanceKey || !childSessionId) {
    return null
  }

  const activityId = typeof candidate.activityId === 'string' ? candidate.activityId.trim() : undefined
  const entryParticipantToken = typeof candidate.entryParticipantToken === 'string' ? candidate.entryParticipantToken.trim() : undefined

  return {
    type: payloadType,
    instanceKey,
    activityId,
    childSessionId,
    ...(entryParticipantToken ? { entryParticipantToken } : {}),
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

export function resolveStudentActiveEmbeddedInstanceKey(
  embeddedActivities: SyncDeckEmbeddedActivitiesMap,
  studentIndices: { h: number; v: number; f: number } | null,
): string | null {
  if (!studentIndices) {
    return null
  }

  let selected: string | null = null
  for (const [instanceKey, record] of Object.entries(embeddedActivities)) {
    const position = parseSyncDeckEmbeddedInstancePosition(instanceKey)
    if (!position) {
      continue
    }
    if (position.h !== studentIndices.h || position.v !== studentIndices.v) {
      continue
    }

    const selectedRecord = selected ? embeddedActivities[selected] : null
    if (!selectedRecord || record.startedAt > selectedRecord.startedAt) {
      selected = instanceKey
    }
  }

  return selected
}

export function resolveStudentActiveEmbeddedInstanceKeyWithFallback(
  embeddedActivities: SyncDeckEmbeddedActivitiesMap,
  studentIndices: { h: number; v: number; f: number } | null,
  fallbackIndices: { h: number; v: number; f: number } | null,
  fallbackOnMismatch = true,
): string | null {
  const primary = resolveStudentActiveEmbeddedInstanceKey(embeddedActivities, studentIndices)
  if (primary) {
    return primary
  }

  if (studentIndices && !fallbackOnMismatch) {
    return null
  }

  if (!fallbackIndices) {
    return null
  }

  return resolveStudentActiveEmbeddedInstanceKey(embeddedActivities, fallbackIndices)
}

export function resolveStudentOverlayEmbeddedInstanceKey(
  embeddedActivities: SyncDeckEmbeddedActivitiesMap,
  studentIndices: { h: number; v: number; f: number } | null,
  instructorIndices: { h: number; v: number; f: number } | null,
  options: {
    preferInstructor: boolean
    fallbackOnMismatch: boolean
  },
): string | null {
  const primaryIndices = options.preferInstructor ? instructorIndices : studentIndices
  const secondaryIndices = options.preferInstructor ? studentIndices : instructorIndices

  const primary = resolveStudentActiveEmbeddedInstanceKey(embeddedActivities, primaryIndices)
  if (primary) {
    return primary
  }

  const shouldReuseSameStackFallback =
    primaryIndices != null
    && secondaryIndices != null
    && primaryIndices.h === secondaryIndices.h

  if (shouldReuseSameStackFallback) {
    const sameStackFallback = resolveStudentActiveEmbeddedInstanceKey(embeddedActivities, secondaryIndices)
    if (sameStackFallback) {
      return sameStackFallback
    }
  }

  return resolveStudentActiveEmbeddedInstanceKeyWithFallback(
    embeddedActivities,
    primaryIndices,
    secondaryIndices,
    options.fallbackOnMismatch,
  )
}

export function resolveStudentOverlayNavigationBaseIndices(params: {
  studentIndices: { h: number; v: number; f: number } | null
  studentAnchoredInstanceKey: string | null
  activeEmbeddedInstanceKey: string | null
}): { h: number; v: number; f: number } | null {
  if (
    params.studentIndices
    && (
      params.studentAnchoredInstanceKey != null
      || params.activeEmbeddedInstanceKey == null
    )
  ) {
    return params.studentIndices
  }

  if (!params.activeEmbeddedInstanceKey) {
    return params.studentIndices
  }

  const activePosition = parseSyncDeckEmbeddedInstancePosition(params.activeEmbeddedInstanceKey)
  if (!activePosition) {
    return params.studentIndices
  }

  return {
    h: activePosition.h,
    v: activePosition.v,
    f: 0,
  }
}

export function shouldRecoverEmbeddedEntryParticipantToken(params: {
  sessionId: string | null | undefined
  childSessionId: string | null | undefined
  studentId: string | null | undefined
  activityId: string | null | undefined
  sessionStorage: Pick<Storage, 'getItem'> | null | undefined
  localStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null | undefined
}): boolean {
  if (!params.sessionId || !params.childSessionId || !params.studentId || !params.activityId) {
    return false
  }

  if (params.localStorage) {
    if (readStoredSessionParticipantIdentity(params.localStorage, params.childSessionId)) {
      return false
    }
  }

  if (!params.sessionStorage) {
    return true
  }

  return !hasValidEntryParticipantHandoffStorageValue(
    params.sessionStorage,
    buildSessionEntryParticipantStorageKey(params.activityId, params.childSessionId),
  )
}

export function persistRecoveredEmbeddedEntryParticipantToken(params: {
  sessionStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  activityId: string
  childSessionId: string
  entryParticipantToken: string
}): boolean {
  const storageKey = buildSessionEntryParticipantStorageKey(params.activityId, params.childSessionId)
  persistEntryParticipantToken(
    params.sessionStorage,
    storageKey,
    params.entryParticipantToken,
  )
  return hasValidEntryParticipantHandoffStorageValue(params.sessionStorage, storageKey)
}

export function extractNavigationCapabilitiesFromStateMessage(rawPayload: unknown): NavigationCapabilities | null {
  if (rawPayload == null || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return null
  }

  const message = rawPayload as RevealSyncEnvelope
  if (message.type !== 'reveal-sync') {
    return null
  }

  if (message.action !== 'state' && message.action !== 'ready') {
    return null
  }

  const payload = message.payload != null && typeof message.payload === 'object' && !Array.isArray(message.payload)
    ? message.payload as Record<string, unknown>
    : null
  if (!payload) {
    return null
  }

  const navigation = payload.navigation != null && typeof payload.navigation === 'object' && !Array.isArray(payload.navigation)
    ? payload.navigation as Record<string, unknown>
    : null
  const capabilities = payload.capabilities != null && typeof payload.capabilities === 'object' && !Array.isArray(payload.capabilities)
    ? payload.capabilities as Record<string, unknown>
    : null

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

export function computeStudentEmbeddedSyncState(
  studentIndices: { h: number; v: number } | null,
  instructorIndices: { h: number; v: number } | null,
): SyncDeckStudentSyncState {
  if (!instructorIndices || !studentIndices) {
    return 'solo'
  }

  if (studentIndices.h === instructorIndices.h) {
    return studentIndices.v === instructorIndices.v ? 'synchronized' : 'vertical'
  }

  return studentIndices.h < instructorIndices.h ? 'behind' : 'ahead'
}

export function shouldShowInstructorPendingActivityNotice(params: {
  hasActiveEmbeddedActivity: boolean
  hasActiveSoloOverlay: boolean
  instructorAnchoredInstanceKey: string | null
  hasPendingSynchronizedActivityRequest: boolean
  studentIndices: { h: number; v: number; f: number } | null
  instructorIndices: { h: number; v: number; f: number } | null
  isBacktrackOptOut: boolean
}): boolean {
  if (params.hasActiveEmbeddedActivity || params.hasActiveSoloOverlay || params.isBacktrackOptOut) {
    return false
  }

  if (!params.studentIndices || !params.instructorIndices) {
    return false
  }

  return (
    (params.instructorAnchoredInstanceKey != null || params.hasPendingSynchronizedActivityRequest)
    && params.studentIndices.h === params.instructorIndices.h
  )
}

interface PendingSynchronizedActivityRequest {
  observedAt: number
  slideKey: string
}

export function buildSyncDeckSlideKey(indices: { h: number; v: number; f: number } | null): string | null {
  if (!indices) {
    return null
  }

  return `${indices.h}:${indices.v}`
}

export function hasPendingSynchronizedActivityRequestForCurrentSlide(params: {
  pendingRequest: PendingSynchronizedActivityRequest | null
  studentIndices: { h: number; v: number; f: number } | null
  now: number
  maxAgeMs?: number
}): boolean {
  const currentSlideKey = buildSyncDeckSlideKey(params.studentIndices)
  if (!currentSlideKey || !params.pendingRequest) {
    return false
  }

  const maxAgeMs = typeof params.maxAgeMs === 'number' && params.maxAgeMs > 0 ? params.maxAgeMs : 8000
  if (params.now - params.pendingRequest.observedAt > maxAgeMs) {
    return false
  }

  return params.pendingRequest.slideKey === currentSlideKey
}

export function buildStudentLocalNavigationPayloads(params: {
  optimisticIndices: { h: number; v: number; f: number }
  maxPosition: { h: number; v: number; f: number } | null
}): Record<string, unknown>[] {
  const payloads: Record<string, unknown>[] = [
    buildRevealCommandMessage('setState', {
      state: {
        indexh: params.optimisticIndices.h,
        indexv: params.optimisticIndices.v,
        indexf: params.optimisticIndices.f,
      },
    }),
  ]

  if (params.maxPosition) {
    payloads.push(buildOutboundSetStudentBoundaryCommand(params.maxPosition))
  }

  return payloads
}

export function buildStudentEmbeddedSyncContextMessage(
  syncState: SyncDeckStudentSyncState,
  studentIndices: { h: number; v: number; f: number } | null,
  instructorIndices: { h: number; v: number; f: number } | null,
): Record<string, unknown> {
  return {
    type: 'activebits-embedded',
    action: 'syncContext',
    payload: {
      syncState,
      studentIndices: studentIndices
        ? { h: studentIndices.h, v: studentIndices.v, f: studentIndices.f }
        : null,
      instructorIndices: instructorIndices
        ? { h: instructorIndices.h, v: instructorIndices.v, f: instructorIndices.f }
        : null,
      role: 'student',
    },
  }
}

export function shouldPreferInstructorOverlaySelection(params: {
  syncState: SyncDeckStudentSyncState
  isBacktrackOptOut: boolean
  suppressFallbackToInstructor: boolean
}): boolean {
  if (params.syncState === 'vertical') {
    return false
  }

  return !params.isBacktrackOptOut && !params.suppressFallbackToInstructor
}

const SyncDeckStudent: FC = () => {
  const { sessionId } = useParams<{ sessionId?: string }>()
  const location = useLocation()
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [presentationUrl, setPresentationUrl] = useState<string | null>(null)
  const [isStandaloneSession, setIsStandaloneSession] = useState(false)
  const [isWaitingForConfiguration, setIsWaitingForConfiguration] = useState(false)
  const [statusMessage, setStatusMessage] = useState('Waiting for instructor sync…')
  const [connectionState, setConnectionState] = useState<'connected' | 'disconnected'>('disconnected')
  const [isStoryboardOpen, setIsStoryboardOpen] = useState(false)
  const [isBacktrackOptOut, setIsBacktrackOptOut] = useState(false)
  const [registeredStudentName, setRegisteredStudentName] = useState('')
  const [registeredStudentId, setRegisteredStudentId] = useState('')
  const [joinError, setJoinError] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const {
    overlayNavClickShieldRef,
    activateOverlayNavClickShield,
    beginOverlayNavPointerDownHandling,
    consumeOverlayNavClick,
    resetOverlayNavPointerDownHandling,
  } = useEmbeddedOverlayNavigationInteraction()
  const pendingPayloadQueueRef = useRef<unknown[]>([])
  const localStudentIndicesRef = useRef<{ h: number; v: number; f: number } | null>(null)
  const lastInstructorIndicesRef = useRef<{ h: number; v: number; f: number } | null>(null)
  const lastEffectiveMaxPositionRef = useRef<{ h: number; v: number; f: number } | null>(null)
  const latestInstructorPayloadRef = useRef<unknown>(null)
  const activeDrawingToolModeRef = useRef<SyncDeckDrawingToolMode>('none')
  const pendingDrawingToolModeRef = useRef<SyncDeckDrawingToolMode | null>(null)
  const hasSeenIframeReadySignalRef = useRef(false)
  const lastObservedIframeOriginRef = useRef<string | null>(null)
  const suppressFallbackToInstructorRef = useRef(false)
  const studentBacktrackOptOutRef = useRef(false)
  const syncDebugEnabledRef = useRef(isSyncDeckDebugEnabled())
  const expectedInstructorLocalTargetRef = useRef<{ h: number; v: number; f: number } | null>(null)
  const recoveredEmbeddedEntryKeysRef = useRef<Set<string>>(new Set())
  const attachSessionEndedHandler = useSessionEndedHandler()
  const [embeddedActivities, setEmbeddedActivities] = useState<SyncDeckEmbeddedActivitiesMap>({})
  const [pendingSynchronizedActivityRequest, setPendingSynchronizedActivityRequest] =
    useState<PendingSynchronizedActivityRequest | null>(null)
  const [studentIndicesState, setStudentIndicesState] = useState<{ h: number; v: number; f: number } | null>(null)
  const [navigationCapabilities, setNavigationCapabilities] = useState<NavigationCapabilities | null>(null)
  const [navigationCapabilityIndices, setNavigationCapabilityIndices] = useState<{ h: number; v: number; f: number } | null>(null)
  const [soloOverlays, setSoloOverlays] = useState<SyncDeckSoloOverlaysMap>({})
  const [presentationTitle, setPresentationTitle] = useState<string | null>(null)
  const embeddedActivityIframeRef = useRef<HTMLIFrameElement | null>(null)
  const restoreDocumentTitleRef = useRef<string | null>(null)

  useEffect(() => {
    syncDebugEnabledRef.current = isSyncDeckDebugEnabled()
  }, [location.search])

  const traceSync = useCallback((event: string, details: Record<string, unknown>): void => {
    if (!syncDebugEnabledRef.current) {
      return
    }

    console.info('[SyncDeck][Student]', {
      event,
      ...details,
    })
  }, [])

  const sendSyncContextToEmbeddedIframe = useCallback((): void => {
    const target = embeddedActivityIframeRef.current?.contentWindow
    if (!target) {
      return
    }

    const syncState = computeStudentEmbeddedSyncState(
      localStudentIndicesRef.current,
      lastInstructorIndicesRef.current,
    )
    const msg = buildStudentEmbeddedSyncContextMessage(
      syncState,
      localStudentIndicesRef.current,
      lastInstructorIndicesRef.current,
    )

    try {
      target.postMessage(msg, window.location.origin)
    } catch {
      // ignore postMessage errors
    }
  }, [])

  useEffect(() => {
    if (!sessionId || typeof window === 'undefined') {
      return
    }

    let isCancelled = false

    void (async () => {
      const resolvedIdentity = await resolveInitialEntryParticipantIdentity({
        activityName: 'syncdeck',
        sessionId,
        isSoloSession: false,
        localStorage: window.localStorage,
        sessionStorage: window.sessionStorage,
      })

      if (isCancelled) {
        return
      }

      const resolvedStudentName = resolvedIdentity.studentName.trim()
      const resolvedStudentId = (resolvedIdentity.studentId ?? '').trim()

      setRegisteredStudentName(resolvedStudentName)
      setRegisteredStudentId(resolvedStudentId)
      setJoinError(
        resolvedStudentName.length === 0 || resolvedStudentId.length === 0
          ? 'This presentation now requires entry through the waiting room.'
          : null,
      )

      if (resolvedStudentName.length > 0 && resolvedStudentId.length > 0) {
        persistSessionParticipantIdentity(
          window.localStorage,
          sessionId,
          resolvedStudentName,
          resolvedStudentId,
        )

        window.sessionStorage.setItem(`syncdeck_student_name_${sessionId}`, resolvedStudentName)
        window.sessionStorage.setItem(`syncdeck_student_id_${sessionId}`, resolvedStudentId)
      }
    })()

    return () => {
      isCancelled = true
    }
  }, [sessionId])

  const presentationUrlError = useMemo(
    () => (presentationUrl
      ? getStudentPresentationCompatibilityError({
        value: presentationUrl,
        hostProtocol: typeof window !== 'undefined' ? window.location.protocol : null,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      })
      : null),
    [presentationUrl],
  )
  const presentationOrigin = useMemo(
    () => resolveConfiguredPresentationOrigin({
      presentationUrl,
      presentationUrlError,
    }),
    [presentationUrl, presentationUrlError],
  )

  useEffect(() => {
    setPresentationTitle(null)
  }, [presentationUrl])

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    if (restoreDocumentTitleRef.current == null) {
      restoreDocumentTitleRef.current = document.title
    }

    document.title = buildSyncDeckDocumentTitle(presentationTitle)
  }, [presentationTitle])

  useEffect(
    () => () => {
      if (typeof document !== 'undefined' && restoreDocumentTitleRef.current != null) {
        document.title = restoreDocumentTitleRef.current
      }
    },
    [],
  )

  const getIframeRuntimeOrigin = useCallback((): string | null => {
    try {
      const runtimeOrigin = iframeRef.current?.contentWindow?.location.origin
      return typeof runtimeOrigin === 'string' ? runtimeOrigin : null
    } catch {
      return null
    }
  }, [])

  const queuePendingIframePayload = useCallback((payload: unknown, reason: string) => {
    const result = enqueuePendingIframePayload(pendingPayloadQueueRef.current, payload)
    pendingPayloadQueueRef.current = result.queue

    if (result.coalesced) {
      traceSync('coalesce_pending_iframe_payload', {
        reason,
        queueDepth: result.queue.length,
      })
    }

    if (result.droppedCount > 0) {
      traceSync('drop_pending_iframe_payloads_due_to_cap', {
        reason,
        droppedCount: result.droppedCount,
        queueDepth: result.queue.length,
      })
    }

    return result.queue.length
  }, [traceSync])

  const sendPayloadToIframe = useCallback((payload: unknown) => {
    if (!presentationOrigin) {
      const queueDepth = queuePendingIframePayload(payload, 'missing-presentation-origin')
      traceSync('queue_payload_missing_presentation_origin', {
        queueDepth,
      })
      return
    }

    const target = iframeRef.current?.contentWindow
    if (!target) {
      const queueDepth = queuePendingIframePayload(payload, 'missing-iframe-window')
      traceSync('queue_payload_missing_iframe_window', {
        queueDepth,
      })
      return
    }

    const targetOrigin = resolveIframePostMessageTargetOrigin({
      observedOrigin: lastObservedIframeOriginRef.current,
      configuredOrigin: presentationOrigin,
      iframeRuntimeOrigin: getIframeRuntimeOrigin(),
    })
    if (!targetOrigin) {
      const queueDepth = queuePendingIframePayload(payload, 'missing-target-origin')
      traceSync('queue_payload_missing_target_origin', {
        queueDepth,
      })
      return
    }

    if (!hasSeenIframeReadySignalRef.current && shouldQueuePayloadUntilIframeReady(payload)) {
      const queueDepth = queuePendingIframePayload(payload, 'waiting-for-iframe-ready')
      traceSync('queue_payload_waiting_for_iframe_ready', {
        queueDepth,
      })
      return
    }

    try {
      target.postMessage(payload, targetOrigin)
      traceSync('post_message_to_iframe', {
        targetOrigin,
      })
    } catch {
      const queueDepth = queuePendingIframePayload(payload, 'post-message-error')
      traceSync('queue_payload_post_message_error', {
        queueDepth,
      })
    }
  }, [getIframeRuntimeOrigin, presentationOrigin, queuePendingIframePayload, traceSync])

  const setBacktrackOptOut = useCallback((value: boolean) => {
    studentBacktrackOptOutRef.current = value
    setIsBacktrackOptOut(value)
  }, [])

  const reconcileEmbeddedActivitiesSnapshot = useCallback(async (): Promise<void> => {
    if (!sessionId) {
      return
    }

    try {
      const response = await fetch(`/api/session/${sessionId}`)
      if (!response.ok) {
        return
      }

      const payload = (await response.json()) as SessionResponsePayload
      const snapshotEmbeddedActivities = normalizeSyncDeckEmbeddedActivities(
        payload.session?.data?.embeddedActivities,
      )
      setEmbeddedActivities(snapshotEmbeddedActivities)
      console.info('[SyncDeck][StudentEmbeddedActivitiesReconcile]', {
        slideKey: `${studentIndicesState?.h ?? 'na'}:${studentIndicesState?.v ?? 'na'}`,
        embeddedActivityKeys: Object.keys(snapshotEmbeddedActivities),
      })
    } catch {
      // Ignore snapshot refresh failures; realtime WS events remain primary source.
    }
  }, [sessionId, studentIndicesState?.h, studentIndicesState?.v])

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

        const embeddedLifecyclePayload = parseEmbeddedLifecyclePayload(parsed.payload)
        if (embeddedLifecyclePayload) {
          if (
            embeddedLifecyclePayload.type === 'embedded-activity-start' &&
            embeddedLifecyclePayload.activityId &&
            embeddedLifecyclePayload.entryParticipantToken &&
            typeof window !== 'undefined' &&
            window.sessionStorage != null
          ) {
            persistEntryParticipantToken(
              window.sessionStorage,
              buildEntryParticipantStorageKey(
                embeddedLifecyclePayload.activityId,
                'session',
                embeddedLifecyclePayload.childSessionId,
              ),
              embeddedLifecyclePayload.entryParticipantToken,
            )
          }
          setEmbeddedActivities((current) =>
            applySyncDeckEmbeddedLifecyclePayload(current, embeddedLifecyclePayload),
          )
          return
        }

        if (isRevealSyncMessage(parsed.payload)) {
          const compatibility = assessRevealSyncProtocolCompatibility(parsed.payload.version)
          if (!compatibility.compatible) {
            traceSync('warn_inbound_server_payload_incompatible_protocol', {
              reason: compatibility.reason,
              expectedVersion: compatibility.expectedVersion,
              receivedVersion: compatibility.receivedVersion,
              action: parsed.payload.action,
            })
          }
        }

        const metadataTitle = extractRevealMetadataTitle(parsed.payload)
        if (metadataTitle != null) {
          setPresentationTitle(metadataTitle)
        }

        const drawingToolMode = parseDrawingToolModePayload(parsed.payload)
        if (drawingToolMode) {
          applyDrawingToolModeToIframe(drawingToolMode)
          traceSync('apply_drawing_tool_mode', {
            mode: drawingToolMode,
          })
          return
        }

        const instructorIndices = extractIndicesFromRevealStateMessage(parsed.payload)
        if (instructorIndices) {
          latestInstructorPayloadRef.current = parsed.payload
          const previousInstructorIndices = lastInstructorIndicesRef.current
          lastInstructorIndicesRef.current = instructorIndices

          const inboundCommandName = extractRevealCommandName(parsed.payload)
          const semanticInstructorCommandName = resolveSemanticInstructorCommandName(parsed.payload)
          const shouldFollowInstructorSetState = shouldForceFollowInstructorSetState({
            semanticInstructorCommandName,
            studentHasBacktrackOptOut: studentBacktrackOptOutRef.current,
            localStudentPosition: localStudentIndicesRef.current,
            previousInstructorPosition: previousInstructorIndices,
            instructorPosition: instructorIndices,
            embeddedActivities,
          })
          if (shouldFollowInstructorSetState) {
            suppressFallbackToInstructorRef.current = false
            setBacktrackOptOut(false)
            localStudentIndicesRef.current = instructorIndices
            setStudentIndicesState(instructorIndices)
            expectedInstructorLocalTargetRef.current = instructorIndices
          }
          console.info('[SyncDeck][StudentInboundInstructorIndices]', {
            inboundCommandName,
            semanticInstructorCommandName,
            instructorIndices,
            shouldFollowInstructorSetState,
            localStudentIndices: localStudentIndicesRef.current,
            suppressFallbackToInstructor: suppressFallbackToInstructorRef.current,
            backtrackOptOut: studentBacktrackOptOutRef.current,
          })
        }

        if (isSyncToInstructorCommand(parsed.payload) && studentBacktrackOptOutRef.current) {
          setBacktrackOptOut(false)
        }

        const boundaryDetails = computeBoundaryDetails(
          parsed.payload,
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
        }

        const boundaryCommand = toRevealBoundaryCommandMessage(
          parsed.payload,
          lastInstructorIndicesRef.current,
        )
        if (boundaryCommand != null) {
          sendPayloadToIframe(boundaryCommand)
          traceSync('forward_boundary_command_to_iframe', {
            action: (boundaryCommand.payload as { name?: unknown } | undefined)?.name as string | undefined,
          })
        }

        const revealCommand = toRevealCommandMessage(parsed.payload)
        if (revealCommand == null) {
          if (boundaryCommand == null) {
            traceSync('drop_inbound_server_payload_unhandled', {
              payloadType: resolveInboundPayloadType(parsed.payload),
            })
            return
          }
        } else {
          const inboundCommandName = extractRevealCommandName(parsed.payload)
          const semanticInstructorCommandName = resolveSemanticInstructorCommandName(parsed.payload)
          const incomingInstructorIndices = extractIndicesFromRevealStateMessage(parsed.payload)
          const {
            suppressForwardSync,
            suppressForwardSyncByBacktrack,
            suppressForwardSyncByVerticalIndependence,
          } = shouldSuppressInstructorRevealCommandForwarding({
            semanticInstructorCommandName,
            studentHasBacktrackOptOut: studentBacktrackOptOutRef.current,
            localStudentPosition: localStudentIndicesRef.current,
            incomingInstructorIndices,
          })
          if (inboundCommandName != null || semanticInstructorCommandName != null) {
            console.info('[SyncDeck][StudentInboundCommand]', {
              commandName: inboundCommandName,
              semanticCommandName: semanticInstructorCommandName,
              incomingInstructorIndices,
              localStudentIndices: localStudentIndicesRef.current,
              suppressForwardSync,
              suppressForwardSyncByBacktrack,
              suppressForwardSyncByVerticalIndependence,
              backtrackOptOut: studentBacktrackOptOutRef.current,
              suppressFallbackToInstructor: suppressFallbackToInstructorRef.current,
            })
          }
          if (!suppressForwardSync) {
            if (incomingInstructorIndices) {
              expectedInstructorLocalTargetRef.current = incomingInstructorIndices
            }
            sendPayloadToIframe(revealCommand)
            traceSync('forward_reveal_command_to_iframe', {
              action: (revealCommand as { payload?: { name?: unknown } }).payload?.name as string | undefined,
            })
          } else {
            traceSync('drop_forward_sync_due_to_backtrack_opt_out', {
              action: (revealCommand as { payload?: { name?: unknown } }).payload?.name as string | undefined,
            })
          }
        }

        setStatusMessage('Receiving instructor sync…')
        sendSyncContextToEmbeddedIframe()
      } catch {
        return
      }
    },
    [applyDrawingToolModeToIframe, embeddedActivities, sendPayloadToIframe, sendSyncContextToEmbeddedIframe, setBacktrackOptOut, traceSync],
  )

  const replayLatestInstructorSyncToIframe = useCallback(() => {
    const payload = latestInstructorPayloadRef.current
    if (payload == null) {
      return
    }

    const boundaryCommand = toRevealBoundaryCommandMessage(
      payload,
      lastInstructorIndicesRef.current,
    )
    if (boundaryCommand != null) {
      sendPayloadToIframe(boundaryCommand)
    }

    const revealCommand = toRevealCommandMessage(payload)
    if (revealCommand != null) {
      const semanticInstructorCommandName = resolveSemanticInstructorCommandName(payload)
      const incomingInstructorIndices = extractIndicesFromRevealStateMessage(payload)
      const { suppressForwardSync } = shouldSuppressInstructorRevealCommandForwarding({
        semanticInstructorCommandName,
        studentHasBacktrackOptOut: studentBacktrackOptOutRef.current,
        localStudentPosition: localStudentIndicesRef.current,
        incomingInstructorIndices,
      })

      if (!suppressForwardSync) {
        sendPayloadToIframe(revealCommand)
      }
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

      if (isRevealSyncMessage(event.data)) {
        const metadataTitle = extractRevealMetadataTitle(event.data)
        if (metadataTitle != null) {
          setPresentationTitle(metadataTitle)
        }

        if (event.data.action === 'activityRequest') {
          const currentSyncState = computeStudentEmbeddedSyncState(
            localStudentIndicesRef.current,
            lastInstructorIndicesRef.current,
          )
          if (currentSyncState === 'solo') {
            const soloRequests = resolveStudentSoloActivityRequestInputs(event.data.payload, localStudentIndicesRef.current)
            if (soloRequests.length > 0) {
              void (async () => {
                const { getActivity } = await import('@src/activities')
                const resolvedRequests = soloRequests.map((soloRequest) => {
                  const activity = getActivity(soloRequest.activityId)
                  return applyResolvedStandaloneEntryToSoloRequest(
                    soloRequest,
                    activity?.standaloneEntry
                      ? {
                        enabled: activity.standaloneEntry.enabled === true,
                        supportsDirectPath: activity.standaloneEntry.supportsDirectPath === true,
                        supportsPermalink: activity.standaloneEntry.supportsPermalink === true,
                      }
                      : null,
                  )
                })

                setSoloOverlays((current) => resolvedRequests.reduce(
                  (nextOverlays, resolvedRequest) => applyStudentSoloActivityRequest(nextOverlays, resolvedRequest),
                  current,
                ))
              })()
            }
          } else {
            const synchronizedRequest = resolveStudentSoloActivityRequest(
              event.data.payload,
              localStudentIndicesRef.current,
            )
            const synchronizedSlideKey = buildSyncDeckSlideKey(synchronizedRequest?.indices ?? null)
            if (synchronizedSlideKey) {
              setPendingSynchronizedActivityRequest({
                slideKey: synchronizedSlideKey,
                observedAt: Date.now(),
              })
            }
          }
        }

        const compatibility = assessRevealSyncProtocolCompatibility(event.data.version)
        if (!compatibility.compatible) {
          traceSync('warn_inbound_iframe_payload_incompatible_protocol', {
            reason: compatibility.reason,
            expectedVersion: compatibility.expectedVersion,
            receivedVersion: compatibility.receivedVersion,
            action: event.data.action,
          })
        }
      }

      const localIndices = extractIndicesFromRevealStateMessage(event.data)
      if (localIndices) {
        const previousLocalIndices = localStudentIndicesRef.current
        localStudentIndicesRef.current = localIndices
        setStudentIndicesState(localIndices)

        const instructorIndices = lastInstructorIndicesRef.current
        if (
          suppressFallbackToInstructorRef.current
          && instructorIndices
          && localIndices.h === instructorIndices.h
          && localIndices.v === instructorIndices.v
          && localIndices.f === instructorIndices.f
        ) {
          suppressFallbackToInstructorRef.current = false
        }

        const maxPosition = lastEffectiveMaxPositionRef.current ?? instructorIndices
        const isInstructorDrivenLocalMove = isExpectedInstructorDrivenLocalMove(
          expectedInstructorLocalTargetRef.current,
          localIndices,
        )
        const shouldEnableLocalBacktrackOptOut = shouldEnableBacktrackOptOutOnLocalMove({
          studentHasBacktrackOptOut: studentBacktrackOptOutRef.current,
          previousLocalPosition: previousLocalIndices,
          nextLocalPosition: localIndices,
          maxPosition,
          instructorPosition: instructorIndices,
        })
        if (isInstructorDrivenLocalMove) {
          expectedInstructorLocalTargetRef.current = null
        } else if (shouldEnableLocalBacktrackOptOut) {
          setBacktrackOptOut(true)
        }

        console.info('[SyncDeck][StudentLocalIndicesUpdate]', {
          previousLocalIndices,
          localIndices,
          instructorIndices,
          maxPosition,
          isInstructorDrivenLocalMove,
          shouldEnableLocalBacktrackOptOut,
          backtrackOptOut: studentBacktrackOptOutRef.current,
          suppressFallbackToInstructor: suppressFallbackToInstructorRef.current,
        })

        if (shouldResetBacktrackOptOutByMaxPosition(studentBacktrackOptOutRef.current, localIndices, maxPosition)) {
          setBacktrackOptOut(false)
        }

        sendSyncContextToEmbeddedIframe()
      }

      const capabilities = extractNavigationCapabilitiesFromStateMessage(event.data)
      if (capabilities) {
        setNavigationCapabilities(capabilities)
        setNavigationCapabilityIndices(localIndices ?? localStudentIndicesRef.current)
      }

      if (!hasSeenIframeReadySignalRef.current && isRevealIframeReadySignal(event.data)) {
        hasSeenIframeReadySignalRef.current = true
        if (pendingPayloadQueueRef.current.length > 0) {
          const queuedPayloads = [...pendingPayloadQueueRef.current]
          pendingPayloadQueueRef.current = []
          for (const queuedPayload of queuedPayloads) {
            sendPayloadToIframe(queuedPayload)
          }
          traceSync('flush_queued_iframe_payloads', {
            count: queuedPayloads.length,
          })
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
  }, [
    applyDrawingToolModeToIframe,
    replayLatestInstructorSyncToIframe,
    sendPayloadToIframe,
    sendSyncContextToEmbeddedIframe,
    setBacktrackOptOut,
    traceSync,
  ])

  const buildStudentWsUrl = useCallback((): string | null => {
    if (typeof window === 'undefined') {
      return null
    }

    return buildStudentWebSocketUrl({
      sessionId,
      presentationUrl,
      studentId: registeredStudentId,
      protocol: window.location.protocol,
      host: window.location.host,
    })
  }, [sessionId, presentationUrl, registeredStudentId])

  const { connect: connectStudentWs, disconnect: disconnectStudentWs, socketRef: studentSocketRef } =
    useResilientWebSocket({
      buildUrl: buildStudentWsUrl,
      shouldReconnect: Boolean(sessionId && presentationUrl && !presentationUrlError && !isStandaloneSession),
      onOpen: () => {
        setConnectionState('connected')
        setStatusMessage('Connected. Waiting for instructor sync…')
      },
      onClose: (event) => {
        const closeDecision = resolveSyncDeckStudentCloseDecision(event)
        if (closeDecision.clearCachedIdentity) {
          if (typeof window !== 'undefined' && sessionId) {
            window.sessionStorage.removeItem(`syncdeck_student_name_${sessionId}`)
            window.sessionStorage.removeItem(`syncdeck_student_id_${sessionId}`)
          }
          setRegisteredStudentName('')
          setRegisteredStudentId('')
          setJoinError(closeDecision.joinError)
          setConnectionState('disconnected')
          setStatusMessage(closeDecision.statusMessage)
          return
        }

        setConnectionState('disconnected')
        setStatusMessage(closeDecision.statusMessage)
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
        const standaloneMode = payload.session?.data?.standaloneMode === true
        if (typeof configuredPresentationUrl !== 'string' || !validatePresentationUrl(configuredPresentationUrl)) {
          if (!isCancelled) {
            setIsStandaloneSession(standaloneMode)
            setIsWaitingForConfiguration(true)
            setError(null)
            setIsLoading(false)
          }
          return
        }

        if (!isCancelled) {
          const existingEmbeddedActivities = normalizeSyncDeckEmbeddedActivities(
            payload.session?.data?.embeddedActivities,
          )
          setEmbeddedActivities(existingEmbeddedActivities)
          setPresentationUrl(configuredPresentationUrl)
          setIsStandaloneSession(standaloneMode)
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
        const standaloneMode = payload.session?.data?.standaloneMode === true
        if (typeof configuredPresentationUrl !== 'string' || !validatePresentationUrl(configuredPresentationUrl)) {
          return
        }

        if (!isCancelled) {
          setPresentationUrl(configuredPresentationUrl)
          setIsStandaloneSession(standaloneMode)
          setIsWaitingForConfiguration(false)
          setConnectionState(standaloneMode ? 'connected' : 'disconnected')
          setStatusMessage(standaloneMode ? 'Standalone navigation enabled' : 'Waiting for instructor sync…')
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
    if (
      !sessionId
      || !presentationUrl
      || isStandaloneSession
      || presentationUrlError
      || registeredStudentName.trim().length === 0
      || registeredStudentId.trim().length === 0
    ) {
      disconnectStudentWs()
      return undefined
    }

    connectStudentWs()
    return () => {
      disconnectStudentWs()
    }
  }, [
    sessionId,
    presentationUrl,
    isStandaloneSession,
    presentationUrlError,
    registeredStudentName,
    registeredStudentId,
    connectStudentWs,
    disconnectStudentWs,
  ])

  const handleIframeLoad = useCallback(() => {
    hasSeenIframeReadySignalRef.current = false
    const bootstrapPayloads = isStandaloneSession
      ? buildStandaloneBootstrapCommandMessages()
      : [buildStudentRoleCommandMessage()]

    for (const payload of bootstrapPayloads) {
      sendPayloadToIframe(payload)
    }

    if (isStandaloneSession) {
      setConnectionState('connected')
      setStatusMessage('Standalone navigation enabled')
      return
    }

    if (studentSocketRef.current?.readyState === WS_OPEN_READY_STATE) {
      setStatusMessage('Connected to instructor sync')
    }
  }, [isStandaloneSession, sendPayloadToIframe, studentSocketRef])

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
    suppressFallbackToInstructorRef.current = false
    setBacktrackOptOut(false)
  }, [sendPayloadToIframe, setBacktrackOptOut])

  const syncState = computeStudentEmbeddedSyncState(
    studentIndicesState,
    lastInstructorIndicesRef.current,
  )
  const preferInstructorOverlay = shouldPreferInstructorOverlaySelection({
    syncState,
    isBacktrackOptOut,
    suppressFallbackToInstructor: suppressFallbackToInstructorRef.current,
  })
  const embeddedActivityKeys = Object.keys(embeddedActivities)
  const overlayNavigationKeys = buildStudentOverlayNavigationKeys({
    embeddedActivities,
    soloOverlays,
  })
  const studentAnchoredInstanceKey = resolveStudentActiveEmbeddedInstanceKey(
    embeddedActivities,
    studentIndicesState,
  )
  const instructorAnchoredInstanceKey = resolveStudentActiveEmbeddedInstanceKey(
    embeddedActivities,
    lastInstructorIndicesRef.current,
  )

  const activeEmbeddedInstanceKey = resolveStudentOverlayEmbeddedInstanceKey(
    embeddedActivities,
    studentIndicesState,
    lastInstructorIndicesRef.current,
    {
      preferInstructor: preferInstructorOverlay,
      fallbackOnMismatch: !preferInstructorOverlay && !suppressFallbackToInstructorRef.current,
    },
  )
  const activeEmbeddedActivity = activeEmbeddedInstanceKey
    ? (embeddedActivities[activeEmbeddedInstanceKey] ?? null)
    : null
  const activeEmbeddedActivityId = activeEmbeddedActivity?.activityId ?? null
  const activeEmbeddedChildSessionId = activeEmbeddedActivity?.childSessionId ?? null
  const activeSoloOverlay = activeEmbeddedInstanceKey
    ? null
    : (studentIndicesState ? (soloOverlays[`${studentIndicesState.h}:${studentIndicesState.v}`] ?? null) : null)
  const hasPendingSynchronizedActivityRequest = hasPendingSynchronizedActivityRequestForCurrentSlide({
    pendingRequest: pendingSynchronizedActivityRequest,
    studentIndices: studentIndicesState,
    now: Date.now(),
  })
  const showInstructorPendingActivityNotice = shouldShowInstructorPendingActivityNotice({
    hasActiveEmbeddedActivity: activeEmbeddedActivity != null,
    hasActiveSoloOverlay: activeSoloOverlay != null,
    instructorAnchoredInstanceKey,
    hasPendingSynchronizedActivityRequest,
    studentIndices: studentIndicesState,
    instructorIndices: lastInstructorIndicesRef.current,
    isBacktrackOptOut,
  })
  const overlayNavigationBaseIndices = resolveStudentOverlayNavigationBaseIndices({
    studentIndices: studentIndicesState,
    studentAnchoredInstanceKey,
    activeEmbeddedInstanceKey,
  })
  const overlayVerticalNavigationCapabilities = deriveEmbeddedOverlayVerticalNavigationCapabilities(
    overlayNavigationKeys,
    overlayNavigationBaseIndices,
  )
  const canMoveBack =
    navigationCapabilities?.canGoBack === true
    || (overlayNavigationBaseIndices ? overlayNavigationBaseIndices.h > 0 : false)
  const canMoveForward =
    navigationCapabilities?.canGoForward !== false
  const canMoveUp =
    resolveEmbeddedOverlayVerticalMoveAllowed({
      direction: 'up',
      iframeCapability: resolveCurrentSlideNavigationCapability({
        iframeCapability: navigationCapabilities?.canGoUp ?? null,
        capabilityIndices: navigationCapabilityIndices,
        currentIndices: overlayNavigationBaseIndices,
      }),
      derivedCapabilities: overlayVerticalNavigationCapabilities,
      fallbackAllowed: overlayNavigationBaseIndices ? overlayNavigationBaseIndices.v > 0 : false,
    })
  const canMoveDown =
    resolveEmbeddedOverlayVerticalMoveAllowed({
      direction: 'down',
      iframeCapability: resolveCurrentSlideNavigationCapability({
        iframeCapability: navigationCapabilities?.canGoDown ?? null,
        capabilityIndices: navigationCapabilityIndices,
        currentIndices: overlayNavigationBaseIndices,
      }),
      derivedCapabilities: overlayVerticalNavigationCapabilities,
      fallbackAllowed: overlayNavigationBaseIndices ? overlayNavigationBaseIndices.v === 0 : false,
    })

  useEffect(() => {
    if (
      typeof window === 'undefined'
      || !sessionId
      || !activeEmbeddedInstanceKey
      || !activeEmbeddedActivityId
      || !activeEmbeddedChildSessionId
    ) {
      return
    }

    const shouldRecover = shouldRecoverEmbeddedEntryParticipantToken({
      sessionId,
      childSessionId: activeEmbeddedChildSessionId,
      studentId: registeredStudentId,
      activityId: activeEmbeddedActivityId,
      sessionStorage: window.sessionStorage,
      localStorage: window.localStorage,
    })
    if (!shouldRecover) {
      return
    }

    const recoveryKey = `${activeEmbeddedActivityId}:${activeEmbeddedChildSessionId}:${registeredStudentId}`
    if (recoveredEmbeddedEntryKeysRef.current.has(recoveryKey)) {
      return
    }
    recoveredEmbeddedEntryKeysRef.current.add(recoveryKey)

    const abortController = new AbortController()

    void (async () => {
      try {
        const response = await fetch(`/api/syncdeck/${encodeURIComponent(sessionId)}/embedded-activity/entry`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            instanceKey: activeEmbeddedInstanceKey,
            childSessionId: activeEmbeddedChildSessionId,
            studentId: registeredStudentId,
          }),
          signal: abortController.signal,
        })

        if (!response.ok) {
          if (!abortController.signal.aborted) {
            recoveredEmbeddedEntryKeysRef.current.delete(recoveryKey)
          }
          return
        }

        const payload = (await response.json()) as SyncDeckEmbeddedEntryResponse
        const recoveredEntry = shouldPersistRecoveredEmbeddedEntryResponse({
          response: payload,
          activeEmbeddedChildSessionId,
        })

        if (!abortController.signal.aborted && recoveredEntry) {
          const persisted = persistRecoveredEmbeddedEntryParticipantToken({
            sessionStorage: window.sessionStorage,
            activityId: activeEmbeddedActivityId,
            childSessionId: recoveredEntry.childSessionId,
            entryParticipantToken: recoveredEntry.entryParticipantToken,
          })
          if (persisted) {
            return
          }
          recoveredEmbeddedEntryKeysRef.current.delete(recoveryKey)
          return
        }

        if (!abortController.signal.aborted) {
          recoveredEmbeddedEntryKeysRef.current.delete(recoveryKey)
        }
      } catch {
        if (!abortController.signal.aborted) {
          recoveredEmbeddedEntryKeysRef.current.delete(recoveryKey)
        }
      }
    })()

    return () => {
      abortController.abort()
      recoveredEmbeddedEntryKeysRef.current.delete(recoveryKey)
    }
  }, [
    activeEmbeddedActivityId,
    activeEmbeddedChildSessionId,
    activeEmbeddedInstanceKey,
    registeredStudentId,
    sessionId,
  ])

  useEffect(() => {
    if (
      !sessionId
      || syncState !== 'synchronized'
      || activeEmbeddedInstanceKey != null
      || !studentIndicesState
      || !hasPendingSynchronizedActivityRequest
    ) {
      return
    }

    void reconcileEmbeddedActivitiesSnapshot()

    const reconcileInterval = window.setInterval(() => {
      void reconcileEmbeddedActivitiesSnapshot()
    }, 1500)

    return () => {
      window.clearInterval(reconcileInterval)
    }
  }, [
    activeEmbeddedInstanceKey,
    hasPendingSynchronizedActivityRequest,
    reconcileEmbeddedActivitiesSnapshot,
    sessionId,
    studentIndicesState,
    syncState,
  ])

  useEffect(() => {
    console.info('[SyncDeck][StudentOverlaySelection]', {
      activeEmbeddedInstanceKey,
      activeEmbeddedActivityId: activeEmbeddedActivity?.activityId ?? null,
      studentAnchoredInstanceKey,
      instructorAnchoredInstanceKey,
      embeddedActivityKeys,
      preferInstructorOverlay,
      studentIndicesState,
      instructorIndices: lastInstructorIndicesRef.current,
      syncState,
      isBacktrackOptOut,
      suppressFallbackToInstructor: suppressFallbackToInstructorRef.current,
    })
  }, [
    activeEmbeddedActivity?.activityId,
    activeEmbeddedInstanceKey,
    embeddedActivityKeys,
    instructorAnchoredInstanceKey,
    isBacktrackOptOut,
    preferInstructorOverlay,
    studentAnchoredInstanceKey,
    studentIndicesState,
    syncState,
  ])

  useEffect(() => {
    if (syncState !== 'solo' && Object.keys(soloOverlays).length > 0) {
      setSoloOverlays({})
    }
  }, [soloOverlays, syncState])

  useEffect(() => {
    if (syncState !== 'solo') {
      return
    }

    const launchableEntries = Object.entries(soloOverlays).filter(([, overlay]) => {
      return overlay.src == null && overlay.selectedOptions != null
    })
    if (launchableEntries.length === 0) {
      return
    }

    let isCancelled = false

    void (async () => {
      const { launchActivityPersistentSoloEntry } = await import('@src/activities')

      for (const [slideKey, overlay] of launchableEntries) {
        if (isCancelled) {
          return
        }

        const selectedOptions = overlay.selectedOptions
        if (!selectedOptions) {
          continue
        }

        try {
          const launchResult = await launchActivityPersistentSoloEntry(overlay.activityId, {
            hash: '',
            search: '',
            selectedOptions,
          })

          if (isCancelled) {
            return
          }

          if (!launchResult) {
            setSoloOverlays((current) => {
              const existing = current[slideKey]
              if (
                !existing
                || existing.activityId !== overlay.activityId
                || getSelectedOptionsComparisonKey(existing.selectedOptions) !== getSelectedOptionsComparisonKey(overlay.selectedOptions)
              ) {
                return current
              }

              return {
                ...current,
                [slideKey]: {
                  activityId: overlay.activityId,
                  notice: 'Unable to launch this solo activity.',
                },
              }
            })
            continue
          }

          const nextSrc = typeof launchResult.navigateTo === 'string' && launchResult.navigateTo.length > 0
            ? launchResult.navigateTo
            : typeof launchResult.sessionId === 'string' && launchResult.sessionId.length > 0
              ? `/${encodeURIComponent(launchResult.sessionId)}`
              : null

          if (
            typeof window !== 'undefined'
            && typeof launchResult.sessionId === 'string'
            && launchResult.sessionId.length > 0
            && registeredStudentName.trim().length > 0
            && registeredStudentId.trim().length > 0
          ) {
            const launchedSessionId = launchResult.sessionId
            persistSessionParticipantIdentity(
              window.localStorage,
              launchedSessionId,
              registeredStudentName,
              registeredStudentId,
            )
            void persistWaitingRoomServerBackedHandoff({
              storage: window.sessionStorage,
              storageKey: buildSessionEntryParticipantStorageKey(overlay.activityId, launchedSessionId),
              values: {
                displayName: registeredStudentName,
                participantId: registeredStudentId,
              },
              submitApiUrl: buildSessionEntryParticipantSubmitApiUrl(launchedSessionId),
              participantContextStorage: window.localStorage,
              sessionParticipantContextSessionId: launchedSessionId,
            })
          }

          setSoloOverlays((current) => {
            const existing = current[slideKey]
            if (
              !existing
              || existing.activityId !== overlay.activityId
              || getSelectedOptionsComparisonKey(existing.selectedOptions) !== getSelectedOptionsComparisonKey(overlay.selectedOptions)
            ) {
              return current
            }

            if (!nextSrc) {
              return {
                ...current,
                [slideKey]: {
                  activityId: overlay.activityId,
                  notice: 'This activity requires a live session.',
                },
              }
            }

            return {
              ...current,
              [slideKey]: {
                activityId: overlay.activityId,
                src: nextSrc,
              },
            }
          })
        } catch {
          if (isCancelled) {
            return
          }

          setSoloOverlays((current) => {
            const existing = current[slideKey]
            if (
              !existing
              || existing.activityId !== overlay.activityId
              || getSelectedOptionsComparisonKey(existing.selectedOptions) !== getSelectedOptionsComparisonKey(overlay.selectedOptions)
            ) {
              return current
            }

            return {
              ...current,
              [slideKey]: {
                activityId: overlay.activityId,
                notice: 'Unable to launch this solo activity.',
              },
            }
          })
        }
      }
    })()

    return () => {
      isCancelled = true
    }
  }, [soloOverlays, syncState])

  useEffect(() => {
    sendSyncContextToEmbeddedIframe()
  }, [activeEmbeddedInstanceKey, sendSyncContextToEmbeddedIframe, studentIndicesState, syncState])

  const sendStudentOverlayNavigation = useCallback((direction: 'left' | 'right' | 'up' | 'down') => {
    const optimisticIndices = resolveOptimisticEmbeddedOverlayIndices(
      overlayNavigationKeys,
      overlayNavigationBaseIndices,
      direction,
    )

    console.info('[SyncDeck][StudentOverlayNavRequest]', {
      direction,
      overlayNavigationBaseIndices,
      studentIndicesState,
      studentAnchoredInstanceKey,
      activeEmbeddedInstanceKey,
      optimisticIndices,
    })

    if (optimisticIndices) {
      activateOverlayNavClickShield()
      suppressFallbackToInstructorRef.current = true
      localStudentIndicesRef.current = optimisticIndices
      setStudentIndicesState(optimisticIndices)
      const maxPosition = lastEffectiveMaxPositionRef.current ?? lastInstructorIndicesRef.current
      const payloads = buildStudentLocalNavigationPayloads({
        optimisticIndices,
        maxPosition,
      })
      for (const payload of payloads) {
        sendPayloadToIframe(payload)
      }
      return
    }
  }, [
    activateOverlayNavClickShield,
    activeEmbeddedInstanceKey,
    overlayNavigationKeys,
    overlayNavigationBaseIndices,
    sendPayloadToIframe,
    studentAnchoredInstanceKey,
    studentIndicesState,
  ])

  const handleStudentOverlayBack = useCallback(() => {
    if (!canMoveBack) {
      return
    }
    sendStudentOverlayNavigation('left')
  }, [canMoveBack, sendStudentOverlayNavigation])

  const handleStudentOverlayForward = useCallback(() => {
    if (!canMoveForward) {
      return
    }
    sendStudentOverlayNavigation('right')
  }, [canMoveForward, sendStudentOverlayNavigation])

  const handleStudentOverlayUp = useCallback(() => {
    if (!canMoveUp) {
      return
    }
    sendStudentOverlayNavigation('up')
  }, [canMoveUp, sendStudentOverlayNavigation])

  const handleStudentOverlayDown = useCallback(() => {
    if (!canMoveDown) {
      return
    }
    sendStudentOverlayNavigation('down')
  }, [canMoveDown, sendStudentOverlayNavigation])

  const handleStudentOverlayNavigationClick = (
    event: MouseEvent<HTMLButtonElement>,
    direction: 'left' | 'right' | 'up' | 'down',
  ): void => {
    consumeEmbeddedOverlayNavigationEvent(event)
    if (consumeOverlayNavClick()) {
      return
    }
    if (direction === 'left') {
      handleStudentOverlayBack()
      return
    }
    if (direction === 'right') {
      handleStudentOverlayForward()
      return
    }
    if (direction === 'up') {
      handleStudentOverlayUp()
      return
    }
    handleStudentOverlayDown()
  }

  const handleStudentOverlayNavigationPointerDown = (
    event: PointerEvent<HTMLButtonElement>,
    direction: 'left' | 'right' | 'up' | 'down',
  ): void => {
    if (event.button !== 0) {
      return
    }
    consumeEmbeddedOverlayNavigationEvent(event)
    beginOverlayNavPointerDownHandling()
    if (direction === 'left') {
      handleStudentOverlayBack()
      return
    }
    if (direction === 'right') {
      handleStudentOverlayForward()
      return
    }
    if (direction === 'up') {
      handleStudentOverlayUp()
      return
    }
    handleStudentOverlayDown()
  }

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

  if (error || presentationUrlError || !presentationUrl) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-3">
        <h1 className="text-2xl font-bold">SyncDeck</h1>
        <p className="text-sm text-gray-700">{error || presentationUrlError || 'Session unavailable.'}</p>
      </div>
    )
  }

  if (registeredStudentName.trim().length === 0 || registeredStudentId.trim().length === 0) {
    return (
      <div className="fixed inset-0 z-10 bg-white flex items-center justify-center p-6">
        <div className="w-full max-w-md border border-gray-200 rounded p-4 space-y-3">
          <h1 className="text-xl font-bold text-gray-800">Return to Waiting Room</h1>
          <p className="text-sm text-gray-700">
            SyncDeck now expects student entry to come through the waiting room before the presentation loads.
          </p>
          {joinError ? <p className="text-sm text-red-600">{joinError}</p> : null}
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.reload()
              }
            }}
            className="px-3 py-2 rounded bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
          >
            Reload Entry Flow
          </button>
        </div>
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

      <div className="relative flex-1 min-h-0 w-full overflow-hidden bg-white">
        <iframe
          ref={iframeRef}
          title="SyncDeck Student Presentation"
          src={presentationUrl}
          className="w-full h-full"
          allow="fullscreen"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          onLoad={handleIframeLoad}
        />

        <div
          ref={overlayNavClickShieldRef}
          aria-hidden="true"
          className="absolute inset-0 z-[15] bg-transparent pointer-events-none"
        />

        {activeEmbeddedActivity ? (
          <div className="absolute inset-0 z-10 bg-white p-14">
            <div className="w-full h-full rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
              <iframe
                ref={embeddedActivityIframeRef}
                title={`Embedded ${activeEmbeddedActivity.activityId} activity`}
                src={`/${encodeURIComponent(activeEmbeddedActivity.childSessionId)}`}
                className="w-full h-full border-0"
                allow="fullscreen"
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                onLoad={sendSyncContextToEmbeddedIframe}
              />
            </div>
          </div>
        ) : null}

        {!activeEmbeddedActivity && activeSoloOverlay ? (
          activeSoloOverlay.src ? (
            <div className="absolute inset-0 z-10 bg-white p-14">
              <div className="w-full h-full rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
                <iframe
                  ref={embeddedActivityIframeRef}
                  title={`Solo ${activeSoloOverlay.activityId} activity`}
                  src={activeSoloOverlay.src}
                  className="w-full h-full border-0"
                  allow="fullscreen"
                  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                  onLoad={sendSyncContextToEmbeddedIframe}
                />
              </div>
            </div>
          ) : (
            <div className={`absolute inset-0 z-10 flex items-center justify-center ${getStudentOverlayBackdropClass()} p-6`}>
              <div className="max-w-lg rounded-lg border border-gray-300 bg-white p-4 shadow-sm space-y-3 text-center">
                <h2 className="text-lg font-semibold text-gray-900">Solo Embedded Activity</h2>
                <p className="text-sm text-gray-700">
                  {activeSoloOverlay.notice ?? 'This activity requires a live session. Solo launch is not available on this slide.'}
                </p>
              </div>
            </div>
          )
        ) : null}

        {!activeEmbeddedActivity && showInstructorPendingActivityNotice ? (
          <div className={`absolute inset-0 z-10 flex items-center justify-center ${getStudentOverlayBackdropClass()} p-6`}>
            <div className="max-w-lg rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-sm space-y-3 text-center">
              <h2 className="text-lg font-semibold text-amber-900">Activity Is Starting</h2>
              <p className="text-sm text-amber-900">
                Your instructor is on an embedded activity slide. This activity session is not ready yet, so you are
                viewing the presentation for now.
              </p>
              <p className="text-xs text-amber-800">
                It will open automatically as soon as the instructor launches the activity for this slide.
              </p>
            </div>
          </div>
        ) : null}

        {shouldRenderStudentOverlayNavigation({
          activeEmbeddedActivity,
          activeSoloOverlay,
        }) ? (
          <>
            <button
              type="button"
              onPointerDown={(event) => handleStudentOverlayNavigationPointerDown(event, 'left')}
              onPointerCancel={resetOverlayNavPointerDownHandling}
              onClick={(event) => handleStudentOverlayNavigationClick(event, 'left')}
              disabled={!canMoveBack}
              aria-disabled={!canMoveBack}
              aria-label="Previous slide"
              title="Previous slide"
              className="absolute left-3 top-1/2 -translate-y-1/2 z-20 rounded-full border border-white/20 bg-black/60 px-3 py-2 text-white shadow-sm hover:bg-black/75 disabled:cursor-not-allowed disabled:border-white/45 disabled:bg-transparent disabled:text-white/65"
            >
              ◀
            </button>
            <button
              type="button"
              onPointerDown={(event) => handleStudentOverlayNavigationPointerDown(event, 'up')}
              onPointerCancel={resetOverlayNavPointerDownHandling}
              onClick={(event) => handleStudentOverlayNavigationClick(event, 'up')}
              disabled={!canMoveUp}
              aria-disabled={!canMoveUp}
              aria-label="Move up"
              title="Move up"
              className="absolute top-3 left-1/2 -translate-x-1/2 z-20 rounded-full border border-white/20 bg-black/60 px-3 py-2 text-white shadow-sm hover:bg-black/75 disabled:cursor-not-allowed disabled:border-white/45 disabled:bg-transparent disabled:text-white/65"
            >
              ▲
            </button>
            <button
              type="button"
              onPointerDown={(event) => handleStudentOverlayNavigationPointerDown(event, 'right')}
              onPointerCancel={resetOverlayNavPointerDownHandling}
              onClick={(event) => handleStudentOverlayNavigationClick(event, 'right')}
              disabled={!canMoveForward}
              aria-disabled={!canMoveForward}
              aria-label="Next slide"
              title="Next slide"
              className="absolute right-3 top-1/2 -translate-y-1/2 z-20 rounded-full border border-white/20 bg-black/60 px-3 py-2 text-white shadow-sm hover:bg-black/75 disabled:cursor-not-allowed disabled:border-white/45 disabled:bg-transparent disabled:text-white/65"
            >
              ▶
            </button>
            <button
              type="button"
              onPointerDown={(event) => handleStudentOverlayNavigationPointerDown(event, 'down')}
              onPointerCancel={resetOverlayNavPointerDownHandling}
              onClick={(event) => handleStudentOverlayNavigationClick(event, 'down')}
              disabled={!canMoveDown}
              aria-disabled={!canMoveDown}
              aria-label="Move down"
              title="Move down"
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 rounded-full border border-white/20 bg-black/60 px-3 py-2 text-white shadow-sm hover:bg-black/75 disabled:cursor-not-allowed disabled:border-white/45 disabled:bg-transparent disabled:text-white/65"
            >
              ▼
            </button>
          </>
        ) : null}

      </div>
    </div>
  )
}

export default SyncDeckStudent
