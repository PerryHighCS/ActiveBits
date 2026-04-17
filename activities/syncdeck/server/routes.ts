import { normalizeSessionData as normalizeSessionRecord, registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import {
  findHashBySessionId,
  generatePersistentHash,
  resolvePersistentSessionEntryPolicy,
  verifyTeacherCodeWithHash,
} from 'activebits-server/core/persistentSessions.js'
import {
  computePersistentLinkUrlHash,
  verifyPersistentLinkUrlHash,
  type PersistentLinkUrlState,
} from 'activebits-server/core/persistentLinkUrlState.js'
import { closeDuplicateParticipantSockets } from 'activebits-server/core/participantSockets.js'
import {
  createSession,
  EMBEDDED_CHILD_SESSION_PREFIX,
  generateHexId,
  type SessionRecord,
  type SessionStore,
} from 'activebits-server/core/sessions.js'
import { storeSessionEntryParticipant } from 'activebits-server/core/sessionEntryParticipants.js'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'
import {
  REVEAL_SYNC_PROTOCOL_VERSION,
  assessRevealSyncProtocolCompatibility,
} from '../shared/revealSyncProtocol.js'
import { getActivityReportBuilder } from '../../../server/activities/activityReportRegistry.js'
import { getActivityConfig, initializeActivityRegistry } from '../../../server/activities/activityRegistry.js'
import { connectSyncDeckStudent } from './studentParticipants.js'
import type { ActivityReportStudentRef, SyncDeckSessionReportManifest } from '../../../types/activity.js'
import { buildSyncDeckReportFilename, buildSyncDeckSessionReportHtml } from './reportHtml.js'

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000
const MAX_SESSIONS_PER_COOKIE = 20
const MAX_TEACHER_CODE_LENGTH = 100
const DEFAULT_SYNCDECK_ENTRY_POLICY = 'instructor-required'

interface CookieSessionEntry {
  key: string
  teacherCode: string
  selectedOptions?: Record<string, unknown>
  entryPolicy?: unknown
  urlHash?: unknown
}

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): void
  send?(payload: unknown): void
  cookie?(name: string, value: string, options: Record<string, unknown>): void
  setHeader?(name: string, value: string): void
}

interface RouteRequest {
  params: Record<string, string | undefined>
  body?: unknown
  cookies?: Record<string, unknown>
  headers?: Record<string, unknown>
}

interface SyncDeckRouteApp {
  get(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
  post(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
  delete(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
}

interface SyncDeckInstructorState {
  indices: { h: number; v: number; f: number } | null
  paused: boolean
  overview: boolean
  updatedAt: number
}

interface SyncDeckStudent {
  studentId: string
  name: string
  joinedAt: number
  lastSeenAt: number
  lastIndices: { h: number; v: number; f: number } | null
  lastStudentStateAt: number | null
}

interface SyncDeckEmbeddedEntryContextResponse {
  resolvedRole: 'teacher' | 'student'
  studentId?: string
  studentName?: string
}

interface SyncDeckEmbeddedActivityRecord {
  childSessionId: string
  activityId: string
  startedAt: number
  owner: string
}

interface SyncDeckEmbeddedInstancePosition {
  h: number
  v: number
}

interface SyncDeckEmbeddedLaunchPayload {
  parentSessionId: string
  instanceKey: string
  selectedOptions: Record<string, unknown>
}

interface SyncDeckEmbeddedManagerBootstrapPayload {
  instructorPasscode?: string
}

interface EmbeddedActivityStartResponsePayload {
  childSessionId: string
  instanceKey: string
  managerBootstrap?: SyncDeckEmbeddedManagerBootstrapPayload
}

type SyncDeckEmbeddedActivitiesMap = Record<string, SyncDeckEmbeddedActivityRecord>

interface SyncDeckChalkboardBuffer {
  snapshot: string | null
  delta: Record<string, unknown>[]
}

type SyncDeckDrawingToolMode = 'none' | 'chalkboard' | 'pen'

interface SyncDeckSessionData extends Record<string, unknown> {
  presentationUrl: string | null
  standaloneMode: boolean
  instructorPasscode: string
  instructorState: SyncDeckInstructorState | null
  lastInstructorPayload: unknown
  lastInstructorStatePayload: unknown
  chalkboard: SyncDeckChalkboardBuffer
  drawingToolMode: SyncDeckDrawingToolMode
  students: SyncDeckStudent[]
  embeddedActivities: SyncDeckEmbeddedActivitiesMap
}

interface SyncDeckSession extends SessionRecord {
  type?: string
  data: SyncDeckSessionData
}

interface SyncDeckSocket extends ActiveBitsWebSocket {
  isInstructor?: boolean
  sessionId?: string | null
  studentId?: string | null
}

interface SyncDeckWsMessage {
  type?: unknown
  payload?: unknown
  instructorPasscode?: unknown
}

interface SyncDeckInstructorAuthMessage {
  type: 'authenticate'
  instructorPasscode: string
}

const WS_OPEN_READY_STATE = 1
const SYNCDECK_WS_UPDATE_TYPE = 'syncdeck-state-update'
const SYNCDECK_WS_BROADCAST_TYPE = 'syncdeck-state'
const SYNCDECK_WS_STUDENTS_TYPE = 'syncdeck-students'
const DEFAULT_INSTRUCTOR_AUTH_TIMEOUT_MS = 5_000
const MAX_CHALKBOARD_DELTA_STROKES = 200
const SYNCDECK_EMBEDDED_OWNER = 'syncdeck-instructor'
const SYNCDECK_PROTOCOL_DEBUG_ENABLED = process.env.SYNCDECK_DEBUG_PROTOCOL === '1'
const SYNCDECK_PROTOCOL_WARNING_DEDUPE_TTL_MS = 5 * 60 * 1000
const SYNCDECK_PROTOCOL_WARNING_DEDUPE_MAX_KEYS = 500
const EMBEDDED_KEEPALIVE_TOUCH_DEDUPE_MS = 5_000
const EMBEDDED_KEEPALIVE_TOUCH_DEDUPE_MAX_KEYS = 500
const loggedProtocolWarningKeys = new Map<string, number>()
const embeddedKeepaliveTouchStateByStore = new WeakMap<object, {
  timestamps: Map<string, number>
  lastPrunedAt: number
}>()

type ChalkboardCommandName = 'chalkboardStroke' | 'chalkboardState' | 'clearChalkboard' | 'resetChalkboard'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function logSyncDeckProtocolEvent(
  level: 'info' | 'warn',
  event: string,
  details: Record<string, unknown>,
): void {
  if (level === 'info' && !SYNCDECK_PROTOCOL_DEBUG_ENABLED) {
    return
  }

  const now = Date.now()

  if (level === 'warn') {
    // Periodically prune stale dedupe keys to keep process memory bounded.
    for (const [key, timestamp] of loggedProtocolWarningKeys) {
      if (now - timestamp > SYNCDECK_PROTOCOL_WARNING_DEDUPE_TTL_MS) {
        loggedProtocolWarningKeys.delete(key)
      }
    }

    const dedupeKey = `${event}|${details.sessionId ?? 'session-unknown'}|${details.reason ?? 'reason-unknown'}|${details.receivedVersion ?? 'version-unknown'}|${details.action ?? 'action-unknown'}`
    const existingTimestamp = loggedProtocolWarningKeys.get(dedupeKey)
    if (typeof existingTimestamp === 'number' && now - existingTimestamp <= SYNCDECK_PROTOCOL_WARNING_DEDUPE_TTL_MS) {
      return
    }

    if (loggedProtocolWarningKeys.size >= SYNCDECK_PROTOCOL_WARNING_DEDUPE_MAX_KEYS) {
      const oldestKey = loggedProtocolWarningKeys.keys().next().value as string | undefined
      if (oldestKey) {
        loggedProtocolWarningKeys.delete(oldestKey)
      }
    }

    loggedProtocolWarningKeys.set(dedupeKey, now)
  }

  const payload = {
    activity: 'syncdeck',
    subsystem: 'reveal-sync-protocol',
    event,
    ...details,
    ts: now,
  }

  const logMessage = JSON.stringify(payload)
  if (level === 'warn') {
    console.warn(logMessage)
    return
  }

  console.info(logMessage)
}

function createInstructorPasscode(): string {
  return randomBytes(16).toString('hex')
}

function normalizeFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeNullableFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeSlideIndices(value: unknown): { h: number; v: number; f: number } | null {
  if (!isPlainObject(value)) {
    return null
  }

  const h = normalizeNullableFiniteNumber(value.h)
  const v = normalizeNullableFiniteNumber(value.v)
  const f = normalizeNullableFiniteNumber(value.f)
  if (h == null || v == null || f == null) {
    return null
  }

  return { h, v, f }
}

function normalizeStudentEntry(value: unknown): SyncDeckStudent | null {
  if (!isPlainObject(value)) {
    return null
  }

  const studentId = normalizeStudentId(value.studentId)
  if (!studentId) {
    return null
  }

  const now = Date.now()
  const joinedAt = normalizeFiniteNumber(value.joinedAt, now)
  const lastSeenAt = normalizeFiniteNumber(value.lastSeenAt, joinedAt)

  return {
    studentId,
    name: normalizeStudentName(value.name),
    joinedAt,
    lastSeenAt,
    lastIndices: normalizeSlideIndices(value.lastIndices),
    lastStudentStateAt: normalizeNullableFiniteNumber(value.lastStudentStateAt),
  }
}

function shouldRefreshEmbeddedChildKeepalive(
  sessions: Pick<SessionStore, 'get' | 'touch'>,
  sessionId: string,
  now = Date.now(),
): boolean {
  let state = embeddedKeepaliveTouchStateByStore.get(sessions)
  if (!state) {
    state = {
      timestamps: new Map<string, number>(),
      lastPrunedAt: 0,
    }
    embeddedKeepaliveTouchStateByStore.set(sessions, state)
  }

  if (
    now - state.lastPrunedAt >= EMBEDDED_KEEPALIVE_TOUCH_DEDUPE_MS
    || state.timestamps.size >= EMBEDDED_KEEPALIVE_TOUCH_DEDUPE_MAX_KEYS
  ) {
    for (const [trackedSessionId, timestamp] of state.timestamps) {
      if (now - timestamp > EMBEDDED_KEEPALIVE_TOUCH_DEDUPE_MS) {
        state.timestamps.delete(trackedSessionId)
      }
    }
    state.lastPrunedAt = now

    while (state.timestamps.size >= EMBEDDED_KEEPALIVE_TOUCH_DEDUPE_MAX_KEYS) {
      const oldestKey = state.timestamps.keys().next().value as string | undefined
      if (!oldestKey) {
        break
      }
      state.timestamps.delete(oldestKey)
    }
  }

  const existingTimestamp = state.timestamps.get(sessionId)
  if (typeof existingTimestamp === 'number' && now - existingTimestamp < EMBEDDED_KEEPALIVE_TOUCH_DEDUPE_MS) {
    return false
  }

  state.timestamps.delete(sessionId)
  state.timestamps.set(sessionId, now)
  return true
}

function findSyncDeckStudentById(
  students: SyncDeckStudent[],
  studentId: string | null,
): SyncDeckStudent | null {
  if (!studentId) {
    return null
  }

  return students.find((student) => student.studentId === studentId) ?? null
}

function normalizeStudents(value: unknown): SyncDeckStudent[] {
  if (!Array.isArray(value)) {
    return []
  }

  const students: SyncDeckStudent[] = []
  for (const entry of value) {
    const normalized = normalizeStudentEntry(entry)
    if (normalized) {
      students.push(normalized)
    }
  }

  return students
}

function normalizeEmbeddedActivityRecord(value: unknown): SyncDeckEmbeddedActivityRecord | null {
  if (!isPlainObject(value)) {
    return null
  }

  const childSessionId = typeof value.childSessionId === 'string' ? value.childSessionId.trim() : ''
  const activityId = typeof value.activityId === 'string' ? value.activityId.trim() : ''
  if (childSessionId.length === 0 || activityId.length === 0) {
    return null
  }

  return {
    childSessionId,
    activityId,
    startedAt: normalizeFiniteNumber(value.startedAt, Date.now()),
    owner:
      typeof value.owner === 'string' && value.owner.trim().length > 0
        ? value.owner.trim()
        : SYNCDECK_EMBEDDED_OWNER,
  }
}

function parseEmbeddedInstancePosition(instanceKey: string | null): SyncDeckEmbeddedInstancePosition | null {
  if (!instanceKey) {
    return null
  }

  const segments = instanceKey.split(':')
  if (segments.length < 3) {
    return null
  }

  const h = Number.parseInt(segments[1] ?? '', 10)
  const v = Number.parseInt(segments[2] ?? '', 10)
  if (!Number.isFinite(h) || !Number.isFinite(v)) {
    return null
  }

  return { h, v }
}

function normalizeEmbeddedActivities(value: unknown): SyncDeckEmbeddedActivitiesMap {
  const normalized: SyncDeckEmbeddedActivitiesMap = {}

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!isPlainObject(entry)) {
        continue
      }
      const instanceKey = typeof entry.embeddedId === 'string' ? entry.embeddedId.trim() : ''
      const activityId = typeof entry.activityType === 'string' ? entry.activityType.trim() : ''
      const sessionId = typeof entry.sessionId === 'string' ? entry.sessionId.trim() : ''
      if (instanceKey.length === 0 || activityId.length === 0) {
        continue
      }
      if (sessionId.length === 0) {
        continue
      }
      normalized[instanceKey] = {
        childSessionId: sessionId,
        activityId,
        startedAt: normalizeFiniteNumber(entry.createdAt, Date.now()),
        owner: 'legacy',
      }
    }
    return normalized
  }

