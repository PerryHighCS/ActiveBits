import { createSession, getSessionCreatedIdentity, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import {
  getActivityCapabilityCookieName,
  issueActivityCapability,
  readCookieValue,
  resolveActivityPrincipalFromCookies,
  writeActivityCapabilityCookie,
} from 'activebits-server/core/activityCapabilities.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import { createBroadcastSubscriptionHelper } from 'activebits-server/core/broadcastUtils.js'
import {
  findIndexedHashBySessionId,
  recordTeacherCodeAttemptStrict,
  resolvePersistentSessionEntryPolicy,
  TEACHER_CODE_ATTEMPT_WINDOW_SECONDS,
  verifyTeacherCodeWithHash,
} from 'activebits-server/core/persistentSessions.js'
import {
  normalizePersistentLinkSelectedOptions,
  verifyPersistentLinkUrlHash,
  type PersistentLinkUrlState,
} from 'activebits-server/core/persistentLinkUrlState.js'
import { isDeepStrictEqual } from 'node:util'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'
import {
  DEFAULT_VIDEO_SYNC_PLAYER_HOST,
  normalizeVideoSyncPlayerHost,
  type VideoSyncPlayerHost,
} from '../shared/playerHosts.js'

type VideoSyncRole = 'instructor' | 'student'
type VideoSyncCommandType = 'play' | 'pause' | 'seek'
type VideoSyncEventType = 'autoplay-blocked' | 'unsync' | 'sync-correction' | 'load-failure'

interface VideoSyncState {
  provider: 'youtube'
  playerHost: VideoSyncPlayerHost
  videoId: string
  startSec: number
  stopSec: number | null
  positionSec: number
  isPlaying: boolean
  playbackRate: 1
  updatedBy: 'instructor' | 'system'
  controllerId: string | null
  playbackRevision: number
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
  standaloneMode: boolean
  state: VideoSyncState
  telemetry: VideoSyncTelemetry
  processedCommandIds: string[]
}

interface PublicVideoSyncSessionData {
  standaloneMode: boolean
  state: VideoSyncState
  telemetry: VideoSyncTelemetry
}

interface VideoSyncSession extends SessionRecord {
  type?: string
  data: VideoSyncSessionData
}

interface VideoSyncSessionStore extends Pick<SessionStore, 'get' | 'getStrict' | 'set' | 'updateAtomic'> {
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
  ip?: string
  socket?: { remoteAddress?: string }
}

function resolveClientIp(req: RouteRequest): string {
  if (typeof req.ip === 'string' && req.ip.trim()) {
    return req.ip.trim()
  }
  const remoteAddress = req.socket?.remoteAddress
  if (typeof remoteAddress === 'string' && remoteAddress.trim()) {
    return remoteAddress.trim()
  }
  return 'unknown'
}

interface JsonResponse {
  status(code: number): JsonResponse
  set?(field: string, value: string): JsonResponse
  cookie(name: string, value: string, options: Record<string, unknown>): void
  json(payload: unknown): void
  readonly headersSent?: boolean
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

interface CommandBody {
  type?: unknown
  positionSec?: unknown
  commandId?: unknown
  managerId?: unknown
  source?: unknown
  expectedPlaybackRevision?: unknown
}

interface ConfigBody {
  sourceUrl?: unknown
  stopSec?: unknown
  standaloneMode?: unknown
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
  playerHost: VideoSyncPlayerHost
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
const MAX_COMMAND_ID_LENGTH = 128
const MAX_PROCESSED_COMMAND_IDS = 128
// Slack allowed between a client-reported natural-end position and a configured
// `stopSec` before the completion is treated as implausible (buffering jitter).
const NATURAL_END_TOLERANCE_SEC = 2
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/
const INVALID_SOURCE_URL_MESSAGE =
  'Only YouTube watch/embed, YouTube Education watch/embed, and youtu.be URLs are supported in v1.'
const UNSYNCED_STUDENTS_KEY_PREFIX = 'video-sync:unsynced:'
const UNSYNCED_STUDENTS_KEY_TTL_MS = UNSYNC_STALE_MS + 1_000
const provider = 'youtube'
const subscribersBySession = new Map<string, Set<VideoSyncSocket>>()
const heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>()
const heartbeatInFlightBySession = new Map<string, boolean>()
const mutationTailsBySession = new Map<string, Promise<void>>()
const unsyncedStudentsBySession = new Map<string, Map<string, number>>()
const unsyncedStudentPruneTimersBySession = new Map<string, ReturnType<typeof setTimeout>>()
// Session ids whose pre-migration unsynced scope (`<id>:0`) has already been
// folded into the incarnation scope this process run, so the fold runs at most
// once per session and is not re-attempted on every heartbeat. Cleared on
// session teardown.
const migratedLegacyUnsyncedScopes = new Set<string>()
const MAX_MIGRATED_LEGACY_UNSYNCED_SCOPES = 5_000

interface CookieSessionEntry {
  key: string
  teacherCode: unknown
  selectedOptions?: unknown
  entryPolicy?: unknown
  urlHash?: unknown
}

interface EmbeddedParentSessionContext {
  parentSessionId: string
  activityName: 'syncdeck'
}

function isInstructorRoleParam(role: string | null): boolean {
  return role === 'instructor' || role === 'manager'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

/** Keep cookie-dependent responses out of any shared or browser cache. */
function setNoStore(res: JsonResponse): void {
  res.set?.('Cache-Control', 'no-store')
}

async function withSessionMutation<T>(sessionId: string, mutate: () => Promise<T>): Promise<T> {
  const previous = mutationTailsBySession.get(sessionId) ?? Promise.resolve()
  let release!: () => void
  const tail = new Promise<void>((resolve) => { release = resolve })
  const completion = previous.catch(() => undefined).then(() => tail)
  mutationTailsBySession.set(sessionId, completion)
  await previous.catch(() => undefined)
  try {
    return await mutate()
  } finally {
    release()
    if (mutationTailsBySession.get(sessionId) === completion) {
      mutationTailsBySession.delete(sessionId)
    }
  }
}

/**
 * Run a serialized session mutation for a REST route, converting a rejected
 * session-store or broadcast operation into a structured log plus a controlled
 * 500 instead of letting the rejection escape the handler (Express 5 would
 * otherwise forward it to the default error handler with no structured log).
 * Mirrors the route-level guard already used by `/manager-access`.
 */
async function withSessionMutationRoute(
  res: JsonResponse,
  sessionId: string,
  event: string,
  mutate: () => Promise<void>,
): Promise<void> {
  try {
    await withSessionMutation(sessionId, mutate)
  } catch (mutationError) {
    console.error(JSON.stringify({
      activity: 'video-sync',
      event,
      sessionId,
      errorName: mutationError instanceof Error ? mutationError.name : 'unknown',
    }))
    if (!res.headersSent) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'This action is temporarily unavailable' })
    }
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
  const isYouTubeEducationHost = host === 'www.youtubeeducation.com' || host === 'youtubeeducation.com'
  const isShortHost = host === 'youtu.be' || host === 'www.youtu.be'

  if (!isYouTubeHost && !isYouTubeEducationHost && !isShortHost) {
    return { ok: false, reason: 'invalid-url' }
  }

  let videoId: string | null = null
  if ((isYouTubeHost || isYouTubeEducationHost) && parsedUrl.pathname === '/watch') {
    videoId = normalizeYouTubeVideoId(parsedUrl.searchParams.get('v'))
  }

  if ((isYouTubeHost || isYouTubeEducationHost) && parsedUrl.pathname.startsWith('/embed/')) {
    const [, , embedId] = parsedUrl.pathname.split('/')
    videoId = normalizeYouTubeVideoId(embedId ?? null)
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
      playerHost: isYouTubeEducationHost ? 'youtube-education' : DEFAULT_VIDEO_SYNC_PLAYER_HOST,
      startSec: startFromUrl,
      stopSec,
    },
  }
}

function createDefaultState(): VideoSyncState {
  return {
    provider,
    playerHost: DEFAULT_VIDEO_SYNC_PLAYER_HOST,
    videoId: '',
    startSec: 0,
    stopSec: null,
    positionSec: 0,
    isPlaying: false,
    playbackRate: 1,
    updatedBy: 'system',
    controllerId: null,
    playbackRevision: 0,
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
    playerHost: normalizeVideoSyncPlayerHost(source.playerHost),
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
    controllerId: typeof source.controllerId === 'string' && source.controllerId.length <= MAX_COMMAND_ID_LENGTH
      ? source.controllerId
      : null,
    playbackRevision: Math.max(0, Math.floor(toFiniteNumber(source.playbackRevision, 0))),
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
        selectedOptions: entry.selectedOptions,
        entryPolicy: entry.entryPolicy,
        urlHash: entry.urlHash,
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

function readEmbeddedParentSessionContext(data: unknown): EmbeddedParentSessionContext | null {
  if (!isPlainObject(data)) {
    return null
  }

  const parentSessionId = typeof data.embeddedParentSessionId === 'string'
    ? data.embeddedParentSessionId.trim()
    : ''

  if (parentSessionId.length === 0) {
    return null
  }

  return {
    parentSessionId,
    activityName: 'syncdeck',
  }
}

/**
 * Whether a `persistent_sessions` cookie entry actually carries a teacher-code
 * *candidate* (a non-empty string), i.e. the request is attempting credentialed
 * recovery. `persistent_sessions` is client-supplied, so a forged/malformed
 * entry with no usable code must not be able to spend the shared IP+hash
 * rate-limit bucket - matching the persistent-manager-capability route's guard.
 */
export function persistentCookieEntryHasTeacherCodeCandidate(entry: CookieSessionEntry | undefined): boolean {
  return typeof entry?.teacherCode === 'string' && entry.teacherCode.length > 0
}

function readPersistentSourceUrlFromCookieEntry(
  persistentHash: string,
  entry: CookieSessionEntry | undefined,
): string | null {
  if (!isPlainObject(entry?.selectedOptions)) {
    return null
  }

  const value = entry.selectedOptions.sourceUrl
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  const urlHash = typeof entry.urlHash === 'string' && entry.urlHash.trim().length > 0
    ? entry.urlHash.trim()
    : null
  if (!urlHash) {
    return null
  }

  const state = {
    entryPolicy: resolvePersistentSessionEntryPolicy(entry.entryPolicy),
    selectedOptions: normalizePersistentLinkSelectedOptions(entry.selectedOptions),
  } satisfies PersistentLinkUrlState

  if (!verifyPersistentLinkUrlHash(persistentHash, state, urlHash)) {
    return null
  }

  return trimmed
}

function normalizeStudentId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 128) return null
  return trimmed
}

function normalizeCommandId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 && normalized.length <= MAX_COMMAND_ID_LENGTH ? normalized : null
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

function resolveManagerSocketPrincipal(session: VideoSyncSession, sessionId: string, socket: VideoSyncSocket) {
  const cookieName = getActivityCapabilityCookieName('manager', sessionId)
  const cookieHeader = socket.upgradeHeaders?.cookie
  return resolveActivityPrincipalFromCookies(session, sessionId, 'manager', {
    [cookieName]: readCookieValue(cookieHeader, cookieName),
  })
}

const MAX_SET_TIMEOUT_MS = 2_147_483_647

/**
 * Close an admitted instructor socket once its manager capability reaches
 * `expiresAt`. Admission only checks authority at connect time, so without this
 * a socket opened just before expiry would keep receiving manager state past the
 * bounded capability lifetime. Mirrors the Java Format lifecycle; the 1008 close
 * is what the Video Sync client's manager-access revalidation path keys on.
 */
function scheduleManagerCapabilityExpiryClose(
  socket: VideoSyncSocket,
  session: VideoSyncSession,
  capabilityId: string,
): void {
  const record = (session.data as { activityCapabilities?: Record<string, { expiresAt?: unknown }> })
    .activityCapabilities?.[capabilityId]
  const expiresAt = record?.expiresAt
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return

  const closeExpired = (): void => {
    try {
      socket.close(1008, 'activity-auth-required')
    } catch {
      // socket already tearing down
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = (): void => {
    const remaining = expiresAt - Date.now()
    if (remaining <= 0) {
      closeExpired()
      return
    }
    // setTimeout caps at ~24.8 days; for a longer TTL, re-arm in chunks so the
    // socket is closed at the real `expiresAt`, not early.
    timer = setTimeout(remaining <= MAX_SET_TIMEOUT_MS ? closeExpired : arm, Math.min(remaining, MAX_SET_TIMEOUT_MS))
    timer.unref?.()
  }
  arm()
  socket.on('close', () => {
    if (timer) clearTimeout(timer)
  })
}

// Auxiliary unsynced-student bookkeeping (the in-memory maps and the Valkey key)
// is keyed by a per-*incarnation* scope, not the bare session id. A same-id
// delete+recreate races: an /event whose atomic write is abandoned for the old
// incarnation must not have its markers read (or blindly deleted) alongside the
// replacement's. `created` distinguishes incarnations; the old scope's Valkey
// key self-expires (UNSYNCED_STUDENTS_KEY_TTL_MS) and its in-memory entry is
// swept by the prune timer.
function unsyncedStudentScope(sessionId: string, createdMs: number | undefined): string {
  return `${sessionId}:${typeof createdMs === 'number' ? createdMs : 0}`
}

function getUnsyncedStudentsKey(scope: string): string {
  return `${UNSYNCED_STUDENTS_KEY_PREFIX}${scope}`
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

// Folds the pre-migration scope (`<sessionId>:0`, used while a legacy record has
// no persisted `created`) into the incarnation scope once `created` has been
// synthesized and persisted by the first atomic write. Merges per-student
// markers (keeping the newer timestamp), prunes stale entries, then deletes the
// source key so the merge is one-shot.
const MERGE_UNSYNCED_STUDENTS_LUA = `
-- video-sync-unsynced-merge
local src = KEYS[1]
local dst = KEYS[2]
local nowMs = tonumber(ARGV[1])
local staleMs = tonumber(ARGV[2])
local ttlMs = tonumber(ARGV[3])
local srcData = redis.call('GET', src)
local dstData = redis.call('GET', dst)
local merged = dstData and cjson.decode(dstData) or {}

if srcData then
  local srcState = cjson.decode(srcData)
  for id, timestamp in pairs(srcState) do
    local existing = merged[id]
    if existing == nil or tonumber(timestamp) > tonumber(existing) then
      merged[id] = timestamp
    end
  end
  redis.call('DEL', src)
end

local count = 0
for id, timestamp in pairs(merged) do
  if nowMs - tonumber(timestamp) > staleMs then
    merged[id] = nil
  else
    count = count + 1
  end
end

if count == 0 then
  redis.call('DEL', dst)
else
  redis.call('SET', dst, cjson.encode(merged), 'PX', ttlMs)
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
  scope: string,
  script: string,
  args: Array<string | number>,
): Promise<number> {
  if (sessions.valkeyStore == null) {
    return 0
  }

  const result = await sessions.valkeyStore.client.eval(
    script,
    1,
    getUnsyncedStudentsKey(scope),
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

function clearUnsyncedStudentPruneTimer(scope: string): void {
  const existing = unsyncedStudentPruneTimersBySession.get(scope)
  if (!existing) {
    return
  }

  clearTimeout(existing)
  unsyncedStudentPruneTimersBySession.delete(scope)
}

function clearUnsyncedStudentState(scope: string): void {
  clearUnsyncedStudentPruneTimer(scope)
  unsyncedStudentsBySession.delete(scope)
}

// Session-level teardown: drop every incarnation's in-memory scope for this id.
function clearAllUnsyncedStudentStateForSession(sessionId: string): void {
  const prefix = `${sessionId}:`
  for (const scope of [...unsyncedStudentPruneTimersBySession.keys()]) {
    if (scope === sessionId || scope.startsWith(prefix)) clearUnsyncedStudentPruneTimer(scope)
  }
  for (const scope of [...unsyncedStudentsBySession.keys()]) {
    if (scope === sessionId || scope.startsWith(prefix)) unsyncedStudentsBySession.delete(scope)
  }
  migratedLegacyUnsyncedScopes.delete(sessionId)
}

// A legacy session record carries no persisted `created`, so every unsynced
// scope derives as `<sessionId>:0` (`getSessionCreatedIdentity` -> null). The
// first video-sync atomic write persists the synthesized `created`, after which
// `getSessionCreatedIdentity` returns a number and the scope moves to
// `<sessionId>:<created>`. Fold any markers/timer left under the `:0` scope into
// the incarnation scope so the count is not silently lost across that one-time
// transition. Runs at most once per session per process.
async function migrateLegacyUnsyncedScope(
  sessions: Pick<VideoSyncSessionStore, 'valkeyStore' | 'get' | 'set'>,
  sessionId: string,
  createdMs: number | undefined,
  nowMs = Date.now(),
): Promise<void> {
  if (createdMs == null || migratedLegacyUnsyncedScopes.has(sessionId)) {
    return
  }
  const legacyScope = unsyncedStudentScope(sessionId, undefined)
  const incarnationScope = unsyncedStudentScope(sessionId, createdMs)
  if (legacyScope === incarnationScope) {
    return
  }
  migratedLegacyUnsyncedScopes.add(sessionId)
  if (migratedLegacyUnsyncedScopes.size > MAX_MIGRATED_LEGACY_UNSYNCED_SCOPES) {
    const oldest = migratedLegacyUnsyncedScopes.values().next().value
    if (oldest !== undefined) migratedLegacyUnsyncedScopes.delete(oldest)
  }

  if (sessions.valkeyStore != null) {
    try {
      await sessions.valkeyStore.client.eval(
        MERGE_UNSYNCED_STUDENTS_LUA,
        2,
        getUnsyncedStudentsKey(legacyScope),
        getUnsyncedStudentsKey(incarnationScope),
        nowMs,
        UNSYNC_STALE_MS,
        UNSYNCED_STUDENTS_KEY_TTL_MS,
      )
    } catch (error) {
      // A failed fold leaves the `:0` key to self-expire via its TTL; the count
      // re-converges as unsynced students re-report drift. Do not block the
      // caller's telemetry refresh on it.
      migratedLegacyUnsyncedScopes.delete(sessionId)
      console.error(JSON.stringify({
        activity: 'video-sync',
        event: 'legacy-unsynced-scope-migration-failed',
        sessionId,
        errorName: error instanceof Error ? error.name : 'unknown',
      }))
    }
    return
  }

  // In-memory backend (tests / non-Valkey deploys): move the map entry and its
  // prune timer, merging per-student markers by newest timestamp.
  const legacyMap = unsyncedStudentsBySession.get(legacyScope)
  if (legacyMap && legacyMap.size > 0) {
    const target = unsyncedStudentsBySession.get(incarnationScope) ?? new Map<string, number>()
    for (const [studentId, timestampMs] of legacyMap) {
      const existing = target.get(studentId)
      if (existing == null || timestampMs > existing) target.set(studentId, timestampMs)
    }
    pruneStaleUnsyncedStudents(target, nowMs)
    if (target.size > 0) {
      unsyncedStudentsBySession.set(incarnationScope, target)
      clearUnsyncedStudentState(legacyScope)
      scheduleUnsyncedStudentsPrune(sessions, sessionId, createdMs, nowMs)
      return
    }
    unsyncedStudentsBySession.delete(incarnationScope)
  }
  clearUnsyncedStudentState(legacyScope)
}

async function refreshUnsyncedStudentsCount(
  sessions: VideoSyncSessionStore,
  data: VideoSyncSessionData,
  scope: string,
  nowMs = Date.now(),
): Promise<void> {
  if (sessions.valkeyStore != null) {
    data.telemetry.sync.unsyncedStudents = await runValkeyUnsyncedStudentCount(
      sessions,
      scope,
      COUNT_UNSYNCED_STUDENTS_LUA,
      [nowMs, UNSYNC_STALE_MS, UNSYNCED_STUDENTS_KEY_TTL_MS],
    )
    return
  }

  const studentMap = unsyncedStudentsBySession.get(scope)
  if (!studentMap) {
    data.telemetry.sync.unsyncedStudents = 0
    return
  }

  pruneStaleUnsyncedStudents(studentMap, nowMs)

  if (studentMap.size === 0) {
    unsyncedStudentsBySession.delete(scope)
    data.telemetry.sync.unsyncedStudents = 0
    return
  }

  data.telemetry.sync.unsyncedStudents = studentMap.size
}

async function markStudentUnsynced(
  sessions: VideoSyncSessionStore,
  scope: string,
  studentId: string,
  nowMs = Date.now(),
): Promise<number> {
  if (sessions.valkeyStore != null) {
    return runValkeyUnsyncedStudentCount(
      sessions,
      scope,
      UPSERT_UNSYNCED_STUDENT_LUA,
      [studentId, nowMs, UNSYNC_STALE_MS, MAX_UNSYNCED_STUDENTS_PER_SESSION, UNSYNCED_STUDENTS_KEY_TTL_MS],
    )
  }

  const existing = unsyncedStudentsBySession.get(scope)
  if (existing) {
    pruneStaleUnsyncedStudents(existing, nowMs)
    if (!existing.has(studentId) && existing.size >= MAX_UNSYNCED_STUDENTS_PER_SESSION) {
      return existing.size
    }
    existing.set(studentId, nowMs)
    return existing.size
  }

  unsyncedStudentsBySession.set(scope, new Map([[studentId, nowMs]]))
  return 1
}

async function clearStudentUnsynced(
  sessions: VideoSyncSessionStore,
  scope: string,
  studentId: string,
  nowMs = Date.now(),
): Promise<number> {
  if (sessions.valkeyStore != null) {
    return runValkeyUnsyncedStudentCount(
      sessions,
      scope,
      CLEAR_UNSYNCED_STUDENT_LUA,
      [studentId, nowMs, UNSYNC_STALE_MS, UNSYNCED_STUDENTS_KEY_TTL_MS],
    )
  }

  const existing = unsyncedStudentsBySession.get(scope)
  if (!existing) return 0

  existing.delete(studentId)
  if (existing.size === 0) {
    clearUnsyncedStudentState(scope)
    return 0
  }

  return existing.size
}

function getNextUnsyncedStudentPruneDelay(scope: string, nowMs = Date.now()): number | null {
  const studentMap = unsyncedStudentsBySession.get(scope)
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
  createdMs: number | undefined,
  nowMs = Date.now(),
): void {
  const scope = unsyncedStudentScope(sessionId, createdMs)
  clearUnsyncedStudentPruneTimer(scope)

  const delayMs = getNextUnsyncedStudentPruneDelay(scope, nowMs)
  if (delayMs == null) {
    return
  }

  const timer = setTimeout(() => {
    unsyncedStudentPruneTimersBySession.delete(scope)
    void (async () => {
      const pruneNowMs = Date.now()
      await withSessionMutation(sessionId, async () => {
        const studentMap = unsyncedStudentsBySession.get(scope)
        if (!studentMap) {
          return
        }

        pruneStaleUnsyncedStudents(studentMap, pruneNowMs)

        // Strict: telemetry-only writer, but the `sessions.set` below persists
        // the whole record - a cache-backed read could write a stale
        // `isPlaying: true` back over another instance's committed pause.
        const session = await getVideoSyncSession(sessions, sessionId, { strict: true })
        if (!session || (createdMs != null && getSessionCreatedIdentity(session) !== createdMs)) {
          // The id is gone, or was recreated as a different incarnation. This
          // scope's markers belong to the old one - drop them, do not persist.
          clearUnsyncedStudentState(scope)
          return
        }

        const data = ensureVideoSyncSessionData(session)
        const telemetryProbe = cloneTelemetry(data.telemetry)
        const probeData = { ...data, telemetry: telemetryProbe }
        await refreshUnsyncedStudentsCount(sessions as VideoSyncSessionStore, probeData, scope, pruneNowMs)

        if (telemetryProbe.sync.unsyncedStudents !== data.telemetry.sync.unsyncedStudents) {
          const committed = await updateVideoSyncSessionAtomic(sessions as VideoSyncSessionStore, sessionId, (_draft, latestData) => {
            latestData.telemetry.sync.unsyncedStudents = telemetryProbe.sync.unsyncedStudents
          }, { expectedCreated: createdMs })
          if (!committed) {
            // The id was deleted or recreated as a different incarnation between
            // the strict read above and this write. Drop the stale prune
            // bookkeeping instead of committing it to - and rescheduling it
            // against - the replacement session.
            clearUnsyncedStudentState(scope)
            return
          }
        }
      })

      if ((unsyncedStudentsBySession.get(scope)?.size ?? 0) > 0) {
        scheduleUnsyncedStudentsPrune(sessions, sessionId, createdMs, pruneNowMs)
      }
    })().catch((error: unknown) => {
      console.error(JSON.stringify({
        activity: 'video-sync',
        event: 'unsynced-student-prune-failed',
        sessionId,
        errorName: error instanceof Error ? error.name : 'unknown',
      }))
    })
  }, delayMs)

  unsyncedStudentPruneTimersBySession.set(scope, timer)
}

function normalizeVideoSyncSessionData(session: SessionRecord): {
  data: VideoSyncSessionData
  changed: boolean
} {
  const previousData = session.data
  const rawData = isPlainObject(previousData) ? previousData : {}
  const { instructorPasscode: _legacyInstructorPasscode, ...dataWithoutLegacyPasscode } = rawData
  const state = normalizeState(rawData.state)
  const telemetry = normalizeTelemetry(rawData.telemetry)

  const normalized: VideoSyncSessionData = {
    ...dataWithoutLegacyPasscode,
    standaloneMode: rawData.standaloneMode === true,
    state,
    telemetry,
    processedCommandIds: Array.isArray(rawData.processedCommandIds)
      ? rawData.processedCommandIds
        .filter((value): value is string => typeof value === 'string')
        .slice(-MAX_PROCESSED_COMMAND_IDS)
      : [],
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
    standaloneMode: data.standaloneMode,
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
  sessions: Pick<VideoSyncSessionStore, 'get' | 'getStrict'>,
  sessionId: string,
  options: { strict?: boolean } = {},
): Promise<VideoSyncSession | null> {
  const result = await getVideoSyncSessionWithNormalization(sessions, sessionId, options)
  return result.session
}

async function getVideoSyncSessionWithNormalization(
  sessions: Pick<VideoSyncSessionStore, 'get' | 'getStrict'>,
  sessionId: string,
  options: { strict?: boolean } = {},
): Promise<{
  session: VideoSyncSession | null
  data: VideoSyncSessionData | null
  didNormalizeSessionData: boolean
}> {
  // When strict, a backend read failure rejects (-> the route's outer catch ->
  // retryable 500) instead of mapping to `null`, which a manager client treats
  // as a definitive "session not found" and stops retrying.
  const read = options.strict && typeof sessions.getStrict === 'function'
    ? sessions.getStrict.bind(sessions)
    : sessions.get.bind(sessions)
  const session = await read(sessionId)
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

// Thrown inside the `updateAtomic` callback when the stored record is not the
// video-sync session incarnation the caller authorized (wrong `type`, or a
// deleted-then-recreated id with a different `created`), so the compare-and-set
// is abandoned rather than committing a no-op write that bumps
// `mutationRevision` and extends the TTL of a foreign session.
class WrongVideoSyncIncarnationError extends Error {}

async function updateVideoSyncSessionAtomic(
  sessions: VideoSyncSessionStore,
  sessionId: string,
  mutate: (session: VideoSyncSession, data: VideoSyncSessionData) => void,
  options: { expectedCreated?: number | null } = {},
): Promise<{ session: VideoSyncSession; data: VideoSyncSessionData } | null> {
  const { expectedCreated } = options
  const isAuthorizedIncarnation = (record: { type?: unknown; created?: unknown }): boolean =>
    record.type === 'video-sync' && (expectedCreated == null || record.created === expectedCreated)

  let result: { session: VideoSyncSession; data: VideoSyncSessionData } | null

  if (typeof sessions.updateAtomic === 'function') {
    let updated: SessionRecord | null
    try {
      updated = await sessions.updateAtomic(sessionId, (draft) => {
        if (!isAuthorizedIncarnation(draft)) throw new WrongVideoSyncIncarnationError()
        const data = ensureVideoSyncSessionData(draft)
        mutate(draft as VideoSyncSession, data)
        return draft
      })
    } catch (error) {
      if (error instanceof WrongVideoSyncIncarnationError) return null
      throw error
    }
    result = !updated || !isAuthorizedIncarnation(updated)
      ? null
      : { session: updated as VideoSyncSession, data: ensureVideoSyncSessionData(updated) }
  } else {
    // Test/minimal store compatibility. Production stores expose updateAtomic;
    // the existing per-process queue still serializes this fallback.
    const session = await getVideoSyncSession(sessions, sessionId, { strict: true })
    if (!session || !isAuthorizedIncarnation(session)) return null
    const data = ensureVideoSyncSessionData(session)
    mutate(session, data)
    await sessions.set(session.id, session)
    result = { session, data }
  }

  // `expectedCreated === null` is this call's own proof - from the caller's own
  // pre-write read, not a later ambient read - that the record was legacy (no
  // persisted `created`) right before this specific write. Only then can the
  // `:0` unsynced-student scope be trusted to belong to the SAME incarnation
  // this write just gave an identity to: a later read of an already-identified
  // session cannot tell whether leftover `:0` state is its own or belongs to an
  // unrelated, since-deleted incarnation that happened to reuse the same
  // session id, so it must not trigger the fold.
  if (expectedCreated === null && result != null) {
    const newCreated = getSessionCreatedIdentity(result.session)
    if (newCreated != null) {
      await migrateLegacyUnsyncedScope(sessions, sessionId, newCreated)
    }
  }

  return result
}

async function persistVideoSyncErrorAtomic(
  sessions: VideoSyncSessionStore,
  sessionId: string,
  error: VideoSyncTelemetry['error'],
  options: { expectedCreated?: number | null } = {},
): Promise<void> {
  await updateVideoSyncSessionAtomic(sessions, sessionId, (_session, data) => {
    data.telemetry.error = error
  }, options)
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
  createdMs: number | undefined,
  unsyncedStudentsCount?: number,
): Promise<void> {
  const sockets = subscribersBySession.get(sessionId)
  data.telemetry.connections.activeCount = sockets?.size ?? 0
  if (typeof unsyncedStudentsCount === 'number' && Number.isFinite(unsyncedStudentsCount)) {
    data.telemetry.sync.unsyncedStudents = Math.max(0, Math.floor(unsyncedStudentsCount))
    return
  }

  // The scope migration itself is triggered from `updateVideoSyncSessionAtomic`
  // (the specific write that persists a legacy record's first `created`), not
  // from this read: an ambient read here cannot prove `<id>:0` belongs to the
  // session it is currently looking at rather than an unrelated, since-deleted
  // incarnation that reused the same id.
  await refreshUnsyncedStudentsCount(sessions, data, unsyncedStudentScope(sessionId, createdMs))
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
  clearAllUnsyncedStudentStateForSession(sessionId)
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
        await withSessionMutation(sessionId, async () => {
        const sockets = subscribersBySession.get(sessionId)
        if (!sockets || sockets.size === 0) {
          stopHeartbeat(sessionId)
          return
        }

        // Strict (cache-bypassing) read: production is multi-instance and
        // `sessions.set` only refreshes the local cache, so a plain `get` here
        // can serve this instance's pre-pause snapshot for up to the 30s cache
        // TTL and rebroadcast `isPlaying:true` after another instance handled the
        // pause. ~1 extra Valkey GET / 3s / session.
        const { session, data } = await getVideoSyncSessionWithNormalization(
          sessions,
          sessionId,
          { strict: true },
        )
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
          getSessionCreatedIdentity(session) ?? undefined,
        )

        let broadcastState = heartbeatState
        let broadcastTelemetry = heartbeatTelemetry

        const persistHeartbeatTelemetry = shouldPersistHeartbeatTelemetry(data.telemetry, heartbeatTelemetry)
        const persistHeartbeatStopTransition = shouldPersistHeartbeatState(data.state, heartbeatState)
        if (persistHeartbeatTelemetry || persistHeartbeatStopTransition) {
          const committed = await updateVideoSyncSessionAtomic(sessions, sessionId, (_latest, latestData) => {
            latestData.telemetry.connections.activeCount = heartbeatTelemetry.connections.activeCount
            latestData.telemetry.sync.unsyncedStudents = heartbeatTelemetry.sync.unsyncedStudents
            const projectedLatest = applyStopIfReached(latestData.state)
            if (shouldPersistHeartbeatState(latestData.state, projectedLatest)) {
              latestData.state = {
                ...projectedLatest,
                playbackRevision: latestData.state.playbackRevision + 1,
              }
            }
          }, { expectedCreated: getSessionCreatedIdentity(session) })
          if (!committed) {
            // The session was deleted, is no longer `video-sync`, or was
            // recreated as a different incarnation between the strict read and
            // this mutation. Do not broadcast state with a fresh heartbeat
            // timestamp - a subscriber admitted against the ended incarnation
            // would accept it. Tear the heartbeat down instead.
            closeSubscribersForMissingSession(sessionId)
            stopHeartbeat(sessionId)
            return
          }
          broadcastState = applyStopIfReached(committed.data.state)
          broadcastTelemetry = cloneTelemetry(committed.data.telemetry)
        }

        const envelope = createEnvelope(sessionId, 'heartbeat', {
          state: broadcastState,
          telemetry: broadcastTelemetry,
        })
        await broadcastEnvelope(sessions, ws, sessionId, envelope)
        })
      } finally {
        if (heartbeatTimers.has(sessionId)) {
          heartbeatInFlightBySession.set(sessionId, false)
        } else {
          heartbeatInFlightBySession.delete(sessionId)
        }
      }
    })().catch((error: unknown) => {
      // The strict heartbeat read rejects on a Valkey outage; log it as
      // structured data so an expected transient blip is distinguishable from a
      // real regression.
      console.error(JSON.stringify({
        activity: 'video-sync',
        event: 'heartbeat-failed',
        sessionId,
        errorName: error instanceof Error ? error.name : 'unknown',
      }))
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

function hasManagerAuthority(session: VideoSyncSession, sessionId: string, req: RouteRequest): boolean {
  return resolveActivityPrincipalFromCookies(session, sessionId, 'manager', req.cookies) != null
}

function readBooleanField(body: unknown, key: string): boolean | null {
  if (!isPlainObject(body)) {
    return null
  }

  const value = body[key]
  return typeof value === 'boolean' ? value : null
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

      const capability = issueActivityCapability(session, 'manager')
      await sessions.set(session.id, session)
      writeActivityCapabilityCookie(res, session.id, 'manager', capability.token)
      res.json({ id: session.id })
    } catch (error) {
      console.error('Failed to create video-sync session:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to create session' })
    }
  })

  app.get('/api/video-sync/:sessionId/manager-access', async (req, res) => {
    // This response reflects the caller's cookies (manager capability / persistent
    // teacher auth) and can issue a Set-Cookie, so it must never be cached.
    setNoStore(res)
    const sessionId = resolveSessionId(req)
    if (!sessionId) {
      res.status(400).json({ error: 'INVALID_SESSION_ID', message: 'sessionId is required' })
      return
    }

    try {
      const {
        session,
        data,
      } = await getVideoSyncSessionWithNormalization(sessions, sessionId, { strict: true })
      if (!session || !data) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Session not found' })
        return
      }

      // Resolve any persistent recovery context up front. It gates capability
      // recovery below, but is also used to return canonical bootstrap data
      // (persistentSourceUrl) even when the caller is already authorized - a
      // just-authenticated teacher lands here with the manager cookie already set
      // and still needs its configured video to be recovered.
      //
      // Read the embedded-parent context before any persistent-store lookup:
      // embedded children never carry their own persistent-session hash, so the
      // recovery hash is always the parent's. Only a standalone session falls
      // back to a lookup keyed by its own id.
      //
      // Use the index-only lookup, not `findHashBySessionId`: this route runs
      // before any auth check, so an uncredentialed caller must not be able to
      // drive the O(n) `getAllHashes()` scan that `findHashBySessionId` falls
      // back to for ids with no reverse-index entry (every temporary session).
      // A live persistent session always has an index entry.
      const embeddedParentContext = readEmbeddedParentSessionContext(session.data)
      const recoveryActivityName = embeddedParentContext?.activityName ?? 'video-sync'
      const recoverySessionId = embeddedParentContext?.parentSessionId ?? sessionId

      // Does the caller already hold a valid manager capability? For such a
      // caller the persistent lookup below only enriches the response with
      // canonical bootstrap data, so a transient Valkey outage must degrade to
      // "no bootstrap data" rather than fail an already-authorized request. A
      // caller whose authorization depends on the lookup still gets a
      // retryable 500 (outer catch) on a store failure.
      const alreadyAuthorized = Boolean(
        resolveActivityPrincipalFromCookies(session, sessionId, 'manager', req.cookies),
      )

      let persistentHash: string | null = null
      let matchingEntry: ReturnType<typeof parsePersistentSessionsCookie>[number] | undefined
      let hasVerifiedTeacherCookie = false
      let persistentSourceUrl: string | null = null
      try {
        persistentHash = await findIndexedHashBySessionId(recoverySessionId)
        const sessionEntries = parsePersistentSessionsCookie(req.cookies?.persistent_sessions)
        matchingEntry = (persistentHash && recoveryActivityName)
          ? sessionEntries.find((entry) => entry.key === `${recoveryActivityName}:${persistentHash}`)
          : undefined
        if (
          !alreadyAuthorized
          && persistentHash
          && recoveryActivityName
          && persistentCookieEntryHasTeacherCodeCandidate(matchingEntry)
        ) {
          // Bound teacher-code guessing on this pre-auth, pollable endpoint the
          // same way POST /api/session/:sessionId/teacher-authenticate does -
          // the global middleware only rate-limits Brython assets, so without
          // this a caller could brute-force the persistent teacher code by
          // replaying requests with different `persistent_sessions` cookies. A
          // legitimate manager verifies once, receives the manager capability,
          // and is `alreadyAuthorized` on every later poll, so real users do
          // not accrue attempts. Only a request that actually carries a
          // teacher-code candidate is charged, so a forged/empty entry cannot
          // drain another client's shared bucket.
          // Strict: a limiter-backend outage rejects here (caught below and
          // rethrown for a non-authorized caller -> the route's outer catch ->
          // retryable 500) rather than failing open and treating every guess as
          // "allowed" while Valkey is unavailable.
          const attempt = await recordTeacherCodeAttemptStrict(`${resolveClientIp(req)}:${persistentHash}`)
          if (!attempt.allowed) {
            // Signal "wait and retry" - the attempt bucket clears after 60s. The
            // manager client treats 429 as transient (bounded delayed retry)
            // rather than a credential rejection, so a valid persistent manager
            // arriving inside the window is not latched read-only.
            res.set?.('Retry-After', String(TEACHER_CODE_ATTEMPT_WINDOW_SECONDS))
            res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', message: 'Too many teacher code attempts. Please wait a minute.' })
            return
          }
        }
        hasVerifiedTeacherCookie = Boolean(
          persistentHash
          && recoveryActivityName
          && matchingEntry
          && verifyTeacherCodeWithHash(recoveryActivityName, persistentHash, String(matchingEntry.teacherCode ?? '')).valid,
        )
        persistentSourceUrl = (persistentHash && matchingEntry && hasVerifiedTeacherCookie)
          ? readPersistentSourceUrlFromCookieEntry(persistentHash, matchingEntry)
          : null
      } catch (recoveryLookupError) {
        if (!alreadyAuthorized) {
          throw recoveryLookupError
        }
        console.error(JSON.stringify({
          activity: 'video-sync',
          event: 'manager-access-recovery-lookup-degraded',
          sessionId,
          errorName: recoveryLookupError instanceof Error ? recoveryLookupError.name : 'unknown',
        }))
      }
      const bootstrapPayload = persistentSourceUrl ? { persistentSourceUrl } : {}

      if (alreadyAuthorized) {
        res.json({ ...bootstrapPayload })
        return
      }

      if (!persistentHash || !recoveryActivityName || !matchingEntry || !hasVerifiedTeacherCookie) {
        res.status(403).json({ error: 'FORBIDDEN', message: 'Instructor credential recovery is not available for this session' })
        return
      }

      let recovery: 'issued' | 'session-missing'
      try {
        recovery = await withSessionMutation(sessionId, async () => {
          // Re-read inside the per-session queue: the checks above ran several
          // awaits (persistent-store lookups, teacher-code verification) during
          // which a command or heartbeat could have persisted newer playback
          // state onto the snapshot read at the top of this handler. Strict, so
          // a session deleted or replaced on another instance in that window
          // stays visible (rejects -> outer catch -> 500) instead of being
          // recreated by the set() below from a stale cache hit.
          let capabilityToken: string | null = null
          const committed = await updateVideoSyncSessionAtomic(sessions, sessionId, (freshSession) => {
            const capability = issueActivityCapability(freshSession, 'manager')
            capabilityToken = capability.token
          }, { expectedCreated: getSessionCreatedIdentity(session) })
          if (!committed || capabilityToken == null) {
            return 'session-missing'
          }
          writeActivityCapabilityCookie(res, sessionId, 'manager', capabilityToken)
          return 'issued'
        })
      } catch (error) {
        console.error(JSON.stringify({
          activity: 'video-sync',
          event: 'manager-capability-persistence-failed',
          sessionId,
          errorName: error instanceof Error ? error.name : 'unknown',
        }))
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Manager access is temporarily unavailable' })
        return
      }
      if (recovery === 'session-missing') {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Session not found' })
        return
      }
      res.json({ ...bootstrapPayload })
    } catch (lookupError) {
      console.error(JSON.stringify({
        activity: 'video-sync',
        event: 'manager-access-failed',
        sessionId,
        errorName: lookupError instanceof Error ? lookupError.name : 'unknown',
      }))
      if (!res.headersSent) {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Manager access is temporarily unavailable' })
      }
    }
  })

  app.get('/api/video-sync/:sessionId/session', async (req, res) => {
    const sessionId = resolveSessionId(req)
    if (!sessionId) {
      res.status(400).json({ error: 'INVALID_SESSION_ID', message: 'sessionId is required' })
      return
    }

    await withSessionMutationRoute(res, sessionId, 'session-read-failed', async () => {
    // Strict: the response carries `applyStopIfReached`'s re-stamped
    // `serverTimestampMs`, and a stop/normalization/telemetry change persists it.
    // A cache-backed read on a multi-instance deploy would hand a reconnecting
    // client a freshly stamped pre-pause `isPlaying:true` that its freshness
    // guard accepts over the authoritative paused state. A store outage stays a
    // retryable 500 via the surrounding route wrapper, not a 404.
    const {
      session,
      data,
      didNormalizeSessionData,
    } = await getVideoSyncSessionWithNormalization(sessions, sessionId, { strict: true })
    if (!session || !data) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Session not found' })
      return
    }

    const snapshotState = data.state
    const projectedState = applyStopIfReached(snapshotState)
    const projectedTelemetry = cloneTelemetry(data.telemetry)
    await updateConnectionTelemetry(
      sessions,
      {
        ...data,
        state: projectedState,
        telemetry: projectedTelemetry,
      },
      sessionId,
      getSessionCreatedIdentity(session) ?? undefined,
    )

    // Everything the public payload is built from. When a commit happens these
    // are replaced wholesale with the committed record, so a field a concurrent
    // config PATCH changed (e.g. `standaloneMode`) is not served stale from the
    // pre-persist snapshot.
    let responseData: VideoSyncSessionData = data
    let responseState = projectedState
    let responseTelemetry = projectedTelemetry

    if (
      didNormalizeSessionData ||
      shouldPersistHeartbeatState(snapshotState, projectedState) ||
      shouldPersistHeartbeatTelemetry(data.telemetry, projectedTelemetry)
    ) {
      const committed = await updateVideoSyncSessionAtomic(sessions, sessionId, (_latest, latestData) => {
        latestData.telemetry.connections.activeCount = projectedTelemetry.connections.activeCount
        latestData.telemetry.sync.unsyncedStudents = projectedTelemetry.sync.unsyncedStudents
        const projectedLatest = applyStopIfReached(latestData.state)
        if (shouldPersistHeartbeatState(latestData.state, projectedLatest)) {
          latestData.state = {
            ...projectedLatest,
            playbackRevision: latestData.state.playbackRevision + 1,
          }
        }
      }, { expectedCreated: getSessionCreatedIdentity(session) })
      if (!committed) {
        // Deleted or reused for a new incarnation between the strict read and
        // this persist. Do not serve the stale snapshot as a 200 - a
        // reconnecting client would accept an ended incarnation's state.
        res.status(404).json({ error: 'NOT_FOUND', message: 'Session not found' })
        return
      }
      responseData = committed.data
      responseState = applyStopIfReached(committed.data.state)
      responseTelemetry = committed.data.telemetry
    }

    res.json({
      id: session.id,
      type: session.type,
      data: toPublicSessionData({
        ...responseData,
        state: responseState,
        telemetry: responseTelemetry,
      }),
    })
    })
  })

  app.patch('/api/video-sync/:sessionId/session', async (req, res) => {
    const sessionId = resolveSessionId(req)
    if (!sessionId) {
      res.status(400).json({ error: 'INVALID_SESSION_ID', message: 'sessionId is required' })
      return
    }

    await withSessionMutationRoute(res, sessionId, 'session-configure-failed', async () => {
    const session = await getVideoSyncSession(sessions, sessionId, { strict: true })
    if (!session) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Session not found' })
      return
    }

    if (!hasManagerAuthority(session, sessionId, req)) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Manager capability is required' })
      return
    }

    const data = ensureVideoSyncSessionData(session)
    if (data.state.videoId.length > 0) {
      data.telemetry.error = {
        code: 'CONFIG_LOCKED',
        message: 'Video source is already configured for this session.',
      }
      await persistVideoSyncErrorAtomic(sessions, sessionId, data.telemetry.error, { expectedCreated: getSessionCreatedIdentity(session) })
      res.status(409).json({ error: 'CONFIG_LOCKED', message: data.telemetry.error.message })
      return
    }

    const body = isPlainObject(req.body) ? (req.body as ConfigBody) : {}
    const requestedStandaloneMode = readBooleanField(req.body, 'standaloneMode')

    if (typeof body.sourceUrl !== 'string' || body.sourceUrl.trim().length === 0) {
      data.telemetry.error = {
        code: 'INVALID_SOURCE_URL',
        message: INVALID_SOURCE_URL_MESSAGE,
      }
      await persistVideoSyncErrorAtomic(sessions, sessionId, data.telemetry.error, { expectedCreated: getSessionCreatedIdentity(session) })
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
      await persistVideoSyncErrorAtomic(sessions, sessionId, data.telemetry.error, { expectedCreated: getSessionCreatedIdentity(session) })
      res.status(400).json({ error: 'INVALID_STOP_SEC', message: data.telemetry.error.message })
      return
    }

    const parsedSource = parseYouTubeSource(body.sourceUrl.trim(), stopOverride)
    if (!parsedSource.ok) {
      if (parsedSource.reason === 'invalid-url') {
        data.telemetry.error = {
          code: 'INVALID_SOURCE_URL',
          message: INVALID_SOURCE_URL_MESSAGE,
        }
        await persistVideoSyncErrorAtomic(sessions, sessionId, data.telemetry.error, { expectedCreated: getSessionCreatedIdentity(session) })
        res.status(400).json({ error: 'INVALID_SOURCE_URL', message: data.telemetry.error.message })
        return
      }

      if (parsedSource.reason === 'invalid-time-range') {
        data.telemetry.error = {
          code: 'INVALID_TIME_RANGE',
          message: 'stopSec must be greater than startSec and both must be >= 0.',
        }
        await persistVideoSyncErrorAtomic(sessions, sessionId, data.telemetry.error, { expectedCreated: getSessionCreatedIdentity(session) })
        res.status(400).json({ error: 'INVALID_TIME_RANGE', message: data.telemetry.error.message })
        return
      }

      data.telemetry.error = {
        code: 'INVALID_VIDEO_ID',
        message: 'Could not determine a valid YouTube video id from sourceUrl.',
      }
      await persistVideoSyncErrorAtomic(sessions, sessionId, data.telemetry.error, { expectedCreated: getSessionCreatedIdentity(session) })
      res.status(400).json({ error: 'INVALID_VIDEO_ID', message: data.telemetry.error.message })
      return
    }

    const telemetryProbe = cloneTelemetry(data.telemetry)
    await updateConnectionTelemetry(sessions, { ...data, telemetry: telemetryProbe }, sessionId, getSessionCreatedIdentity(session) ?? undefined)
    let configured = false
    const committed = await updateVideoSyncSessionAtomic(sessions, sessionId, (_draft, latestData) => {
      configured = false
      if (latestData.state.videoId.length > 0) return
      const now = Date.now()
      latestData.state = {
        ...latestData.state,
        provider,
        playerHost: parsedSource.source.playerHost,
        videoId: parsedSource.source.videoId,
        startSec: parsedSource.source.startSec,
        stopSec: parsedSource.source.stopSec,
        positionSec: parsedSource.source.startSec,
        isPlaying: false,
        playbackRate: 1,
        updatedBy: 'instructor',
        playbackRevision: latestData.state.playbackRevision + 1,
        serverTimestampMs: now,
      }
      if (requestedStandaloneMode != null) latestData.standaloneMode = requestedStandaloneMode
      // Write only the two connection counters this route recomputed; a CAS
      // retry re-runs this callback against a fresh draft, and replacing the
      // whole telemetry object with the pre-mutation `telemetryProbe` clone
      // would discard fields another writer committed in that window
      // (`autoplay.blockedCount`, `sync.lastDriftSec`, ...).
      latestData.telemetry.connections.activeCount = telemetryProbe.connections.activeCount
      latestData.telemetry.sync.unsyncedStudents = telemetryProbe.sync.unsyncedStudents
      latestData.telemetry.error = { code: null, message: null }
      configured = true
    }, { expectedCreated: getSessionCreatedIdentity(session) })
    if (!committed) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Session not found' })
      return
    }
    if (!configured) {
      res.status(409).json({ error: 'CONFIG_LOCKED', message: 'Video source is already configured for this session.' })
      return
    }
    const committedData = committed.data

    const envelope = createEnvelope(sessionId, 'state-update', {
      state: committedData.state,
      telemetry: committedData.telemetry,
      reason: 'config-updated',
    })
    await broadcastEnvelope(sessions, ws, sessionId, envelope)

    res.json({ success: true, data: toPublicSessionData(committedData) })
    })
  })

  app.post('/api/video-sync/:sessionId/command', async (req, res) => {
    const sessionId = resolveSessionId(req)
    if (!sessionId) {
      res.status(400).json({ error: 'INVALID_SESSION_ID', message: 'sessionId is required' })
      return
    }

    await withSessionMutationRoute(res, sessionId, 'command-failed', async () => {
    // Strict: a command must mutate from authoritative Valkey state, not a
    // possibly-stale local cache on whichever instance received the POST. A
    // store outage stays a retryable 500 (outer catch) instead of a misleading
    // 404.
    const session = await getVideoSyncSession(sessions, sessionId, { strict: true })
    if (!session) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Session not found' })
      return
    }

    if (!hasManagerAuthority(session, sessionId, req)) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Manager capability is required' })
      return
    }

    const body = isPlainObject(req.body) ? (req.body as CommandBody) : {}
    if (!isCommandType(body.type)) {
      res.status(400).json({ error: 'INVALID_COMMAND', message: 'type must be play, pause, or seek' })
      return
    }

    const commandId = normalizeCommandId(body.commandId)
    if (body.commandId != null && commandId == null) {
      res.status(400).json({ error: 'INVALID_COMMAND_ID', message: 'commandId must be a non-empty string of at most 128 characters' })
      return
    }
    const managerId = normalizeCommandId(body.managerId)
    if (body.managerId != null && managerId == null) {
      res.status(400).json({ error: 'INVALID_MANAGER_ID', message: 'managerId must be a non-empty string of at most 128 characters' })
      return
    }
    const naturalCompletion = body.source === 'natural-ended'
    // `natural-ended` means the video reached its end; it can only pause. Reject
    // a `play` / `seek` carrying that source before the mutation so it cannot
    // set `isPlaying: true` via the ownership-gated path below.
    if (naturalCompletion && body.type !== 'pause') {
      res.status(400).json({ error: 'INVALID_COMMAND', message: 'A natural-ended command must be a pause.' })
      return
    }
    const expectedPlaybackRevision = typeof body.expectedPlaybackRevision === 'number' &&
      Number.isInteger(body.expectedPlaybackRevision) && body.expectedPlaybackRevision >= 0
      ? body.expectedPlaybackRevision
      : null

    const telemetryProbe = cloneTelemetry(ensureVideoSyncSessionData(session).telemetry)
    await updateConnectionTelemetry(sessions, {
      ...ensureVideoSyncSessionData(session),
      telemetry: telemetryProbe,
    }, sessionId, getSessionCreatedIdentity(session) ?? undefined)
    const activeCount = telemetryProbe.connections.activeCount
    const unsyncedStudents = telemetryProbe.sync.unsyncedStudents
    let duplicate = false
    let accepted = true
    const committed = await updateVideoSyncSessionAtomic(sessions, sessionId, (_draft, data) => {
      duplicate = false
      accepted = true
      if (commandId != null && data.processedCommandIds.includes(commandId)) {
        duplicate = true
        return
      }

      if (naturalCompletion) {
        // A natural end is accepted from any manager that holds a capability
        // (the request already passed `hasManagerAuthority`) as long as it
        // names the current playback revision. Binding it to `controllerId` -
        // a per-page id - permanently stranded playback as `isPlaying: true`
        // once the manager that issued Play reloaded, closed, or was
        // autoplay-blocked and only another manager's player reached the media
        // end; without a configured `stopSec` the server has no other end
        // detector. The revision match rejects a stale ENDED from a superseded
        // playback; the position check rejects an implausible early end.
        const reportedEndSec = typeof body.positionSec === 'number' && Number.isFinite(body.positionSec)
          ? clampSeconds(body.positionSec)
          : null
        const endIsPlausible = reportedEndSec != null &&
          reportedEndSec >= data.state.startSec &&
          (data.state.stopSec == null || reportedEndSec >= data.state.stopSec - NATURAL_END_TOLERANCE_SEC)
        if (
          managerId == null ||
          expectedPlaybackRevision == null ||
          expectedPlaybackRevision !== data.state.playbackRevision ||
          !endIsPlausible
        ) {
          accepted = false
          return
        }
      }

      const now = Date.now()
      const currentPosition = computeCurrentPositionSec(data.state, now)
      const requested = typeof body.positionSec === 'number' && Number.isFinite(body.positionSec)
        ? clampSeconds(body.positionSec)
        : body.type === 'seek'
          ? data.state.startSec
          : currentPosition
      const clamped = data.state.stopSec != null ? Math.min(requested, data.state.stopSec) : requested
      // v1: a seek always lands paused. `isPlaying` is true only for an explicit
      // `play`; `pause` and `seek` both stop, and resuming after a seek is a
      // separate `play` command.
      data.state = {
        ...data.state,
        positionSec: clamped,
        isPlaying: body.type === 'play',
        updatedBy: 'instructor',
        controllerId: managerId ?? data.state.controllerId,
        playbackRevision: data.state.playbackRevision + 1,
        serverTimestampMs: now,
      }
      data.state = applyStopIfReached(data.state, now)
      data.telemetry.connections.activeCount = activeCount
      data.telemetry.sync.unsyncedStudents = unsyncedStudents
      if (commandId != null) {
        data.processedCommandIds = [...data.processedCommandIds, commandId].slice(-MAX_PROCESSED_COMMAND_IDS)
      }
    }, { expectedCreated: getSessionCreatedIdentity(session) })
    if (!committed) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Session not found' })
      return
    }
    const { data } = committed

    if (!duplicate && accepted) {
      const envelope = createEnvelope(sessionId, 'state-update', {
        state: data.state,
        telemetry: data.telemetry,
        reason: body.type,
      })
      await broadcastEnvelope(sessions, ws, sessionId, envelope)
    }

    res.json({ success: true, data: toPublicSessionData(data) })
    })
  })

  app.post('/api/video-sync/:sessionId/event', async (req, res) => {
    const sessionId = resolveSessionId(req)
    if (!sessionId) {
      res.status(400).json({ error: 'INVALID_SESSION_ID', message: 'sessionId is required' })
      return
    }

    await withSessionMutationRoute(res, sessionId, 'event-failed', async () => {
    // Strict: this route mutates only telemetry, but `sessions.set` below
    // persists the whole record. A cache-backed read on a peer holding a
    // pre-pause snapshot would write `isPlaying: true` back to Valkey, which the
    // next strict heartbeat would then re-stamp and rebroadcast. The residual
    // sub-request race writes back `state` with an unchanged (older)
    // `serverTimestampMs`, which the client freshness guard rejects.
    const session = await getVideoSyncSession(sessions, sessionId, { strict: true })
    if (!session) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Session not found' })
      return
    }

    const body = isPlainObject(req.body) ? (req.body as EventBody) : {}
    if (!isEventType(body.type)) {
      res.status(400).json({ error: 'INVALID_EVENT', message: 'type must be autoplay-blocked, unsync, sync-correction, or load-failure' })
      return
    }

    let unsyncedStudentsCount: number | undefined
    const studentId = normalizeStudentId(body.studentId)
    // Scope the auxiliary bookkeeping to this session incarnation: if the atomic
    // write below is abandoned for a recreated id, this scope's markers/timer
    // stay isolated from the replacement's (Valkey key self-expires, in-memory
    // entry is swept by its own prune tick).
    const unsyncedScope = unsyncedStudentScope(sessionId, getSessionCreatedIdentity(session) ?? undefined)
    // If this session is legacy, this handler's own atomic write below (which
    // persists `created` for the first time) triggers the `<id>:0` ->
    // `<id>:<created>` fold via `updateVideoSyncSessionAtomic` - after the mark
    // below, so a marker recorded here is included in the fold.

    if (body.type === 'unsync') {
      if (studentId) {
        unsyncedStudentsCount = await markStudentUnsynced(sessions, unsyncedScope, studentId)
        if (sessions.valkeyStore == null) {
          scheduleUnsyncedStudentsPrune(sessions, sessionId, getSessionCreatedIdentity(session) ?? undefined)
        }
      }
    }

    if (body.type === 'sync-correction') {
      const correction = body.correctionResult
      if (studentId && correction === 'success') {
        unsyncedStudentsCount = await clearStudentUnsynced(sessions, unsyncedScope, studentId)
        if (sessions.valkeyStore == null) {
          scheduleUnsyncedStudentsPrune(sessions, sessionId, getSessionCreatedIdentity(session) ?? undefined)
        }
      }
    }

    const activeCount = subscribersBySession.get(sessionId)?.size ?? 0
    const committed = await updateVideoSyncSessionAtomic(sessions, sessionId, (_draft, latestData) => {
      latestData.telemetry.connections.activeCount = activeCount
      if (unsyncedStudentsCount != null) {
        latestData.telemetry.sync.unsyncedStudents = unsyncedStudentsCount
      }
      if (body.type === 'autoplay-blocked') {
        latestData.telemetry.autoplay.blockedCount += 1
      } else if (body.type === 'unsync') {
        const normalizedDriftSec = normalizeDriftSec(body.driftSec)
        latestData.telemetry.sync.lastDriftSec = normalizedDriftSec ?? latestData.telemetry.sync.lastDriftSec
        latestData.telemetry.sync.lastCorrectionResult = 'attempted'
      } else if (body.type === 'sync-correction') {
        const correction = body.correctionResult
        latestData.telemetry.sync.lastCorrectionResult =
          correction === 'success' || correction === 'failed' ? correction : 'attempted'
      } else {
        latestData.telemetry.sync.lastCorrectionResult = 'failed'
        const errorCode = normalizeTelemetryErrorField(body.errorCode, MAX_TELEMETRY_ERROR_CODE_LENGTH)
        const errorMessage = normalizeTelemetryErrorField(body.errorMessage, MAX_TELEMETRY_ERROR_MESSAGE_LENGTH)
        if (errorCode != null || errorMessage != null) {
          latestData.telemetry.error = { code: errorCode, message: errorMessage }
        }
      }
    }, { expectedCreated: getSessionCreatedIdentity(session) })
    if (!committed) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Session not found' })
      return
    }
    const telemetry = committed.data.telemetry

    const envelope = createEnvelope(sessionId, 'telemetry-update', {
      telemetry,
      reason: body.type,
    })
    await broadcastEnvelope(sessions, ws, sessionId, envelope)

    res.json({ success: true, telemetry })
    })
  })

  ws.register('/ws/video-sync', (socket, query) => {
    const sessionId = query.get('sessionId')
    const roleParam = query.get('role')

    if (!sessionId) {
      socket.close(1008, 'Missing sessionId')
      return
    }

    const typedSocket = socket as VideoSyncSocket
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
        await withSessionMutation(sessionId, async () => {
          // Strict: only `connections.activeCount` changes here, but the
          // `sessions.set` below persists the whole record - a cache-backed
          // read could write a stale `isPlaying: true` back to Valkey.
          const currentSession = await getVideoSyncSession(sessions, sessionId, { strict: true })
          if (!currentSession) {
            stopHeartbeat(sessionId)
            return
          }

          const telemetryProbe = cloneTelemetry(ensureVideoSyncSessionData(currentSession).telemetry)
          await updateConnectionTelemetry(sessions, {
            ...ensureVideoSyncSessionData(currentSession),
            telemetry: telemetryProbe,
          }, sessionId, getSessionCreatedIdentity(currentSession) ?? undefined)
          const committed = await updateVideoSyncSessionAtomic(sessions, sessionId, (_draft, latestData) => {
            latestData.telemetry.connections.activeCount = telemetryProbe.connections.activeCount
            latestData.telemetry.sync.unsyncedStudents = telemetryProbe.sync.unsyncedStudents
          }, { expectedCreated: getSessionCreatedIdentity(currentSession) })
          // `!committed` also covers a same-id delete+recreate between the strict
          // read and this write: do not publish this old socket's connection
          // update against the replacement session.
          if (!committed) return
          const currentData = committed.data

          const disconnectTelemetryUpdate = createEnvelope(sessionId, 'telemetry-update', {
            telemetry: currentData.telemetry,
            reason: 'connection-change',
          })
          await broadcastEnvelope(sessions, ws, sessionId, disconnectTelemetryUpdate)
        })

        if ((subscribersBySession.get(sessionId)?.size ?? 0) === 0) {
          stopHeartbeat(sessionId)
        }
      })().catch((error: unknown) => {
        // A strict read can reject on a Valkey outage; the heartbeat's own
        // `updateConnectionTelemetry` recomputes `activeCount` from the live
        // subscriber set on the next tick, so this is self-healing.
        console.error(JSON.stringify({
          activity: 'video-sync',
          event: 'socket-cleanup-failed',
          sessionId,
          errorName: error instanceof Error ? error.name : 'unknown',
        }))
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
        const managerPrincipal = resolveManagerSocketPrincipal(session, sessionId, typedSocket)
        if (!managerPrincipal) {
          typedSocket.close(1008, 'Forbidden')
          return
        }
        // Bound the socket to the capability's lifetime so it cannot keep
        // receiving manager state after the credential expires.
        scheduleManagerCapabilityExpiryClose(typedSocket, session, managerPrincipal.capabilityId)
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

      const data = await withSessionMutation(sessionId, async () => {
        const currentSession = await getVideoSyncSession(sessions, sessionId, { strict: true })
        if (!currentSession) return null
        const telemetryProbe = cloneTelemetry(ensureVideoSyncSessionData(currentSession).telemetry)
        await updateConnectionTelemetry(sessions, {
          ...ensureVideoSyncSessionData(currentSession),
          telemetry: telemetryProbe,
        }, sessionId, getSessionCreatedIdentity(currentSession) ?? undefined)
        // Bind the snapshot persist to the incarnation the socket was authorized
        // against (`session`, read for `resolveManagerSocketPrincipal` above). A
        // same-id delete/recreate in the await window would otherwise let a
        // stale manager socket receive the replacement session's snapshot.
        const committed = await updateVideoSyncSessionAtomic(sessions, sessionId, (_draft, latestData) => {
          latestData.telemetry.connections.activeCount = telemetryProbe.connections.activeCount
          latestData.telemetry.sync.unsyncedStudents = telemetryProbe.sync.unsyncedStudents
          const projected = applyStopIfReached(latestData.state)
          if (shouldPersistHeartbeatState(latestData.state, projected)) {
            latestData.state = {
              ...projected,
              playbackRevision: latestData.state.playbackRevision + 1,
            }
          }
        }, { expectedCreated: getSessionCreatedIdentity(session) })
        return committed?.data ?? null
      })

      if (!data) {
        typedSocket.close(1008, 'Session not found')
        return
      }

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
      console.error(JSON.stringify({
        activity: 'video-sync',
        event: 'initial-snapshot-failed',
        sessionId,
        errorName: error instanceof Error ? error.name : 'unknown',
      }))
      // A failure before the subscription was wired up (e.g. the not-found /
      // forbidden paths) closes the socket itself and leaves nothing to tear
      // down here.
      if (!isSubscribed) {
        return
      }
      // The broadcast subscription + heartbeat are wired up (above) before the
      // snapshot mutation that can throw here. Without this teardown the socket
      // stays in `subscribersBySession` and keeps receiving later envelopes
      // despite never getting an authoritative snapshot. `handleSocketClosed`
      // is idempotent (guarded by `cleanedUp`) and removes the subscriber,
      // rebroadcasts the connection count, and stops the now-orphaned
      // heartbeat; closing the socket lets the client reconnect cleanly.
      handleSocketClosed()
      if (typedSocket.readyState === WS_OPEN_READY_STATE) {
        typedSocket.close(1011, 'Initial snapshot failed')
      }
    })
  })
}
