import SessionHeader from '@src/components/common/SessionHeader'
import { fetchEmbeddedLaunchSelectedOptions } from '@src/components/common/embeddedLaunchBootstrap'
import {
  isEmbeddedManagerActivatedMessage,
  requestEmbeddedManagerBootstrapRefresh,
} from '@src/components/common/embeddedManagerBootstrap'
import { isEmbeddedChildSessionId } from '@src/components/common/sessionHeaderUtils'
import Button from '@src/components/ui/Button'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import { useEmbeddedManagerCapabilityExchange } from '@src/hooks/useEmbeddedManagerCapabilityExchange'
import { nextEmbeddedManagerBootstrapRefreshAttempt } from '@src/hooks/useEmbeddedManagerPasscodeExchange'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import {
  parseVideoSyncErrorMessagePayload,
  parseVideoSyncEnvelope,
  parseVideoSyncStateMessagePayload,
  parseVideoSyncTelemetryMessagePayload,
  type VideoSyncState,
  type VideoSyncTelemetry,
  type VideoSyncWsEnvelope,
} from '../protocol.js'
import {
  computeDesiredPositionSec,
  DEFAULT_DRIFT_TOLERANCE_SEC,
  shouldApplyIncomingVideoSyncState,
  shouldCorrectDrift,
} from '../syncMath.js'
import {
  loadYoutubeIframeApi,
  resolveYoutubePlayerState,
  type YoutubeNamespace,
  type YoutubePlayerLike,
} from '../youtubeIframeApi.js'
import { parseYouTubeStartSecondsFromUrl, parseYouTubeTimestampSeconds } from '../youtubeTimestamp.js'
import {
  DEFAULT_VIDEO_SYNC_PLAYER_HOST,
  formatVideoSyncPlayerHostLabel,
  resolveYoutubePlayerHostCandidates,
  type VideoSyncPlayerHost,
} from '../../shared/playerHosts.js'

interface SessionResponse {
  id?: string
  data?: {
    state?: VideoSyncState
    telemetry?: VideoSyncTelemetry
  }
}

interface ConfigResponse {
  data?: {
    state?: VideoSyncState
    telemetry?: VideoSyncTelemetry
  }
}

interface CommandResponse {
  data?: {
    state?: VideoSyncState
    telemetry?: VideoSyncTelemetry
  }
}

interface ManagerAccessResponse {
  persistentSourceUrl?: unknown
}

type AutoStartStatus = 'idle' | 'starting' | 'failed'

const YOUTUBE_MANAGER_LOAD_ERROR = 'YouTube player failed to load. Try a different video URL.'
const MISSING_MANAGER_ACCESS_ERROR = 'Manager access is unavailable. Open this session from the dashboard or authenticated permalink.'
const YOUTUBE_HOST_FALLBACK_TIMEOUT_MS = 1_500
const MANAGER_PLAYING_DRIFT_TOLERANCE_SEC = 2
const MANAGER_PLAYBACK_COMMAND_FLUSH_DELAY_MS = 120
// A command rejected for a transient reason (a 401/403 while the manager
// capability cookie is mid-refresh) keeps its intent and re-flushes a bounded
// number of times so `revalidateManagerAccess()` can restore authority before
// the gesture is dropped.
const MANAGER_PLAYBACK_COMMAND_RETRY_DELAY_MS = 600
const MAX_MANAGER_PLAYBACK_FLUSH_RETRIES = 3
const MAX_MANAGER_API_ERROR_MESSAGE_LENGTH = 160
// How long after genuine user activation an `onStateChange` still counts as an
// instructor gesture worth mirroring to the server. Beyond this, a play/pause
// transition is treated as involuntary (autoplay block, heartbeat-driven seek,
// buffering) and not echoed back as a command - otherwise two connected manager
// views ping-pong each other's stuck players into repeated pauses.
const MANAGER_USER_GESTURE_GRACE_MS = 4_000
const MANAGER_AUTOPLAY_CHECK_DELAY_MS = 1_200
const MANAGER_AUTOPLAY_BLOCKED_MESSAGE =
  'This browser blocked playback on the instructor view. Click once to start; playback then follows the shared session.'

const EMPTY_TELEMETRY: VideoSyncTelemetry = {
  connections: { activeCount: 0 },
  autoplay: { blockedCount: 0 },
  sync: { unsyncedStudents: 0, lastDriftSec: null, lastCorrectionResult: 'none' },
  error: { code: null, message: null },
}

const DEFAULT_STATE: VideoSyncState = {
  provider: 'youtube',
  playerHost: DEFAULT_VIDEO_SYNC_PLAYER_HOST,
  videoId: '',
  startSec: 0,
  stopSec: null,
  positionSec: 0,
  isPlaying: false,
  playbackRate: 1,
  updatedBy: 'system',
  serverTimestampMs: Date.now(),
}

