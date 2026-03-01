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
    unsyncEvents: number
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
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

  if (typeof parsed.sessionId !== 'string' || typeof parsed.type !== 'string' || typeof parsed.timestamp !== 'number') {
    return null
  }

  return {
    version: '1',
    activity: 'video-sync',
    sessionId: parsed.sessionId,
    type: parsed.type as VideoSyncMessageType,
    timestamp: parsed.timestamp,
    payload: parsed.payload,
  }
}
