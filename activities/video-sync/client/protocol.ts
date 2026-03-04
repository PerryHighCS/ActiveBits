export type VideoSyncMessageType =
  | 'state-snapshot'
  | 'state-update'
  | 'heartbeat'
  | 'telemetry-update'
  | 'error'

export interface VideoSyncState {
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

export interface VideoSyncTelemetry {
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

export interface VideoSyncWsEnvelope<TPayload = unknown> {
  version: '1'
  activity: 'video-sync'
  sessionId: string
  type: VideoSyncMessageType
  timestamp: number
  payload: TPayload
}

export interface VideoSyncStateMessagePayload {
  state?: VideoSyncState
  telemetry?: VideoSyncTelemetry
}

export interface VideoSyncTelemetryMessagePayload {
  telemetry?: VideoSyncTelemetry
}

export interface VideoSyncErrorMessagePayload {
  message?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

export function isVideoSyncState(value: unknown): value is VideoSyncState {
  if (!isRecord(value)) {
    return false
  }

  return (
    value.provider === 'youtube' &&
    typeof value.videoId === 'string' &&
    isFiniteNumber(value.startSec) &&
    isNullableFiniteNumber(value.stopSec) &&
    isFiniteNumber(value.positionSec) &&
    typeof value.isPlaying === 'boolean' &&
    value.playbackRate === 1 &&
    (value.updatedBy === 'manager' || value.updatedBy === 'system') &&
    isFiniteNumber(value.serverTimestampMs)
  )
}

export function isVideoSyncTelemetry(value: unknown): value is VideoSyncTelemetry {
  if (!isRecord(value)) {
    return false
  }

  if (!isRecord(value.connections) || !isFiniteNumber(value.connections.activeCount)) {
    return false
  }

  if (!isRecord(value.autoplay) || !isFiniteNumber(value.autoplay.blockedCount)) {
    return false
  }

  if (!isRecord(value.sync)) {
    return false
  }

  if (
    !isFiniteNumber(value.sync.unsyncedStudents) ||
    !isNullableFiniteNumber(value.sync.lastDriftSec) ||
    (
      value.sync.lastCorrectionResult !== 'none' &&
      value.sync.lastCorrectionResult !== 'attempted' &&
      value.sync.lastCorrectionResult !== 'success' &&
      value.sync.lastCorrectionResult !== 'failed'
    )
  ) {
    return false
  }

  if (!isRecord(value.error)) {
    return false
  }

  return (
    (value.error.code === null || typeof value.error.code === 'string') &&
    (value.error.message === null || typeof value.error.message === 'string')
  )
}

export function parseVideoSyncStateMessagePayload(payload: unknown): VideoSyncStateMessagePayload | null {
  if (!isRecord(payload)) {
    return null
  }

  if ('state' in payload && payload.state !== undefined && !isVideoSyncState(payload.state)) {
    return null
  }

  if ('telemetry' in payload && payload.telemetry !== undefined && !isVideoSyncTelemetry(payload.telemetry)) {
    return null
  }

  return {
    state: isVideoSyncState(payload.state) ? payload.state : undefined,
    telemetry: isVideoSyncTelemetry(payload.telemetry) ? payload.telemetry : undefined,
  }
}

export function parseVideoSyncTelemetryMessagePayload(payload: unknown): VideoSyncTelemetryMessagePayload | null {
  if (!isRecord(payload)) {
    return null
  }

  if ('telemetry' in payload && payload.telemetry !== undefined && !isVideoSyncTelemetry(payload.telemetry)) {
    return null
  }

  return {
    telemetry: isVideoSyncTelemetry(payload.telemetry) ? payload.telemetry : undefined,
  }
}

export function parseVideoSyncErrorMessagePayload(payload: unknown): VideoSyncErrorMessagePayload | null {
  if (!isRecord(payload)) {
    return null
  }

  if ('message' in payload && payload.message !== undefined && typeof payload.message !== 'string') {
    return null
  }

  return {
    message: typeof payload.message === 'string' ? payload.message : undefined,
  }
}

function isVideoSyncMessageType(value: unknown): value is VideoSyncMessageType {
  return (
    value === 'state-snapshot' ||
    value === 'state-update' ||
    value === 'heartbeat' ||
    value === 'telemetry-update' ||
    value === 'error'
  )
}

export function parseVideoSyncEnvelope(raw: unknown): VideoSyncWsEnvelope | null {
  if (typeof raw !== 'string') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isRecord(parsed)) return null

  if (parsed.version !== '1' || parsed.activity !== 'video-sync') {
    return null
  }

  if (
    typeof parsed.sessionId !== 'string' ||
    !isVideoSyncMessageType(parsed.type) ||
    typeof parsed.timestamp !== 'number' ||
    !Number.isFinite(parsed.timestamp)
  ) {
    return null
  }

  return {
    version: '1',
    activity: 'video-sync',
    sessionId: parsed.sessionId,
    type: parsed.type,
    timestamp: parsed.timestamp,
    payload: parsed.payload,
  }
}
