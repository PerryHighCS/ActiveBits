import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import { createBroadcastSubscriptionHelper } from 'activebits-server/core/broadcastUtils.js'
import { findHashBySessionId, verifyTeacherCodeWithHash } from 'activebits-server/core/persistentSessions.js'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'

type VideoSyncRole = 'instructor' | 'student'
type VideoSyncCommandType = 'play' | 'pause' | 'seek'
type VideoSyncEventType = 'autoplay-blocked' | 'unsync' | 'sync-correction' | 'load-failure'

interface VideoSyncState {
  provider: 'youtube'
  videoId: string
  startSec: number
  stopSec: number | null
  positionSec: number
  isPlaying: boolean
  playbackRate: 1
  updatedBy: 'instructor' | 'system'
  serverTimestampMs: number
}

interface VideoSyncTelemetry {
  connections: {
    activeCount: number
  }
  autoplay: {
    blockedCount: number
  }
  sync: {
    unsyncedStudents: number
    lastDriftSec: number | null
    lastCorrectionResult: 'none' | 'attempted' | 'success' | 'failed'
  }
  error: {
    code: string | null
    message: string | null
  }
}

interface VideoSyncSessionData extends Record<string, unknown> {
  instructorPasscode: string
  state: VideoSyncState
  telemetry: VideoSyncTelemetry
}

interface PublicVideoSyncSessionData {
  state: VideoSyncState
  telemetry: VideoSyncTelemetry
}

interface VideoSyncSession extends SessionRecord {
  type?: string
  data: VideoSyncSessionData
}

interface VideoSyncSessionStore extends Pick<SessionStore, 'get' | 'set'> {
  publishBroadcast?: (channel: string, message: Record<string, unknown>) => Promise<void>
  subscribeToBroadcast?: (channel: string, handler: (message: unknown) => void) => void
  valkeyStore?: {
    client: {
      eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>
    }
  }
}

interface RouteRequest {
  params: Record<string, string | undefined>
  body?: unknown
  cookies?: Record<string, unknown>
}

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): void
}