  if (!isPlainObject(value)) {
    return normalized
  }

  for (const [instanceKey, entry] of Object.entries(value)) {
    const normalizedEntry = normalizeEmbeddedActivityRecord(entry)
    if (!normalizedEntry || instanceKey.trim().length === 0) {
      continue
    }
    normalized[instanceKey.trim()] = normalizedEntry
  }

  return normalized
}

function normalizeChalkboardSnapshot(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  return value
}

function normalizeChalkboardDelta(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return []
  }

  const delta: Record<string, unknown>[] = []
  for (const entry of value) {
    if (isPlainObject(entry)) {
      delta.push(entry)
    }
  }

  if (delta.length > MAX_CHALKBOARD_DELTA_STROKES) {
    return delta.slice(-MAX_CHALKBOARD_DELTA_STROKES)
  }

  return delta
}

function normalizeChalkboardBuffer(value: unknown): SyncDeckChalkboardBuffer {
  if (!isPlainObject(value)) {
    return {
      snapshot: null,
      delta: [],
    }
  }

  return {
    snapshot: normalizeChalkboardSnapshot(value.snapshot),
    delta: normalizeChalkboardDelta(value.delta),
  }
}

function normalizeDrawingToolMode(value: unknown): SyncDeckDrawingToolMode {
  if (value === 'chalkboard' || value === 'pen' || value === 'none') {
    return value
  }

  return 'none'
}

function extractIndicesFromRevealStateObject(value: unknown): { h: number; v: number; f: number } | null {
  if (!isPlainObject(value)) {
    return null
  }

  if (
    typeof value.indexh === 'number' &&
    Number.isFinite(value.indexh) &&
    typeof value.indexv === 'number' &&
    Number.isFinite(value.indexv)
  ) {
    return {
      h: value.indexh,
      v: value.indexv,
      f: typeof value.indexf === 'number' && Number.isFinite(value.indexf) ? value.indexf : 0,
    }
  }

  if (typeof value.h === 'number' && Number.isFinite(value.h) && typeof value.v === 'number' && Number.isFinite(value.v)) {
    return {
      h: value.h,
      v: value.v,
      f: typeof value.f === 'number' && Number.isFinite(value.f) ? value.f : 0,
    }
  }

  return null
}

function extractIndicesFromInstructorPayload(payload: unknown): { h: number; v: number; f: number } | null {
  if (!isPlainObject(payload)) {
    return null
  }

  if (payload.type === 'slidechanged' && isPlainObject(payload.payload)) {
    return extractIndicesFromRevealStateObject(payload.payload)
  }

  if (payload.type !== 'reveal-sync') {
    return null
  }

  if (payload.action === 'command' && isPlainObject(payload.payload)) {
    const commandName = payload.payload.name
    if (commandName === 'setState' && isPlainObject(payload.payload.payload)) {
      return extractIndicesFromRevealStateObject(payload.payload.payload.state)
    }
    return null
  }

  if (payload.action !== 'state' || !isPlainObject(payload.payload)) {
    return null
  }

  if (isPlainObject(payload.payload.indices)) {
    const indices = extractIndicesFromRevealStateObject(payload.payload.indices)
    if (indices) {
      return indices
    }
  }

  return extractIndicesFromRevealStateObject(payload.payload.revealState) ?? extractIndicesFromRevealStateObject(payload.payload)
}