function clampNumber(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export function readBootstrapSourceUrl(search: string): string | null {
  const value = new URLSearchParams(search).get('sourceUrl')
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function readRecoveredPersistentSourceUrl(payload: ManagerAccessResponse | null | undefined): string | null {
  const value = payload?.persistentSourceUrl
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function readEmbeddedBootstrapSourceUrl(selectedOptions: unknown): string | null {
  if (
    selectedOptions == null ||
    typeof selectedOptions !== 'object' ||
    Array.isArray(selectedOptions)
  ) {
    return null
  }

  const value = (selectedOptions as { sourceUrl?: unknown }).sourceUrl
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function buildManagerWsUrl(params: {
  sessionId: string | null | undefined
  location: Pick<Location, 'protocol' | 'host'> | null | undefined
}): string | null {
  if (!params.sessionId || params.location == null) {
    return null
  }

  const protocol = params.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${params.location.host}/ws/video-sync?sessionId=${encodeURIComponent(params.sessionId)}&role=instructor`
}

export function shouldRenderManagerHeaderForSession(sessionId: string | null | undefined): boolean {
  return !isEmbeddedChildSessionId(sessionId ?? undefined)
}

/** The `/manager-access` status for an exhausted teacher-code attempt bucket. */
export const MANAGER_ACCESS_RATE_LIMITED_STATUS = 429
/** Fallback wait before retrying a 429 when the route sends no usable `Retry-After`. */
export const DEFAULT_MANAGER_ACCESS_RETRY_AFTER_MS = 60_000

/**
 * Whether a non-OK `/manager-access` response is a fast transient failure worth
 * a short bounded backoff. The route returns an explicit 5xx for
 * persistent/session-store outages. A 429 (rate-limited teacher-code
 * verification) is also transient but handled separately with a longer,
 * `Retry-After`-honoring delay - see `parseManagerAccessRetryAfterMs`. Any other
 * 4xx is a definitive denial that latches the read-only state.
 */
export function isRetryableManagerAccessStatus(status: number): boolean {
  return status >= 500
}

/**
 * Parse a `Retry-After` header (delta-seconds form only) into milliseconds,
 * clamped to a sane ceiling. Returns `null` for an absent, non-numeric, or
 * non-positive value so the caller can fall back to
 * `DEFAULT_MANAGER_ACCESS_RETRY_AFTER_MS`.
 */
export function parseManagerAccessRetryAfterMs(headerValue: string | null | undefined): number | null {
  if (headerValue == null) return null
  const seconds = Number(headerValue.trim())
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return Math.min(seconds * 1000, 5 * 60_000)
}

/**
 * Whether a websocket close means the server rejected the connection for
 * missing manager authority (an expired capability), i.e. the manager should
 * re-run `/manager-access` rather than keep reconnecting. `1008` is the policy
 * violation code the manager socket uses for `Forbidden`.
 */
export function isManagerAuthorizationClose(code: number): boolean {
  return code === 1008
}

/**
 * Whether a definitive `/manager-access` denial should trigger a bounded parent
 * bootstrap-token refresh instead of latching read-only. Only an embedded child
 * frame can recover this way (its one-time entry token is gone from the URL, but
 * the parent can mint a new one); a standalone manager just latches. The caller
 * still applies the per-session attempt bound.
 */
export function shouldRequestEmbeddedBootstrapRefreshOnDenial(params: {
  sessionId: string | null | undefined
  status: number
}): boolean {
  if (params.status !== 401 && params.status !== 403) {
    return false
  }
  return isEmbeddedChildSessionId(params.sessionId ?? undefined)
}

export function shouldFetchEmbeddedBootstrapSourceUrl(params: {
  sessionId: string | null | undefined
  queryBootstrapSourceUrl: string | null
}): boolean {
  if (params.queryBootstrapSourceUrl != null) {
    return false
  }

  return isEmbeddedChildSessionId(params.sessionId ?? undefined)
}

export function shouldAutoStartBootstrapSource(params: {
  setupMode: boolean
  bootstrapSourceUrl: string | null
  isManagerAccessReady: boolean
  hasManagerAccess: boolean
  autoStartStatus: AutoStartStatus
}): boolean {
  return (
    params.setupMode &&
    params.bootstrapSourceUrl != null &&
    params.autoStartStatus !== 'failed' &&
    params.isManagerAccessReady &&
    params.hasManagerAccess
  )
}

export function shouldRecoverAutoStartAfterCredentialLoad(params: {
  setupMode: boolean
  bootstrapSourceUrl: string | null
  hasManagerAccess: boolean
  autoStartStatus: AutoStartStatus
  errorMessage: string | null
}): boolean {
  return (
    params.setupMode
    && params.bootstrapSourceUrl != null
    && params.hasManagerAccess
    && params.autoStartStatus === 'failed'
    && params.errorMessage === MISSING_MANAGER_ACCESS_ERROR
  )
}

export async function autoConfigureBootstrapSource(params: {
  bootstrapSourceUrl: string
  saveConfig: (sourceUrl: string) => Promise<boolean>
}): Promise<boolean> {
  return params.saveConfig(params.bootstrapSourceUrl)
}

export function clearManagerPlayerLoadError(message: string | null): string | null {
  return message === YOUTUBE_MANAGER_LOAD_ERROR ? null : message
}

export function sanitizeManagerApiErrorMessage(
  message: unknown,
  fallback: string,
): string {
  if (typeof message !== 'string') {
    return fallback
  }

  const trimmed = message.trim()
  if (trimmed.length === 0) {
    return fallback
  }

  if (trimmed.length <= MAX_MANAGER_API_ERROR_MESSAGE_LENGTH) {
    return trimmed
  }

  return `${trimmed.slice(0, MAX_MANAGER_API_ERROR_MESSAGE_LENGTH - 1).trimEnd()}…`
}

export function shouldApplyManagerStateUpdate(
  currentState: VideoSyncState,
  nextState: VideoSyncState,
): boolean {
  return !(currentState.videoId.length > 0 && nextState.videoId.length === 0)
}

export function shouldCorrectManagerPlaybackDrift(
  playerPositionSec: number,
  desiredPositionSec: number,
  isPlaying: boolean,
): boolean {
  return shouldCorrectDrift(
    playerPositionSec,
    desiredPositionSec,
    isPlaying ? MANAGER_PLAYING_DRIFT_TOLERANCE_SEC : DEFAULT_DRIFT_TOLERANCE_SEC,
  )
}

export function getManagerPlaybackIntentForStateChange(params: {
  eventState: number
  endedStateValue: number
  playingStateValue: number
  pausedStateValue: number
}): 'play' | 'pause' | null {
  if (params.eventState === params.playingStateValue) {
    return 'play'
  }

  if (params.eventState === params.pausedStateValue || params.eventState === params.endedStateValue) {
    return 'pause'
  }

  return null
}

/**
 * Whether a native `onStateChange` event should be recorded as a fresh
 * instructor playback intent.
 *
 * `applyStateToPlayer` programmatically calls `playVideo()` / `pauseVideo()`,
 * which each fire `onStateChange`; a blunt time-based mute (`suppressed`) is
 * armed around those calls so the echo is not sent straight back to the server
 * as a redundant command. The old guard dropped *every* event while muted,
 * which also discarded a genuine instructor click made inside the window.
 *
 * Instead, only drop the event that matches the transition `applyStateToPlayer`
 * just requested (`programmaticTarget`). An opposite-direction gesture - the
 * instructor hitting pause right after a programmatic play - is still recorded
 * and flushed. `flushManagerPlaybackIntent` independently no-ops a flush whose
 * intent already matches authoritative state, so a recorded echo costs nothing.
 */
export function resolveManagerStateChangeIntent(params: {
  suppressed: boolean
  nextIntent: 'play' | 'pause' | null
  programmaticTarget: 'play' | 'pause' | null
}): { record: boolean } {
  if (params.nextIntent == null) {
    return { record: false }
  }

  if (params.suppressed && params.nextIntent === params.programmaticTarget) {
    return { record: false }
  }

  return { record: true }
}

/**
 * The next value of the programmatic playback target after an `onStateChange`
 * event. The target absorbs exactly one echo of the transition
 * `applyStateToPlayer` requested: once any play-state event has been seen
 * (`nextIntent != null`) it is cleared, so a later same-direction instructor
 * click inside the same suppression window is not also swallowed as an echo.
 */
export function consumeProgrammaticPlaybackTarget(params: {
  nextIntent: 'play' | 'pause' | null
  programmaticTarget: 'play' | 'pause' | null
}): 'play' | 'pause' | null {
  return params.nextIntent == null ? params.programmaticTarget : null
}

/**
 * Whether an `onStateChange` transition is recent enough after genuine user
 * activation to mirror to the server as an instructor command.
 *
 * With several manager views open, a manager whose player cannot reach the
 * authoritative state - autoplay-blocked, mid-seek, buffering - emits
 * involuntary play/pause transitions. Echoing each one back as a command makes
 * the managers fight over playback (the classic symptom: a passive second
 * instructor's view re-pausing the video every few seconds). A real click on the
 * YouTube control bar gives the manager document transient user activation,
 * which propagates from the cross-origin iframe; an involuntary transition does
 * not. Browsers without `navigator.userActivation` keep the prior
 * mirror-always behavior.
 */
export function isManagerPlaybackGestureRecent(params: {
  userActivationSupported: boolean
  msSinceLastUserActivation: number
  graceMs?: number
}): boolean {
  if (!params.userActivationSupported) {
    return true
  }
  return params.msSinceLastUserActivation <= (params.graceMs ?? MANAGER_USER_GESTURE_GRACE_MS)
}

/**
 * Bounded retry decision for a playback command that failed to send (a transient
 * 401/403 while the manager capability is mid-refresh). Retries up to
 * `MAX_MANAGER_PLAYBACK_FLUSH_RETRIES`, then gives up and resets the counter.
 */
export function nextManagerPlaybackFlushRetry(
  currentRetryCount: number,
): { retry: boolean; nextRetryCount: number } {
  if (currentRetryCount < MAX_MANAGER_PLAYBACK_FLUSH_RETRIES) {
    return { retry: true, nextRetryCount: currentRetryCount + 1 }
  }
  return { retry: false, nextRetryCount: 0 }
}

function readManagerUserActivation(): { supported: boolean; isActive: boolean } {
  if (typeof navigator === 'undefined') {
    return { supported: false, isActive: false }
  }

  const activation = (navigator as Navigator & { userActivation?: { isActive?: unknown } }).userActivation
  if (activation == null || typeof activation.isActive !== 'boolean') {
    return { supported: false, isActive: false }
  }

  return { supported: true, isActive: activation.isActive }
}

export function shouldSendManagerPlaybackPositionUpdate(params: {
  authoritativeState: VideoSyncState
  desiredPositionSec: number | null
}): boolean {
  if (params.desiredPositionSec == null) {
    return false
  }

  const authoritativePositionSec = computeDesiredPositionSec(params.authoritativeState)
  return shouldCorrectDrift(
    params.desiredPositionSec,
    authoritativePositionSec,
    DEFAULT_DRIFT_TOLERANCE_SEC,
  )
}

export function parseManagerStopTimeInput(params: {
  sourceUrl: string
  stopTimeEnabled: boolean
  stopSecText: string
}): { stopSecValue: number | null; errorMessage: string | null } {
  if (!params.stopTimeEnabled) {
    return { stopSecValue: null, errorMessage: null }
  }

  const stopSecValue = parseYouTubeTimestampSeconds(params.stopSecText)
  if (stopSecValue == null) {
    return {
      stopSecValue: null,
      errorMessage: 'End time must be a valid number of seconds or h/m/s value like 1m23s.',
    }
  }

  const startSecValue = parseYouTubeStartSecondsFromUrl(params.sourceUrl.trim())
  if (startSecValue != null && stopSecValue <= startSecValue) {
    return {
      stopSecValue,
      errorMessage: 'End time must be greater than the YouTube URL start time.',
    }
  }

  return { stopSecValue, errorMessage: null }
}

export default function VideoSyncManager() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  const [state, setState] = useState<VideoSyncState>(DEFAULT_STATE)
  const [telemetry, setTelemetry] = useState<VideoSyncTelemetry>(EMPTY_TELEMETRY)
  const [sourceUrlInput, setSourceUrlInput] = useState('')
  const [stopSecInput, setStopSecInput] = useState('')
  const [hasStopTime, setHasStopTime] = useState(false)
  const [setupMode, setSetupMode] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [playerReady, setPlayerReady] = useState(false)
  const [activePlayerHost, setActivePlayerHost] = useState<VideoSyncPlayerHost | null>(null)
  const [managerAccessRefreshNonce, setManagerAccessRefreshNonce] = useState(0)
  // The /manager-access outcome, tagged with the session id and refresh nonce it
  // was resolved for. Readiness is derived from equality with the current values
  // so a parameter-only route swap can never expose the previous session's
  // authorization before its own check runs.
  const [managerAccessState, setManagerAccessState] = useState<
    { sessionId: string; nonce: number; granted: boolean; sourceUrl: string | null } | null
  >(null)
  const [autoStartStatus, setAutoStartStatus] = useState<AutoStartStatus>('idle')
  const [embeddedBootstrapSourceUrl, setEmbeddedBootstrapSourceUrl] = useState<string | null>(null)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)

  const playerContainerRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YoutubePlayerLike | null>(null)
  const youtubeRef = useRef<YoutubeNamespace | null>(null)
  const loadedVideoIdRef = useRef<string | null>(null)
  const latestStateRef = useRef<VideoSyncState>(DEFAULT_STATE)
  const desiredPlaybackIntentRef = useRef<'play' | 'pause' | null>(null)
  const desiredPlaybackPositionRef = useRef<number | null>(null)
  // The play/pause transition `applyStateToPlayer` last requested. Used to tell a
  // programmatic `onStateChange` echo apart from a real instructor gesture made
  // inside the suppression window.
  const programmaticPlaybackTargetRef = useRef<'play' | 'pause' | null>(null)
  const playbackFlushRetryCountRef = useRef(0)
  // Wall-clock of the last `onStateChange` that fired with genuine document user
  // activation. An involuntary transition (autoplay block, heartbeat seek,
  // buffering) has no recent activation and must not be mirrored as a command.
  const lastUserActivationAtRef = useRef(0)
  const playbackCommandInFlightRef = useRef(false)
  const playbackCommandFlushTimerRef = useRef<number | null>(null)
  const managerAutoplayCheckTimerRef = useRef<number | null>(null)
  const suppressPlayerEventsRef = useRef(false)
  const suppressPlayerEventsTimeoutRef = useRef<number | null>(null)
  const autoStartAttemptKeyRef = useRef<string | null>(null)
  const managerAccessBootstrapRefreshAttemptsRef = useRef<Map<string, number>>(new Map())
  const queryBootstrapSourceUrl = useMemo(() => readBootstrapSourceUrl(location.search), [location.search])
  const embeddedManagerCapabilityExchange = useEmbeddedManagerCapabilityExchange({
    sessionId: sessionId ?? undefined,
    search: location.search,
  })
  const managerAccessResolved =
    managerAccessState != null
    && managerAccessState.sessionId === sessionId
    && managerAccessState.nonce === managerAccessRefreshNonce
  const isManagerAccessReady = sessionId == null || managerAccessResolved
  const hasManagerAccess = managerAccessResolved && managerAccessState.granted

  // Re-run /manager-access after an authorization failure mid-session (a 1008
  // socket close or a protected-route 401/403): the manager capability cookie
  // has likely expired. The re-check re-issues for a persistent teacher and
  // latches read-only for a temporary manager, instead of reconnecting forever
  // with controls still enabled.
  const revalidateManagerAccess = useCallback(() => {
    setManagerAccessRefreshNonce((current) => current + 1)
  }, [])
  const persistentRecoverySourceUrl = managerAccessResolved ? managerAccessState.sourceUrl : null
  const bootstrapSourceUrl = persistentRecoverySourceUrl ?? queryBootstrapSourceUrl ?? embeddedBootstrapSourceUrl

  useEffect(() => {
    if (!shouldFetchEmbeddedBootstrapSourceUrl({ sessionId, queryBootstrapSourceUrl })) {
      setEmbeddedBootstrapSourceUrl(null)
      return
    }

    const embeddedSessionId = sessionId
    if (!embeddedSessionId) {
      setEmbeddedBootstrapSourceUrl(null)
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const selectedOptions = await fetchEmbeddedLaunchSelectedOptions(embeddedSessionId)
        if (!cancelled) {
          setEmbeddedBootstrapSourceUrl(readEmbeddedBootstrapSourceUrl(selectedOptions))
        }
      } catch {
        if (!cancelled) {
          setEmbeddedBootstrapSourceUrl(null)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [queryBootstrapSourceUrl, sessionId])

  // A parameter-only route swap (/manage/video-sync/A -> /manage/video-sync/B) reuses
  // this component instead of remounting it. Reset the session-scoped baseline so the
  // new session's snapshot is compared against its own state, not the previous
  // session's serverTimestampMs - otherwise an older timestamp on B would be rejected
  // by the freshness guard forever, leaving the manager controlling B while still
  // displaying A's video.
  useEffect(() => {
    latestStateRef.current = DEFAULT_STATE
    setState(DEFAULT_STATE)
    setTelemetry(EMPTY_TELEMETRY)
    setSetupMode(true)
  }, [sessionId])

  useEffect(() => {
    latestStateRef.current = state
  }, [state])

  const applyManagerStateUpdate = useCallback((nextState: VideoSyncState): void => {
    const currentState = latestStateRef.current
    if (
      !shouldApplyManagerStateUpdate(currentState, nextState) ||
      !shouldApplyIncomingVideoSyncState(currentState, nextState)
    ) {
      return
    }

    latestStateRef.current = nextState
    setSetupMode(nextState.videoId.length === 0)
    setState(nextState)
  }, [])

  const setSuppressPlayerEventsForWindow = useCallback((ms = 450): void => {
    suppressPlayerEventsRef.current = true
    if (suppressPlayerEventsTimeoutRef.current != null) {
      window.clearTimeout(suppressPlayerEventsTimeoutRef.current)
    }

    suppressPlayerEventsTimeoutRef.current = window.setTimeout(() => {
      suppressPlayerEventsRef.current = false
      suppressPlayerEventsTimeoutRef.current = null
    }, ms)
  }, [])

  const clearPlayerEventSuppression = useCallback(() => {
    suppressPlayerEventsRef.current = false
    if (suppressPlayerEventsTimeoutRef.current != null) {
      window.clearTimeout(suppressPlayerEventsTimeoutRef.current)
      suppressPlayerEventsTimeoutRef.current = null
    }
  }, [])

  const clearPlaybackCommandFlushTimer = useCallback(() => {
    if (playbackCommandFlushTimerRef.current != null) {
      window.clearTimeout(playbackCommandFlushTimerRef.current)
      playbackCommandFlushTimerRef.current = null
    }
  }, [])

  const clearManagerAutoplayCheckTimer = useCallback(() => {
    if (managerAutoplayCheckTimerRef.current != null) {
      window.clearTimeout(managerAutoplayCheckTimerRef.current)
      managerAutoplayCheckTimerRef.current = null
    }
  }, [])

  const sendCommand = useCallback(async (
    command: 'play' | 'pause' | 'seek',
    options?: { positionSec?: number; reportErrors?: boolean },
  ): Promise<boolean> => {
    if (!sessionId) {
      return false
    }
    if (!hasManagerAccess) {
      if (options?.reportErrors !== false) {
        setErrorMessage(MISSING_MANAGER_ACCESS_ERROR)
      }
      return false
    }

    const payload: Record<string, unknown> = { type: command }
    if (typeof options?.positionSec === 'number' && Number.isFinite(options.positionSec)) {
      payload.positionSec = clampNumber(options.positionSec)
    }
    try {
      const response = await fetch(`/api/video-sync/${sessionId}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          revalidateManagerAccess()
        }
        const failure = (await response.json()) as { message?: string }
        throw new Error(sanitizeManagerApiErrorMessage(failure.message, 'Failed to send command'))
      }

      const updated = (await response.json()) as CommandResponse
      if (updated.data?.state) {
        applyManagerStateUpdate(updated.data.state)
      }
      if (updated.data?.telemetry) {
        setTelemetry(updated.data.telemetry)
      }
      setErrorMessage(null)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send command'
      if (options?.reportErrors === false) {
        console.error('Video sync command failed:', message)
      } else {
        setErrorMessage(message)
      }
      return false
    }
  }, [applyManagerStateUpdate, hasManagerAccess, revalidateManagerAccess, sessionId])

  const flushManagerPlaybackIntent = useCallback(async (): Promise<void> => {
    clearPlaybackCommandFlushTimer()

    if (playbackCommandInFlightRef.current) {
      return
    }

    const desiredIntent = desiredPlaybackIntentRef.current
    if (desiredIntent == null) {
      return
    }

    const authoritativeState = latestStateRef.current
    const authoritativeIsPlaying = authoritativeState.isPlaying
    const shouldSendPositionUpdate = shouldSendManagerPlaybackPositionUpdate({
      authoritativeState,
      desiredPositionSec: desiredPlaybackPositionRef.current,
    })

    if ((desiredIntent === 'play') === authoritativeIsPlaying && !shouldSendPositionUpdate) {
      desiredPlaybackIntentRef.current = null
      desiredPlaybackPositionRef.current = null
      playbackFlushRetryCountRef.current = 0
      return
    }

    playbackCommandInFlightRef.current = true
    const didSend = await sendCommand(desiredIntent, {
      positionSec: desiredPlaybackPositionRef.current ?? undefined,
      reportErrors: false,
    })
    playbackCommandInFlightRef.current = false

    if (!didSend) {
      // Keep the intent and re-flush a bounded number of times: a transient
      // 401/403 has already triggered `revalidateManagerAccess()`, so a short
      // delayed retry lets the restored capability carry the gesture through
      // instead of silently dropping it.
      const { retry, nextRetryCount } = nextManagerPlaybackFlushRetry(playbackFlushRetryCountRef.current)
      playbackFlushRetryCountRef.current = nextRetryCount
      if (retry) {
        clearPlaybackCommandFlushTimer()
        playbackCommandFlushTimerRef.current = window.setTimeout(() => {
          void flushManagerPlaybackIntent()
        }, MANAGER_PLAYBACK_COMMAND_RETRY_DELAY_MS)
      } else {
        desiredPlaybackIntentRef.current = null
        desiredPlaybackPositionRef.current = null
      }
      return
    }

    playbackFlushRetryCountRef.current = 0
    setSuppressPlayerEventsForWindow(900)

    const nextDesiredIntent = desiredPlaybackIntentRef.current
    const nextAuthoritativeIsPlaying = latestStateRef.current.isPlaying
    if (nextDesiredIntent == null || (nextDesiredIntent === 'play') === nextAuthoritativeIsPlaying) {
      desiredPlaybackIntentRef.current = null
      desiredPlaybackPositionRef.current = null
      return
    }

    playbackCommandFlushTimerRef.current = window.setTimeout(() => {
      void flushManagerPlaybackIntent()
    }, MANAGER_PLAYBACK_COMMAND_FLUSH_DELAY_MS)
  }, [clearPlaybackCommandFlushTimer, sendCommand, setSuppressPlayerEventsForWindow])

  const scheduleManagerPlaybackIntentFlush = useCallback((delayMs = MANAGER_PLAYBACK_COMMAND_FLUSH_DELAY_MS): void => {
    clearPlaybackCommandFlushTimer()
    playbackCommandFlushTimerRef.current = window.setTimeout(() => {
      void flushManagerPlaybackIntent()
    }, delayMs)
  }, [clearPlaybackCommandFlushTimer, flushManagerPlaybackIntent])

  // `scheduleManagerPlaybackIntentFlush` is recreated whenever `sendCommand` is (its
  // `hasManagerAccess` dependency flips transiently during a 401/403
  // `revalidateManagerAccess()` cycle). Read the latest flush through a ref inside the
  // player-lifecycle effect below instead of depending on the callback directly, so an
  // access-cookie refresh does not tear down and rebuild the YouTube player - which
  // would also wipe the in-flight retry this callback schedules.
  const scheduleManagerPlaybackIntentFlushRef = useRef(scheduleManagerPlaybackIntentFlush)
  useEffect(() => {
    scheduleManagerPlaybackIntentFlushRef.current = scheduleManagerPlaybackIntentFlush
  }, [scheduleManagerPlaybackIntentFlush])

  const applyStateToPlayer = useCallback((nextState: VideoSyncState) => {
    const player = playerRef.current
    if (!player || !nextState.videoId) {
      return
    }

    setErrorMessage((current) => clearManagerPlayerLoadError(current))
    setSuppressPlayerEventsForWindow()

    const desiredPositionSec = computeDesiredPositionSec(nextState)

    if (loadedVideoIdRef.current !== nextState.videoId) {
      player.cueVideoById({
        videoId: nextState.videoId,
        startSeconds: desiredPositionSec,
        endSeconds: nextState.stopSec ?? undefined,
      })
      loadedVideoIdRef.current = nextState.videoId
    } else {
      const currentTimeSec = player.getCurrentTime()
      if (shouldCorrectManagerPlaybackDrift(currentTimeSec, desiredPositionSec, nextState.isPlaying)) {
        player.seekTo(desiredPositionSec, true)
      }
    }

    const { PLAYING } = resolveYoutubePlayerState(youtubeRef.current)
    const playerState = player.getPlayerState()

    // Record the transition being requested so `onStateChange` can drop only its
    // own programmatic echo while still capturing an opposing instructor gesture
    // that lands inside the suppression window.
    programmaticPlaybackTargetRef.current = nextState.isPlaying ? 'play' : 'pause'

    if (nextState.isPlaying) {
      if (playerState !== PLAYING) {
        player.playVideo()
      }

      // A programmatic play on this (unmuted) instructor view can be refused by
      // the browser autoplay policy - most likely on a second manager that has
      // not been interacted with. Surface a one-click affordance instead of
      // leaving the view silently stuck behind the shared session.
      clearManagerAutoplayCheckTimer()
      managerAutoplayCheckTimerRef.current = window.setTimeout(() => {
        const activePlayer = playerRef.current
        if (activePlayer !== player) {
          return
        }
        setAutoplayBlocked(activePlayer.getPlayerState() !== PLAYING)
      }, MANAGER_AUTOPLAY_CHECK_DELAY_MS)
    } else {
      clearManagerAutoplayCheckTimer()
      player.pauseVideo()
      setAutoplayBlocked(false)
    }
  }, [clearManagerAutoplayCheckTimer, setSuppressPlayerEventsForWindow])

  const retryManagerAutoplay = useCallback((): void => {
    const player = playerRef.current
    if (!player) {
      return
    }
    // Deliberate click -> this document now has user activation, so the play is
    // honored and `onStateChange` may legitimately mirror it.
    player.playVideo()
    setAutoplayBlocked(false)
  }, [])

  const fetchSession = useCallback(async (signal?: AbortSignal) => {
    if (!sessionId) return

    try {
      const response = await fetch(`/api/video-sync/${sessionId}/session`, { signal })
      if (!response.ok) {
        throw new Error('Failed to load video-sync session')
      }

      const data = (await response.json()) as SessionResponse
      // A route swap to another session aborts this request in the effect
      // cleanup; drop a response that resolved first so it cannot restore the
      // previous session's state over the freshly reset baseline.
      if (signal?.aborted) return
      if (data.data?.state) {
        applyManagerStateUpdate(data.data.state)
      }
      if (data.data?.telemetry) {
        setTelemetry(data.data.telemetry)
      }
      setErrorMessage(null)
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        return
      }
      const message = error instanceof Error ? error.message : 'Failed to load video-sync session'
      setErrorMessage(message)
    }
  }, [applyManagerStateUpdate, sessionId])

  const buildWsUrl = useCallback(() => {
    if (typeof window === 'undefined') return null
    return buildManagerWsUrl({
      sessionId,
      location: window.location,
    })
  }, [sessionId])

  useEffect(() => {
    if (!sessionId || typeof window === 'undefined') {
      return
    }
    if (embeddedManagerCapabilityExchange.isResolving) return

    const nonce = managerAccessRefreshNonce
    let isCancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    let rateLimitRetried = false
    const MAX_ATTEMPTS = 4
    // `isCancelled` blocks stale state writes; this also stops the in-flight
    // request so a slow `/manager-access` from a previous session cannot reach
    // the route and issue a capability / `sessions.set` for the old session
    // after a route swap.
    const accessController = new AbortController()

    const denyAccess = (): void => {
      if (!isCancelled) {
        setManagerAccessState({ sessionId, nonce, granted: false, sourceUrl: null })
      }
    }

    // An embedded child frame whose capability cookie expired or was cleared
    // cannot recover on its own - its one-time entry token is long gone from the
    // URL. Ask the still-authenticated parent for a fresh bootstrap token
    // (bounded by nextEmbeddedManagerBootstrapRefreshAttempt so a persistently
    // failing exchange cannot loop) and let the capability-exchange hook re-run,
    // instead of latching read-only on the first 401/403.
    const requestBoundedBootstrapRefresh = (): boolean => {
      const attemptsMap = managerAccessBootstrapRefreshAttemptsRef.current
      const nextAttempt = nextEmbeddedManagerBootstrapRefreshAttempt(attemptsMap.get(sessionId) ?? 0)
      if (nextAttempt == null) return false
      attemptsMap.set(sessionId, nextAttempt)
      requestEmbeddedManagerBootstrapRefresh(sessionId)
      return true
    }

    const runManagerAccess = async (): Promise<void> => {
      let response: Response
      try {
        response = await fetch(`/api/video-sync/${sessionId}/manager-access`, {
          credentials: 'include',
          signal: accessController.signal,
        })
      } catch {
        // Network error or an abort from cleanup; the `isCancelled` guard below
        // drops an aborted attempt so it never retries for an inactive effect.
        if (!isCancelled) scheduleRetryOrDeny()
        return
      }
      if (isCancelled) return
      if (!response.ok) {
        if (isRetryableManagerAccessStatus(response.status)) {
          scheduleRetryOrDeny()
        } else if (response.status === MANAGER_ACCESS_RATE_LIMITED_STATUS) {
          // The route rate-limits pre-auth teacher-code verification for a
          // minute and returns `Retry-After`. This is "wait and retry", not a
          // credential rejection: schedule one delayed retry across the window
          // before latching read-only, so a valid persistent manager that
          // happened to arrive mid-window still recovers.
          if (rateLimitRetried) {
            denyAccess()
          } else {
            rateLimitRetried = true
            const delayMs = parseManagerAccessRetryAfterMs(response.headers.get('retry-after'))
              ?? DEFAULT_MANAGER_ACCESS_RETRY_AFTER_MS
            if (!isCancelled) {
              retryTimer = setTimeout(() => { void runManagerAccess() }, delayMs)
            }
          }
        } else if (
          shouldRequestEmbeddedBootstrapRefreshOnDenial({ sessionId, status: response.status })
          && requestBoundedBootstrapRefresh()
        ) {
          // Parent asked for a new token; a fresh capability exchange re-runs
          // this effect (cleanup cancels the retry below). If the parent never
          // acknowledges - no new token, no `EMBEDDED_MANAGER_ACTIVATED` - the
          // scheduled retry re-checks `/manager-access` and, once the refresh
          // and retry budgets are spent, latches read-only via `denyAccess()`
          // instead of hanging on "Loading manager access..." forever.
          scheduleRetryOrDeny()
        } else {
          denyAccess()
        }
        return
      }
      try {
        const payload = (await response.json()) as ManagerAccessResponse
        if (!isCancelled) {
          managerAccessBootstrapRefreshAttemptsRef.current.delete(sessionId)
          setManagerAccessState({ sessionId, nonce, granted: true, sourceUrl: readRecoveredPersistentSourceUrl(payload) })
        }
      } catch {
        denyAccess()
      }
    }

    // Network errors and the route's explicitly temporary 5xx failures are
    // transient: retry with bounded backoff before latching the read-only
    // state. A 4xx is a definitive denial and latches immediately.
    const scheduleRetryOrDeny = (): void => {
      attempts += 1
      if (attempts >= MAX_ATTEMPTS) {
        denyAccess()
        return
      }
      retryTimer = setTimeout(() => { void runManagerAccess() }, 1000 * attempts)
    }

    // Defer one microtask so React Strict Mode's throwaway effect pass is
    // cancelled (isCancelled = true) before the fetch starts, instead of firing
    // two state-changing /manager-access requests - each consuming a rate-limit
    // attempt and racing the route's whole-session capability write - per mount.
    void Promise.resolve().then(() => {
      if (isCancelled) return
      void runManagerAccess()
    })
    return () => {
      isCancelled = true
      accessController.abort()
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [embeddedManagerCapabilityExchange.isResolving, managerAccessRefreshNonce, sessionId])

  const handleEnvelope = useCallback((envelope: VideoSyncWsEnvelope) => {
    if (envelope.type === 'state-update' || envelope.type === 'state-snapshot' || envelope.type === 'heartbeat') {
      const payload = parseVideoSyncStateMessagePayload(envelope.payload)
      if (payload?.state) {
        applyManagerStateUpdate(payload.state)
      }
      if (payload?.telemetry) {
        setTelemetry(payload.telemetry)
      }
      return
    }

    if (envelope.type === 'telemetry-update') {
      const payload = parseVideoSyncTelemetryMessagePayload(envelope.payload)
      if (payload?.telemetry) {
        setTelemetry(payload.telemetry)
      }
      return
    }

    if (envelope.type === 'error') {
      const payload = parseVideoSyncErrorMessagePayload(envelope.payload)
      if (typeof payload?.message === 'string' && payload.message.length > 0) {
        setErrorMessage(payload.message)
      }
    }
  }, [])

  useEffect(() => {
    if (setupMode) {
      setPlayerReady(false)
      loadedVideoIdRef.current = null
      desiredPlaybackIntentRef.current = null
      desiredPlaybackPositionRef.current = null
      programmaticPlaybackTargetRef.current = null
      playbackFlushRetryCountRef.current = 0
      playbackCommandInFlightRef.current = false
      clearPlaybackCommandFlushTimer()
      clearManagerAutoplayCheckTimer()
      setAutoplayBlocked(false)
      playerRef.current?.destroy()
      playerRef.current = null
      setActivePlayerHost(null)
      clearPlayerEventSuppression()
      return
    }

    if (!playerContainerRef.current || playerRef.current) {
      return
    }

    let cancelled = false
    let playerReadyTimeoutId: number | null = null
    let activeAttemptIndex = 0
    const playerHostCandidates = resolveYoutubePlayerHostCandidates(state.playerHost)
    const clearPlayerReadyTimeout = () => {
      if (playerReadyTimeoutId != null) {
        window.clearTimeout(playerReadyTimeoutId)
        playerReadyTimeoutId = null
      }
    }
    const resetPlayerInstance = (player: YoutubePlayerLike): void => {
      clearPlayerReadyTimeout()
      setPlayerReady(false)
      loadedVideoIdRef.current = null
      desiredPlaybackIntentRef.current = null
      desiredPlaybackPositionRef.current = null
      programmaticPlaybackTargetRef.current = null
      playbackFlushRetryCountRef.current = 0
      playbackCommandInFlightRef.current = false
      clearPlaybackCommandFlushTimer()
      clearManagerAutoplayCheckTimer()
      setAutoplayBlocked(false)
      clearPlayerEventSuppression()
      player.destroy()
      if (playerRef.current === player) {
        playerRef.current = null
      }
    }

    const initializePlayer = async (candidateIndex = 0): Promise<void> => {
      const candidate = playerHostCandidates[candidateIndex]
      if (!candidate) {
        setErrorMessage('Unable to initialize YouTube player.')
        return
      }

      const fallbackToNextHost = (player: YoutubePlayerLike): void => {
        if (cancelled || candidateIndex !== activeAttemptIndex) return
        const nextCandidateIndex = candidateIndex + 1
        if (nextCandidateIndex >= playerHostCandidates.length) {
          setErrorMessage(YOUTUBE_MANAGER_LOAD_ERROR)
          return
        }

        resetPlayerInstance(player)
        void initializePlayer(nextCandidateIndex)
      }
      const hasFallbackHost = candidateIndex + 1 < playerHostCandidates.length
      const armFallbackTimeout = (player: YoutubePlayerLike): void => {
        if (!hasFallbackHost) {
          clearPlayerReadyTimeout()
          return
        }

        clearPlayerReadyTimeout()
        playerReadyTimeoutId = window.setTimeout(() => {
          fallbackToNextHost(player)
        }, YOUTUBE_HOST_FALLBACK_TIMEOUT_MS)
      }

      try {
        activeAttemptIndex = candidateIndex
        setActivePlayerHost(candidate.playerHost)
        const youtube = await loadYoutubeIframeApi(candidate.iframeApiSrc)
        if (cancelled || candidateIndex !== activeAttemptIndex || !playerContainerRef.current) return

        youtubeRef.current = youtube
        const player = new youtube.Player(playerContainerRef.current, {
          width: '100%',
          height: '100%',
          host: candidate.hostUrl,
          playerVars: {
            controls: 1,
            rel: 0,
            modestbranding: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (cancelled || candidateIndex !== activeAttemptIndex) return
              // A refused education iframe can still complete wrapper setup.
              // Keep the fallback watchdog armed until the player emits state.
              armFallbackTimeout(player)
              setPlayerReady(true)
              setErrorMessage((current) => clearManagerPlayerLoadError(current))
              applyStateToPlayer(latestStateRef.current)
            },
            onStateChange: (event) => {
              if (cancelled || candidateIndex !== activeAttemptIndex) {
                return
              }

              clearPlayerReadyTimeout()
              // The player emitted a state event, so it did load - clear any
              // stale load-error banner even for our own muted echo.
              setErrorMessage((current) => clearManagerPlayerLoadError(current))

              const states = resolveYoutubePlayerState(youtubeRef.current)
              const nextIntent = getManagerPlaybackIntentForStateChange({
                eventState: event.data,
                endedStateValue: states.ENDED,
                playingStateValue: states.PLAYING,
                pausedStateValue: states.PAUSED,
              })

              // Playback actually started (possibly after a slow buffer that
              // tripped the autoplay-blocked check) - retire the affordance.
              if (nextIntent === 'play') {
                clearManagerAutoplayCheckTimer()
                setAutoplayBlocked(false)
              }

              const { record } = resolveManagerStateChangeIntent({
                suppressed: suppressPlayerEventsRef.current,
                nextIntent,
                programmaticTarget: programmaticPlaybackTargetRef.current,
              })

              // The programmatic target absorbs exactly one echo; clear it once
              // any play-state event has been seen so a later same-direction
              // instructor click within the same suppression window is not also
              // swallowed. (`flushManagerPlaybackIntent` still no-ops a redundant
              // flush, so a stray second echo costs nothing.)
              programmaticPlaybackTargetRef.current = consumeProgrammaticPlaybackTarget({
                nextIntent,
                programmaticTarget: programmaticPlaybackTargetRef.current,
              })

              if (!record) {
                return
              }

              // Only mirror a transition that follows genuine user activation of
              // this document. Without this, a manager whose player cannot reach
              // the shared state (autoplay-blocked, mid-seek, buffering) echoes
              // its involuntary pauses/plays back as commands, and connected
              // managers fight over playback.
              const activation = readManagerUserActivation()
              if (activation.supported && activation.isActive) {
                lastUserActivationAtRef.current = Date.now()
              }
              if (!isManagerPlaybackGestureRecent({
                userActivationSupported: activation.supported,
                msSinceLastUserActivation: Date.now() - lastUserActivationAtRef.current,
              })) {
                return
              }

              const target = event.target
              const playerPosition = clampNumber(target.getCurrentTime())

              // A fresh instructor gesture: restart the bounded transient-failure
              // retry budget for the flush that follows.
              playbackFlushRetryCountRef.current = 0
              desiredPlaybackIntentRef.current = nextIntent
              desiredPlaybackPositionRef.current = playerPosition
              scheduleManagerPlaybackIntentFlushRef.current()
            },
            onError: () => {
              if (cancelled || candidateIndex !== activeAttemptIndex) return
              if (hasFallbackHost) {
                fallbackToNextHost(player)
                return
              }
              setErrorMessage(YOUTUBE_MANAGER_LOAD_ERROR)
            },
          },
        })

        playerRef.current = player
        armFallbackTimeout(player)
      } catch {
        if (cancelled) {
          return
        }
        if (candidateIndex + 1 < playerHostCandidates.length) {
          void initializePlayer(candidateIndex + 1)
        } else {
          setErrorMessage('Unable to initialize YouTube player.')
        }
      }
    }

    void initializePlayer()

    return () => {
      cancelled = true
      clearPlayerReadyTimeout()
      setPlayerReady(false)
      loadedVideoIdRef.current = null
      desiredPlaybackIntentRef.current = null
      desiredPlaybackPositionRef.current = null
      programmaticPlaybackTargetRef.current = null
      playbackFlushRetryCountRef.current = 0
      playbackCommandInFlightRef.current = false
      clearPlaybackCommandFlushTimer()
      clearManagerAutoplayCheckTimer()
      setAutoplayBlocked(false)
      playerRef.current?.destroy()
      playerRef.current = null
      setActivePlayerHost(null)
      clearPlayerEventSuppression()
    }
  }, [
    applyStateToPlayer,
    clearManagerAutoplayCheckTimer,
    clearPlaybackCommandFlushTimer,
    clearPlayerEventSuppression,
    setupMode,
    state.playerHost,
  ])

  useEffect(() => {
    setStopSecInput(state.stopSec == null ? '' : String(state.stopSec))
    setHasStopTime(state.stopSec != null)
  }, [state.stopSec])

  useEffect(() => {
    if (!playerReady) return
    applyStateToPlayer(state)
  }, [playerReady, state, applyStateToPlayer])

  const { connect, disconnect } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(sessionId && hasManagerAccess && isManagerAccessReady),
    // A 1008 close is the server rejecting the socket for missing manager
    // authority (expired capability). Treat it as terminal so the hook stops
    // reconnecting, and re-run /manager-access to recover or latch read-only.
    isTerminalClose: (event) => isManagerAuthorizationClose(event.code),
    onClose: (event) => {
      if (isManagerAuthorizationClose(event.code)) {
        revalidateManagerAccess()
      }
    },
    onOpen: () => {},
    onMessage: (event) => {
      const envelope = parseVideoSyncEnvelope(event.data)
      if (!envelope || envelope.sessionId !== sessionId) return
      handleEnvelope(envelope)
    },
    onError: () => {
      setErrorMessage('Live updates unavailable. Attempting reconnect...')
    },
  })

  useEffect(() => {
    if (!sessionId) return undefined
    const sessionFetchController = new AbortController()
    void fetchSession(sessionFetchController.signal)
    if (isManagerAccessReady && hasManagerAccess) {
      connect()
    }
    return () => {
      sessionFetchController.abort()
      disconnect()
    }
  }, [sessionId, fetchSession, connect, disconnect, hasManagerAccess, isManagerAccessReady])

  useEffect(() => {
    if (!sessionId || typeof window === 'undefined' || window.parent === window) {
      return undefined
    }

    const handleParentMessage = (event: MessageEvent<unknown>): void => {
      if (event.origin !== window.location.origin || event.source !== window.parent) {
        return
      }
      if (isEmbeddedManagerActivatedMessage(event.data, sessionId)) {
        setManagerAccessRefreshNonce((current) => current + 1)
      }
    }

    window.addEventListener('message', handleParentMessage)
    return () => window.removeEventListener('message', handleParentMessage)
  }, [sessionId])

  const saveConfigWithValues = useCallback(async (
    sourceUrlValue: string,
    stopTimeEnabled: boolean,
    stopSecTextValue: string,
  ): Promise<boolean> => {
    if (!sessionId) return false
    if (!isManagerAccessReady) {
      setErrorMessage('Loading manager access...')
      return false
    }
    if (!hasManagerAccess) {
      setErrorMessage(MISSING_MANAGER_ACCESS_ERROR)
      return false
    }

    const parsedStopTimeInput = parseManagerStopTimeInput({
      sourceUrl: sourceUrlValue,
      stopTimeEnabled,
      stopSecText: stopSecTextValue,
    })
    if (parsedStopTimeInput.errorMessage) {
      setErrorMessage(parsedStopTimeInput.errorMessage)
      return false
    }
    const stopSecValue = parsedStopTimeInput.stopSecValue

    try {
      const response = await fetch(`/api/video-sync/${sessionId}/session`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceUrl: sourceUrlValue,
          stopSec: stopSecValue,
        }),
      })

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          revalidateManagerAccess()
        }
        const failure = (await response.json()) as { message?: string }
        throw new Error(sanitizeManagerApiErrorMessage(failure.message, 'Failed to save video config'))
      }

      const updated = (await response.json()) as ConfigResponse
      if (updated.data?.state) {
        applyManagerStateUpdate(updated.data.state)
      }
      if (updated.data?.telemetry) {
        setTelemetry(updated.data.telemetry)
      }
      setErrorMessage(null)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save video config'
      setErrorMessage(message)
      return false
    }
  }, [applyManagerStateUpdate, hasManagerAccess, isManagerAccessReady, revalidateManagerAccess, sessionId])

  const saveConfig = useCallback(async (): Promise<void> => {
    await saveConfigWithValues(sourceUrlInput, hasStopTime, stopSecInput)
  }, [hasStopTime, saveConfigWithValues, sourceUrlInput, stopSecInput])

  useEffect(() => {
    autoStartAttemptKeyRef.current = null
    setAutoStartStatus('idle')
  }, [bootstrapSourceUrl, sessionId])

  useEffect(() => {
    if (!setupMode || !bootstrapSourceUrl) {
      return
    }

    setSourceUrlInput((current) => (current.trim().length > 0 ? current : bootstrapSourceUrl))
  }, [bootstrapSourceUrl, setupMode])

  useEffect(() => {
    if (!setupMode || !bootstrapSourceUrl) {
      return
    }

    if (!isManagerAccessReady) {
      setAutoStartStatus('starting')
      return
    }

    if (!hasManagerAccess) {
      setAutoStartStatus('failed')
      return
    }

    if (!shouldAutoStartBootstrapSource({
      setupMode,
      bootstrapSourceUrl,
      isManagerAccessReady,
      hasManagerAccess,
      autoStartStatus,
    })) {
      return
    }

    const attemptKey = `${sessionId ?? ''}:${bootstrapSourceUrl}`
    if (autoStartAttemptKeyRef.current === attemptKey) {
      return
    }

    autoStartAttemptKeyRef.current = attemptKey
    setAutoStartStatus('starting')

    void (async () => {
      const ok = await autoConfigureBootstrapSource({
        bootstrapSourceUrl,
        saveConfig: async (sourceUrl) => saveConfigWithValues(sourceUrl, false, ''),
      })
      setAutoStartStatus(ok ? 'idle' : 'failed')
    })()
  }, [
    autoStartStatus,
    bootstrapSourceUrl,
    hasManagerAccess,
    isManagerAccessReady,
    saveConfigWithValues,
    sessionId,
    setupMode,
  ])

  useEffect(() => {
    if (!shouldRecoverAutoStartAfterCredentialLoad({
      setupMode,
      bootstrapSourceUrl,
      hasManagerAccess,
      autoStartStatus,
      errorMessage,
    })) {
      return
    }

    autoStartAttemptKeyRef.current = null
    setAutoStartStatus('idle')
    setErrorMessage((current) => (
      current === MISSING_MANAGER_ACCESS_ERROR ? null : current
    ))
  }, [autoStartStatus, bootstrapSourceUrl, errorMessage, hasManagerAccess, setupMode])

  const handleEndSession = async (): Promise<void> => {
    if (!sessionId) return
    await fetch(`/api/session/${sessionId}`, { method: 'DELETE' })
    void navigate('/manage')
  }

  const displayPosition = useMemo(() => computeDesiredPositionSec(state), [state])

  if (setupMode) {
    const shouldShowAutoStartSplash = bootstrapSourceUrl != null && autoStartStatus !== 'failed'
    const shouldRenderHeader = shouldRenderManagerHeaderForSession(sessionId)

    return (
      <div className="w-full p-4 space-y-4">
        {shouldRenderHeader ? (
          <SessionHeader
            activityName="Video Sync"
            sessionId={sessionId}
            onEndSession={handleEndSession}
          />
        ) : null}

        {errorMessage && (
          <div className="border border-red-300 bg-red-50 text-red-800 rounded p-3" role="alert">
            {errorMessage}
          </div>
        )}

        {shouldShowAutoStartSplash ? (
          <section className="max-w-2xl border rounded p-4 space-y-3" aria-labelledby="video-sync-autostart-heading">
            <h2 id="video-sync-autostart-heading" className="text-xl font-semibold">Preparing instructor view…</h2>
            <p className="text-gray-700">
              Loading the configured YouTube video from launch bootstrap and moving directly into the instructor view.
            </p>
            <p className="text-sm text-gray-600 break-all">{bootstrapSourceUrl}</p>
          </section>
        ) : (
          <section className="max-w-2xl border rounded p-4 space-y-3" aria-labelledby="video-sync-config-heading">
            <h2 id="video-sync-config-heading" className="text-xl font-semibold">Step 1: Configure video source</h2>
            <label className="block">
              <span className="block mb-1 font-medium">YouTube URL</span>
              <input
                className="border rounded p-2 w-full"
                type="url"
                value={sourceUrlInput}
                onChange={(event) => setSourceUrlInput(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=..., /embed/..., or https://youtu.be/..."
                aria-label="YouTube URL"
              />
              <span className="mt-1 block text-sm text-gray-600">
                Shared URLs can include `t`, `start`, and `end` timestamps like `1m23s`.
              </span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={hasStopTime}
                onChange={(event) => setHasStopTime(event.target.checked)}
                aria-controls="video-sync-stop-time"
                aria-expanded={hasStopTime}
              />
              <span className="font-medium">Set stop time</span>
            </label>

            {hasStopTime ? (
              <label id="video-sync-stop-time" className="block max-w-xs">
                <span className="block mb-1 font-medium">Stop at</span>
                <input
                  className="border rounded p-2 w-full"
                  type="text"
                  value={stopSecInput}
                  onChange={(event) => setStopSecInput(event.target.value)}
                  placeholder="2m10s or 130"
                  aria-label="Stop at"
                />
                <span className="mt-1 block text-sm text-gray-600">
                  Accepts seconds or `h/m/s` format.
                </span>
              </label>
            ) : null}

            <Button disabled={!isManagerAccessReady || !hasManagerAccess} onClick={() => void saveConfig()}>
              {!isManagerAccessReady
                ? 'Loading manager access...'
                : hasManagerAccess
                  ? 'Start instructor view'
                  : 'Manager access unavailable'}
            </Button>
          </section>
        )}
      </div>
    )
  }

  const shouldRenderHeader = shouldRenderManagerHeaderForSession(sessionId)

  return (
    <div className="fixed inset-0 z-30 bg-black text-white">
      {shouldRenderHeader ? (
        <div className="absolute top-0 left-0 right-0 z-20 px-3 py-2 bg-black/80 border-b border-white/10">
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0 flex items-center gap-3">
              <span className="font-semibold whitespace-nowrap">Video Sync Instructor</span>
              <span className="text-gray-300 truncate">Session: {sessionId ?? '—'}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button onClick={() => void handleEndSession()}>End session</Button>
            </div>
          </div>
        </div>
      ) : null}

      {errorMessage && (
        <div className={`absolute right-4 z-20 w-[min(28rem,calc(100vw-2rem))] border border-red-300 bg-red-50 text-red-800 rounded p-3 ${shouldRenderHeader ? 'top-20' : 'top-4'}`} role="alert">
          {errorMessage}
        </div>
      )}

      <div className="absolute inset-0 w-full h-full bg-black">
        {state.videoId ? (
          <div className="w-full h-full">
            <div ref={playerContainerRef} className="w-full h-full" aria-label="Video Sync manager preview" />
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-gray-300">
            Configure a YouTube URL to preview the synchronized video.
          </div>
        )}
      </div>

      {state.videoId && autoplayBlocked && (
        <div
          className="absolute bottom-16 right-4 z-20 w-[min(28rem,calc(100vw-2rem))] border border-amber-300 bg-amber-50 text-amber-900 rounded p-3 text-sm"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {MANAGER_AUTOPLAY_BLOCKED_MESSAGE}
          <div className="mt-2">
            <Button onClick={retryManagerAutoplay}>Click to start playback</Button>
          </div>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 z-20 px-4 py-2 bg-black/80 border-t border-white/10 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-200" aria-live="polite">
        <span>Video: {state.videoId || 'Not configured'}</span>
        <span>Host: {formatVideoSyncPlayerHostLabel(state.videoId ? activePlayerHost : null)}</span>
        <span>Playing: {state.isPlaying ? 'Yes' : 'No'}</span>
        <span>Position: {displayPosition.toFixed(2)}s</span>
        <span>Connections: {telemetry.connections.activeCount}</span>
        <span>Unsynced students: {telemetry.sync.unsyncedStudents}</span>
      </div>
    </div>
  )
}