interface VideoSyncRouteApp {
  post(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
  get(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
  patch(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
}

interface VideoSyncWsMessageEnvelope<TPayload = unknown> {
  version: '1'
  activity: 'video-sync'
  sessionId: string
  type: 'state-snapshot' | 'state-update' | 'heartbeat' | 'telemetry-update' | 'error'
  timestamp: number
  payload: TPayload
}

interface VideoSyncSocket extends ActiveBitsWebSocket {
  sessionId?: string | null
  videoSyncRole?: VideoSyncRole
}

interface VideoSyncInstructorAuthMessage {
  type: 'authenticate'
  instructorPasscode: string
}

interface CommandBody {
  instructorPasscode?: unknown
  type?: unknown
  positionSec?: unknown
}

interface ConfigBody {
  instructorPasscode?: unknown
  sourceUrl?: unknown
  stopSec?: unknown
}

interface EventBody {
  type?: unknown
  studentId?: unknown
  driftSec?: unknown
  correctionResult?: unknown
  errorCode?: unknown
  errorMessage?: unknown
}

interface ParsedVideoSource {
  videoId: string
  startSec: number
  stopSec: number | null
}

type ParsedVideoSourceResult =
  | { ok: true; source: ParsedVideoSource }
  | { ok: false; reason: 'invalid-url' | 'invalid-video-id' | 'invalid-time-range' }

const HEARTBEAT_INTERVAL_MS = 3000
const UNSYNC_STALE_MS = 20_000
const MAX_UNSYNCED_STUDENTS_PER_SESSION = 200
const WS_OPEN_READY_STATE = 1
const MAX_TELEMETRY_ERROR_CODE_LENGTH = 64
const MAX_TELEMETRY_ERROR_MESSAGE_LENGTH = 256
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/
const INSTRUCTOR_PASSCODE_LENGTH = 32
const INSTRUCTOR_PASSCODE_PATTERN = /^[a-f0-9]{32}$/i
const UNSYNCED_STUDENTS_KEY_PREFIX = 'video-sync:unsynced:'
const UNSYNCED_STUDENTS_KEY_TTL_MS = UNSYNC_STALE_MS + 1_000
const DEFAULT_INSTRUCTOR_AUTH_TIMEOUT_MS = 5_000
const provider = 'youtube'
const subscribersBySession = new Map<string, Set<VideoSyncSocket>>()
const heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>()
const heartbeatInFlightBySession = new Map<string, boolean>()
const unsyncedStudentsBySession = new Map<string, Map<string, number>>()
const unsyncedStudentPruneTimersBySession = new Map<string, ReturnType<typeof setTimeout>>()

interface CookieSessionEntry {
  key: string
  teacherCode: unknown
}

function isInstructorRoleParam(role: string | null): boolean {
  return role === 'instructor' || role === 'manager'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function createInstructorPasscode(): string {
  return randomBytes(16).toString('hex')
}

function normalizeInstructorPasscode(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  if (
    normalized.length !== INSTRUCTOR_PASSCODE_LENGTH ||
    !INSTRUCTOR_PASSCODE_PATTERN.test(normalized)
  ) {
    return null
  }

  return normalized.toLowerCase()
}

function verifyInstructorPasscode(expected: string, candidate: string): boolean {
  if (
    expected.length !== INSTRUCTOR_PASSCODE_LENGTH ||
    !INSTRUCTOR_PASSCODE_PATTERN.test(expected) ||
    candidate.length !== INSTRUCTOR_PASSCODE_LENGTH ||
    !INSTRUCTOR_PASSCODE_PATTERN.test(candidate)
  ) {
    return false
  }

  const expectedBuffer = Buffer.from(expected)
  const candidateBuffer = Buffer.from(candidate)

  if (expectedBuffer.length === 0 || expectedBuffer.length !== candidateBuffer.length) {
    return false
  }

  try {
    return timingSafeEqual(expectedBuffer, candidateBuffer)
  } catch {
    return false
  }
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clampSeconds(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, value)
}

function parseTimestampSeconds(value: string | null): number | null {
  if (value == null || value.trim().length === 0) return null

  const numeric = Number.parseFloat(value)
  if (Number.isFinite(numeric) && /^\s*\d+(?:\.\d+)?\s*$/.test(value)) {
    return clampSeconds(numeric)
  }

  const trimmed = value.trim().toLowerCase()
  const match = trimmed.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  if (!match) return null

  const hours = match[1] ? Number.parseInt(match[1], 10) : 0
  const minutes = match[2] ? Number.parseInt(match[2], 10) : 0
  const seconds = match[3] ? Number.parseInt(match[3], 10) : 0

  const total = hours * 3600 + minutes * 60 + seconds
  return clampSeconds(total)
}

function normalizeYouTubeVideoId(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  return YOUTUBE_VIDEO_ID_PATTERN.test(trimmed) ? trimmed : null
}

function parseYouTubeSource(sourceUrl: string, stopOverride: number | null): ParsedVideoSourceResult {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(sourceUrl)
  } catch {
    return { ok: false, reason: 'invalid-url' }
  }

  const host = parsedUrl.hostname.toLowerCase()
  const isYouTubeHost = host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com'
  const isShortHost = host === 'youtu.be' || host === 'www.youtu.be'

  if (!isYouTubeHost && !isShortHost) {
    return { ok: false, reason: 'invalid-url' }
  }

  let videoId: string | null = null
  if (isYouTubeHost && parsedUrl.pathname === '/watch') {
    videoId = normalizeYouTubeVideoId(parsedUrl.searchParams.get('v'))
  }

  if (isShortHost) {
    const [firstSegment] = parsedUrl.pathname
      .split('/')
      .filter((segment) => segment.trim().length > 0)
    videoId = normalizeYouTubeVideoId(firstSegment ?? null)
  }

  if (!videoId) {
    return { ok: false, reason: 'invalid-video-id' }
  }

  const startFromStartParam = parseTimestampSeconds(parsedUrl.searchParams.get('start'))
  const startFromTParam = parseTimestampSeconds(parsedUrl.searchParams.get('t'))
  const startFromUrl = startFromStartParam ?? startFromTParam ?? 0
  const stopFromUrl = parseTimestampSeconds(parsedUrl.searchParams.get('end'))
  const stopSec = stopOverride ?? stopFromUrl

  if (stopSec != null && stopSec <= startFromUrl) {
    return { ok: false, reason: 'invalid-time-range' }
  }

  return {
    ok: true,
    source: {
      videoId,
      startSec: startFromUrl,
      stopSec,
    },
  }
}

function createDefaultState(): VideoSyncState {
  return {
    provider,
    videoId: '',
    startSec: 0,
    stopSec: null,
    positionSec: 0,
    isPlaying: false,
    playbackRate: 1,
    updatedBy: 'system',
    serverTimestampMs: Date.now(),
  }
}

function createDefaultTelemetry(): VideoSyncTelemetry {
  return {
    connections: { activeCount: 0 },
    autoplay: { blockedCount: 0 },
    sync: { unsyncedStudents: 0, lastDriftSec: null, lastCorrectionResult: 'none' },
    error: { code: null, message: null },
  }
}

function normalizeState(raw: unknown): VideoSyncState {
  const source = isPlainObject(raw) ? raw : {}
  const stopCandidate = source.stopSec
  const normalizedStop = typeof stopCandidate === 'number' && Number.isFinite(stopCandidate)
    ? clampSeconds(stopCandidate)
    : null
  const normalizedServerTimestampMs =
    typeof source.serverTimestampMs === 'number' &&
    Number.isFinite(source.serverTimestampMs) &&
    source.serverTimestampMs > 0
      ? source.serverTimestampMs
      : Date.now()

  return {
    provider,
    videoId: normalizeYouTubeVideoId(typeof source.videoId === 'string' ? source.videoId : null) ?? '',
    startSec: clampSeconds(toFiniteNumber(source.startSec, 0)),
    stopSec: normalizedStop,
    positionSec: clampSeconds(toFiniteNumber(source.positionSec, 0)),
    isPlaying: source.isPlaying === true,
    playbackRate: 1,
    updatedBy:
      source.updatedBy === 'instructor' || source.updatedBy === 'manager'
        ? 'instructor'
        : 'system',
    serverTimestampMs: normalizedServerTimestampMs,
  }
}

function normalizeTelemetry(raw: unknown): VideoSyncTelemetry {
  const source = isPlainObject(raw) ? raw : {}
  const connections = isPlainObject(source.connections) ? source.connections : {}
  const autoplay = isPlainObject(source.autoplay) ? source.autoplay : {}
  const sync = isPlainObject(source.sync) ? source.sync : {}
  const error = isPlainObject(source.error) ? source.error : {}

  const lastDriftSec = typeof sync.lastDriftSec === 'number' && Number.isFinite(sync.lastDriftSec)
    ? sync.lastDriftSec
    : null

  const correctionResult =
    sync.lastCorrectionResult === 'attempted' ||
    sync.lastCorrectionResult === 'success' ||
    sync.lastCorrectionResult === 'failed'
      ? sync.lastCorrectionResult
      : 'none'

  const normalizedErrorCode = normalizeTelemetryErrorField(error.code, MAX_TELEMETRY_ERROR_CODE_LENGTH)
  const normalizedErrorMessage = normalizeTelemetryErrorField(error.message, MAX_TELEMETRY_ERROR_MESSAGE_LENGTH)

  return {
    connections: {
      activeCount: Math.max(0, Math.floor(toFiniteNumber(connections.activeCount, 0))),
    },
    autoplay: {
      blockedCount: Math.max(0, Math.floor(toFiniteNumber(autoplay.blockedCount, 0))),
    },
    sync: {
      unsyncedStudents: Math.max(0, Math.floor(toFiniteNumber(sync.unsyncedStudents, 0))),
      lastDriftSec,
      lastCorrectionResult: correctionResult,
    },
    error: {
      code: normalizedErrorCode,
      message: normalizedErrorMessage,
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

  if (Array.isArray(parsedCookie)) {
    return parsedCookie
      .filter((entry): entry is Record<string, unknown> => isPlainObject(entry) && typeof entry.key === 'string')
      .map((entry) => ({
        key: String(entry.key),
        teacherCode: entry.teacherCode,
      }))
  }

  if (isPlainObject(parsedCookie)) {
    return Object.keys(parsedCookie).map((key) => ({
      key,
      teacherCode: parsedCookie[key],
    }))
  }

  return []
}

function normalizeStudentId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 128) return null
  return trimmed
}

function normalizeTelemetryErrorField(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (trimmed.length === 0) return null

  return trimmed.slice(0, maxLength)
}

function normalizeDriftSec(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  return clampSeconds(Math.abs(value))
}

function parseInstructorAuthMessage(raw: unknown): VideoSyncInstructorAuthMessage | null {
  let text: string | null = null

  if (typeof raw === 'string') {
    text = raw
  } else if (Buffer.isBuffer(raw)) {
    text = raw.toString('utf8')
  } else if (raw instanceof ArrayBuffer) {
    text = Buffer.from(raw).toString('utf8')
  }

  if (text == null) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  if (!isPlainObject(parsed) || parsed.type !== 'authenticate') {
    return null
  }

  const instructorPasscode = normalizeInstructorPasscode(parsed.instructorPasscode)
  if (instructorPasscode == null) {
    return null
  }

  return {
    type: 'authenticate',
    instructorPasscode,
  }
}

function getInstructorAuthTimeoutMs(): number {
  // Temporary compatibility shim for mixed deploys; owner: Codex; cleanup: remove once all callers use ACTIVEBITS_VIDEO_SYNC_INSTRUCTOR_AUTH_TIMEOUT_MS.
  const rawValue =
    process.env.ACTIVEBITS_VIDEO_SYNC_INSTRUCTOR_AUTH_TIMEOUT_MS ??
    process.env.ACTIVEBITS_VIDEO_SYNC_MANAGER_AUTH_TIMEOUT_MS
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
      socket.close(1008, 'Auth timeout')
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

function getUnsyncedStudentsKey(sessionId: string): string {
  return `${UNSYNCED_STUDENTS_KEY_PREFIX}${sessionId}`
}

const UPSERT_UNSYNCED_STUDENT_LUA = `
-- video-sync-unsynced-upsert
local key = KEYS[1]
local studentId = ARGV[1]
local nowMs = tonumber(ARGV[2])
local staleMs = tonumber(ARGV[3])
local maxStudents = tonumber(ARGV[4])
local ttlMs = tonumber(ARGV[5])
local data = redis.call('GET', key)
local state = data and cjson.decode(data) or {}
local count = 0

for id, timestamp in pairs(state) do
  if nowMs - tonumber(timestamp) > staleMs then
    state[id] = nil
  else
    count = count + 1
  end
end

if state[studentId] == nil and count >= maxStudents then
  if count == 0 then
    redis.call('DEL', key)
  else
    redis.call('SET', key, cjson.encode(state), 'PX', ttlMs)
  end
  return count
end

if state[studentId] == nil then
  count = count + 1
end
state[studentId] = nowMs
redis.call('SET', key, cjson.encode(state), 'PX', ttlMs)
return count
`

const CLEAR_UNSYNCED_STUDENT_LUA = `
-- video-sync-unsynced-clear
local key = KEYS[1]
local studentId = ARGV[1]
local nowMs = tonumber(ARGV[2])
local staleMs = tonumber(ARGV[3])
local ttlMs = tonumber(ARGV[4])
local data = redis.call('GET', key)
if not data then
  return 0
end

local state = cjson.decode(data)
local count = 0

for id, timestamp in pairs(state) do
  if nowMs - tonumber(timestamp) > staleMs then
    state[id] = nil
  end
end

state[studentId] = nil

for _id, _timestamp in pairs(state) do
  count = count + 1
end

if count == 0 then
  redis.call('DEL', key)
else
  redis.call('SET', key, cjson.encode(state), 'PX', ttlMs)
end

return count
`

const COUNT_UNSYNCED_STUDENTS_LUA = `
-- video-sync-unsynced-count
local key = KEYS[1]
local nowMs = tonumber(ARGV[1])
local staleMs = tonumber(ARGV[2])
local ttlMs = tonumber(ARGV[3])
local data = redis.call('GET', key)
if not data then
  return 0
end

local state = cjson.decode(data)
local count = 0

for id, timestamp in pairs(state) do
  if nowMs - tonumber(timestamp) > staleMs then
    state[id] = nil
  else
    count = count + 1
  end
end

if count == 0 then
  redis.call('DEL', key)
else
  redis.call('SET', key, cjson.encode(state), 'PX', ttlMs)
end

return count
`

async function runValkeyUnsyncedStudentCount(
  sessions: VideoSyncSessionStore,
  sessionId: string,
  script: string,
  args: Array<string | number>,
): Promise<number> {
  if (sessions.valkeyStore == null) {
    return 0
  }

  const result = await sessions.valkeyStore.client.eval(
    script,
    1,
    getUnsyncedStudentsKey(sessionId),
    ...args,
  )

  return typeof result === 'number' && Number.isFinite(result)
    ? Math.max(0, Math.floor(result))
    : 0
}

function pruneStaleUnsyncedStudents(studentMap: Map<string, number>, nowMs = Date.now()): void {
  for (const [studentId, timestampMs] of studentMap.entries()) {
    if (nowMs - timestampMs > UNSYNC_STALE_MS) {
      studentMap.delete(studentId)
    }
  }
}

function clearUnsyncedStudentPruneTimer(sessionId: string): void {
  const existing = unsyncedStudentPruneTimersBySession.get(sessionId)
  if (!existing) {
    return
  }

  clearTimeout(existing)
  unsyncedStudentPruneTimersBySession.delete(sessionId)
}

function clearUnsyncedStudentState(sessionId: string): void {
  clearUnsyncedStudentPruneTimer(sessionId)
  unsyncedStudentsBySession.delete(sessionId)
}

async function refreshUnsyncedStudentsCount(
  sessions: VideoSyncSessionStore,
  data: VideoSyncSessionData,
  sessionId: string,
  nowMs = Date.now(),
): Promise<void> {
  if (sessions.valkeyStore != null) {
    data.telemetry.sync.unsyncedStudents = await runValkeyUnsyncedStudentCount(
      sessions,
      sessionId,
      COUNT_UNSYNCED_STUDENTS_LUA,
      [nowMs, UNSYNC_STALE_MS, UNSYNCED_STUDENTS_KEY_TTL_MS],
    )
    return
  }

  const studentMap = unsyncedStudentsBySession.get(sessionId)
  if (!studentMap) {
    data.telemetry.sync.unsyncedStudents = 0
    return
  }

  pruneStaleUnsyncedStudents(studentMap, nowMs)

  if (studentMap.size === 0) {
    unsyncedStudentsBySession.delete(sessionId)
    data.telemetry.sync.unsyncedStudents = 0
    return
  }

  data.telemetry.sync.unsyncedStudents = studentMap.size
}

async function markStudentUnsynced(
  sessions: VideoSyncSessionStore,
  sessionId: string,
  studentId: string,
  nowMs = Date.now(),
): Promise<number> {
  if (sessions.valkeyStore != null) {
    return runValkeyUnsyncedStudentCount(
      sessions,
      sessionId,
      UPSERT_UNSYNCED_STUDENT_LUA,
      [studentId, nowMs, UNSYNC_STALE_MS, MAX_UNSYNCED_STUDENTS_PER_SESSION, UNSYNCED_STUDENTS_KEY_TTL_MS],
    )
  }

  const existing = unsyncedStudentsBySession.get(sessionId)
  if (existing) {
    pruneStaleUnsyncedStudents(existing, nowMs)
    if (!existing.has(studentId) && existing.size >= MAX_UNSYNCED_STUDENTS_PER_SESSION) {
      return existing.size
    }
    existing.set(studentId, nowMs)
    return existing.size
  }

  unsyncedStudentsBySession.set(sessionId, new Map([[studentId, nowMs]]))
  return 1
}

async function clearStudentUnsynced(
  sessions: VideoSyncSessionStore,
  sessionId: string,
  studentId: string,
  nowMs = Date.now(),
): Promise<number> {
  if (sessions.valkeyStore != null) {
    return runValkeyUnsyncedStudentCount(
      sessions,
      sessionId,
      CLEAR_UNSYNCED_STUDENT_LUA,
      [studentId, nowMs, UNSYNC_STALE_MS, UNSYNCED_STUDENTS_KEY_TTL_MS],
    )
  }

  const existing = unsyncedStudentsBySession.get(sessionId)
  if (!existing) return 0

  existing.delete(studentId)
  if (existing.size === 0) {
    clearUnsyncedStudentState(sessionId)
    return 0
  }

  return existing.size
}

function getNextUnsyncedStudentPruneDelay(sessionId: string, nowMs = Date.now()): number | null {
  const studentMap = unsyncedStudentsBySession.get(sessionId)
  if (!studentMap || studentMap.size === 0) {
    return null
  }

  let minDelayMs = Number.POSITIVE_INFINITY
  for (const timestampMs of studentMap.values()) {
    const delayMs = Math.max(0, timestampMs + UNSYNC_STALE_MS - nowMs)
    minDelayMs = Math.min(minDelayMs, delayMs)
  }

  return Number.isFinite(minDelayMs) ? minDelayMs : null
}

function scheduleUnsyncedStudentsPrune(
  sessions: Pick<VideoSyncSessionStore, 'get' | 'set'>,
  sessionId: string,
  nowMs = Date.now(),
): void {
  clearUnsyncedStudentPruneTimer(sessionId)

  const delayMs = getNextUnsyncedStudentPruneDelay(sessionId, nowMs)
  if (delayMs == null) {
    return
  }

  const timer = setTimeout(() => {
    unsyncedStudentPruneTimersBySession.delete(sessionId)
    void (async () => {
      const studentMap = unsyncedStudentsBySession.get(sessionId)
      if (!studentMap) {
        return
      }

      const pruneNowMs = Date.now()
      pruneStaleUnsyncedStudents(studentMap, pruneNowMs)

      const session = await getVideoSyncSession(sessions, sessionId)
      if (!session) {
        clearUnsyncedStudentState(sessionId)
        return
      }

      const data = ensureVideoSyncSessionData(session)
      const previousCount = data.telemetry.sync.unsyncedStudents
      await refreshUnsyncedStudentsCount(sessions as VideoSyncSessionStore, data, sessionId, pruneNowMs)

      if (data.telemetry.sync.unsyncedStudents !== previousCount) {
        await sessions.set(session.id, session)
      }

      if ((unsyncedStudentsBySession.get(sessionId)?.size ?? 0) > 0) {
        scheduleUnsyncedStudentsPrune(sessions, sessionId, pruneNowMs)
      }
    })().catch((error: unknown) => {
      console.error(`Failed to prune stale video-sync unsynced students for session ${sessionId}:`, error)
    })
  }, delayMs)

  unsyncedStudentPruneTimersBySession.set(sessionId, timer)
}

function normalizeVideoSyncSessionData(session: SessionRecord): {
  data: VideoSyncSessionData
  changed: boolean
} {
  const previousData = session.data
  const rawData = isPlainObject(previousData) ? previousData : {}
  const state = normalizeState(rawData.state)
  const telemetry = normalizeTelemetry(rawData.telemetry)

  const normalized: VideoSyncSessionData = {
    ...rawData,
    instructorPasscode: normalizeInstructorPasscode(rawData.instructorPasscode) ?? createInstructorPasscode(),
    state,
    telemetry,
  }

  const changed = !isPlainObject(previousData) || !isDeepStrictEqual(previousData, normalized)
  session.data = normalized
  return {
    data: normalized,
    changed,
  }
}

function ensureVideoSyncSessionData(session: SessionRecord): VideoSyncSessionData {
  return normalizeVideoSyncSessionData(session).data
}

function toPublicSessionData(data: VideoSyncSessionData): PublicVideoSyncSessionData {
  return {
    state: data.state,
    telemetry: data.telemetry,
  }
}

registerSessionNormalizer('video-sync', (session) => {
  ensureVideoSyncSessionData(session as SessionRecord)
})

function computeCurrentPositionSec(state: VideoSyncState, nowMs = Date.now()): number {
  const basePosition = clampSeconds(state.positionSec)
  if (!state.isPlaying) return basePosition

  const elapsedSec = Math.max(0, (nowMs - state.serverTimestampMs) / 1000)
  const projected = clampSeconds(basePosition + elapsedSec)

  if (state.stopSec != null && projected >= state.stopSec) {
    return state.stopSec
  }

  return projected
}

function applyStopIfReached(state: VideoSyncState, nowMs = Date.now()): VideoSyncState {
  const positionSec = computeCurrentPositionSec(state, nowMs)
  const reachedStop = state.stopSec != null && positionSec >= state.stopSec

  return {
    ...state,
    positionSec,
    isPlaying: reachedStop ? false : state.isPlaying,
    serverTimestampMs: nowMs,
  }
}

function cloneTelemetry(telemetry: VideoSyncTelemetry): VideoSyncTelemetry {
  return {
    connections: { ...telemetry.connections },
    autoplay: { ...telemetry.autoplay },
    sync: { ...telemetry.sync },
    error: { ...telemetry.error },
  }
}

function shouldPersistHeartbeatState(previous: VideoSyncState, next: VideoSyncState): boolean {
  return previous.isPlaying && !next.isPlaying
}

function shouldPersistHeartbeatTelemetry(
  previous: VideoSyncTelemetry,
  next: VideoSyncTelemetry,
): boolean {
  return (
    previous.connections.activeCount !== next.connections.activeCount ||
    previous.sync.unsyncedStudents !== next.sync.unsyncedStudents
  )
}

function createEnvelope<TPayload>(
  sessionId: string,
  type: VideoSyncWsMessageEnvelope<TPayload>['type'],
  payload: TPayload,
): VideoSyncWsMessageEnvelope<TPayload> {
  return {
    version: '1',
    activity: 'video-sync',
    sessionId,
    type,
    timestamp: Date.now(),
    payload,
  }
}

async function getVideoSyncSession(
  sessions: Pick<VideoSyncSessionStore, 'get'>,
  sessionId: string,
): Promise<VideoSyncSession | null> {
  const result = await getVideoSyncSessionWithNormalization(sessions, sessionId)
  return result.session
}

async function getVideoSyncSessionWithNormalization(
  sessions: Pick<VideoSyncSessionStore, 'get'>,
  sessionId: string,
): Promise<{
  session: VideoSyncSession | null
  data: VideoSyncSessionData | null
  didNormalizeSessionData: boolean
}> {
  const session = await sessions.get(sessionId)
  if (!session || session.type !== 'video-sync') {
    return {
      session: null,
      data: null,
      didNormalizeSessionData: false,
    }
  }

  const { data, changed: didNormalizeSessionData } = normalizeVideoSyncSessionData(session)
  return {
    session: session as VideoSyncSession,
    data,
    didNormalizeSessionData,
  }
}

function upsertSubscriber(sessionId: string, socket: VideoSyncSocket): void {
  const existing = subscribersBySession.get(sessionId)
  if (existing) {
    existing.add(socket)
    return
  }

  subscribersBySession.set(sessionId, new Set([socket]))
}

function removeSubscriber(sessionId: string, socket: VideoSyncSocket): void {
  const existing = subscribersBySession.get(sessionId)
  if (!existing) return

  existing.delete(socket)
  if (existing.size === 0) {
    subscribersBySession.delete(sessionId)
  }
}

async function updateConnectionTelemetry(
  sessions: VideoSyncSessionStore,
  data: VideoSyncSessionData,
  sessionId: string,
  unsyncedStudentsCount?: number,
): Promise<void> {
  const sockets = subscribersBySession.get(sessionId)
  data.telemetry.connections.activeCount = sockets?.size ?? 0
  if (typeof unsyncedStudentsCount === 'number' && Number.isFinite(unsyncedStudentsCount)) {
    data.telemetry.sync.unsyncedStudents = Math.max(0, Math.floor(unsyncedStudentsCount))
    return
  }

  await refreshUnsyncedStudentsCount(sessions, data, sessionId)
}

async function broadcastEnvelope(
  sessions: VideoSyncSessionStore,
  ws: WsRouter,
  sessionId: string,
  envelope: VideoSyncWsMessageEnvelope,
): Promise<void> {
  if (sessions.publishBroadcast && sessions.valkeyStore != null) {
    try {
      await sessions.publishBroadcast(`session:${sessionId}:broadcast`, envelope as unknown as Record<string, unknown>)
      return
    } catch (error) {
      console.error('Failed to publish video-sync broadcast:', error)
    }
  }

  void ws
  const encoded = JSON.stringify(envelope)
  const subscribers = subscribersBySession.get(sessionId)
  if (!subscribers || subscribers.size === 0) {
    return
  }

  for (const client of subscribers) {
    if (client.readyState === WS_OPEN_READY_STATE) {
      try {
        client.send(encoded)
      } catch {
        continue
      }
    }
  }
}

function stopHeartbeat(sessionId: string): void {
  const existing = heartbeatTimers.get(sessionId)
  if (existing) {
    clearInterval(existing)
  }
  heartbeatTimers.delete(sessionId)
  heartbeatInFlightBySession.delete(sessionId)
  clearUnsyncedStudentState(sessionId)
}

function closeSubscribersForMissingSession(sessionId: string): void {
  const sockets = subscribersBySession.get(sessionId)
  if (!sockets || sockets.size === 0) {
    subscribersBySession.delete(sessionId)
    return
  }

  subscribersBySession.delete(sessionId)
  for (const socket of sockets) {
    try {
      socket.close?.(1008, 'Session not found')
    } catch {
      continue
    }
  }
}

function ensureHeartbeat(
  sessions: VideoSyncSessionStore,
  ws: WsRouter,
  sessionId: string,
): void {
  if (heartbeatTimers.has(sessionId)) {
    return
  }

  const timer = setInterval(() => {
    void (async () => {
      if (heartbeatInFlightBySession.get(sessionId) === true) {
        return
      }

      heartbeatInFlightBySession.set(sessionId, true)

      try {
        const sockets = subscribersBySession.get(sessionId)
        if (!sockets || sockets.size === 0) {
          stopHeartbeat(sessionId)
          return
        }

        const { session, data } = await getVideoSyncSessionWithNormalization(sessions, sessionId)
        if (!session || !data) {
          closeSubscribersForMissingSession(sessionId)
          stopHeartbeat(sessionId)
          return
        }

        const heartbeatState = applyStopIfReached(data.state)
        const heartbeatTelemetry = cloneTelemetry(data.telemetry)
        await updateConnectionTelemetry(
          sessions,
          {
            ...data,
            state: heartbeatState,
            telemetry: heartbeatTelemetry,
          },
          sessionId,
        )

        if (
          shouldPersistHeartbeatState(data.state, heartbeatState) ||
          shouldPersistHeartbeatTelemetry(data.telemetry, heartbeatTelemetry)
        ) {
          data.state = heartbeatState
          data.telemetry = heartbeatTelemetry
          await sessions.set(session.id, session)
        }

        const envelope = createEnvelope(sessionId, 'heartbeat', {
          state: heartbeatState,
          telemetry: heartbeatTelemetry,
        })
        await broadcastEnvelope(sessions, ws, sessionId, envelope)
      } finally {
        if (heartbeatTimers.has(sessionId)) {
          heartbeatInFlightBySession.set(sessionId, false)
        } else {
          heartbeatInFlightBySession.delete(sessionId)
        }
      }
    })().catch((error: unknown) => {
      console.error(`Video sync heartbeat failed for session ${sessionId}:`, error)
    })
  }, HEARTBEAT_INTERVAL_MS)

  heartbeatTimers.set(sessionId, timer)
}

function resolveSessionId(req: RouteRequest): string | null {
  const value = req.params.sessionId
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }
  return value
}

function isCommandType(value: unknown): value is VideoSyncCommandType {
  return value === 'play' || value === 'pause' || value === 'seek'
}

function isEventType(value: unknown): value is VideoSyncEventType {
  return value === 'autoplay-blocked' || value === 'unsync' || value === 'sync-correction' || value === 'load-failure'
}

function readInstructorPasscode(body: unknown): string | null {
  if (!isPlainObject(body)) {
    return null
  }

  return normalizeInstructorPasscode(body.instructorPasscode)
}

export default function setupVideoSyncRoutes(
  app: VideoSyncRouteApp,
  sessions: VideoSyncSessionStore,
  ws: WsRouter,
): void {
  const ensureBroadcastSubscription = createBroadcastSubscriptionHelper(sessions, ws)

  app.post('/api/video-sync/create', async (_req, res) => {
    try {
      const session = await createSession(sessions, { data: {} })
      session.type = 'video-sync'

      const data = ensureVideoSyncSessionData(session)
      data.state = createDefaultState()
      data.telemetry = createDefaultTelemetry()

      await sessions.set(session.id, session)
      res.json({ id: session.id, instructorPasscode: data.instructorPasscode })
    } catch (error) {
      console.error('Failed to create video-sync session:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to create session' })
    }
  })

  app.get('/api/video-sync/:sessionId/instructor-passcode', async (req, res) => {
    const sessionId = resolveSessionId(req)
    if (!sessionId) {
      res.status(400).json({ error: 'INVALID_SESSION_ID', message: 'sessionId is required' })
      return
    }

    const {
      session,
      data,
      didNormalizeSessionData,
    } = await getVideoSyncSessionWithNormalization(sessions, sessionId)
    if (!session || !data) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Session not found' })
      return
    }

    const persistentHash = await findHashBySessionId(sessionId)
    if (!persistentHash) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Instructor credential recovery is not available for this session' })
      return
    }

    const sessionEntries = parsePersistentSessionsCookie(req.cookies?.persistent_sessions)
    const matchingEntry = sessionEntries.find((entry) => entry.key === `video-sync:${persistentHash}`)
    if (!matchingEntry) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Instructor credential recovery is not available for this session' })
      return
    }

    const verifiedTeacherCode = verifyTeacherCodeWithHash('video-sync', persistentHash, String(matchingEntry.teacherCode ?? ''))
    if (!verifiedTeacherCode.valid) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Instructor credential recovery is not available for this session' })
      return
    }

