import Button from '@src/components/ui/Button'
import {
  persistSessionParticipantIdentity,
  resolveInitialEntryParticipantIdentity,
  type ResolvedEntryParticipantIdentity,
} from '@src/components/common/entryParticipantIdentityUtils'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import {
  parseVideoSyncErrorMessagePayload,
  parseVideoSyncEnvelope,
  parseVideoSyncStateMessagePayload,
  type VideoSyncState,
} from '../protocol.js'
import {
  clampPositionSec,
  computeDriftSec,
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

interface VideoSyncStudentProps {
  sessionData?: {
    sessionId?: string
  }
}

interface SessionResponse {
  data?: {
    standaloneMode?: boolean
    state?: VideoSyncState
  }
}

const STUDENT_PLAYING_DRIFT_TOLERANCE_SEC = 0.5
const STUDENT_HARD_SEEK_DRIFT_SEC = 1.5
const STUDENT_CATCH_UP_PLAYBACK_RATE = 1.25
const STUDENT_SLOW_DOWN_PLAYBACK_RATE = 0.75

interface StudentPlaybackSyncAction {
  type: 'none' | 'rate' | 'seek'
  playbackRate: number
}

export function shouldInitializeYoutubePlayer(
  videoId: string,
  container: HTMLDivElement | null,
  existingPlayer: YoutubePlayerLike | null,
): boolean {
  return videoId.length > 0 && container != null && existingPlayer == null
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

export function hasInstructorPlaybackStarted(state: VideoSyncState): boolean {
  if (!state.videoId) {
    return false
  }

  if (state.isPlaying) {
    return true
  }

  return state.positionSec > state.startSec
}

function createStudentClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const random = Math.random().toString(36).slice(2)
  return `student-${Date.now()}-${random}`
}

interface VideoSyncStudentIdentity {
  studentName: string
  studentId: string
  nameSubmitted: boolean
}

export function finalizeVideoSyncStudentIdentity(
  identity: ResolvedEntryParticipantIdentity,
  createStudentId: () => string = createStudentClientId,
): VideoSyncStudentIdentity {
  const normalizedStudentName = identity.studentName.trim()
  const normalizedStudentId = typeof identity.studentId === 'string' ? identity.studentId.trim() : ''

  return {
    studentName: normalizedStudentName || 'Student',
    studentId: normalizedStudentId || createStudentId(),
    nameSubmitted: identity.nameSubmitted || normalizedStudentName.length > 0,
  }
}

const BLOCKED_STUDENT_OVERLAY_KEYS = new Set<string>([
  ' ',
  'k',
  'j',
  'l',
  'm',
  'f',
  'c',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
])

export function shouldBlockStudentOverlayKey(key: string): boolean {
  return BLOCKED_STUDENT_OVERLAY_KEYS.has(key)
}

export function buildStudentPlayerVars(isStandaloneSession: boolean): {
  controls: 0 | 1
  rel: 0
  modestbranding: 1
} {
  return {
    controls: isStandaloneSession ? 1 : 0,
    rel: 0,
    modestbranding: 1,
  }
}

export function shouldRenderStudentInteractionOverlay(isStandaloneSession: boolean): boolean {
  return !isStandaloneSession
}

export function shouldConnectVideoSyncStudentRealtime(params: {
  sessionId: string | null
  isStandaloneSession: boolean
  isSessionModeResolved: boolean
}): boolean {
  return Boolean(params.sessionId && params.isSessionModeResolved && !params.isStandaloneSession)
}

export function getVideoSyncStudentIdentityLookup(sessionId: string | null | undefined): {
  sessionId?: string
  isSoloSession: false
} {
  return {
    ...(typeof sessionId === 'string' ? { sessionId } : {}),
    // Standalone Video Sync still routes through /:sessionId, so entry-participant
    // handoff should stay on the session-backed storage/consume path.
    isSoloSession: false,
  }
}

export function resetUnsyncedPlaybackTelemetry(params: {
  isLocallyUnsyncedRef: { current: boolean }
  lastUnsyncReportAtRef: { current: number }
}): void {
  params.isLocallyUnsyncedRef.current = false
  params.lastUnsyncReportAtRef.current = 0
}

export function syncLoadedVideoSource(
  player: YoutubePlayerLike,
  nextState: VideoSyncState,
  desiredPositionSec: number,
): void {
  player.setPlaybackRate(1)

  const sourceOptions = {
    videoId: nextState.videoId,
    startSeconds: desiredPositionSec,
    endSeconds: nextState.stopSec ?? undefined,
  }

  if (nextState.isPlaying) {
    player.loadVideoById(sourceOptions)
    return
  }

  player.cueVideoById(sourceOptions)
}

export function clearAutoplayCheckTimer(autoplayCheckTimerRef: { current: number | null }): void {
  if (autoplayCheckTimerRef.current != null) {
    window.clearTimeout(autoplayCheckTimerRef.current)
    autoplayCheckTimerRef.current = null
  }
}

export function shouldRunAutoplayCheck(
  currentPlayer: YoutubePlayerLike | null,
  scheduledPlayer: YoutubePlayerLike,
): boolean {
  return currentPlayer === scheduledPlayer
}

export function shouldCorrectStudentPlaybackDrift(
  playerPositionSec: number,
  desiredPositionSec: number,
  isPlaying: boolean,
): boolean {
  return shouldCorrectDrift(
    playerPositionSec,
    desiredPositionSec,
    isPlaying ? STUDENT_PLAYING_DRIFT_TOLERANCE_SEC : DEFAULT_DRIFT_TOLERANCE_SEC,
  )
}

export function getStudentPlaybackSyncAction(
  playerPositionSec: number,
  desiredPositionSec: number,
  isPlaying: boolean,
): StudentPlaybackSyncAction {
  if (!isPlaying) {
    return shouldCorrectStudentPlaybackDrift(playerPositionSec, desiredPositionSec, false)
      ? { type: 'seek', playbackRate: 1 }
      : { type: 'none', playbackRate: 1 }
  }

  if (!shouldCorrectStudentPlaybackDrift(playerPositionSec, desiredPositionSec, true)) {
    return { type: 'none', playbackRate: 1 }
  }

  const driftSec = computeDriftSec(playerPositionSec, desiredPositionSec)
  if (driftSec > STUDENT_HARD_SEEK_DRIFT_SEC) {
    return { type: 'seek', playbackRate: 1 }
  }

  const desired = clampPositionSec(desiredPositionSec)
  const current = clampPositionSec(playerPositionSec)
  return {
    type: 'rate',
    playbackRate: desired >= current ? STUDENT_CATCH_UP_PLAYBACK_RATE : STUDENT_SLOW_DOWN_PLAYBACK_RATE,
  }
}

export async function reportVideoSyncStudentEvent(params: {
  sessionId: string | null
  studentId: string
  eventType: 'autoplay-blocked' | 'unsync' | 'sync-correction' | 'load-failure'
  driftSec?: number
  correctionResult?: 'success' | 'failed'
  errorCode?: string
  errorMessage?: string
}): Promise<void> {
  if (!params.sessionId) {
    return
  }

  try {
    await fetch(`/api/video-sync/${params.sessionId}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: params.eventType,
        studentId: params.studentId,
        driftSec: params.driftSec,
        correctionResult: params.correctionResult,
        errorCode: params.errorCode,
        errorMessage: params.errorMessage,
      }),
    })
  } catch {
    // Telemetry failures should not affect student playback UX.
  }
}

export default function VideoSyncStudent({ sessionData }: VideoSyncStudentProps) {
  const sessionId = sessionData?.sessionId ?? null
  const attachSessionEndedHandler = useSessionEndedHandler()

  const [state, setState] = useState<VideoSyncState>(DEFAULT_STATE)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const [playerReady, setPlayerReady] = useState(false)
  const [hasStartedInstructorPlayback, setHasStartedInstructorPlayback] = useState(false)
  const [isStandaloneSession, setIsStandaloneSession] = useState(false)
  const [isSessionModeResolved, setIsSessionModeResolved] = useState(false)
  const [studentIdentity, setStudentIdentity] = useState<VideoSyncStudentIdentity>(() => ({
    studentName: 'Student',
    studentId: createStudentClientId(),
    nameSubmitted: false,
  }))

  const playerContainerRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YoutubePlayerLike | null>(null)
  const youtubeRef = useRef<YoutubeNamespace | null>(null)
  const loadedVideoIdRef = useRef<string | null>(null)
  const lastUnsyncReportAtRef = useRef(0)
  const isLocallyUnsyncedRef = useRef(false)
  const autoplayCheckTimerRef = useRef<number | null>(null)
  const studentIdentityRef = useRef<VideoSyncStudentIdentity>(studentIdentity)

  useEffect(() => {
    studentIdentityRef.current = studentIdentity
  }, [studentIdentity])

  useEffect(() => {
    if (typeof window === 'undefined' || !sessionId) {
      return
    }

    let isCancelled = false

    void (async () => {
      try {
        const identityLookup = getVideoSyncStudentIdentityLookup(sessionId)
        const resolvedIdentity = await resolveInitialEntryParticipantIdentity({
          activityName: 'video-sync',
          sessionId: identityLookup.sessionId,
          isSoloSession: identityLookup.isSoloSession,
          localStorage: window.localStorage,
          sessionStorage: window.sessionStorage,
        })
        if (isCancelled) {
          return
        }

        const finalizedIdentity = finalizeVideoSyncStudentIdentity(resolvedIdentity)
        persistSessionParticipantIdentity(
          window.localStorage,
          sessionId,
          finalizedIdentity.studentName,
          finalizedIdentity.studentId,
        )
        setStudentIdentity(finalizedIdentity)
      } catch (error) {
        console.error('Failed to resolve initial participant identity for video-sync:', error)
      }
    })()

    return () => {
      isCancelled = true
    }
  }, [sessionId])

  const reportEvent = useCallback(async (
    eventType: 'autoplay-blocked' | 'unsync' | 'sync-correction' | 'load-failure',
    options?: {
      driftSec?: number
      correctionResult?: 'success' | 'failed'
      errorCode?: string
      errorMessage?: string
    },
  ): Promise<void> => {
    await reportVideoSyncStudentEvent({
      sessionId,
      studentId: studentIdentityRef.current.studentId,
      eventType,
      driftSec: options?.driftSec,
      correctionResult: options?.correctionResult,
      errorCode: options?.errorCode,
      errorMessage: options?.errorMessage,
    })
  }, [sessionId])

  const applyStateToPlayer = useCallback((nextState: VideoSyncState) => {
    const player = playerRef.current
    if (!player || !nextState.videoId) return

    const desiredPositionSec = computeDesiredPositionSec(nextState)
    if (isStandaloneSession) {
      if (loadedVideoIdRef.current !== nextState.videoId) {
        syncLoadedVideoSource(player, {
          ...nextState,
          isPlaying: false,
        }, desiredPositionSec)
        loadedVideoIdRef.current = nextState.videoId
      }
      clearAutoplayCheckTimer(autoplayCheckTimerRef)
      setAutoplayBlocked(false)
      return
    }

    player.mute()
    const now = Date.now()

    if (loadedVideoIdRef.current !== nextState.videoId) {
      resetUnsyncedPlaybackTelemetry({
        isLocallyUnsyncedRef,
        lastUnsyncReportAtRef,
      })
      syncLoadedVideoSource(player, nextState, desiredPositionSec)
      loadedVideoIdRef.current = nextState.videoId
    } else {
      const currentTimeSec = player.getCurrentTime()
      const driftSec = computeDriftSec(currentTimeSec, desiredPositionSec)
      const syncAction = getStudentPlaybackSyncAction(currentTimeSec, desiredPositionSec, nextState.isPlaying)

      if (syncAction.type === 'seek') {
        const wasUnsynced = isLocallyUnsyncedRef.current
        player.setPlaybackRate(1)
        player.seekTo(desiredPositionSec, true)
        isLocallyUnsyncedRef.current = true

        if (!wasUnsynced || now - lastUnsyncReportAtRef.current >= 10_000) {
          lastUnsyncReportAtRef.current = now
          void reportEvent('unsync', { driftSec })
        }
      } else if (syncAction.type === 'rate') {
        const wasUnsynced = isLocallyUnsyncedRef.current
        player.setPlaybackRate(syncAction.playbackRate)
        isLocallyUnsyncedRef.current = true

        if (!wasUnsynced || now - lastUnsyncReportAtRef.current >= 10_000) {
          lastUnsyncReportAtRef.current = now
          void reportEvent('unsync', { driftSec })
        }
      } else if (isLocallyUnsyncedRef.current) {
        player.setPlaybackRate(1)
        isLocallyUnsyncedRef.current = false
        void reportEvent('sync-correction', { driftSec, correctionResult: 'success' })
      } else {
        player.setPlaybackRate(1)
      }
    }

    const { PLAYING } = resolveYoutubePlayerState(youtubeRef.current)
    if (nextState.isPlaying) {
      player.playVideo()
      clearAutoplayCheckTimer(autoplayCheckTimerRef)

      autoplayCheckTimerRef.current = window.setTimeout(() => {
        if (!shouldRunAutoplayCheck(playerRef.current, player)) {
          return
        }

        const stateValue = player.getPlayerState()
        if (stateValue !== PLAYING) {
          setAutoplayBlocked(true)
          void reportEvent('autoplay-blocked')
        } else {
          setAutoplayBlocked(false)
        }
      }, 1200)
    } else {
      clearAutoplayCheckTimer(autoplayCheckTimerRef)
      player.setPlaybackRate(1)
      player.pauseVideo()
      setAutoplayBlocked(false)
    }
  }, [isStandaloneSession, reportEvent])

  const buildWsUrl = useCallback(() => {
    if (!sessionId || typeof window === 'undefined') return null
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws/video-sync?sessionId=${encodeURIComponent(sessionId)}&role=student`
  }, [sessionId])

  const { connect, disconnect } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: shouldConnectVideoSyncStudentRealtime({
      sessionId,
      isStandaloneSession,
      isSessionModeResolved,
    }),
    attachSessionEndedHandler,
    onMessage: (event) => {
      const envelope = parseVideoSyncEnvelope(event.data)
      if (!envelope || envelope.sessionId !== sessionId) return

      if (envelope.type === 'state-update' || envelope.type === 'state-snapshot' || envelope.type === 'heartbeat') {
        const payload = parseVideoSyncStateMessagePayload(envelope.payload)
        if (payload?.state) {
          setState(payload.state)
        }
      }

      if (envelope.type === 'error') {
        const payload = parseVideoSyncErrorMessagePayload(envelope.payload)
        if (typeof payload?.message === 'string' && payload.message.length > 0) {
          setErrorMessage(payload.message)
        }
      }
    },
  })

  useEffect(() => {
    if (!shouldInitializeYoutubePlayer(state.videoId, playerContainerRef.current, playerRef.current)) {
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
          playerVars: buildStudentPlayerVars(isStandaloneSession),
          events: {
            onReady: () => {
              if (cancelled) return
              setPlayerReady(true)
              if (!isStandaloneSession) {
                player.mute()
              }
            },
            onError: () => {
              if (cancelled) return
              setErrorMessage('YouTube player failed to load for this video.')
              void reportEvent('load-failure', {
                correctionResult: 'failed',
                errorCode: 'PLAYER_LOAD_FAILED',
                errorMessage: 'YouTube player failed to load in synchronized student view',
              })
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
      resetUnsyncedPlaybackTelemetry({
        isLocallyUnsyncedRef,
        lastUnsyncReportAtRef,
      })
      clearAutoplayCheckTimer(autoplayCheckTimerRef)
      playerRef.current?.destroy()
      playerRef.current = null
    }
  }, [isStandaloneSession, reportEvent, state.videoId])

  useEffect(() => {
    if (!playerReady) return
    applyStateToPlayer(state)
  }, [playerReady, state, applyStateToPlayer])

  useEffect(() => {
    if (!state.videoId) {
      setHasStartedInstructorPlayback(false)
      return
    }

    if (isStandaloneSession) {
      setHasStartedInstructorPlayback(true)
      return
    }

    if (hasInstructorPlaybackStarted(state)) {
      setHasStartedInstructorPlayback(true)
    }
  }, [isStandaloneSession, state])

  useEffect(() => {
    setIsSessionModeResolved(false)
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return undefined

    let cancelled = false

    const loadSession = async () => {
      try {
        const response = await fetch(`/api/video-sync/${sessionId}/session`)
        if (!response.ok) {
          if (!cancelled) {
            setIsSessionModeResolved(true)
          }
          return
        }
        const data = (await response.json()) as SessionResponse
        if (cancelled) {
          return
        }
        setIsStandaloneSession(data.data?.standaloneMode === true)
        if (data.data?.state) {
          setState(data.data.state)
        }
      } catch {
        if (!cancelled) {
          setErrorMessage('Unable to load synchronized video state')
        }
      } finally {
        if (!cancelled) {
          setIsSessionModeResolved(true)
        }
      }
    }

    void loadSession()

    return () => {
      cancelled = true
    }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return undefined
    if (shouldConnectVideoSyncStudentRealtime({
      sessionId,
      isStandaloneSession,
      isSessionModeResolved,
    })) {
      connect()
    }

    return () => disconnect()
  }, [sessionId, isStandaloneSession, isSessionModeResolved, connect, disconnect])

  const retryAutoplay = (): void => {
    const player = playerRef.current
    if (!player) return
    player.setPlaybackRate(1)
    player.mute()
    player.playVideo()
    setAutoplayBlocked(false)
  }

  const handleStudentOverlayPointer = (event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.focus()
  }

  const handleStudentOverlayKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!shouldBlockStudentOverlayKey(event.key)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div className="fixed inset-0 z-30 bg-black">
      {state.videoId ? (
        <div className="absolute inset-0 w-full h-full bg-black">
          <div ref={playerContainerRef} className="w-full h-full" aria-label="Video Sync player" />
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-300">
          Waiting for instructor to configure the video.
        </div>
      )}

      {shouldRenderStudentInteractionOverlay(isStandaloneSession) ? (
        <div
          className="absolute inset-0 z-10 bg-transparent"
          tabIndex={0}
          aria-label="Synchronized playback is managed by the instructor"
          onMouseDown={handleStudentOverlayPointer}
          onClick={handleStudentOverlayPointer}
          onKeyDown={handleStudentOverlayKeyDown}
        />
      ) : null}

      {state.videoId && !isStandaloneSession && !hasStartedInstructorPlayback && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-black"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <p className="text-sm text-gray-300">Waiting for instructor to start the video.</p>
        </div>
      )}

      {errorMessage && (
        <div className="absolute top-4 left-4 right-4 z-20 md:left-auto md:right-4 md:w-[26.25rem] border border-red-300 bg-red-50 text-red-800 rounded p-3" role="alert">
          {errorMessage}
        </div>
      )}

      {autoplayBlocked && (
        <div className="absolute bottom-4 left-4 right-4 z-20 md:left-auto md:right-4 md:w-[26.25rem] border border-amber-300 bg-amber-50 rounded p-3 text-sm text-amber-900">
          Browser blocked autoplay. Click once to start, then follow the classroom display.
          <div className="mt-2">
            <Button onClick={retryAutoplay}>Click to start playback</Button>
          </div>
        </div>
      )}
    </div>
  )
}
