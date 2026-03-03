import Button from '@src/components/ui/Button'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import {
  parseVideoSyncEnvelope,
  type VideoSyncState,
} from '../protocol.js'
import { computeDesiredPositionSec, shouldCorrectDrift } from '../syncMath.js'
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
    state?: VideoSyncState
  }
}

export function shouldInitializeYoutubePlayer(
  container: HTMLDivElement | null,
  existingPlayer: YoutubePlayerLike | null,
): boolean {
  return container != null && existingPlayer == null
}

const SYNC_DRIFT_TOLERANCE_SEC = 0.2

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

  const playerContainerRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YoutubePlayerLike | null>(null)
  const youtubeRef = useRef<YoutubeNamespace | null>(null)
  const loadedVideoIdRef = useRef<string | null>(null)
  const lastUnsyncReportAtRef = useRef(0)
  const isLocallyUnsyncedRef = useRef(false)
  const autoplayCheckTimerRef = useRef<number | null>(null)
  const studentClientIdRef = useRef(createStudentClientId())

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
      studentId: studentClientIdRef.current,
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

    player.mute()

    const desiredPositionSec = computeDesiredPositionSec(nextState)
    const now = Date.now()

    if (loadedVideoIdRef.current !== nextState.videoId) {
      player.loadVideoById({
        videoId: nextState.videoId,
        startSeconds: desiredPositionSec,
        endSeconds: nextState.stopSec ?? undefined,
      })
      loadedVideoIdRef.current = nextState.videoId
    } else {
      const currentTimeSec = player.getCurrentTime()
      const driftSec = Math.abs(currentTimeSec - desiredPositionSec)

      if (shouldCorrectDrift(currentTimeSec, desiredPositionSec, SYNC_DRIFT_TOLERANCE_SEC)) {
        const wasUnsynced = isLocallyUnsyncedRef.current
        player.seekTo(desiredPositionSec, true)
        isLocallyUnsyncedRef.current = true

        if (!wasUnsynced || now - lastUnsyncReportAtRef.current >= 10_000) {
          lastUnsyncReportAtRef.current = now
          void reportEvent('unsync', { driftSec })
        }
      } else if (isLocallyUnsyncedRef.current) {
        isLocallyUnsyncedRef.current = false
        void reportEvent('sync-correction', { driftSec, correctionResult: 'success' })
      }
    }

    const { PLAYING } = resolveYoutubePlayerState(youtubeRef.current)
    if (nextState.isPlaying) {
      player.playVideo()

      if (autoplayCheckTimerRef.current != null) {
        window.clearTimeout(autoplayCheckTimerRef.current)
      }

      autoplayCheckTimerRef.current = window.setTimeout(() => {
        const stateValue = player.getPlayerState()
        if (stateValue !== PLAYING) {
          setAutoplayBlocked(true)
          void reportEvent('autoplay-blocked')
        } else {
          setAutoplayBlocked(false)
        }
      }, 1200)
    } else {
      player.pauseVideo()
      setAutoplayBlocked(false)
    }
  }, [reportEvent])

  const buildWsUrl = useCallback(() => {
    if (!sessionId || typeof window === 'undefined') return null
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws/video-sync?sessionId=${encodeURIComponent(sessionId)}&role=student`
  }, [sessionId])

  const { connect, disconnect } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(sessionId),
    attachSessionEndedHandler,
    onMessage: (event) => {
      const envelope = parseVideoSyncEnvelope(event.data)
      if (!envelope || envelope.sessionId !== sessionId) return

      if (envelope.type === 'state-update' || envelope.type === 'state-snapshot' || envelope.type === 'heartbeat') {
        const payload = envelope.payload as { state?: VideoSyncState }
        if (payload.state) {
          setState(payload.state)
        }
      }

      if (envelope.type === 'error') {
        const payload = envelope.payload as { message?: string }
        if (typeof payload.message === 'string' && payload.message.length > 0) {
          setErrorMessage(payload.message)
        }
      }
    },
  })

  useEffect(() => {
    if (!shouldInitializeYoutubePlayer(playerContainerRef.current, playerRef.current)) {
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
            controls: 0,
            rel: 0,
            modestbranding: 1,
          },
          events: {
            onReady: () => {
              if (cancelled) return
              setPlayerReady(true)
              player.mute()
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
      if (autoplayCheckTimerRef.current != null) {
        window.clearTimeout(autoplayCheckTimerRef.current)
        autoplayCheckTimerRef.current = null
      }
      playerRef.current?.destroy()
      playerRef.current = null
    }
  }, [reportEvent])

  useEffect(() => {
    if (!playerReady) return
    applyStateToPlayer(state)
  }, [playerReady, state, applyStateToPlayer])

  useEffect(() => {
    if (!state.videoId) {
      setHasStartedInstructorPlayback(false)
      return
    }

    if (hasInstructorPlaybackStarted(state)) {
      setHasStartedInstructorPlayback(true)
    }
  }, [state])

  useEffect(() => {
    if (!sessionId) return undefined

    const loadSession = async () => {
      try {
        const response = await fetch(`/api/video-sync/${sessionId}/session`)
        if (!response.ok) return
        const data = (await response.json()) as SessionResponse
        if (data.data?.state) {
          setState(data.data.state)
        }
      } catch {
        setErrorMessage('Unable to load synchronized video state')
      }
    }

    void loadSession()
    connect()

    return () => disconnect()
  }, [sessionId, connect, disconnect])

  const retryAutoplay = (): void => {
    const player = playerRef.current
    if (!player) return
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

      <div
        className="absolute inset-0 z-10 bg-transparent"
        tabIndex={0}
        aria-label="Synchronized playback is managed by the instructor"
        onMouseDown={handleStudentOverlayPointer}
        onClick={handleStudentOverlayPointer}
        onKeyDown={handleStudentOverlayKeyDown}
      />

      {state.videoId && !hasStartedInstructorPlayback && (
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
