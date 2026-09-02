import type { VideoSyncState } from './protocol.js'

export const DEFAULT_DRIFT_TOLERANCE_SEC = 0.2

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

type IncomingStateGuardFields = Pick<
  VideoSyncState,
  'videoId' | 'updatedBy' | 'playbackRevision' | 'serverTimestampMs'
>

/**
 * Whether an incoming `state-update` / `state-snapshot` / `heartbeat` frame is
 * fresh enough to apply, given the state already applied locally. This is the
 * client's last line of defence against a stale frame - typically a heartbeat
 * from a multi-instance peer whose local session cache still holds pre-pause
 * state - silently resuming playback after an instructor pause.
 *
 * Rules:
 * - Always apply while still unconfigured (`currentState.videoId === ''`): the
 *   client boots from an empty default, so the first real snapshot and the
 *   empty -> configured transition must always land.
 * - Otherwise reject a frame whose `serverTimestampMs` is strictly older than
 *   what is applied: a late / duplicate / reordered frame that would revert
 *   newer state. A different `videoId` is not a bypass - the server blocks
 *   re-configuration once a video is set, so a configured -> different-id frame
 *   with an older timestamp is a stale frame for the previous video, and a
 *   genuine reconfigure always carries a newer timestamp anyway.
 * - On an identical `serverTimestampMs`, reject a non-instructor frame when the
 *   applied state is instructor-authored, so a heartbeat cannot override a
 *   command committed in the same millisecond.
 */
export function shouldApplyIncomingVideoSyncState(
  currentState: IncomingStateGuardFields,
  nextState: IncomingStateGuardFields,
): boolean {
  if (currentState.videoId.length === 0) {
    return true
  }

  const currentRevision = currentState.playbackRevision ?? 0
  const nextRevision = nextState.playbackRevision ?? 0
  if (nextRevision !== currentRevision) {
    return nextRevision > currentRevision
  }

  if (nextState.serverTimestampMs < currentState.serverTimestampMs) {
    return false
  }

  if (
    nextState.serverTimestampMs === currentState.serverTimestampMs &&
    currentState.updatedBy === 'instructor' &&
    nextState.updatedBy !== 'instructor'
  ) {
    return false
  }

  return true
}