function normalizeSessionData(data: unknown): SyncDeckSessionData {
  const source = isPlainObject(data) ? data : {}
  const normalizedLastInstructorPayload = source.lastInstructorPayload ?? null
  const normalizedLastInstructorStatePayload =
    source.lastInstructorStatePayload != null && extractIndicesFromInstructorPayload(source.lastInstructorStatePayload)
      ? source.lastInstructorStatePayload
      : extractIndicesFromInstructorPayload(normalizedLastInstructorPayload)
        ? normalizedLastInstructorPayload
        : null
  const preservedAcceptedEntryParticipants = isPlainObject(source.acceptedEntryParticipants)
    ? source.acceptedEntryParticipants
    : undefined
  const preservedEntryParticipants = isPlainObject(source.entryParticipants)
    ? source.entryParticipants
    : undefined

  return {
    ...(preservedAcceptedEntryParticipants ? { acceptedEntryParticipants: preservedAcceptedEntryParticipants } : {}),
    ...(preservedEntryParticipants ? { entryParticipants: preservedEntryParticipants } : {}),
    presentationUrl: typeof source.presentationUrl === 'string' ? source.presentationUrl : null,
    standaloneMode: source.standaloneMode === true,
    instructorPasscode:
      typeof source.instructorPasscode === 'string' && source.instructorPasscode.length > 0
        ? source.instructorPasscode
        : createInstructorPasscode(),
    instructorState: null,
    lastInstructorPayload: normalizedLastInstructorPayload,
    lastInstructorStatePayload: normalizedLastInstructorStatePayload,
    chalkboard: normalizeChalkboardBuffer(source.chalkboard),
    drawingToolMode: normalizeDrawingToolMode(source.drawingToolMode),
    students: normalizeStudents(source.students),
    embeddedActivities: normalizeEmbeddedActivities(source.embeddedActivities),
  }
}

function parseDrawingToolModeUpdate(payload: unknown): SyncDeckDrawingToolMode | null {
  if (!isPlainObject(payload) || payload.type !== 'syncdeck-tool-mode') {
    return null
  }

  return normalizeDrawingToolMode(payload.mode)
}

function buildDrawingToolModePayload(mode: SyncDeckDrawingToolMode): Record<string, unknown> {
  return {
    type: 'syncdeck-tool-mode',
    mode,
  }
}

function toChalkboardCommandName(value: unknown): ChalkboardCommandName | null {
  if (value === 'chalkboardStroke' || value === 'chalkboardState' || value === 'clearChalkboard' || value === 'resetChalkboard') {
    return value
  }

  return null
}

function parseChalkboardCommand(payload: unknown): { name: ChalkboardCommandName; payload: Record<string, unknown> } | null {
  if (!isPlainObject(payload)) {
    return null
  }

  const revealAction = toChalkboardCommandName(payload.action)
  if (revealAction) {
    return {
      name: revealAction,
      payload: isPlainObject(payload.payload) ? payload.payload : {},
    }
  }

  if (payload.action === 'command' && isPlainObject(payload.payload)) {
    const commandPayload = payload.payload
    const commandName = toChalkboardCommandName(commandPayload.name)
    if (!commandName) {
      return null
    }

    return {
      name: commandName,
      payload: isPlainObject(commandPayload.payload) ? commandPayload.payload : {},
    }
  }

  const topLevelCommandName = toChalkboardCommandName(payload.name)
  if (!topLevelCommandName) {
    return null
  }

  return {
    name: topLevelCommandName,
    payload: isPlainObject(payload.payload) ? payload.payload : {},
  }
}

function applyChalkboardBufferUpdate(sessionData: SyncDeckSessionData, payload: unknown): void {
  const command = parseChalkboardCommand(payload)
  if (!command) {
    return
  }

  if (command.name === 'chalkboardState') {
    sessionData.chalkboard.snapshot = typeof command.payload.storage === 'string' ? command.payload.storage : null
    sessionData.chalkboard.delta = []
    return
  }

  if (command.name === 'chalkboardStroke') {
    sessionData.chalkboard.delta.push(command.payload)
    if (sessionData.chalkboard.delta.length > MAX_CHALKBOARD_DELTA_STROKES) {
      sessionData.chalkboard.delta.splice(0, sessionData.chalkboard.delta.length - MAX_CHALKBOARD_DELTA_STROKES)
    }
    return
  }

  if (command.name === 'clearChalkboard' || command.name === 'resetChalkboard') {
    sessionData.chalkboard.snapshot = null
    sessionData.chalkboard.delta = []
  }
}

function createRevealCommandEnvelope(name: 'chalkboardStroke' | 'chalkboardState', payload: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'reveal-sync',
    version: REVEAL_SYNC_PROTOCOL_VERSION,
    action: 'command',
    deckId: null,
    role: 'instructor',
    source: 'reveal-iframe-sync',
    ts: Date.now(),
    payload: {
      name,
      payload,
    },
  }
}

function sendBufferedChalkboardState(socket: ActiveBitsWebSocket, chalkboard: SyncDeckChalkboardBuffer): void {
  if (chalkboard.snapshot != null) {
    sendSyncDeckState(socket, createRevealCommandEnvelope('chalkboardState', { storage: chalkboard.snapshot }))
  }

  for (const strokePayload of chalkboard.delta) {
    sendSyncDeckState(socket, createRevealCommandEnvelope('chalkboardStroke', strokePayload))
  }
}

function parseWsMessage(raw: unknown): SyncDeckWsMessage | null {
  try {
    const text =
      typeof raw === 'string'
        ? raw
        : raw instanceof Buffer
          ? raw.toString('utf8')
          : Buffer.isBuffer(raw)
            ? raw.toString('utf8')
            : String(raw)
    const parsed = JSON.parse(text) as unknown
    return isPlainObject(parsed) ? (parsed as SyncDeckWsMessage) : null
  } catch {
    return null
  }
}

function parseInstructorAuthMessage(raw: unknown): SyncDeckInstructorAuthMessage | null {
  const message = parseWsMessage(raw)
  if (!message || message.type !== 'authenticate' || typeof message.instructorPasscode !== 'string') {
    return null
  }

  return {
    type: 'authenticate',
    instructorPasscode: message.instructorPasscode,
  }
}

function getInstructorAuthTimeoutMs(): number {
  const rawValue = process.env.ACTIVEBITS_SYNCDECK_INSTRUCTOR_AUTH_TIMEOUT_MS
  const parsed = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INSTRUCTOR_AUTH_TIMEOUT_MS
}

export function waitForInstructorAuthMessage(
  socket: ActiveBitsWebSocket,
  timeoutMs = getInstructorAuthTimeoutMs(),
): Promise<unknown | null> {
  return new Promise<unknown | null>((resolve) => {
    let settled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      settle(null)
      socket.close(1008, 'auth timeout')
    }, timeoutMs)

    const settle = (value: unknown | null) => {
      if (settled) {
        return
      }
      settled = true
      if (timeoutId != null) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      resolve(value)
    }

    socket.once('message', (raw: unknown) => {
      settle(raw)
    })
    socket.once('close', () => {
      settle(null)
    })
    socket.once('error', () => {
      settle(null)
    })
  })
}

function sendSyncDeckState(socket: ActiveBitsWebSocket, payload: unknown): void {
  if (socket.readyState !== WS_OPEN_READY_STATE) {
    return
  }

  try {
    socket.send(
      JSON.stringify({
        type: SYNCDECK_WS_BROADCAST_TYPE,
        payload,
      }),
    )
  } catch {
    // Ignore socket send failures.
  }
}

function normalizeStudentId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 80) {
    return null
  }

  return trimmed
}

function normalizeStudentName(value: unknown): string {
  if (typeof value !== 'string') {
    return 'Student'
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return 'Student'
  }

  return trimmed.slice(0, 80)
}

function normalizeInstructorPasscode(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_TEACHER_CODE_LENGTH) {
    return null
  }

  return trimmed
}

function asSyncDeckSession(session: SessionRecord | null): SyncDeckSession | null {
  if (!session || session.type !== 'syncdeck') {
    return null
  }

  session.data = normalizeSessionData(session.data)
  return session as SyncDeckSession
}

function readStringField(payload: unknown, key: string): string | null {
  if (!isPlainObject(payload)) return null
  const value = payload[key]
  return typeof value === 'string' ? value : null
}

function readBooleanField(payload: unknown, key: string): boolean | null {
  if (!isPlainObject(payload)) return null
  const value = payload[key]
  return typeof value === 'boolean' ? value : null
}

