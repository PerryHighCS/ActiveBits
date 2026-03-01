import type { VideoSyncState } from './protocol'

export const DEFAULT_DRIFT_TOLERANCE_SEC = 0.75

export function clampPositionSec(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, value)
}

export function computeDesiredPositionSec(state: VideoSyncState, nowMs = Date.now()): number {
  const basePosition = clampPositionSec(state.positionSec)
  const projected = state.isPlaying
    ? basePosition + Math.max(0, (nowMs - state.serverTimestampMs) / 1000)
    : basePosition

  if (state.stopSec == null) {
    return clampPositionSec(projected)
  }

  return Math.min(clampPositionSec(projected), state.stopSec)
}

export function computeDriftSec(playerPositionSec: number, desiredPositionSec: number): number {
  const player = clampPositionSec(playerPositionSec)
  const desired = clampPositionSec(desiredPositionSec)
  return Math.abs(player - desired)
}

export function shouldCorrectDrift(
  playerPositionSec: number,
  desiredPositionSec: number,
  toleranceSec = DEFAULT_DRIFT_TOLERANCE_SEC,
): boolean {
  return computeDriftSec(playerPositionSec, desiredPositionSec) > toleranceSec
}
