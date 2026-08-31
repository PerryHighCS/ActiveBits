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
const MAX_MANAGER_API_ERROR_MESSAGE_LENGTH = 160

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

  const playerContainerRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YoutubePlayerLike | null>(null)
  const youtubeRef = useRef<YoutubeNamespace | null>(null)
  const loadedVideoIdRef = useRef<string | null>(null)
  const latestStateRef = useRef<VideoSyncState>(DEFAULT_STATE)
  const desiredPlaybackIntentRef = useRef<'play' | 'pause' | null>(null)
  const desiredPlaybackPositionRef = useRef<number | null>(null)
  const playbackCommandInFlightRef = useRef(false)
  const playbackCommandFlushTimerRef = useRef<number | null>(null)
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

  useEffect(() => {
    latestStateRef.current = state
  }, [state])

  const applyManagerStateUpdate = useCallback((nextState: VideoSyncState): void => {
    latestStateRef.current = nextState
    setState((currentState) => {
      if (!shouldApplyManagerStateUpdate(currentState, nextState)) {
        return currentState
      }

      setSetupMode(nextState.videoId.length === 0)
      return nextState
    })
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
        latestStateRef.current = updated.data.state
        setState(updated.data.state)
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
  }, [hasManagerAccess, revalidateManagerAccess, sessionId])

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
      return
    }

    playbackCommandInFlightRef.current = true
    const didSend = await sendCommand(desiredIntent, {
      positionSec: desiredPlaybackPositionRef.current ?? undefined,
      reportErrors: false,
    })
    playbackCommandInFlightRef.current = false

    if (!didSend) {
      desiredPlaybackIntentRef.current = null
      desiredPlaybackPositionRef.current = null
      return
    }

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

    if (nextState.isPlaying) {
      if (playerState !== PLAYING) {
        player.playVideo()
      }
    } else {
      player.pauseVideo()
    }
  }, [setSuppressPlayerEventsForWindow])

  const fetchSession = useCallback(async () => {
    if (!sessionId) return

    try {
      const response = await fetch(`/api/video-sync/${sessionId}/session`)
      if (!response.ok) {
        throw new Error('Failed to load video-sync session')
      }

      const data = (await response.json()) as SessionResponse
      if (data.data?.state) {
        applyManagerStateUpdate(data.data.state)
      }
      if (data.data?.telemetry) {
        setTelemetry(data.data.telemetry)
      }
      setErrorMessage(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load video-sync session'
      setErrorMessage(message)
    }
  }, [sessionId])

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
        response = await fetch(`/api/video-sync/${sessionId}/manager-access`, { credentials: 'include' })
      } catch {
        scheduleRetryOrDeny()
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
          // Parent asked for a new token; the capability-exchange hook re-runs
          // and re-triggers this effect. Don't latch read-only yet.
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
      playbackCommandInFlightRef.current = false
      clearPlaybackCommandFlushTimer()
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
      playbackCommandInFlightRef.current = false
      clearPlaybackCommandFlushTimer()
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

              if (suppressPlayerEventsRef.current) {
                return
              }

              setErrorMessage((current) => clearManagerPlayerLoadError(current))

              const target = event.target
              const playerPosition = clampNumber(target.getCurrentTime())
              const states = resolveYoutubePlayerState(youtubeRef.current)

              const nextIntent = getManagerPlaybackIntentForStateChange({
                eventState: event.data,
                endedStateValue: states.ENDED,
                playingStateValue: states.PLAYING,
                pausedStateValue: states.PAUSED,
              })

              if (nextIntent == null) {
                return
              }

              desiredPlaybackIntentRef.current = nextIntent
              desiredPlaybackPositionRef.current = playerPosition
              scheduleManagerPlaybackIntentFlush()
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
      playbackCommandInFlightRef.current = false
      clearPlaybackCommandFlushTimer()
      playerRef.current?.destroy()
      playerRef.current = null
      setActivePlayerHost(null)
      clearPlayerEventSuppression()
    }
  }, [
    applyStateToPlayer,
    clearPlaybackCommandFlushTimer,
    clearPlayerEventSuppression,
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
    void fetchSession()
    if (isManagerAccessReady && hasManagerAccess) {
      connect()
    }
    return () => disconnect()
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
