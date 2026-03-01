import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import { createBroadcastSubscriptionHelper } from 'activebits-server/core/broadcastUtils.js'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'

type VideoSyncRole = 'manager' | 'student'
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
  updatedBy: 'manager' | 'system'
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
}

interface RouteRequest {
  params: Record<string, string | undefined>
  body?: unknown
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

interface CommandBody {
  type?: unknown
  positionSec?: unknown
}

interface ConfigBody {
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

const HEARTBEAT_INTERVAL_MS = 3000
const UNSYNC_STALE_MS = 20_000
const WS_OPEN_READY_STATE = 1
const provider = 'youtube'
const subscribersBySession = new Map<string, Set<VideoSyncSocket>>()
const heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>()
const unsyncedStudentsBySession = new Map<string, Map<string, number>>()

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
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
  if (Number.isFinite(numeric)) {
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

function parseYouTubeSource(sourceUrl: string, stopOverride: number | null): ParsedVideoSource | null {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(sourceUrl)
  } catch {
    return null
  }

  const host = parsedUrl.hostname.toLowerCase()
  const isYouTubeHost = host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com'
  const isShortHost = host === 'youtu.be' || host === 'www.youtu.be'

  let videoId: string | null = null
  if (isYouTubeHost && parsedUrl.pathname === '/watch') {
    const raw = parsedUrl.searchParams.get('v')
    videoId = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null
  }

  if (isShortHost) {
    const raw = parsedUrl.pathname.slice(1).trim()
    videoId = raw.length > 0 ? raw : null
  }

  if (!videoId) {
    return null
  }

  const startFromUrl = parseTimestampSeconds(parsedUrl.searchParams.get('start') ?? parsedUrl.searchParams.get('t')) ?? 0
  const stopFromUrl = parseTimestampSeconds(parsedUrl.searchParams.get('end'))
  const stopSec = stopOverride ?? stopFromUrl

  if (stopSec != null && stopSec <= startFromUrl) {
    return null
  }

  return {
    videoId,
    startSec: startFromUrl,
    stopSec,
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

  return {
    provider,
    videoId: typeof source.videoId === 'string' ? source.videoId : '',
    startSec: clampSeconds(toFiniteNumber(source.startSec, 0)),
    stopSec: normalizedStop,
    positionSec: clampSeconds(toFiniteNumber(source.positionSec, 0)),
    isPlaying: source.isPlaying === true,
    playbackRate: 1,
    updatedBy: source.updatedBy === 'manager' ? 'manager' : 'system',
    serverTimestampMs: toFiniteNumber(source.serverTimestampMs, Date.now()),
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
      code: typeof error.code === 'string' ? error.code : null,
      message: typeof error.message === 'string' ? error.message : null,
    },
  }
}

function normalizeStudentId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 128) return null
  return trimmed
}

function refreshUnsyncedStudentsCount(data: VideoSyncSessionData, sessionId: string, nowMs = Date.now()): void {
  const studentMap = unsyncedStudentsBySession.get(sessionId)
  if (!studentMap) {
    data.telemetry.sync.unsyncedStudents = 0
    return
  }

  for (const [studentId, timestampMs] of studentMap.entries()) {
    if (nowMs - timestampMs > UNSYNC_STALE_MS) {
      studentMap.delete(studentId)
    }
  }

  if (studentMap.size === 0) {
    unsyncedStudentsBySession.delete(sessionId)
    data.telemetry.sync.unsyncedStudents = 0
    return
  }

  data.telemetry.sync.unsyncedStudents = studentMap.size
}

function markStudentUnsynced(sessionId: string, studentId: string, nowMs = Date.now()): void {
  const existing = unsyncedStudentsBySession.get(sessionId)
  if (existing) {
    existing.set(studentId, nowMs)
    return
  }

  unsyncedStudentsBySession.set(sessionId, new Map([[studentId, nowMs]]))
}