function readObjectField(payload: unknown, key: string): Record<string, unknown> | null {
  if (!isPlainObject(payload)) return null
  const value = payload[key]
  return isPlainObject(value) ? value : null
}

function readHeaderField(headers: Record<string, unknown> | undefined, key: string): string | null {
  if (!headers) return null
  const normalizedKey = key.toLowerCase()

  for (const [candidateKey, value] of Object.entries(headers)) {
    if (candidateKey.toLowerCase() !== normalizedKey) {
      continue
    }
    if (typeof value === 'string') {
      return value
    }
    if (Array.isArray(value)) {
      const firstString = value.find((entry) => typeof entry === 'string')
      return typeof firstString === 'string' ? firstString : null
    }
  }

  return null
}

function sanitizeEmbeddedLaunchValue(value: unknown): unknown {
  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeEmbeddedLaunchValue(entry))
  }

  if (!isPlainObject(value)) {
    return null
  }

  const sanitized: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const nextValue = sanitizeEmbeddedLaunchValue(entry)
    if (nextValue !== undefined) {
      sanitized[key] = nextValue
    }
  }

  return sanitized
}

function sanitizeEmbeddedLaunchSelectedOptions(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeEmbeddedLaunchValue(value)
  return isPlainObject(sanitized) ? sanitized : {}
}

function buildEmbeddedManagerBootstrapPayload(session: SessionRecord): SyncDeckEmbeddedManagerBootstrapPayload | null {
  if (!isPlainObject(session.data)) {
    return null
  }

  const instructorPasscode = normalizeInstructorPasscode(session.data.instructorPasscode)
  if (!instructorPasscode) {
    return null
  }

  return {
    instructorPasscode,
  }
}

function buildEmbeddedActivityReportPath(reportEndpoint: string, childSessionId: string): string {
  return reportEndpoint.replaceAll(':sessionId', encodeURIComponent(childSessionId))
}

function buildEmbeddedActivityStartLockKey(sessionId: string, instanceKey: string): string {
  return `${sessionId}:${instanceKey}`
}

function mergeReportStudents(sections: Array<{ students?: ActivityReportStudentRef[] }>): ActivityReportStudentRef[] {
  const byStudentId = new Map<string, ActivityReportStudentRef>()
  for (const section of sections) {
    for (const student of section.students ?? []) {
      if (!byStudentId.has(student.studentId)) {
        byStudentId.set(student.studentId, student)
      }
    }
  }
  return [...byStudentId.values()]
}

async function buildSyncDeckSessionReportManifest(
  session: SyncDeckSession,
  sessions: SessionStore,
): Promise<SyncDeckSessionReportManifest> {
  const activities: SyncDeckSessionReportManifest['activities'] = []
  for (const [instanceKey, embeddedActivity] of Object.entries(session.data.embeddedActivities)) {
    const childSession = await sessions.get(embeddedActivity.childSessionId)
    if (!childSession || typeof childSession.type !== 'string') {
      continue
    }

    const builder = getActivityReportBuilder(childSession.type)
    if (!builder) {
      continue
    }

    const report = builder(childSession, { instanceKey })
    if (!report) {
      continue
    }

    const activityConfig = getActivityConfig(childSession.type)
    activities.push({
      activityId: embeddedActivity.activityId,
      activityName: typeof activityConfig?.title === 'string' && activityConfig.title.trim().length > 0
        ? activityConfig.title.trim()
        : typeof activityConfig?.name === 'string' && activityConfig.name.trim().length > 0
          ? activityConfig.name.trim()
          : embeddedActivity.activityId,
      childSessionId: embeddedActivity.childSessionId,
      instanceKey,
      startedAt: embeddedActivity.startedAt,
      report,
    })
  }

  return {
    parentSessionId: session.id,
    generatedAt: Date.now(),
    activities,
    students: mergeReportStudents(activities.map((entry) => entry.report)),
  }
}

function toSelectedOptions(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {}
}

function buildSyncDeckPersistentLinkUrlState(entryPolicy: unknown, presentationUrl: string): PersistentLinkUrlState {
  return {
    entryPolicy: resolvePersistentSessionEntryPolicy(entryPolicy),
    selectedOptions: {
      presentationUrl,
    },
  }
}

function parsePersistentSessionsCookie(cookieValue: unknown): CookieSessionEntry[] {
  if (cookieValue == null) {
    return []
  }

  let parsedCookie: unknown
  try {
    parsedCookie = typeof cookieValue === 'string' ? JSON.parse(cookieValue) : cookieValue
  } catch {
    return []
  }

  if (!Array.isArray(parsedCookie)) {
    return []
  }

  return parsedCookie
    .filter(
      (entry): entry is Record<string, unknown> =>
        isPlainObject(entry) && typeof entry.key === 'string' && typeof entry.teacherCode === 'string',
    )
    .map((entry) => ({
      key: String(entry.key),
      teacherCode: entry.teacherCode as string,
      selectedOptions: toSelectedOptions(entry.selectedOptions),
      entryPolicy: entry.entryPolicy,
      urlHash: entry.urlHash,
    }))
}

function validatePresentationUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0
  } catch {
    return false
  }
}

function normalizePersistentPresentationUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  if (validatePresentationUrl(trimmed)) {
    return trimmed
  }

  let current = trimmed
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const decoded = decodeURIComponent(current)
      if (decoded === current) {
        return null
      }
      if (validatePresentationUrl(decoded)) {
        return decoded
      }
      current = decoded
    } catch {
      // Ignore decode errors and fall through to null.
      return null
    }
  }

  return null
}

function verifyInstructorPasscode(expected: string, candidate: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'utf8')
  const candidateBuffer = Buffer.from(candidate, 'utf8')
  if (expectedBuffer.length !== candidateBuffer.length) {
    return false
  }

  try {
    return timingSafeEqual(expectedBuffer, candidateBuffer)
  } catch {
    return false
  }
}

function normalizeInstanceKey(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 200) {
    return null
  }

  return trimmed
}

function normalizeActivityId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 100 || trimmed === 'syncdeck') {
    return null
  }

  return trimmed
}

async function createEmbeddedChildSession(
  sessions: Pick<SessionStore, 'get' | 'set'>,
  parentSessionId: string,
  activityId: string,
  instanceKey: string,
  selectedOptions: Record<string, unknown>,
): Promise<SessionRecord> {
  const childId = await generateHexId(sessions)
  const sessionId = `${EMBEDDED_CHILD_SESSION_PREFIX}${parentSessionId}:${childId}:${activityId}`
  const now = Date.now()
  const session: SessionRecord = {
    id: sessionId,
    type: activityId,
    created: now,
    lastActivity: now,
    data: {
      embeddedParentSessionId: parentSessionId,
      embeddedInstanceKey: instanceKey,
      embeddedLaunch: {
        parentSessionId,
        instanceKey,
        selectedOptions,
      } satisfies SyncDeckEmbeddedLaunchPayload,
    },
  }
  await sessions.set(sessionId, normalizeSessionRecord(session))
  return session
}

async function getSyncDeckSessionWithEmbeddedKeepalive(
  sessions: Pick<SessionStore, 'get' | 'touch'>,
  sessionId: string,
): Promise<SyncDeckSession | null> {
  const session = asSyncDeckSession(await sessions.get(sessionId))
  if (!session) {
    return null
  }

  const childSessionIds = new Set<string>()
  for (const embeddedActivity of Object.values(session.data.embeddedActivities)) {
    if (typeof embeddedActivity.childSessionId === 'string' && embeddedActivity.childSessionId.length > 0) {
      childSessionIds.add(embeddedActivity.childSessionId)
    }
  }

  if (childSessionIds.size === 0 || !shouldRefreshEmbeddedChildKeepalive(sessions, sessionId)) {
    return session
  }

  await Promise.allSettled([...childSessionIds].map(async (childSessionId) => {
    await sessions.touch(childSessionId)
  }))

  return session
}