    if (didNormalizeSessionData) {
      await sessions.set(session.id, session)
    }
    res.json({ instructorPasscode: data.instructorPasscode })
  })

  app.get('/api/video-sync/:sessionId/session', async (req, res) => {
    const sessionId = resolveSessionId(req)
    if (!sessionId) {
      res.status(400).json({ error: 'INVALID_SESSION_ID', message: 'sessionId is required' })
      return
    }

    const {
      session,
      data,
      didNormalizeSessionData,
    } = await getVideoSyncSessionWithNormalization(sessions, sessionId)
    if (!session || !data) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Session not found' })
      return
    }

    const projectedState = applyStopIfReached(data.state)
    const projectedTelemetry = cloneTelemetry(data.telemetry)
    await updateConnectionTelemetry(
      sessions,
      {
        ...data,
        state: projectedState,
        telemetry: projectedTelemetry,
      },
      sessionId,
    )

    if (
      didNormalizeSessionData ||
      shouldPersistHeartbeatState(data.state, projectedState) ||
      shouldPersistHeartbeatTelemetry(data.telemetry, projectedTelemetry)
    ) {
      data.state = projectedState
      data.telemetry = projectedTelemetry
      await sessions.set(session.id, session)
    }

    res.json({
      id: session.id,
      type: session.type,
      data: {
        state: projectedState,
        telemetry: projectedTelemetry,
      },
    })
  })

  app.patch('/api/video-sync/:sessionId/session', async (req, res) => {
    const sessionId = resolveSessionId(req)
    if (!sessionId) {
      res.status(400).json({ error: 'INVALID_SESSION_ID', message: 'sessionId is required' })
      return
    }

    const session = await getVideoSyncSession(sessions, sessionId)
    if (!session) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Session not found' })
      return
    }

    const instructorPasscode = readInstructorPasscode(req.body)
    if (!instructorPasscode || !verifyInstructorPasscode(session.data.instructorPasscode, instructorPasscode)) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Valid instructorPasscode is required' })
      return
    }

    const data = ensureVideoSyncSessionData(session)
    if (data.state.videoId.length > 0) {
      data.telemetry.error = {
        code: 'CONFIG_LOCKED',
        message: 'Video source is already configured for this session.',
      }
      await sessions.set(session.id, session)
      res.status(409).json({ error: 'CONFIG_LOCKED', message: data.telemetry.error.message })
      return
    }

    const body = isPlainObject(req.body) ? (req.body as ConfigBody) : {}

    if (typeof body.sourceUrl !== 'string' || body.sourceUrl.trim().length === 0) {
      data.telemetry.error = {
        code: 'INVALID_SOURCE_URL',
        message: 'Only youtube.com/watch and youtu.be URLs are supported in v1.',
      }
      await sessions.set(session.id, session)
      res.status(400).json({ error: 'INVALID_SOURCE_URL', message: data.telemetry.error.message })
      return
    }

    const stopOverride =
      body.stopSec == null
        ? null
        : typeof body.stopSec === 'number' && Number.isFinite(body.stopSec)
          ? clampSeconds(body.stopSec)
          : Number.NaN

    if (Number.isNaN(stopOverride)) {
      data.telemetry.error = {
        code: 'INVALID_STOP_SEC',
        message: 'stopSec must be a finite number of seconds or omitted.',
      }
      await sessions.set(session.id, session)
      res.status(400).json({ error: 'INVALID_STOP_SEC', message: data.telemetry.error.message })
      return
    }

    const parsedSource = parseYouTubeSource(body.sourceUrl.trim(), stopOverride)
    if (!parsedSource.ok) {
      if (parsedSource.reason === 'invalid-url') {
        data.telemetry.error = {
          code: 'INVALID_SOURCE_URL',
          message: 'Only youtube.com/watch and youtu.be URLs are supported in v1.',
        }
        await sessions.set(session.id, session)
        res.status(400).json({ error: 'INVALID_SOURCE_URL', message: data.telemetry.error.message })
        return
      }

      if (parsedSource.reason === 'invalid-time-range') {
        data.telemetry.error = {
          code: 'INVALID_TIME_RANGE',
          message: 'stopSec must be greater than startSec and both must be >= 0.',
        }
        await sessions.set(session.id, session)
        res.status(400).json({ error: 'INVALID_TIME_RANGE', message: data.telemetry.error.message })
        return
      }

      data.telemetry.error = {
        code: 'INVALID_VIDEO_ID',
        message: 'Could not determine a valid YouTube video id from sourceUrl.',
      }
      await sessions.set(session.id, session)
      res.status(400).json({ error: 'INVALID_VIDEO_ID', message: data.telemetry.error.message })
      return
    }

    const now = Date.now()
    data.state = {
      ...data.state,
      provider,
      videoId: parsedSource.source.videoId,
      startSec: parsedSource.source.startSec,
      stopSec: parsedSource.source.stopSec,
      positionSec: parsedSource.source.startSec,
      isPlaying: false,
      playbackRate: 1,
      updatedBy: 'instructor',
      serverTimestampMs: now,
    }
    data.telemetry.error = { code: null, message: null }
    await updateConnectionTelemetry(sessions, data, sessionId)

    await sessions.set(session.id, session)

    const envelope = createEnvelope(sessionId, 'state-update', {
      state: data.state,
      telemetry: data.telemetry,
      reason: 'config-updated',
    })
    await broadcastEnvelope(sessions, ws, sessionId, envelope)

    res.json({ success: true, data: toPublicSessionData(data) })
  })

  app.post('/api/video-sync/:sessionId/command', async (req, res) => {
    const sessionId = resolveSessionId(req)
    if (!sessionId) {
      res.status(400).json({ error: 'INVALID_SESSION_ID', message: 'sessionId is required' })
      return
    }

    const session = await getVideoSyncSession(sessions, sessionId)
    if (!session) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Session not found' })
      return
    }

    const instructorPasscode = readInstructorPasscode(req.body)
    if (!instructorPasscode || !verifyInstructorPasscode(session.data.instructorPasscode, instructorPasscode)) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Valid instructorPasscode is required' })
      return
    }

    const body = isPlainObject(req.body) ? (req.body as CommandBody) : {}
    if (!isCommandType(body.type)) {
      res.status(400).json({ error: 'INVALID_COMMAND', message: 'type must be play, pause, or seek' })
      return
    }

    const data = ensureVideoSyncSessionData(session)
    const now = Date.now()
    const currentPosition = computeCurrentPositionSec(data.state, now)

    if (body.type === 'play') {
      const requested = typeof body.positionSec === 'number' && Number.isFinite(body.positionSec)
        ? clampSeconds(body.positionSec)
        : currentPosition
      const clamped = data.state.stopSec != null ? Math.min(requested, data.state.stopSec) : requested
      data.state = {
        ...data.state,
        positionSec: clamped,
        isPlaying: true,
        updatedBy: 'instructor',
        serverTimestampMs: now,
      }
    } else if (body.type === 'pause') {
      const requested = typeof body.positionSec === 'number' && Number.isFinite(body.positionSec)
        ? clampSeconds(body.positionSec)
        : currentPosition
      const clamped = data.state.stopSec != null ? Math.min(requested, data.state.stopSec) : requested
      data.state = {
        ...data.state,
        positionSec: clamped,
        isPlaying: false,
        updatedBy: 'instructor',
        serverTimestampMs: now,
      }
    } else {
      const requested = typeof body.positionSec === 'number' && Number.isFinite(body.positionSec)
        ? clampSeconds(body.positionSec)
        : data.state.startSec
      const clamped = data.state.stopSec != null ? Math.min(requested, data.state.stopSec) : requested
      data.state = {
        ...data.state,
        positionSec: clamped,
        isPlaying: false,
        updatedBy: 'instructor',
        serverTimestampMs: now,
      }
    }

    data.state = applyStopIfReached(data.state, now)
    await updateConnectionTelemetry(sessions, data, sessionId)
    await sessions.set(session.id, session)

    const envelope = createEnvelope(sessionId, 'state-update', {
      state: data.state,
      telemetry: data.telemetry,
      reason: body.type,
    })
    await broadcastEnvelope(sessions, ws, sessionId, envelope)

    res.json({ success: true, data: toPublicSessionData(data) })
  })

  app.post('/api/video-sync/:sessionId/event', async (req, res) => {
    const sessionId = resolveSessionId(req)
    if (!sessionId) {
      res.status(400).json({ error: 'INVALID_SESSION_ID', message: 'sessionId is required' })
      return
    }

    const session = await getVideoSyncSession(sessions, sessionId)
    if (!session) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Session not found' })
      return
    }

    const body = isPlainObject(req.body) ? (req.body as EventBody) : {}
    if (!isEventType(body.type)) {
      res.status(400).json({ error: 'INVALID_EVENT', message: 'type must be autoplay-blocked, unsync, sync-correction, or load-failure' })
      return
    }

    const data = ensureVideoSyncSessionData(session)
    let unsyncedStudentsCount: number | undefined

    if (body.type === 'autoplay-blocked') {
      data.telemetry.autoplay.blockedCount += 1
    }

    const studentId = normalizeStudentId(body.studentId)

    if (body.type === 'unsync') {
      if (studentId) {
        unsyncedStudentsCount = await markStudentUnsynced(sessions, sessionId, studentId)
        if (sessions.valkeyStore == null) {
          scheduleUnsyncedStudentsPrune(sessions, sessionId)
        }
      }
      const normalizedDriftSec = normalizeDriftSec(body.driftSec)
      data.telemetry.sync.lastDriftSec =
        normalizedDriftSec ?? data.telemetry.sync.lastDriftSec
      data.telemetry.sync.lastCorrectionResult = 'attempted'
    }

    if (body.type === 'sync-correction') {
      const correction = body.correctionResult
      if (studentId && correction === 'success') {
        unsyncedStudentsCount = await clearStudentUnsynced(sessions, sessionId, studentId)
        if (sessions.valkeyStore == null) {
          scheduleUnsyncedStudentsPrune(sessions, sessionId)
        }
      }
      data.telemetry.sync.lastCorrectionResult =
        correction === 'success' || correction === 'failed' ? correction : 'attempted'
    }

    if (body.type === 'load-failure') {
      data.telemetry.sync.lastCorrectionResult = 'failed'
      const errorCode = normalizeTelemetryErrorField(body.errorCode, MAX_TELEMETRY_ERROR_CODE_LENGTH)
      const errorMessage = normalizeTelemetryErrorField(body.errorMessage, MAX_TELEMETRY_ERROR_MESSAGE_LENGTH)

      if (errorCode != null || errorMessage != null) {
        data.telemetry.error = {
          code: errorCode,
          message: errorMessage,
        }
      }
    }

    await updateConnectionTelemetry(sessions, data, sessionId, unsyncedStudentsCount)
    await sessions.set(session.id, session)

    const envelope = createEnvelope(sessionId, 'telemetry-update', {
      telemetry: data.telemetry,
      reason: body.type,
    })
    await broadcastEnvelope(sessions, ws, sessionId, envelope)

    res.json({ success: true, telemetry: data.telemetry })
  })

  ws.register('/ws/video-sync', (socket, query) => {
    const sessionId = query.get('sessionId')
    const roleParam = query.get('role')

    if (!sessionId) {
      socket.close(1008, 'Missing sessionId')
      return
    }

    const typedSocket = socket as VideoSyncSocket
    const instructorAuthMessagePromise = isInstructorRoleParam(roleParam)
      ? waitForInstructorAuthMessage(typedSocket)
      : null
    let cleanedUp = false
    let isSubscribed = false
    const handleSocketClosed = () => {
      if (cleanedUp) {
        return
      }
      cleanedUp = true

      if (!isSubscribed) {
        return
      }

      isSubscribed = false
      removeSubscriber(sessionId, typedSocket)
      void (async () => {
        const currentSession = await getVideoSyncSession(sessions, sessionId)
        if (!currentSession) {
          stopHeartbeat(sessionId)
          return
        }

        const currentData = ensureVideoSyncSessionData(currentSession)
        await updateConnectionTelemetry(sessions, currentData, sessionId)
        await sessions.set(currentSession.id, currentSession)

        const disconnectTelemetryUpdate = createEnvelope(sessionId, 'telemetry-update', {
          telemetry: currentData.telemetry,
          reason: 'connection-change',
        })
        await broadcastEnvelope(sessions, ws, sessionId, disconnectTelemetryUpdate)

        if ((subscribersBySession.get(sessionId)?.size ?? 0) === 0) {
          stopHeartbeat(sessionId)
        }
      })().catch((error: unknown) => {
        console.error('Failed to clean up closed video-sync socket:', error)
      })
    }

    socket.on('close', handleSocketClosed)
    socket.on('error', handleSocketClosed)

    ;(async () => {
      const session = await getVideoSyncSession(sessions, sessionId)
      if (!session) {
        const errorEnvelope = createEnvelope(sessionId, 'error', {
          code: 'NOT_FOUND',
          message: 'Session not found',
        })
        try {
          if (typedSocket.readyState === WS_OPEN_READY_STATE) {
            typedSocket.send(JSON.stringify(errorEnvelope))
          }
        } finally {
          typedSocket.close(1008, 'Session not found')
        }
        return
      }

      if (isInstructorRoleParam(roleParam)) {
        const rawAuthMessage = await instructorAuthMessagePromise
        if (cleanedUp || typedSocket.readyState !== WS_OPEN_READY_STATE) {
          handleSocketClosed()
          return
        }

        const authMessage = parseInstructorAuthMessage(rawAuthMessage)
        if (!authMessage || !verifyInstructorPasscode(session.data.instructorPasscode, authMessage.instructorPasscode)) {
          typedSocket.close(1008, 'Forbidden')
          return
        }
      }

      const role: VideoSyncRole = isInstructorRoleParam(roleParam) ? 'instructor' : 'student'
      typedSocket.sessionId = sessionId
      typedSocket.videoSyncRole = role

      if (cleanedUp || typedSocket.readyState !== WS_OPEN_READY_STATE) {
        handleSocketClosed()
        return
      }

      ensureBroadcastSubscription(sessionId)
      upsertSubscriber(sessionId, typedSocket)
      isSubscribed = true
      ensureHeartbeat(sessions, ws, sessionId)

      const data = ensureVideoSyncSessionData(session)
      data.state = applyStopIfReached(data.state)
      await updateConnectionTelemetry(sessions, data, sessionId)
      await sessions.set(session.id, session)

      const snapshot = createEnvelope(sessionId, 'state-snapshot', {
        state: data.state,
        telemetry: data.telemetry,
        role,
      })

      if (typedSocket.readyState === WS_OPEN_READY_STATE) {
        typedSocket.send(JSON.stringify(snapshot))
      }

      const telemetryUpdate = createEnvelope(sessionId, 'telemetry-update', {
        telemetry: data.telemetry,
        reason: 'connection-change',
      })
      await broadcastEnvelope(sessions, ws, sessionId, telemetryUpdate)
    })().catch((error: unknown) => {
      console.error('Failed to send initial video-sync snapshot:', error)
    })
  })
}