function clearStudentUnsynced(sessionId: string, studentId: string): void {
  const existing = unsyncedStudentsBySession.get(sessionId)
  if (!existing) return

  existing.delete(studentId)
  if (existing.size === 0) {
    unsyncedStudentsBySession.delete(sessionId)
  }
}

function ensureVideoSyncSessionData(session: SessionRecord): VideoSyncSessionData {
  const rawData = isPlainObject(session.data) ? session.data : {}
  const state = normalizeState(rawData.state)
  const telemetry = normalizeTelemetry(rawData.telemetry)

  const normalized: VideoSyncSessionData = {
    ...rawData,
    state,
    telemetry,
  }

  session.data = normalized
  return normalized
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
  const session = await sessions.get(sessionId)
  if (!session || session.type !== 'video-sync') {
    return null
  }

  ensureVideoSyncSessionData(session)
  return session as VideoSyncSession
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

function updateConnectionTelemetry(data: VideoSyncSessionData, sessionId: string): void {
  const sockets = subscribersBySession.get(sessionId)
  data.telemetry.connections.activeCount = sockets?.size ?? 0
  refreshUnsyncedStudentsCount(data, sessionId)
}

async function broadcastEnvelope(
  sessions: VideoSyncSessionStore,
  ws: WsRouter,
  sessionId: string,
  envelope: VideoSyncWsMessageEnvelope,
): Promise<void> {
  if (sessions.publishBroadcast) {
    try {
      await sessions.publishBroadcast(`session:${sessionId}:broadcast`, envelope as unknown as Record<string, unknown>)
    } catch (error) {
      console.error('Failed to publish video-sync broadcast:', error)
    }
  }

  const encoded = JSON.stringify(envelope)
  for (const client of ws.wss.clients) {
    if (client.readyState === WS_OPEN_READY_STATE && client.sessionId === sessionId) {
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
  if (!existing) return
  clearInterval(existing)
  heartbeatTimers.delete(sessionId)
  unsyncedStudentsBySession.delete(sessionId)
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
      const sockets = subscribersBySession.get(sessionId)
      if (!sockets || sockets.size === 0) {
        stopHeartbeat(sessionId)
        return
      }

      const session = await getVideoSyncSession(sessions, sessionId)
      if (!session) return

      const data = ensureVideoSyncSessionData(session)
      data.state = applyStopIfReached(data.state)
      updateConnectionTelemetry(data, sessionId)
      await sessions.set(session.id, session)

      const envelope = createEnvelope(sessionId, 'heartbeat', {
        state: data.state,
        telemetry: data.telemetry,
      })
      await broadcastEnvelope(sessions, ws, sessionId, envelope)
    })()
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
      res.json({ id: session.id })
    } catch (error) {
      console.error('Failed to create video-sync session:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to create session' })
    }
  })

  app.get('/api/video-sync/:sessionId/session', async (req, res) => {
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

    const data = ensureVideoSyncSessionData(session)
    data.state = applyStopIfReached(data.state)
    updateConnectionTelemetry(data, sessionId)
    await sessions.set(session.id, session)

    res.json({
      id: session.id,
      type: session.type,
      data,
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

    const data = ensureVideoSyncSessionData(session)
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
        code: 'INVALID_TIME_RANGE',
        message: 'stopSec must be greater than startSec and both must be >= 0.',
      }
      await sessions.set(session.id, session)
      res.status(400).json({ error: 'INVALID_TIME_RANGE', message: data.telemetry.error.message })
      return
    }

    const parsedSource = parseYouTubeSource(body.sourceUrl.trim(), stopOverride)
    if (!parsedSource) {
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
      videoId: parsedSource.videoId,
      startSec: parsedSource.startSec,
      stopSec: parsedSource.stopSec,
      positionSec: parsedSource.startSec,
      isPlaying: false,
      playbackRate: 1,
      updatedBy: 'manager',
      serverTimestampMs: now,
    }
    data.telemetry.error = { code: null, message: null }
    updateConnectionTelemetry(data, sessionId)

    await sessions.set(session.id, session)

    const envelope = createEnvelope(sessionId, 'state-update', {
      state: data.state,
      telemetry: data.telemetry,
      reason: 'config-updated',
    })
    await broadcastEnvelope(sessions, ws, sessionId, envelope)

    res.json({ success: true, data })
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
        updatedBy: 'manager',
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
        updatedBy: 'manager',
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
        updatedBy: 'manager',
        serverTimestampMs: now,
      }
    }

    data.state = applyStopIfReached(data.state, now)
    updateConnectionTelemetry(data, sessionId)
    await sessions.set(session.id, session)

    const envelope = createEnvelope(sessionId, 'state-update', {
      state: data.state,
      telemetry: data.telemetry,
      reason: body.type,
    })
    await broadcastEnvelope(sessions, ws, sessionId, envelope)

    res.json({ success: true, data })
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

    if (body.type === 'autoplay-blocked') {
      data.telemetry.autoplay.blockedCount += 1
    }

    const studentId = normalizeStudentId(body.studentId)

    if (body.type === 'unsync') {
      if (studentId) {
        markStudentUnsynced(sessionId, studentId)
      }
      data.telemetry.sync.lastDriftSec =
        typeof body.driftSec === 'number' && Number.isFinite(body.driftSec) ? body.driftSec : data.telemetry.sync.lastDriftSec
      data.telemetry.sync.lastCorrectionResult = 'attempted'
    }

    if (body.type === 'sync-correction') {
      const correction = body.correctionResult
      if (studentId && correction === 'success') {
        clearStudentUnsynced(sessionId, studentId)
      }
      data.telemetry.sync.lastCorrectionResult =
        correction === 'success' || correction === 'failed' ? correction : 'attempted'
    }

    if (body.type === 'load-failure') {
      data.telemetry.sync.lastCorrectionResult = 'failed'
    }

    if (typeof body.errorCode === 'string' || typeof body.errorMessage === 'string') {
      data.telemetry.error = {
        code: typeof body.errorCode === 'string' ? body.errorCode : null,
        message: typeof body.errorMessage === 'string' ? body.errorMessage : null,
      }
    }

    updateConnectionTelemetry(data, sessionId)
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

    const role: VideoSyncRole = roleParam === 'manager' ? 'manager' : 'student'
    const typedSocket = socket as VideoSyncSocket
    typedSocket.sessionId = sessionId
    typedSocket.videoSyncRole = role

    ensureBroadcastSubscription(sessionId)
    upsertSubscriber(sessionId, typedSocket)
    ensureHeartbeat(sessions, ws, sessionId)

    ;(async () => {
      const session = await getVideoSyncSession(sessions, sessionId)
      if (!session) {
        const errorEnvelope = createEnvelope(sessionId, 'error', {
          code: 'NOT_FOUND',
          message: 'Session not found',
        })
        typedSocket.send(JSON.stringify(errorEnvelope))
        typedSocket.close(1008, 'Session not found')
        return
      }

      const data = ensureVideoSyncSessionData(session)
      data.state = applyStopIfReached(data.state)
      updateConnectionTelemetry(data, sessionId)
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

    const handleSocketClosed = () => {
      removeSubscriber(sessionId, typedSocket)
      void (async () => {
        const session = await getVideoSyncSession(sessions, sessionId)
        if (!session) {
          stopHeartbeat(sessionId)
          return
        }

        const data = ensureVideoSyncSessionData(session)
        updateConnectionTelemetry(data, sessionId)
        await sessions.set(session.id, session)

        const telemetryUpdate = createEnvelope(sessionId, 'telemetry-update', {
          telemetry: data.telemetry,
          reason: 'connection-change',
        })
        await broadcastEnvelope(sessions, ws, sessionId, telemetryUpdate)

        if ((subscribersBySession.get(sessionId)?.size ?? 0) === 0) {
          stopHeartbeat(sessionId)
        }
      })()
    }

    socket.on('close', handleSocketClosed)
    socket.on('error', handleSocketClosed)
  })
}
