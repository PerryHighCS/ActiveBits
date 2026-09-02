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

// `retryableAuth` controls whether the intent queue should retry after this
// request finishes. An ambiguous transport failure is retried once inside
// `sendCommand` with the same server-deduplicated command ID instead.
type SendCommandResult = { ok: true } | { ok: false; retryableAuth: boolean }

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
  controllerId: null,
  playbackRevision: 0,
  serverTimestampMs: Date.now(),
}

function clampNumber(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export function createManagerPlaybackCommandId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
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

/**
 * What `flushManagerPlaybackIntent` should do once `sendCommand` returns.
 * A bounded retry is only ever appropriate for a confirmed auth failure
 * (`retryableAuth`); permanent failures are dropped after `sendCommand` has
 * already performed its safe command-id de-duplicated transport retry.
 */
export function resolveManagerPlaybackFlushOutcome(params: {
  result: SendCommandResult
  currentRetryCount: number
}): { action: 'done' | 'retry' | 'drop'; nextRetryCount: number } {
  if (params.result.ok) {
    return { action: 'done', nextRetryCount: 0 }
  }
  if (params.result.retryableAuth) {
    const { retry, nextRetryCount } = nextManagerPlaybackFlushRetry(params.currentRetryCount)
    if (retry) {
      return { action: 'retry', nextRetryCount }
    }
  }
  return { action: 'drop', nextRetryCount: 0 }
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

/**
 * Validate the instructor "Seek to" text input before it becomes a `seek`
 * command. A `type="number"` field still permits an empty value, and
 * `Number.parseFloat('')` is `NaN`, so this guards clearing the field and
 * clicking Seek as well as any other non-finite entry. Range clamping is the
 * server's job (`clampSeconds`), so a negative number is passed through here.
 */
export function resolveManagerSeekRequest(
  input: string,
): { ok: true; positionSec: number } | { ok: false; message: string } {
  const positionSec = Number.parseFloat(input)
  if (!Number.isFinite(positionSec)) {
    return { ok: false, message: 'Seek position must be a finite number of seconds.' }
  }
  return { ok: true, positionSec }
}

/**
 * The `positionSec` an explicit Play/Pause command should carry. Normally
 * `null` - play/pause acts at the server-projected authoritative position so a
 * lagging manager cannot rewind the class. The exception is Play after this
 * player emitted a natural `ENDED`: the server's projected position is the end
 * of the completed playback, so a plain Play would immediately re-pause (with
 * `stopSec`) or project past the video (without it). Restart from `startSec`.
 */
export function resolveExplicitPlaybackPositionSec(params: {
  intent: 'play' | 'pause'
  playerEnded: boolean
  startSec: number
}): number | null {
  return params.intent === 'play' && params.playerEnded ? params.startSec : null
}

/**
 * Whether an `ENDED` player event is a genuine end-of-media completion for the
 * playback this manager is currently driving - not a delayed `ENDED` from an
 * earlier playback that lands after the same manager has already restarted the
 * video at (or near) `startSec`. A real completion leaves the playhead within a
 * couple of seconds of the media end; a stale one fires while the playhead is
 * back near the start. When the duration is not yet known (0 / non-finite),
 * fall back to trusting the event so a real completion is never dropped.
 */
export function isNaturalPlaybackCompletion(params: {
  isEndedEvent: boolean
  currentTimeSec: number
  durationSec: number
}): boolean {
  if (!params.isEndedEvent) {
    return false
  }
  if (!Number.isFinite(params.durationSec) || params.durationSec <= 0) {
    return true
  }
  const NATURAL_END_PROXIMITY_SEC = 2
  return params.currentTimeSec >= params.durationSec - NATURAL_END_PROXIMITY_SEC
}

/**
 * Whether an `ENDED` player event should be mirrored to the server as a
 * `natural-ended` pause. Three guards, all required:
 * - `isNaturalCompletion`: an `ENDED` event whose playhead is at the media end
 *   (see {@link isNaturalPlaybackCompletion}).
 * - `endedRevision` (the revision this player was driving, from
 *   `playerAppliedRevisionRef`) still matches authoritative state.
 * - the player's *playback generation* has not advanced since it last entered
 *   PLAYING. `applyStateToPlayer` bumps the generation on every fresh
 *   `playVideo()`; `onStateChange` records it on each PLAYING transition. A
 *   delayed `ENDED` from a superseded playback lands after a new `playVideo()`
 *   (generation bumped) but before the new PLAYING event (recorded generation
 *   not yet updated), so the two differ and it is rejected - even when `startSec`
 *   sits inside the 2s end-proximity window and the revision was reused.
 */
export function shouldEmitNaturalEndPause(params: {
  isNaturalCompletion: boolean
  endedRevision: number
  authoritativeRevision: number
  playbackGenerationAtEnd: number
  playingGeneration: number
}): boolean {
  if (!params.isNaturalCompletion) {
    return false
  }
  if (params.endedRevision !== params.authoritativeRevision) {
    return false
  }
  return params.playbackGenerationAtEnd === params.playingGeneration
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
  const [seekPositionInput, setSeekPositionInput] = useState('0')

  const playerContainerRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YoutubePlayerLike | null>(null)
  const youtubeRef = useRef<YoutubeNamespace | null>(null)
  const loadedVideoIdRef = useRef<string | null>(null)
  const latestStateRef = useRef<VideoSyncState>(DEFAULT_STATE)
  const managerInstanceIdRef = useRef(createManagerPlaybackCommandId())
  const desiredPlaybackIntentRef = useRef<'play' | 'pause' | 'seek' | null>(null)
  const desiredPlaybackPositionRef = useRef<number | null>(null)
  // The `playbackRevision` of the authoritative state last handed to this
  // player. A delayed `ENDED` event is mirrored with this captured value, not
  // whatever `latestStateRef` holds when the event finally arrives.
  const playerAppliedRevisionRef = useRef(0)
  // Monotonic count of playbacks issued to this player: `applyStateToPlayer`
  // bumps it on every fresh `playVideo()`, and `onStateChange` records the value
  // seen on each PLAYING transition into `playerPlayingGenerationRef`. An `ENDED`
  // whose generation no longer matches the last PLAYING generation is a delayed
  // event from a superseded playback and must not become a `natural-ended` pause.
  const playerPlaybackGenerationRef = useRef(0)
  const playerPlayingGenerationRef = useRef(0)
  // Set when this player emitted a natural `ENDED`; a subsequent explicit Play
  // then restarts from `startSec` instead of resuming at the (end) position the
  // server projected for the completed playback.
  const playerEndedRef = useRef(false)
  const playbackFlushRetryCountRef = useRef(0)
  const playbackCommandInFlightRef = useRef(false)
  // Monotonic id issued to each `flushManagerPlaybackIntent` send, and the id
  // currently permitted to mutate the shared flush refs. A session swap or a
  // superseding flush moves ownership; a stale completion checks it before
  // touching `playbackCommandInFlightRef` / the intent refs.
  const playbackFlushTokenSeqRef = useRef(0)
  const playbackFlushOwnerRef = useRef(0)
  const playbackCommandFlushTimerRef = useRef<number | null>(null)
  const managerAutoplayCheckTimerRef = useRef<number | null>(null)
  const autoStartAttemptKeyRef = useRef<string | null>(null)
  const managerAccessBootstrapRefreshAttemptsRef = useRef<Map<string, number>>(new Map())
  // The session id the component is currently mounted for. An async request
  // captures its own `sessionId`; comparing against this ref after each await
  // drops a response that resolved after a parameter-only route swap.
  const sessionIdRef = useRef(sessionId)
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
    sessionIdRef.current = sessionId
    latestStateRef.current = DEFAULT_STATE
    setState(DEFAULT_STATE)
    setTelemetry(EMPTY_TELEMETRY)
    setSetupMode(true)
    // Also clear the setup-form inputs and any stale banner, so navigating from
    // a configured session to an unconfigured one does not show (and Save) the
    // previous session's URL / stop time. `stopSecInput` + `hasStopTime` follow
    // `state.stopSec` via their own effect once `state` resets above.
    setSourceUrlInput('')
    setSeekPositionInput('0')
    setErrorMessage(null)
    // Drop any playback command the previous session queued: a 120 ms flush
    // timer that fires after navigation would otherwise POST session A's
    // intent/position to session B (the refreshed flush callback and
    // `sendCommand` now both carry B's id). Cleared directly here rather than
    // waiting on the `setupMode` player-teardown cascade, which lands a render
    // later.
    desiredPlaybackIntentRef.current = null
    desiredPlaybackPositionRef.current = null
    playerAppliedRevisionRef.current = 0
    playerPlaybackGenerationRef.current = 0
    playerPlayingGenerationRef.current = 0
    playerEndedRef.current = false
    playbackFlushRetryCountRef.current = 0
    playbackCommandInFlightRef.current = false
    // Orphan any in-flight flush from the previous session: when it resolves it
    // will see it no longer owns the token and touch nothing.
    playbackFlushOwnerRef.current = 0
    if (playbackCommandFlushTimerRef.current != null) {
      window.clearTimeout(playbackCommandFlushTimerRef.current)
      playbackCommandFlushTimerRef.current = null
    }
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
    options?: {
      positionSec?: number
      reportErrors?: boolean
      source?: 'explicit' | 'natural-ended'
      expectedPlaybackRevision?: number
    },
  ): Promise<SendCommandResult> => {
    if (!sessionId) {
      return { ok: false, retryableAuth: false }
    }
    if (!hasManagerAccess) {
      if (options?.reportErrors !== false) {
        setErrorMessage(MISSING_MANAGER_ACCESS_ERROR)
      }
      // Capability may just be mid-resolution; a bounded retry can still land.
      return { ok: false, retryableAuth: true }
    }

    const payload: Record<string, unknown> = {
      type: command,
      commandId: createManagerPlaybackCommandId(),
      managerId: managerInstanceIdRef.current,
      source: options?.source ?? 'explicit',
    }
    if (typeof options?.positionSec === 'number' && Number.isFinite(options.positionSec)) {
      payload.positionSec = clampNumber(options.positionSec)
    }
    if (typeof options?.expectedPlaybackRevision === 'number') {
      payload.expectedPlaybackRevision = options.expectedPlaybackRevision
    }
    try {
      const postCommand = async (): Promise<Response> => await fetch(`/api/video-sync/${sessionId}/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      let response: Response
      try {
        response = await postCommand()
      } catch {
        // The server de-duplicates commandId, so an ambiguous transport failure
        // is safe to retry once with exactly the same command.
        if (sessionIdRef.current !== sessionId) {
          return { ok: false, retryableAuth: false }
        }
        response = await postCommand()
      }

      // A route swap to another session happened mid-request; its result -
      // a 401 -> revalidate, an error banner, or a state apply - must not
      // land on the new session's view.
      if (sessionIdRef.current !== sessionId) {
        return { ok: false, retryableAuth: false }
      }

      if (!response.ok) {
        const isAuthFailure = response.status === 401 || response.status === 403
        const failure = (await response.json().catch(() => ({}))) as { message?: string }
        // Re-check after the body parse too: a route swap during that await must
        // not land this session's error banner or trigger its revalidate.
        if (sessionIdRef.current !== sessionId) {
          return { ok: false, retryableAuth: false }
        }
        if (isAuthFailure) {
          revalidateManagerAccess()
        }
        const message = sanitizeManagerApiErrorMessage(failure.message, 'Failed to send command')
        if (options?.reportErrors === false) {
          console.error('Video sync command failed:', message)
        } else {
          setErrorMessage(message)
        }
        // Only an auth failure is worth retaining/retrying the intent for; a
        // permanent 4xx / 5xx is not going to succeed on replay.
        return { ok: false, retryableAuth: isAuthFailure }
      }

      const updated = (await response.json()) as CommandResponse
      if (sessionIdRef.current !== sessionId) {
        return { ok: false, retryableAuth: false }
      }
      if (updated.data?.state) {
        applyManagerStateUpdate(updated.data.state)
      }
      if (updated.data?.telemetry) {
        setTelemetry(updated.data.telemetry)
      }
      setErrorMessage(null)
      return { ok: true }
    } catch (error) {
      // A rejected fetch (network error) skips the post-await guards above; drop
      // it too when the route has since swapped to another session.
      if (sessionIdRef.current !== sessionId) {
        return { ok: false, retryableAuth: false }
      }
      const message = error instanceof Error ? error.message : 'Failed to send command'
      if (options?.reportErrors === false) {
        console.error('Video sync command failed:', message)
      } else {
        setErrorMessage(message)
      }
      // Both attempts failed. The command may still have committed, so leave
      // reconciliation to the next heartbeat/state update instead of starting
      // a new queue-level attempt with a different command ID.
      return { ok: false, retryableAuth: false }
    }
  }, [applyManagerStateUpdate, hasManagerAccess, revalidateManagerAccess, sessionId])

  const sendCommandRef = useRef(sendCommand)
  useEffect(() => {
    sendCommandRef.current = sendCommand
  }, [sendCommand])

  // `flushManagerPlaybackIntent` re-schedules itself (a bounded transient-failure
  // retry, and a follow-up flush when a newer gesture landed mid-send). Those
  // timers must call the *latest* callback: one scheduled while `hasManagerAccess`
  // was momentarily false during a `revalidateManagerAccess()` cycle would
  // otherwise keep re-running a closure bound to `hasManagerAccess === false` and
  // drop the gesture even after access recovers.
  const flushManagerPlaybackIntentRef = useRef<() => void>(() => {})

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
    const isSeek = desiredIntent === 'seek'
    const shouldSendPositionUpdate = shouldSendManagerPlaybackPositionUpdate({
      authoritativeState,
      desiredPositionSec: desiredPlaybackPositionRef.current,
    })

    // A seek is an explicit instructor gesture with a target position, so it is
    // always sent (never collapsed by the drift-tolerance no-op guard). Routing
    // it through this queue - rather than a bare `sendCommand` - serializes it
    // after any in-flight play/pause so the server sees commands in gesture
    // order (a seek is defined to land paused).
    if (!isSeek && (desiredIntent === 'play') === authoritativeIsPlaying && !shouldSendPositionUpdate) {
      desiredPlaybackIntentRef.current = null
      desiredPlaybackPositionRef.current = null
      playbackFlushRetryCountRef.current = 0
      return
    }

    const sentIntent = desiredIntent
    const sentPosition = desiredPlaybackPositionRef.current

    // Claim ownership of the shared flush refs with a unique token. A session
    // swap (or another flush) resets the owner; a completion that no longer
    // owns the token must not touch `playbackCommandInFlightRef` or the intent
    // refs, because a newer flush - possibly for a different session - now holds
    // them.
    const flushToken = (playbackFlushTokenSeqRef.current += 1)
    playbackFlushOwnerRef.current = flushToken
    playbackCommandInFlightRef.current = true
    const result = await sendCommand(sentIntent, {
      positionSec: sentPosition ?? undefined,
      // A seek is an explicit gesture; surface its failure to the instructor.
      // Queued play/pause stays silent and is reconciled by the next heartbeat.
      reportErrors: isSeek,
    })
    if (playbackFlushOwnerRef.current !== flushToken) {
      return
    }
    playbackFlushOwnerRef.current = 0
    playbackCommandInFlightRef.current = false

    // A newer instructor gesture may have taken ownership of the shared
    // desired-intent refs while this request was in flight. If so, never clear
    // them here - just make sure the newer intent gets flushed.
    const supersededByNewerIntent =
      desiredPlaybackIntentRef.current !== sentIntent ||
      desiredPlaybackPositionRef.current !== sentPosition
    const scheduleFollowUpFlush = () => {
      clearPlaybackCommandFlushTimer()
      playbackCommandFlushTimerRef.current = window.setTimeout(() => {
        flushManagerPlaybackIntentRef.current()
      }, MANAGER_PLAYBACK_COMMAND_FLUSH_DELAY_MS)
    }

    if (!result.ok) {
      const outcome = resolveManagerPlaybackFlushOutcome({
        result,
        currentRetryCount: playbackFlushRetryCountRef.current,
      })
      playbackFlushRetryCountRef.current = outcome.nextRetryCount
      if (outcome.action === 'retry' && !supersededByNewerIntent) {
        // A confirmed 401/403 has already triggered `revalidateManagerAccess()`;
        // a short bounded retry lets the restored capability carry the gesture
        // through instead of silently dropping it.
        clearPlaybackCommandFlushTimer()
        playbackCommandFlushTimerRef.current = window.setTimeout(() => {
          flushManagerPlaybackIntentRef.current()
        }, MANAGER_PLAYBACK_COMMAND_RETRY_DELAY_MS)
        return
      }
      if (supersededByNewerIntent) {
        scheduleFollowUpFlush()
        return
      }
      // 'drop': a permanent failure, exhausted transport attempts, or a spent
      // auth retry budget. Let the next heartbeat/state update reconcile the
      // player.
      desiredPlaybackIntentRef.current = null
      desiredPlaybackPositionRef.current = null
      return
    }

    playbackFlushRetryCountRef.current = 0
    const nextDesiredIntent = desiredPlaybackIntentRef.current
    const nextAuthoritativeIsPlaying = latestStateRef.current.isPlaying
    if (
      !supersededByNewerIntent &&
      (nextDesiredIntent == null ||
        // A seek that was sent and not superseded is complete - do not re-flush.
        nextDesiredIntent === 'seek' ||
        (nextDesiredIntent === 'play') === nextAuthoritativeIsPlaying)
    ) {
      desiredPlaybackIntentRef.current = null
      desiredPlaybackPositionRef.current = null
      return
    }

    scheduleFollowUpFlush()
  }, [clearPlaybackCommandFlushTimer, sendCommand])

  useEffect(() => {
    flushManagerPlaybackIntentRef.current = () => {
      void flushManagerPlaybackIntent()
    }
  }, [flushManagerPlaybackIntent])

  // Reads the latest flush through the ref, so it never closes over a stale
  // `sendCommand`/`hasManagerAccess` and is referentially stable for the life of
  // the component (its only dependency is a `[]`-stable callback). That keeps the
  // player-lifecycle effect below from tearing down and rebuilding the YouTube
  // player - and wiping any in-flight retry - on every access-cookie refresh.
  const scheduleManagerPlaybackIntentFlush = useCallback((delayMs = MANAGER_PLAYBACK_COMMAND_FLUSH_DELAY_MS): void => {
    clearPlaybackCommandFlushTimer()
    playbackCommandFlushTimerRef.current = window.setTimeout(() => {
      flushManagerPlaybackIntentRef.current()
    }, delayMs)
  }, [clearPlaybackCommandFlushTimer])

  const applyStateToPlayer = useCallback((nextState: VideoSyncState) => {
    const player = playerRef.current
    if (!player || !nextState.videoId) {
      return
    }

    setErrorMessage((current) => clearManagerPlayerLoadError(current))
    playerAppliedRevisionRef.current = nextState.playbackRevision ?? 0
    if (nextState.isPlaying) {
      playerEndedRef.current = false
    }
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

    if (nextState.isPlaying) {
      if (playerState !== PLAYING) {
        // A fresh playback: bump the generation so a delayed `ENDED` from the
        // previous playback (which fires before the player re-enters PLAYING)
        // is distinguishable from a genuine completion of this one.
        playerPlaybackGenerationRef.current += 1
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
  }, [clearManagerAutoplayCheckTimer])

  const retryManagerAutoplay = useCallback((): void => {
    if (!playerRef.current) {
      return
    }
    // Re-apply authoritative state rather than a bare `playVideo()`: this seeks
    // the lagging blocked player to the projected server position before
    // resuming, so recovery on this view does not diverge from the rest of the
    // class. Ordinary iframe state changes are projection-only and never become
    // commands, so no echo suppression is needed.
    applyStateToPlayer(latestStateRef.current)
    setAutoplayBlocked(false)
  }, [applyStateToPlayer])

  const requestExplicitPlayback = useCallback((intent: 'play' | 'pause'): void => {
    playbackFlushRetryCountRef.current = 0
    desiredPlaybackIntentRef.current = intent
    // Play/pause acts at the server-projected authoritative position. Position
    // changes are a separate explicit seek, so a lagging manager cannot rewind
    // the class merely by pressing pause. The one exception: Play after a
    // natural end restarts from `startSec`, otherwise the server would resume at
    // the (end) position it projected for the completed playback.
    desiredPlaybackPositionRef.current = resolveExplicitPlaybackPositionSec({
      intent,
      playerEnded: playerEndedRef.current,
      startSec: latestStateRef.current.startSec,
    })
    scheduleManagerPlaybackIntentFlush(0)
  }, [scheduleManagerPlaybackIntentFlush])

  const requestExplicitSeek = useCallback((): void => {
    const parsed = resolveManagerSeekRequest(seekPositionInput)
    if (!parsed.ok) {
      setErrorMessage(parsed.message)
      return
    }
    // An explicit seek supersedes a prior natural end (the next Play resumes
    // from the sought position, not `startSec`) and any queued play/pause.
    // Routing it through the shared intent queue serializes it after an
    // in-flight command so the server applies commands in gesture order (a seek
    // is defined to land paused), and reuses the queue's flush-token /
    // session-ownership guard so a mid-request route swap cannot apply a stale
    // result.
    playerEndedRef.current = false
    playbackFlushRetryCountRef.current = 0
    desiredPlaybackIntentRef.current = 'seek'
    desiredPlaybackPositionRef.current = parsed.positionSec
    scheduleManagerPlaybackIntentFlush(0)
  }, [scheduleManagerPlaybackIntentFlush, seekPositionInput])

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
      playerAppliedRevisionRef.current = 0
      playerPlaybackGenerationRef.current = 0
      playerPlayingGenerationRef.current = 0
      playerEndedRef.current = false
      playbackFlushRetryCountRef.current = 0
      playbackCommandInFlightRef.current = false
      playbackFlushOwnerRef.current = 0
      clearPlaybackCommandFlushTimer()
      clearManagerAutoplayCheckTimer()
      setAutoplayBlocked(false)
      playerRef.current?.destroy()
      playerRef.current = null
      setActivePlayerHost(null)
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
      playerAppliedRevisionRef.current = 0
      playerPlaybackGenerationRef.current = 0
      playerPlayingGenerationRef.current = 0
      playerEndedRef.current = false
      playbackFlushRetryCountRef.current = 0
      playbackCommandInFlightRef.current = false
      playbackFlushOwnerRef.current = 0
      clearPlaybackCommandFlushTimer()
      clearManagerAutoplayCheckTimer()
      setAutoplayBlocked(false)
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
            controls: 0,
            rel: 0,
            modestbranding: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (cancelled || candidateIndex !== activeAttemptIndex) return
              // The preview iframe is a projection: keep it out of the tab order
              // too, not just the accessibility tree. The wrapper is
              // `aria-hidden`, but a cross-origin iframe stays keyboard-focusable
              // unless its own `tabindex` is -1.
              try {
                player.getIframe?.()?.setAttribute('tabindex', '-1')
              } catch {
                // getIframe can throw if the player was torn down mid-init.
              }
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
              // Natural completion must reach the server or the session stays
              // `isPlaying: true` and heartbeats drive an end-of-video replay
              // loop. The server accepts it from any authorized manager whose
              // command names the current playback revision. Require the
              // playhead to be at the media end too: a delayed `ENDED` from an
              // earlier playback that lands after this same manager restarted
              // the video near `startSec` would otherwise pass the revision
              // guard and cancel the new play.
              const isNaturalCompletion = isNaturalPlaybackCompletion({
                isEndedEvent: event.data === states.ENDED,
                currentTimeSec: event.target.getCurrentTime(),
                durationSec: event.target.getDuration?.() ?? 0,
              })

              // Playback actually started (possibly after a slow buffer that
              // tripped the autoplay-blocked check) - retire the affordance and
              // record which playback generation is now live so a later ENDED
              // can be matched to it.
              if (nextIntent === 'play') {
                clearManagerAutoplayCheckTimer()
                setAutoplayBlocked(false)
                playerPlayingGenerationRef.current = playerPlaybackGenerationRef.current
              }

              // The iframe is a projection, never an authority. Only the
              // activity-owned controls below create play/pause/seek commands.
              // Natural completion is the exception, and the server accepts it
              // from any authorized manager at the current playback revision.
              const endedRevision = playerAppliedRevisionRef.current
              if (shouldEmitNaturalEndPause({
                isNaturalCompletion,
                endedRevision,
                authoritativeRevision: latestStateRef.current.playbackRevision ?? 0,
                playbackGenerationAtEnd: playerPlaybackGenerationRef.current,
                playingGeneration: playerPlayingGenerationRef.current,
              })) {
                playerEndedRef.current = true
                void sendCommandRef.current('pause', {
                  positionSec: event.target.getCurrentTime(),
                  reportErrors: false,
                  source: 'natural-ended',
                  // Mirror the revision this player was actually driving, not
                  // whatever `latestStateRef` holds now.
                  expectedPlaybackRevision: endedRevision,
                })
              }
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
      playerAppliedRevisionRef.current = 0
      playerPlaybackGenerationRef.current = 0
      playerPlayingGenerationRef.current = 0
      playerEndedRef.current = false
      playbackFlushRetryCountRef.current = 0
      playbackCommandInFlightRef.current = false
      playbackFlushOwnerRef.current = 0
      clearPlaybackCommandFlushTimer()
      clearManagerAutoplayCheckTimer()
      setAutoplayBlocked(false)
      playerRef.current?.destroy()
      playerRef.current = null
      setActivePlayerHost(null)
    }
  }, [
    applyStateToPlayer,
    clearManagerAutoplayCheckTimer,
    clearPlaybackCommandFlushTimer,
    scheduleManagerPlaybackIntentFlush,
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

      // A parameter-only route swap while this PATCH was in flight must not
      // land session A's config response (or its 401 -> revalidate / error)
      // on session B's freshly reset view.
      if (sessionIdRef.current !== sessionId) {
        return false
      }

      if (!response.ok) {
        const isAuthFailure = response.status === 401 || response.status === 403
        const failure = (await response.json().catch(() => ({}))) as { message?: string }
        // Re-check after the body parse too: a route swap during that await must
        // not trigger this session's revalidate or surface its error.
        if (sessionIdRef.current !== sessionId) {
          return false
        }
        if (isAuthFailure) {
          revalidateManagerAccess()
        }
        throw new Error(sanitizeManagerApiErrorMessage(failure.message, 'Failed to save video config'))
      }

      const updated = (await response.json()) as ConfigResponse
      if (sessionIdRef.current !== sessionId) {
        return false
      }
      if (updated.data?.state) {
        applyManagerStateUpdate(updated.data.state)
      }
      if (updated.data?.telemetry) {
        setTelemetry(updated.data.telemetry)
      }
      setErrorMessage(null)
      return true
    } catch (error) {
      if (sessionIdRef.current !== sessionId) {
        return false
      }
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
      // A route swap while this bootstrap PATCH was pending: `saveConfig`
      // returned `false` because it was stale, not because it failed. Don't
      // stamp the new session's auto-start as `failed` and block its own
      // auto-configure.
      if (sessionIdRef.current !== sessionId) {
        return
      }
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
          <div className="w-full h-full pointer-events-none" aria-hidden="true">
            <div ref={playerContainerRef} className="w-full h-full" />
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-gray-300">
            Configure a YouTube URL to preview the synchronized video.
          </div>
        )}
      </div>

      {state.videoId && !state.isPlaying && (
        <button
          type="button"
          className="absolute left-1/2 top-1/2 z-10 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-white bg-black/95 text-lg font-semibold text-white shadow-2xl disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!hasManagerAccess}
          onClick={() => requestExplicitPlayback('play')}
          aria-label="Play synchronized video"
        >
          Play
        </button>
      )}

      {state.videoId && autoplayBlocked && (
        <div className="absolute bottom-16 right-4 z-20 w-[min(28rem,calc(100vw-2rem))] border border-amber-300 bg-amber-50 text-amber-900 rounded p-3 text-sm">
          {/* Live region holds only the announcement text; the retry control
              sits outside it so assistive tech does not re-announce a button
              as status content. */}
          <div role="status" aria-live="polite" aria-atomic="true">
            {MANAGER_AUTOPLAY_BLOCKED_MESSAGE}
          </div>
          <div className="mt-2">
            <Button onClick={retryManagerAutoplay}>Click to start playback</Button>
          </div>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 z-20 px-4 py-2 bg-black/80 border-t border-white/10 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-200">
        <div className="flex items-center gap-2" role="group" aria-label="Instructor playback controls">
          <Button
            disabled={!hasManagerAccess || state.isPlaying}
            onClick={() => requestExplicitPlayback('play')}
          >
            Play
          </Button>
          <Button
            disabled={!hasManagerAccess || !state.isPlaying}
            onClick={() => requestExplicitPlayback('pause')}
          >
            Pause
          </Button>
          <label className="flex items-center gap-1">
            <span>Seek to</span>
            <input
              className="w-20 rounded border border-gray-500 bg-black px-2 py-1 text-white disabled:opacity-50"
              type="number"
              min="0"
              step="0.1"
              value={seekPositionInput}
              onChange={(event) => setSeekPositionInput(event.target.value)}
              disabled={!hasManagerAccess}
              aria-label="Seek to position in seconds"
            />
          </label>
          <Button disabled={!hasManagerAccess} onClick={requestExplicitSeek}>Seek</Button>
        </div>
        {/* Only the status text is a live region; the interactive controls above
            must not be re-announced on every heartbeat re-render. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-live="polite">
          <span>Video: {state.videoId || 'Not configured'}</span>
          <span>Host: {formatVideoSyncPlayerHostLabel(state.videoId ? activePlayerHost : null)}</span>
          <span>Playing: {state.isPlaying ? 'Yes' : 'No'}</span>
          <span>Position: {displayPosition.toFixed(2)}s</span>
          <span>Connections: {telemetry.connections.activeCount}</span>
          <span>Unsynced students: {telemetry.sync.unsyncedStudents}</span>
        </div>
      </div>
    </div>
  )
}