function markEmbeddedChildSessionForAutoActivateAllQuestions(
  childSession: SessionRecord,
): boolean {
  if (childSession.type !== 'resonance' || !isPlainObject(childSession.data)) {
    return false
  }

  const activeQuestionIds = Array.isArray(childSession.data.activeQuestionIds)
    ? childSession.data.activeQuestionIds.filter((questionId): questionId is string => typeof questionId === 'string')
    : []
  const hasActiveQuestionRun =
    typeof childSession.data.activeQuestionRunStartedAt === 'number'
    && Number.isFinite(childSession.data.activeQuestionRunStartedAt)
  const hasEmbeddedAutoActivated =
    typeof childSession.data.embeddedAutoActivatedAt === 'number'
    && Number.isFinite(childSession.data.embeddedAutoActivatedAt)
  if (activeQuestionIds.length > 0 || hasActiveQuestionRun || hasEmbeddedAutoActivated) {
    return false
  }

  const embeddedLaunch = isPlainObject(childSession.data.embeddedLaunch) ? childSession.data.embeddedLaunch : null
  const selectedOptions = isPlainObject(embeddedLaunch?.selectedOptions) ? embeddedLaunch.selectedOptions : null
  if (!embeddedLaunch || !selectedOptions || selectedOptions.autoActivateAllQuestions === true) {
    return false
  }

  embeddedLaunch.selectedOptions = {
    ...selectedOptions,
    autoActivateAllQuestions: true,
  }
  childSession.data.embeddedLaunch = embeddedLaunch
  return true
}

function notifyResonanceAutoActivatedQuestions(
  ws: WsRouter,
  childSession: SessionRecord,
): void {
  if (childSession.type !== 'resonance' || !isPlainObject(childSession.data)) {
    return
  }

  const activeQuestionIds = Array.isArray(childSession.data.activeQuestionIds)
    ? childSession.data.activeQuestionIds.filter((questionId): questionId is string => typeof questionId === 'string')
    : []
  if (activeQuestionIds.length === 0) {
    return
  }

  const deadlineAt =
    typeof childSession.data.activeQuestionDeadlineAt === 'number'
    && Number.isFinite(childSession.data.activeQuestionDeadlineAt)
      ? childSession.data.activeQuestionDeadlineAt
      : null
  const clients = ws.wss.clients ?? new Set<ActiveBitsWebSocket>()
  for (const socket of clients as Set<ActiveBitsWebSocket>) {
    if (socket.readyState !== 1 || socket.sessionId !== childSession.id) {
      continue
    }

    try {
      socket.send(
        JSON.stringify({
          version: '1',
          activity: 'resonance',
          sessionId: childSession.id,
          type: 'resonance:question-activated',
          timestamp: Date.now(),
          payload: {
            questionId: activeQuestionIds[0] ?? null,
            questionIds: activeQuestionIds,
            deadlineAt,
          },
        }),
      )
    } catch (error) {
      console.error('[syncdeck] Failed to notify embedded Resonance auto-activation', {
        childSessionId: childSession.id,
        error,
      })
    }
  }
}

function canStudentAutoActivateEmbeddedInstance(params: {
  instanceKey: string
  session: SyncDeckSession
}): boolean {
  const instancePosition = parseEmbeddedInstancePosition(params.instanceKey)
  if (!instancePosition) {
    return false
  }

  const instructorIndices = extractIndicesFromInstructorPayload(params.session.data.lastInstructorStatePayload)
  if (!instructorIndices) {
    return false
  }

  if (instancePosition.v > 0) {
    return instancePosition.h <= instructorIndices.h
  }

  return instancePosition.h < instructorIndices.h
}

function buildEmbeddedActivityStartPayload(
  instanceKey: string,
  activityId: string,
  childSessionId: string,
  entryParticipantToken: string | null,
): Record<string, unknown> {
  return {
    type: 'embedded-activity-start',
    instanceKey,
    activityId,
    childSessionId,
    entryParticipantToken,
  }
}

function buildEmbeddedActivityEndPayload(instanceKey: string, childSessionId: string): Record<string, unknown> {
  return {
    type: 'embedded-activity-end',
    instanceKey,
    childSessionId,
  }
}

registerSessionNormalizer('syncdeck', (session) => {
  session.data = normalizeSessionData(session.data)
})

