import SessionHeader from '@src/components/common/SessionHeader'
import { fetchEmbeddedLaunchSelectedOptions } from '@src/components/common/embeddedLaunchBootstrap'
import { consumeCreateSessionBootstrapPayload } from '@src/components/common/manageDashboardUtils'
import { isEmbeddedChildSessionId } from '@src/components/common/sessionHeaderUtils'
import Button from '@src/components/ui/Button'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
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

interface InstructorPasscodeResponse {
  instructorPasscode?: unknown
}

interface ManagerLocationState {
  createSessionPayload?: {
    instructorPasscode?: unknown
  }
}

type AutoStartStatus = 'idle' | 'starting' | 'failed'

const YOUTUBE_MANAGER_LOAD_ERROR = 'YouTube player failed to load. Try a different video URL.'
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

export function readBootstrapInstructorPasscode(locationState: unknown): string | null {
  if (
    locationState == null ||
    typeof locationState !== 'object' ||
    Array.isArray(locationState)
  ) {
    return null
  }

  const state = locationState as ManagerLocationState
  const value = state.createSessionPayload?.instructorPasscode
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function readBootstrapSourceUrl(search: string): string | null {
  const value = new URLSearchParams(search).get('sourceUrl')
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

export function resolveBootstrapInstructorPasscode(params: {
  locationState: unknown
  sessionId: string | null | undefined
}): {
  instructorPasscode: string | null
  shouldClearLocationState: boolean
} {
  const fromLocationState = readBootstrapInstructorPasscode(params.locationState)
  if (fromLocationState != null) {
    if (params.sessionId) {
      consumeCreateSessionBootstrapPayload('video-sync', params.sessionId)
    }
    return {
      instructorPasscode: fromLocationState,
      shouldClearLocationState: true,
    }
  }

  if (!params.sessionId) {
    return {
      instructorPasscode: null,
      shouldClearLocationState: false,
    }
  }

  const fromBootstrapPayload = readBootstrapInstructorPasscode({
    createSessionPayload: consumeCreateSessionBootstrapPayload('video-sync', params.sessionId) ?? undefined,
  })

  return {
    instructorPasscode: fromBootstrapPayload,
    shouldClearLocationState: false,
  }
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

export function createManagerWsAuthMessage(instructorPasscode: string | null | undefined): string | null {
  if (typeof instructorPasscode !== 'string' || instructorPasscode.length === 0) {
    return null
  }

  return JSON.stringify({
    type: 'authenticate',
    instructorPasscode,
  })
}

export function shouldRenderEmbeddedManagerHeader(sessionId: string | null | undefined): boolean {
  return !isEmbeddedChildSessionId(sessionId ?? undefined)
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
  isPasscodeReady: boolean
  instructorPasscode: string | null
  autoStartStatus: AutoStartStatus
}): boolean {
  return (
    params.setupMode &&
    params.bootstrapSourceUrl != null &&
    params.autoStartStatus !== 'failed' &&
    params.isPasscodeReady &&
    params.instructorPasscode != null
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
  playingStateValue: number
  pausedStateValue: number
}): 'play' | 'pause' | null {
  if (params.eventState === params.playingStateValue) {
    return 'play'
  }

  if (params.eventState === params.pausedStateValue) {
    return 'pause'
  }

  return null
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
  const [instructorPasscode, setInstructorPasscode] = useState<string | null>(null)
  const [isPasscodeReady, setIsPasscodeReady] = useState(false)
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
  const queryBootstrapSourceUrl = useMemo(() => readBootstrapSourceUrl(location.search), [location.search])
  const bootstrapSourceUrl = queryBootstrapSourceUrl ?? embeddedBootstrapSourceUrl

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
    if (!instructorPasscode) {
      if (options?.reportErrors !== false) {
        setErrorMessage('Instructor credentials missing. Open this session from the dashboard or authenticated permalink.')
      }
      return false
    }

    const payload: Record<string, unknown> = { type: command }
    if (typeof options?.positionSec === 'number' && Number.isFinite(options.positionSec)) {
      payload.positionSec = clampNumber(options.positionSec)
    }
    payload.instructorPasscode = instructorPasscode

    try {
      const response = await fetch(`/api/video-sync/${sessionId}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
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
  }, [instructorPasscode, sessionId])

  const flushManagerPlaybackIntent = useCallback(async (): Promise<void> => {
    clearPlaybackCommandFlushTimer()

    if (playbackCommandInFlightRef.current) {
      return
    }

    const desiredIntent = desiredPlaybackIntentRef.current
    if (desiredIntent == null) {
      return
    }

    const authoritativeIsPlaying = latestStateRef.current.isPlaying
    if ((desiredIntent === 'play') === authoritativeIsPlaying) {
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
      setInstructorPasscode(null)
      setIsPasscodeReady(true)
      return
    }

    let isCancelled = false

    const loadInstructorPasscode = async (): Promise<void> => {
      const bootstrap = resolveBootstrapInstructorPasscode({
        locationState: location.state,
        sessionId,
      })
      if (bootstrap.instructorPasscode) {
        if (bootstrap.shouldClearLocationState) {
          void navigate(location.pathname + location.search, {
            replace: true,
            state: null,
          })
        }
        if (!isCancelled) {
          setInstructorPasscode(bootstrap.instructorPasscode)
          setIsPasscodeReady(true)
        }
        return
      }

      try {
        const response = await fetch(`/api/video-sync/${sessionId}/instructor-passcode`, {
          credentials: 'include',
        })
        if (!response.ok) {
          if (!isCancelled) {
            setInstructorPasscode(null)
          }
          return
        }

        const payload = (await response.json()) as InstructorPasscodeResponse
        if (typeof payload.instructorPasscode === 'string' && payload.instructorPasscode.length > 0) {
          if (!isCancelled) {
            setInstructorPasscode(payload.instructorPasscode)
          }
          return
        }

        if (!isCancelled) {
          setInstructorPasscode(null)
        }
      } catch {
        if (!isCancelled) {
          setInstructorPasscode(null)
        }
      } finally {
        if (!isCancelled) {
          setIsPasscodeReady(true)
        }
      }
    }

    setIsPasscodeReady(false)
    void loadInstructorPasscode()

    return () => {
      isCancelled = true
    }
  }, [location.pathname, location.search, location.state, navigate, sessionId])

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
      clearPlayerEventSuppression()
      return
    }

    if (!playerContainerRef.current || playerRef.current) {
      return
    }

    let cancelled = false

    const initializePlayer = async (): Promise<void> => {
      try {
        const youtube = await loadYoutubeIframeApi()
        if (cancelled || !playerContainerRef.current) return

        youtubeRef.current = youtube
        const player = new youtube.Player(playerContainerRef.current, {
          width: '100%',
          height: '100%',
          host: 'https://www.youtube-nocookie.com',
          playerVars: {
            controls: 1,
            rel: 0,
            modestbranding: 1,
          },
          events: {
            onReady: () => {
              if (cancelled) return
              setPlayerReady(true)
              setErrorMessage((current) => clearManagerPlayerLoadError(current))
              applyStateToPlayer(latestStateRef.current)
            },
            onStateChange: (event) => {
              if (cancelled || suppressPlayerEventsRef.current) {
                return
              }

              setErrorMessage((current) => clearManagerPlayerLoadError(current))

              const target = event.target
              const playerPosition = clampNumber(target.getCurrentTime())
              const states = resolveYoutubePlayerState(youtubeRef.current)

              const nextIntent = getManagerPlaybackIntentForStateChange({
                eventState: event.data,
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
              if (cancelled) return
              setErrorMessage(YOUTUBE_MANAGER_LOAD_ERROR)
            },
          },
        })

        playerRef.current = player
      } catch {
        if (!cancelled) {
          setErrorMessage('Unable to initialize YouTube player.')
        }
      }
    }

    void initializePlayer()

    return () => {
      cancelled = true
      setPlayerReady(false)
      loadedVideoIdRef.current = null
      desiredPlaybackIntentRef.current = null
      desiredPlaybackPositionRef.current = null
      playbackCommandInFlightRef.current = false
      clearPlaybackCommandFlushTimer()
      playerRef.current?.destroy()
      playerRef.current = null
      clearPlayerEventSuppression()
    }
  }, [applyStateToPlayer, clearPlaybackCommandFlushTimer, clearPlayerEventSuppression, scheduleManagerPlaybackIntentFlush, setupMode])

  useEffect(() => {
    setStopSecInput(state.stopSec == null ? '' : String(state.stopSec))
    setHasStopTime(state.stopSec != null)
  }, [state.stopSec])

  useEffect(() => {
    if (!playerReady) return
    applyStateToPlayer(state)
  }, [playerReady, state, applyStateToPlayer])

  useEffect(() => {
    if (!setupMode) {
      return
    }

    const bootstrappedSourceUrl = readBootstrapSourceUrl(location.search)
    if (!bootstrappedSourceUrl) {
      return
    }

    setSourceUrlInput((current) => (current.trim().length > 0 ? current : bootstrappedSourceUrl))
  }, [location.search, setupMode])

  const { connect, disconnect } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(sessionId && instructorPasscode && isPasscodeReady),
    onOpen: (_event, ws) => {
      const authMessage = createManagerWsAuthMessage(instructorPasscode)
      if (!authMessage) {
        return
      }

      ws.send(authMessage)
    },
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
    if (isPasscodeReady && instructorPasscode) {
      connect()
    }
    return () => disconnect()
  }, [sessionId, fetchSession, connect, disconnect, instructorPasscode, isPasscodeReady])

  const saveConfigWithValues = useCallback(async (
    sourceUrlValue: string,
    stopTimeEnabled: boolean,
    stopSecTextValue: string,
  ): Promise<boolean> => {
    if (!sessionId) return false
    if (!isPasscodeReady) {
      setErrorMessage('Loading instructor credentials...')
      return false
    }
    if (!instructorPasscode) {
      setErrorMessage('Instructor credentials missing. Open this session from the dashboard or authenticated permalink.')
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
          instructorPasscode,
          sourceUrl: sourceUrlValue,
          stopSec: stopSecValue,
        }),
      })

      if (!response.ok) {
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
  }, [applyManagerStateUpdate, instructorPasscode, isPasscodeReady, sessionId])

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

    if (!isPasscodeReady) {
      setAutoStartStatus('starting')
      return
    }

    if (!instructorPasscode) {
      setAutoStartStatus('failed')
      return
    }

    if (!shouldAutoStartBootstrapSource({
      setupMode,
      bootstrapSourceUrl,
      isPasscodeReady,
      instructorPasscode,
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
    instructorPasscode,
    isPasscodeReady,
    saveConfigWithValues,
    sessionId,
    setupMode,
  ])

  const handleEndSession = async (): Promise<void> => {
    if (!sessionId) return
    await fetch(`/api/session/${sessionId}`, { method: 'DELETE' })
    void navigate('/manage')
  }

  const displayPosition = useMemo(() => computeDesiredPositionSec(state), [state])

  if (setupMode) {
    const shouldShowAutoStartSplash = bootstrapSourceUrl != null && autoStartStatus !== 'failed'
    const shouldRenderHeader = shouldRenderEmbeddedManagerHeader(sessionId)

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
                placeholder="https://www.youtube.com/watch?v=...&t=1m23s or https://youtu.be/..."
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

            <Button disabled={!isPasscodeReady} onClick={() => void saveConfig()}>
              {isPasscodeReady ? 'Start instructor view' : 'Loading instructor access...'}
            </Button>
          </section>
        )}
      </div>
    )
  }

  const shouldRenderHeader = shouldRenderEmbeddedManagerHeader(sessionId)

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
        <span>Playing: {state.isPlaying ? 'Yes' : 'No'}</span>
        <span>Position: {displayPosition.toFixed(2)}s</span>
        <span>Connections: {telemetry.connections.activeCount}</span>
        <span>Unsynced students: {telemetry.sync.unsyncedStudents}</span>
      </div>
    </div>
  )
}