export default function setupSyncDeckRoutes(app: SyncDeckRouteApp, sessions: SessionStore, ws: WsRouter): void {
  const embeddedActivityStartLocks = new Map<string, Promise<void>>()

  const withEmbeddedActivityStartLock = async <T,>(lockKey: string, work: () => Promise<T>): Promise<T> => {
    const previous = embeddedActivityStartLocks.get(lockKey) ?? Promise.resolve()
    let releaseCurrent!: () => void
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve
    })
    const queued = previous.then(() => current, () => current)
    embeddedActivityStartLocks.set(lockKey, queued)

    await previous

    try {
      return await work()
    } finally {
      releaseCurrent()
      if (embeddedActivityStartLocks.get(lockKey) === queued) {
        embeddedActivityStartLocks.delete(lockKey)
      }
    }
  }

  const broadcastStudentsToInstructors = async (sessionId: string): Promise<void> => {
    const session = await getSyncDeckSessionWithEmbeddedKeepalive(sessions, sessionId)
    if (!session) {
      return
    }

    const connectedStudentIds = new Set<string>()
    for (const peer of ws.wss.clients as Set<SyncDeckSocket>) {
      if (
        peer.readyState === WS_OPEN_READY_STATE &&
        peer.sessionId === session.id &&
        !peer.isInstructor &&
        typeof peer.studentId === 'string'
      ) {
        connectedStudentIds.add(peer.studentId)
      }
    }

    const payload = {
      students: session.data.students.map((student) => ({
        studentId: student.studentId,
        name: student.name,
        joinedAt: student.joinedAt,
        lastSeenAt: student.lastSeenAt,
        connected: connectedStudentIds.has(student.studentId),
      })),
      connectedCount: connectedStudentIds.size,
    }

    const serialized = JSON.stringify({
      type: SYNCDECK_WS_STUDENTS_TYPE,
      payload,
    })

    for (const peer of ws.wss.clients as Set<SyncDeckSocket>) {
      if (peer.readyState !== WS_OPEN_READY_STATE || peer.sessionId !== session.id || !peer.isInstructor) {
        continue
      }
      try {
        peer.send(serialized)
      } catch {
        // Ignore socket send failures.
      }
    }
  }

  const broadcastEmbeddedActivityEnd = (session: SyncDeckSession, instanceKey: string, childSessionId: string): void => {
    const payload = buildEmbeddedActivityEndPayload(instanceKey, childSessionId)
    for (const peer of ws.wss.clients as Set<SyncDeckSocket>) {
      if (peer.readyState !== WS_OPEN_READY_STATE || peer.sessionId !== session.id) {
        continue
      }
      sendSyncDeckState(peer, payload)
    }
  }

  const broadcastEmbeddedActivityStart = async (
    session: SyncDeckSession,
    instanceKey: string,
    activityId: string,
    childSessionId: string,
  ): Promise<void> => {
    const childSession = await sessions.get(childSessionId)
    if (!childSession) {
      return
    }

    const connectedStudents = new Map<string, SyncDeckStudent>()
    for (const peer of ws.wss.clients as Set<SyncDeckSocket>) {
      if (
        peer.readyState !== WS_OPEN_READY_STATE ||
        peer.sessionId !== session.id ||
        peer.isInstructor !== false ||
        typeof peer.studentId !== 'string'
      ) {
        continue
      }
      const student = findSyncDeckStudentById(session.data.students, peer.studentId)
      if (student) {
        connectedStudents.set(student.studentId, student)
      }
    }

    const tokensByStudentId = new Map<string, string>()
    for (const student of connectedStudents.values()) {
      const stored = storeSessionEntryParticipant(childSession, {
        participantId: student.studentId,
        displayName: student.name,
      })
      tokensByStudentId.set(student.studentId, stored.token)
    }
    await sessions.set(childSession.id, childSession)

    for (const peer of ws.wss.clients as Set<SyncDeckSocket>) {
      if (peer.readyState !== WS_OPEN_READY_STATE || peer.sessionId !== session.id) {
        continue
      }

      const entryParticipantToken = peer.isInstructor
        ? null
        : typeof peer.studentId === 'string'
          ? tokensByStudentId.get(peer.studentId) ?? null
          : null
      sendSyncDeckState(peer, buildEmbeddedActivityStartPayload(instanceKey, activityId, childSessionId, entryParticipantToken))
    }
  }

  app.get('/api/syncdeck/:sessionId/instructor-passcode', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = await getSyncDeckSessionWithEmbeddedKeepalive(sessions, sessionId)
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const persistentHash = await findHashBySessionId(sessionId)
    if (!persistentHash) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const sessionEntries = parsePersistentSessionsCookie(req.cookies?.persistent_sessions)
    const matchingEntry = sessionEntries.find((entry) => entry.key === `syncdeck:${persistentHash}`)
    if (!matchingEntry) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const verifiedTeacherCode = verifyTeacherCodeWithHash('syncdeck', persistentHash, matchingEntry.teacherCode)
    if (!verifiedTeacherCode.valid) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const selectedOptions = isPlainObject(matchingEntry.selectedOptions) ? matchingEntry.selectedOptions : {}
    const persistentPresentationUrl = normalizePersistentPresentationUrl(selectedOptions.presentationUrl)
    const persistentEntryPolicy = resolvePersistentSessionEntryPolicy(matchingEntry.entryPolicy)
    const candidateUrlHash =
      typeof matchingEntry.urlHash === 'string' && matchingEntry.urlHash.trim().length > 0
        ? matchingEntry.urlHash.trim()
        : null
    const persistentUrlHash =
      candidateUrlHash
        && persistentPresentationUrl
        && verifyPersistentLinkUrlHash(
          persistentHash,
          buildSyncDeckPersistentLinkUrlState(persistentEntryPolicy, persistentPresentationUrl),
          candidateUrlHash,
        )
        ? candidateUrlHash
        : null

    res.json({
      instructorPasscode: session.data.instructorPasscode,
      persistentEntryPolicy,
      ...(persistentPresentationUrl ? { persistentPresentationUrl } : {}),
      ...(persistentUrlHash ? { persistentUrlHash } : {}),
    })
  })

  app.post('/api/syncdeck/generate-url', async (req, res) => {
    const body = isPlainObject(req.body) ? req.body : {}
    const activityName = readStringField(body, 'activityName')
    const teacherCode = readStringField(body, 'teacherCode')
    const selectedOptions = toSelectedOptions(body.selectedOptions)
    const presentationUrl = typeof selectedOptions.presentationUrl === 'string' ? selectedOptions.presentationUrl : null

    if (activityName !== 'syncdeck' || !teacherCode) {
      res.status(400).json({ error: 'Missing or invalid activityName or teacherCode' })
      return
    }

    if (teacherCode.length < 6) {
      res.status(400).json({ error: 'Teacher code must be at least 6 characters' })
      return
    }

    if (teacherCode.length > MAX_TEACHER_CODE_LENGTH) {
      res.status(400).json({ error: `Teacher code must be at most ${MAX_TEACHER_CODE_LENGTH} characters` })
      return
    }

    if (!presentationUrl || !validatePresentationUrl(presentationUrl)) {
      res.status(400).json({ error: 'presentationUrl must be a valid http(s) URL' })
      return
    }

    const { hash } = generatePersistentHash('syncdeck', teacherCode)
    const urlState = buildSyncDeckPersistentLinkUrlState(DEFAULT_SYNCDECK_ENTRY_POLICY, presentationUrl)
    const urlHash = computePersistentLinkUrlHash(hash, urlState)

    const cookieName = 'persistent_sessions'
    let sessionEntries = parsePersistentSessionsCookie(req.cookies?.[cookieName])
    const cookieKey = `syncdeck:${hash}`
    const existingIndex = sessionEntries.findIndex((entry) => entry.key === cookieKey)
    if (existingIndex !== -1) {
      sessionEntries.splice(existingIndex, 1)
    }

    sessionEntries.push({
      key: cookieKey,
      teacherCode,
      selectedOptions: {
        presentationUrl,
      },
      entryPolicy: DEFAULT_SYNCDECK_ENTRY_POLICY,
      urlHash,
    })

    if (sessionEntries.length > MAX_SESSIONS_PER_COOKIE) {
      sessionEntries = sessionEntries.slice(-MAX_SESSIONS_PER_COOKIE)
    }

    res.cookie?.(cookieName, JSON.stringify(sessionEntries), {
      maxAge: ONE_YEAR_MS,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
    })

    const params = new URLSearchParams({
      presentationUrl,
      entryPolicy: DEFAULT_SYNCDECK_ENTRY_POLICY,
      urlHash,
    })

    res.json({
      hash,
      url: `/activity/syncdeck/${hash}?${params.toString()}`,
    })
  })

  app.post('/api/syncdeck/create', async (_req, res) => {
    const session = await createSession(sessions, { data: {} })
    session.type = 'syncdeck'
    session.data = normalizeSessionData(session.data)
    await sessions.set(session.id, session)

    const response = res as unknown as JsonResponse
    response.json({ id: session.id, instructorPasscode: session.data.instructorPasscode })
  })

  app.post('/api/syncdeck/:sessionId/embedded-context', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      const response = res as unknown as JsonResponse
      response.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = await getSyncDeckSessionWithEmbeddedKeepalive(sessions, sessionId)
    if (!session) {
      const response = res as unknown as JsonResponse
      response.status(404).json({ error: 'invalid session' })
      return
    }

    const instructorPasscode = normalizeInstructorPasscode(readStringField(req.body, 'instructorPasscode'))
    if (instructorPasscode && verifyInstructorPasscode(session.data.instructorPasscode, instructorPasscode)) {
      const response = res as unknown as JsonResponse
      const payload: SyncDeckEmbeddedEntryContextResponse = { resolvedRole: 'teacher' }
      response.json(payload)
      return
    }

    const studentId = normalizeStudentId(readStringField(req.body, 'studentId'))
    const student = findSyncDeckStudentById(session.data.students, studentId)
    if (student) {
      const response = res as unknown as JsonResponse
      const payload: SyncDeckEmbeddedEntryContextResponse = {
        resolvedRole: 'student',
        studentId: student.studentId,
        studentName: student.name,
      }
      response.json(payload)
      return
    }

    const response = res as unknown as JsonResponse
    response.status(403).json({ error: 'forbidden' })
  })

  app.post('/api/syncdeck/:sessionId/embedded-activity/start', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = await getSyncDeckSessionWithEmbeddedKeepalive(sessions, sessionId)
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const instructorPasscode = normalizeInstructorPasscode(readStringField(req.body, 'instructorPasscode'))
    const activityId = normalizeActivityId(readStringField(req.body, 'activityId'))
    const instanceKey = normalizeInstanceKey(readStringField(req.body, 'instanceKey'))
    const activityOptions = sanitizeEmbeddedLaunchSelectedOptions(readObjectField(req.body, 'activityOptions'))
    if (!instructorPasscode || !verifyInstructorPasscode(session.data.instructorPasscode, instructorPasscode)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
    if (!activityId || !instanceKey) {
      res.status(400).json({ error: 'invalid payload' })
      return
    }

    let embeddedActivityConfig = getActivityConfig(activityId)
    if (!embeddedActivityConfig) {
      await initializeActivityRegistry()
      embeddedActivityConfig = getActivityConfig(activityId)
    }
    if (!embeddedActivityConfig) {
      res.status(404).json({ error: 'invalid embedded activity' })
      return
    }

    const responsePayload = await withEmbeddedActivityStartLock(
      buildEmbeddedActivityStartLockKey(sessionId, instanceKey),
      async (): Promise<{ statusCode: number; body: { error: string } | EmbeddedActivityStartResponsePayload }> => {
        const lockedSession = asSyncDeckSession(await sessions.get(sessionId))
        if (!lockedSession) {
          return { statusCode: 404, body: { error: 'invalid session' } }
        }

        if (!verifyInstructorPasscode(lockedSession.data.instructorPasscode, instructorPasscode)) {
          return { statusCode: 403, body: { error: 'forbidden' } }
        }

        const existing = lockedSession.data.embeddedActivities[instanceKey]
        if (existing) {
          if (existing.activityId !== activityId) {
            return {
              statusCode: 409,
              body: { error: 'embedded activity instance key already belongs to a different activity' },
            }
          }

          const existingChildSession = await sessions.get(existing.childSessionId)
          if (existingChildSession) {
            const managerBootstrap = buildEmbeddedManagerBootstrapPayload(existingChildSession)
            return {
              statusCode: 200,
              body: {
                childSessionId: existing.childSessionId,
                instanceKey,
                ...(managerBootstrap ? { managerBootstrap } : {}),
              },
            }
          }

          delete lockedSession.data.embeddedActivities[instanceKey]
        }

        const childSession = await createEmbeddedChildSession(sessions, lockedSession.id, activityId, instanceKey, activityOptions)
        lockedSession.data.embeddedActivities[instanceKey] = {
          childSessionId: childSession.id,
          activityId,
          startedAt: Date.now(),
          owner: SYNCDECK_EMBEDDED_OWNER,
        }
        await sessions.set(lockedSession.id, lockedSession)
        await broadcastEmbeddedActivityStart(lockedSession, instanceKey, activityId, childSession.id)

        const normalizedChildSession = await sessions.get(childSession.id)
        const managerBootstrap = normalizedChildSession
          ? buildEmbeddedManagerBootstrapPayload(normalizedChildSession)
          : null
        return {
          statusCode: 200,
          body: {
            childSessionId: childSession.id,
            instanceKey,
            ...(managerBootstrap ? { managerBootstrap } : {}),
          },
        }
      },
    )

    res.status(responsePayload.statusCode).json(responsePayload.body)
  })

  app.post('/api/syncdeck/:sessionId/embedded-activity/end', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = await getSyncDeckSessionWithEmbeddedKeepalive(sessions, sessionId)
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const instructorPasscode = normalizeInstructorPasscode(readStringField(req.body, 'instructorPasscode'))
    const instanceKey = normalizeInstanceKey(readStringField(req.body, 'instanceKey'))
    if (!instructorPasscode || !verifyInstructorPasscode(session.data.instructorPasscode, instructorPasscode)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
    if (!instanceKey) {
      res.status(400).json({ error: 'invalid payload' })
      return
    }

    const existing = session.data.embeddedActivities[instanceKey]
    if (!existing) {
      res.status(404).json({ error: 'embedded activity not found' })
      return
    }

    delete session.data.embeddedActivities[instanceKey]
    await sessions.set(session.id, session)
    await sessions.delete(existing.childSessionId)
    broadcastEmbeddedActivityEnd(session, instanceKey, existing.childSessionId)

    res.json({ ok: true, instanceKey, childSessionId: existing.childSessionId })
  })

  app.get('/api/syncdeck/:sessionId/embedded-activity/report/:instanceKey', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = await getSyncDeckSessionWithEmbeddedKeepalive(sessions, sessionId)
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const instructorPasscode = normalizeInstructorPasscode(readHeaderField(req.headers, 'x-syncdeck-instructor-passcode'))
    const instanceKey = normalizeInstanceKey(req.params.instanceKey)
    if (!instructorPasscode || !verifyInstructorPasscode(session.data.instructorPasscode, instructorPasscode)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
    if (!instanceKey) {
      res.status(400).json({ error: 'invalid payload' })
      return
    }

    const embeddedActivity = session.data.embeddedActivities[instanceKey]
    if (!embeddedActivity) {
      res.status(404).json({ error: 'embedded activity not found' })
      return
    }

    const childSession = await sessions.get(embeddedActivity.childSessionId)
    if (!childSession) {
      res.status(404).json({ error: 'invalid child session' })
      return
    }

    const activityConfig = getActivityConfig(childSession.type ?? '')
    const reportEndpoint = typeof activityConfig?.reportEndpoint === 'string' ? activityConfig.reportEndpoint.trim() : ''
    if (reportEndpoint.length === 0) {
      res.status(404).json({ error: 'embedded activity report unavailable' })
      return
    }

    const location = buildEmbeddedActivityReportPath(reportEndpoint, childSession.id)
    res.setHeader?.('Location', location)
    res.status(302).json({ location })
  })

  app.get('/api/syncdeck/:sessionId/report-manifest', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = await getSyncDeckSessionWithEmbeddedKeepalive(sessions, sessionId)
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const instructorPasscode = normalizeInstructorPasscode(readHeaderField(req.headers, 'x-syncdeck-instructor-passcode'))
    if (!instructorPasscode || !verifyInstructorPasscode(session.data.instructorPasscode, instructorPasscode)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const manifest = await buildSyncDeckSessionReportManifest(session, sessions)
    res.json(manifest)
  })

  app.get('/api/syncdeck/:sessionId/report', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = await getSyncDeckSessionWithEmbeddedKeepalive(sessions, sessionId)
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const instructorPasscode = normalizeInstructorPasscode(readHeaderField(req.headers, 'x-syncdeck-instructor-passcode'))
    if (!instructorPasscode || !verifyInstructorPasscode(session.data.instructorPasscode, instructorPasscode)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const manifest = await buildSyncDeckSessionReportManifest(session, sessions)
    const html = buildSyncDeckSessionReportHtml(manifest)
    const filename = buildSyncDeckReportFilename(manifest)
    res.setHeader?.('Content-Type', 'text/html; charset=utf-8')
    res.setHeader?.('Content-Disposition', `attachment; filename="${filename}"`)
    if (typeof res.send === 'function') {
      res.send(html)
      return
    }

    res.json(html)
  })

  app.delete('/api/syncdeck/:sessionId', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = await getSyncDeckSessionWithEmbeddedKeepalive(sessions, sessionId)
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const instructorPasscode = normalizeInstructorPasscode(readStringField(req.body, 'instructorPasscode'))
    if (!instructorPasscode || !verifyInstructorPasscode(session.data.instructorPasscode, instructorPasscode)) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    // Delete all embedded child sessions before removing the parent.
    const childSessionIds = Object.values(session.data.embeddedActivities).map((record) => record.childSessionId)
    await Promise.all(childSessionIds.map((childSessionId) => sessions.delete(childSessionId)))

    // Notify connected clients that the parent session has ended.
    if (sessions.publishBroadcast) {
      await sessions.publishBroadcast('session-ended', { sessionId })
    } else {
      for (const peer of ws.wss.clients as Set<SyncDeckSocket>) {
        if (peer.readyState === WS_OPEN_READY_STATE && peer.sessionId === sessionId) {
          try {
            peer.send(JSON.stringify({ type: 'session-ended' }))
          } catch {
            // Socket may have closed concurrently; swallow send failures.
          }
        }
      }
    }

    await sessions.delete(sessionId)
    res.json({ success: true, deleted: sessionId })
  })

  app.post('/api/syncdeck/:sessionId/embedded-activity/entry', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = await getSyncDeckSessionWithEmbeddedKeepalive(sessions, sessionId)
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const instanceKey = normalizeInstanceKey(readStringField(req.body, 'instanceKey'))
    const requestedChildSessionId = normalizeInstanceKey(readStringField(req.body, 'childSessionId'))
    if (!instanceKey) {
      res.status(400).json({ error: 'invalid payload' })
      return
    }

    const embeddedActivity = session.data.embeddedActivities[instanceKey]
    if (!embeddedActivity) {
      res.status(404).json({ error: 'embedded activity not found' })
      return
    }
    if (requestedChildSessionId && requestedChildSessionId !== embeddedActivity.childSessionId) {
      res.status(404).json({ error: 'embedded activity not found' })
      return
    }

    const studentId = normalizeStudentId(readStringField(req.body, 'studentId'))
    const student = findSyncDeckStudentById(session.data.students, studentId)
    if (!student) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const childSession = await sessions.get(embeddedActivity.childSessionId)
    if (!childSession) {
      res.status(404).json({ error: 'invalid child session' })
      return
    }

    const stored = storeSessionEntryParticipant(childSession, {
      participantId: student.studentId,
      displayName: student.name,
    })
    await sessions.set(childSession.id, childSession)

    res.json({
      resolvedRole: 'student',
      instanceKey,
      childSessionId: childSession.id,
      entryParticipantToken: stored.token,
      values: stored.values,
    })
  })

  app.post('/api/syncdeck/:sessionId/embedded-activity/auto-activate', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      res.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = await getSyncDeckSessionWithEmbeddedKeepalive(sessions, sessionId)
    if (!session) {
      res.status(404).json({ error: 'invalid session' })
      return
    }

    const instanceKey = normalizeInstanceKey(readStringField(req.body, 'instanceKey'))
    const requestedChildSessionId = normalizeInstanceKey(readStringField(req.body, 'childSessionId'))
    const studentId = normalizeStudentId(readStringField(req.body, 'studentId'))
    const autoActivateAllQuestions = readBooleanField(req.body, 'autoActivateAllQuestions') === true
    if (!instanceKey || !studentId || !autoActivateAllQuestions) {
      res.status(400).json({ error: 'invalid payload' })
      return
    }

    const embeddedActivity = session.data.embeddedActivities[instanceKey]
    if (!embeddedActivity) {
      res.status(404).json({ error: 'embedded activity not found' })
      return
    }
    if (requestedChildSessionId && requestedChildSessionId !== embeddedActivity.childSessionId) {
      res.status(404).json({ error: 'embedded activity not found' })
      return
    }

    const student = findSyncDeckStudentById(session.data.students, studentId)
    if (!student) {
      res.status(403).json({ error: 'forbidden' })
      return
    }
    if (!canStudentAutoActivateEmbeddedInstance({ instanceKey, session })) {
      res.status(403).json({ error: 'forbidden' })
      return
    }

    const childSession = await sessions.get(embeddedActivity.childSessionId)
    if (!childSession) {
      res.status(404).json({ error: 'invalid child session' })
      return
    }

    const activated = markEmbeddedChildSessionForAutoActivateAllQuestions(childSession)
    if (activated) {
      const normalizedChildSession = normalizeSessionRecord(childSession)
      await sessions.set(normalizedChildSession.id, normalizedChildSession)
      notifyResonanceAutoActivatedQuestions(ws, normalizedChildSession)
    }

    res.json({
      ok: true,
      instanceKey,
      childSessionId: childSession.id,
      studentId: student.studentId,
      activated,
    })
  })

  app.post('/api/syncdeck/:sessionId/configure', async (req, res) => {
    const sessionId = req.params.sessionId
    if (!sessionId) {
      const response = res as unknown as JsonResponse
      response.status(400).json({ error: 'missing sessionId' })
      return
    }

    const session = await getSyncDeckSessionWithEmbeddedKeepalive(sessions, sessionId)
    if (!session) {
      const response = res as unknown as JsonResponse
      response.status(404).json({ error: 'invalid session' })
      return
    }

    const presentationUrl = readStringField(req.body, 'presentationUrl')
    const entryPolicy = resolvePersistentSessionEntryPolicy(readStringField(req.body, 'entryPolicy'))
    const instructorPasscode = readStringField(req.body, 'instructorPasscode')
    const urlHash = readStringField(req.body, 'urlHash')
    const persistentHashFromClient = readStringField(req.body, 'persistentHash')
    const standaloneMode = readBooleanField(req.body, 'standaloneMode') === true
    if (
      !presentationUrl ||
      !validatePresentationUrl(presentationUrl) ||
      !instructorPasscode ||
      !verifyInstructorPasscode(session.data.instructorPasscode, instructorPasscode)
    ) {
      const response = res as unknown as JsonResponse
      response.status(400).json({ error: 'invalid payload' })
      return
    }

    if (persistentHashFromClient) {
      const response = res as unknown as JsonResponse
      response.status(400).json({ error: 'persistentHash must not be provided by client' })
      return
    }

    if (urlHash) {
      const persistentHash = await findHashBySessionId(sessionId)
      if (!persistentHash) {
        const response = res as unknown as JsonResponse
        response.status(400).json({ error: 'invalid payload' })
        return
      }

      if (!verifyPersistentLinkUrlHash(
        persistentHash,
        buildSyncDeckPersistentLinkUrlState(entryPolicy, presentationUrl),
        urlHash,
      )) {
        const response = res as unknown as JsonResponse
        response.status(400).json({ error: 'invalid payload' })
        return
      }
    }

    session.data.presentationUrl = presentationUrl
    session.data.standaloneMode = standaloneMode
    await sessions.set(session.id, session)

    const response = res as unknown as JsonResponse
    response.json({ ok: true })
  })

  ws.register('/ws/syncdeck', (socket, query) => {
    const client = socket as SyncDeckSocket
    client.sessionId = query.get('sessionId')
    client.isInstructor = false
    client.studentId = normalizeStudentId(query.get('studentId'))

    const sessionId = client.sessionId
    if (!sessionId) {
      socket.close(1008, 'missing sessionId')
      return
    }

    const role = query.get('role')
    const instructorAuthMessagePromise = role === 'instructor'
      ? waitForInstructorAuthMessage(socket)
      : null

    ;(async () => {
      const session = await getSyncDeckSessionWithEmbeddedKeepalive(sessions, sessionId)
      if (!session) {
        socket.close(1008, 'invalid session')
        return
      }

      if (role === 'instructor') {
        const rawAuthMessage = await instructorAuthMessagePromise
        if (socket.readyState !== WS_OPEN_READY_STATE) {
          return
        }
        const authMessage = parseInstructorAuthMessage(rawAuthMessage)
        if (!authMessage || !verifyInstructorPasscode(session.data.instructorPasscode, authMessage.instructorPasscode)) {
          socket.close(1008, 'forbidden')
          return
        }
        client.isInstructor = true
        if (session.data.lastInstructorStatePayload != null) {
          if (!parseChalkboardCommand(session.data.lastInstructorStatePayload)) {
            sendSyncDeckState(socket, session.data.lastInstructorStatePayload)
          }
        }
        if (session.data.lastInstructorPayload != null) {
          if (
            session.data.lastInstructorPayload !== session.data.lastInstructorStatePayload &&
            !parseChalkboardCommand(session.data.lastInstructorPayload)
          ) {
            sendSyncDeckState(socket, session.data.lastInstructorPayload)
          }
        }
        sendSyncDeckState(socket, buildDrawingToolModePayload(session.data.drawingToolMode))
        sendBufferedChalkboardState(socket, session.data.chalkboard)
        await broadcastStudentsToInstructors(session.id)
        return
      }

      if (!client.studentId) {
        socket.close(1008, 'missing studentId')
        return
      }

      const connectedStudent = connectSyncDeckStudent(
        session,
        client.studentId,
      )
      if (!connectedStudent) {
        socket.close(1008, 'unregistered student')
        return
      }

      client.studentId = connectedStudent.participantId
      await sessions.set(session.id, session)
      closeDuplicateParticipantSockets(ws.wss.clients as Set<SyncDeckSocket>, client)

      if (session.data.lastInstructorPayload != null) {
        if (session.data.lastInstructorStatePayload != null && !parseChalkboardCommand(session.data.lastInstructorStatePayload)) {
          sendSyncDeckState(socket, session.data.lastInstructorStatePayload)
        }
        if (
          session.data.lastInstructorPayload !== session.data.lastInstructorStatePayload &&
          !parseChalkboardCommand(session.data.lastInstructorPayload)
        ) {
          sendSyncDeckState(socket, session.data.lastInstructorPayload)
        }
      }

      sendSyncDeckState(socket, buildDrawingToolModePayload(session.data.drawingToolMode))
      sendBufferedChalkboardState(socket, session.data.chalkboard)

      await broadcastStudentsToInstructors(session.id)
    })().catch(() => {
      socket.close(1011, 'syncdeck initialization failed')
    })

    socket.on('message', (raw: unknown) => {
      void (async () => {
        if (!client.isInstructor || !client.sessionId) {
          return
        }

        const message = parseWsMessage(raw)
        if (!message || message.type !== SYNCDECK_WS_UPDATE_TYPE) {
          logSyncDeckProtocolEvent('info', 'ignore_instructor_ws_message', {
            sessionId: client.sessionId,
            reason: !message ? 'parse-failed' : 'unsupported-message-type',
            messageType: message?.type ?? null,
          })
          return
        }

        if (isPlainObject(message.payload) && message.payload.type === 'reveal-sync') {
          const compatibility = assessRevealSyncProtocolCompatibility(message.payload.version)
          if (!compatibility.compatible) {
            logSyncDeckProtocolEvent('warn', 'warn_instructor_ws_payload_incompatible_protocol', {
              sessionId: client.sessionId,
              expectedVersion: compatibility.expectedVersion,
              receivedVersion: compatibility.receivedVersion,
              reason: compatibility.reason,
              action: message.payload.action ?? null,
            })
          }
        }

        const session = await getSyncDeckSessionWithEmbeddedKeepalive(sessions, client.sessionId)
        if (!session) {
          logSyncDeckProtocolEvent('info', 'ignore_instructor_ws_message_missing_session', {
            sessionId: client.sessionId,
          })
          return
        }

        session.data.lastInstructorPayload = message.payload ?? null
        if (extractIndicesFromInstructorPayload(message.payload) != null) {
          session.data.lastInstructorStatePayload = message.payload
        }
        applyChalkboardBufferUpdate(session.data, message.payload)
        const drawingToolModeUpdate = parseDrawingToolModeUpdate(message.payload)
        if (drawingToolModeUpdate) {
          session.data.drawingToolMode = drawingToolModeUpdate
        }
        await sessions.set(session.id, session)
        logSyncDeckProtocolEvent('info', 'apply_instructor_ws_payload', {
          sessionId: session.id,
          payloadType: isPlainObject(message.payload) ? (message.payload.type ?? null) : null,
          payloadAction: isPlainObject(message.payload) ? (message.payload.action ?? null) : null,
        })

        for (const peer of ws.wss.clients as Set<SyncDeckSocket>) {
          if (peer.sessionId !== session.id || peer === client) {
            continue
          }
          sendSyncDeckState(peer, message.payload ?? null)
        }
      })().catch(() => {
        return
      })
    })

    socket.on('close', () => {
      if (!client.sessionId) {
        return
      }

      void broadcastStudentsToInstructors(client.sessionId)
    })
  })
}
