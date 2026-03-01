import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import Button from '@src/components/ui/Button'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler'
import {
  parseVideoSyncEnvelope,
  type VideoSyncState,
} from '../protocol'
import { computeDesiredPositionSec, shouldCorrectDrift } from '../syncMath'
import {
  loadYoutubeIframeApi,
  resolveYoutubePlayerState,
  type YoutubeNamespace,
  type YoutubePlayerLike,
} from '../youtubeIframeApi'

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

const SOLO_STORAGE_KEY = 'video-sync-solo-state-solo-video-sync'
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

function clampNumber(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function createStudentClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const random = Math.random().toString(36).slice(2)
  return `student-${Date.now()}-${random}`
}

function parseYouTubeVideoId(urlValue: string): { videoId: string | null; startSec: number; stopSec: number | null } {
  try {
    const url = new URL(urlValue)
    const host = url.hostname.toLowerCase()
    const isYoutube = host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com'
    const isShort = host === 'youtu.be' || host === 'www.youtu.be'

    let videoId: string | null = null
    if (isYoutube && url.pathname === '/watch') {
      const value = url.searchParams.get('v')
      videoId = typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
    } else if (isShort) {
      const value = url.pathname.slice(1)
      videoId = value.trim().length > 0 ? value.trim() : null
    }

    const startRaw = url.searchParams.get('start') ?? url.searchParams.get('t')
    const stopRaw = url.searchParams.get('end')

    const startSec = startRaw ? clampNumber(Number.parseFloat(startRaw)) : 0
    const stopParsed = stopRaw == null || stopRaw.length === 0 ? null : clampNumber(Number.parseFloat(stopRaw))

    return { videoId, startSec, stopSec: stopParsed }
  } catch {
    return { videoId: null, startSec: 0, stopSec: null }
  }
}

export default function VideoSyncStudent({ sessionData }: VideoSyncStudentProps) {
  const sessionId = sessionData?.sessionId ?? null
  const isSoloMode = sessionId?.startsWith('solo-') ?? false
  const attachSessionEndedHandler = useSessionEndedHandler()

  const [state, setState] = useState<VideoSyncState>(DEFAULT_STATE)
  const [sourceUrlInput, setSourceUrlInput] = useState('')
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

  useEffect(() => {
    if (!isSoloMode || typeof window === 'undefined') return
    try {
      const stored = localStorage.getItem(SOLO_STORAGE_KEY)
      if (!stored) return
      const parsed = JSON.parse(stored) as Partial<VideoSyncState>
      setState({
        ...DEFAULT_STATE,
        ...parsed,
      })
    } catch {
      setState(DEFAULT_STATE)
    }
  }, [isSoloMode])

  const reportEvent = useCallback(async (
    eventType: 'autoplay-blocked' | 'unsync' | 'sync-correction' | 'load-failure',
    options?: {
      driftSec?: number
      correctionResult?: 'success' | 'failed'
      errorCode?: string
      errorMessage?: string
    },
  ): Promise<void> => {
    if (!sessionId || isSoloMode) return
    await fetch(`/api/video-sync/${sessionId}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: eventType,
        studentId: studentClientIdRef.current,
        driftSec: options?.driftSec,
        correctionResult: options?.correctionResult,
        errorCode: options?.errorCode,
        errorMessage: options?.errorMessage,
      }),
    })
  }, [sessionId, isSoloMode])

  const applyStateToPlayer = useCallback((nextState: VideoSyncState, source: 'sync' | 'solo') => {
    const player = playerRef.current
    if (!player || !nextState.videoId) return

    if (source === 'sync') {
      player.mute()
    } else {
      player.unMute()
    }

    const desiredPositionSec = computeDesiredPositionSec(nextState)
    const now = Date.now()

    if (loadedVideoIdRef.current !== nextState.videoId) {
      if (source === 'sync') {
        player.loadVideoById({
          videoId: nextState.videoId,
          startSeconds: desiredPositionSec,
          endSeconds: nextState.stopSec ?? undefined,
        })
      } else {
        player.cueVideoById({
          videoId: nextState.videoId,
          startSeconds: desiredPositionSec,
          endSeconds: nextState.stopSec ?? undefined,
        })
      }
      loadedVideoIdRef.current = nextState.videoId
    } else {
      const currentTimeSec = player.getCurrentTime()
      const driftSec = Math.abs(currentTimeSec - desiredPositionSec)

      if (source === 'sync' && shouldCorrectDrift(currentTimeSec, desiredPositionSec, SYNC_DRIFT_TOLERANCE_SEC)) {
        const wasUnsynced = isLocallyUnsyncedRef.current
        player.seekTo(desiredPositionSec, true)
        isLocallyUnsyncedRef.current = true

        if (!wasUnsynced || now - lastUnsyncReportAtRef.current >= 10_000) {
          lastUnsyncReportAtRef.current = now
          void reportEvent('unsync', { driftSec })
        }
      } else if (source === 'sync' && isLocallyUnsyncedRef.current) {
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
          if (source === 'sync') {
            void reportEvent('autoplay-blocked')
          }
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
    if (!sessionId || isSoloMode || typeof window === 'undefined') return null
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws/video-sync?sessionId=${encodeURIComponent(sessionId)}&role=student`
  }, [sessionId, isSoloMode])

  const { connect, disconnect } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: !isSoloMode && Boolean(sessionId),
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
    if (!playerContainerRef.current) {
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
            controls: isSoloMode ? 1 : 0,
            rel: 0,
            modestbranding: 1,
          },
          events: {
            onReady: () => {
              if (cancelled) return
              setPlayerReady(true)
              if (!isSoloMode) {
                player.mute()
              }
              applyStateToPlayer(state, isSoloMode ? 'solo' : 'sync')
            },
            onError: () => {
              if (cancelled) return
              setErrorMessage('YouTube player failed to load for this video.')
              if (!isSoloMode) {
                void reportEvent('load-failure', {
                  correctionResult: 'failed',
                  errorCode: 'PLAYER_LOAD_FAILED',
                  errorMessage: 'YouTube player failed to load in synchronized student view',
                })
              }
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
  }, [applyStateToPlayer, isSoloMode, state.videoId])

  useEffect(() => {
    if (!playerReady) return
    applyStateToPlayer(state, isSoloMode ? 'solo' : 'sync')
  }, [playerReady, state, isSoloMode, applyStateToPlayer])

  useEffect(() => {
    if (isSoloMode) {
      setHasStartedInstructorPlayback(false)
      return
    }

    if (!state.videoId) {
      setHasStartedInstructorPlayback(false)
      return
    }

    if (hasInstructorPlaybackStarted(state)) {
      setHasStartedInstructorPlayback(true)
    }
  }, [isSoloMode, state])

  useEffect(() => {
    if (!sessionId || isSoloMode) return undefined

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
  }, [sessionId, isSoloMode, connect, disconnect])

  const persistSoloState = useCallback((next: VideoSyncState) => {
    if (!isSoloMode || typeof window === 'undefined') return
    localStorage.setItem(SOLO_STORAGE_KEY, JSON.stringify(next))
  }, [isSoloMode])

  const applySoloSource = (): void => {
    const parsed = parseYouTubeVideoId(sourceUrlInput)
    if (!parsed.videoId) {
      setErrorMessage('Enter a valid youtube.com/watch or youtu.be URL')
      return
    }

    const next: VideoSyncState = {
      ...state,
      provider: 'youtube',
      videoId: parsed.videoId,
      startSec: parsed.startSec,
      stopSec: parsed.stopSec,
      positionSec: parsed.startSec,
      isPlaying: false,
      updatedBy: 'system',
      serverTimestampMs: Date.now(),
    }

    setState(next)
    persistSoloState(next)
    if (playerReady) {
      applyStateToPlayer(next, 'solo')
    }
    setErrorMessage(null)
  }

  const updateSoloPlayback = (type: 'play' | 'pause' | 'seek-start') => {
    if (!isSoloMode) return

    const now = Date.now()
    const currentPosition = computeDesiredPositionSec(state)
    const next: VideoSyncState =
      type === 'play'
        ? {
        ...state,
        positionSec: currentPosition,
        isPlaying: true,
        updatedBy: 'system',
        serverTimestampMs: now,
      }
        : type === 'pause'
          ? {
        ...state,
        positionSec: currentPosition,
        isPlaying: false,
        updatedBy: 'system',
        serverTimestampMs: now,
      }
          : {
        ...state,
        positionSec: state.startSec,
        isPlaying: false,
        updatedBy: 'system',
        serverTimestampMs: now,
      }

    setState(next)
    persistSoloState(next)
    if (playerReady) {
      applyStateToPlayer(next, 'solo')
    }
  }

  const displayPosition = useMemo(() => computeDesiredPositionSec(state), [state])

  const retryAutoplay = (): void => {
    const player = playerRef.current
    if (!player) return
    if (!isSoloMode) {
      player.mute()
    }
    player.playVideo()
    setAutoplayBlocked(false)
  }

  const handleStudentOverlayPointer = (event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.focus()
  }

  const handleStudentOverlayKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
  }

  if (!isSoloMode) {
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
            className="absolute inset-0 z-15 flex items-center justify-center bg-black"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <p className="text-sm text-gray-300">Waiting for instructor to start the video.</p>
          </div>
        )}

        {errorMessage && (
          <div className="absolute top-4 left-4 right-4 z-20 md:left-auto md:right-4 md:w-105 border border-red-300 bg-red-50 text-red-800 rounded p-3" role="alert">
            {errorMessage}
          </div>
        )}

        {autoplayBlocked && (
          <div className="absolute bottom-4 left-4 right-4 z-20 md:left-auto md:right-4 md:w-105 border border-amber-300 bg-amber-50 rounded p-3 text-sm text-amber-900">
            Browser blocked autoplay. Click once to start, then follow the classroom display.
            <div className="mt-2">
              <Button onClick={retryAutoplay}>Click to start playback</Button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="w-full p-4 space-y-4">
      <h1 className="text-2xl font-bold">Video Sync</h1>

      {errorMessage && (
        <div className="border border-red-300 bg-red-50 text-red-800 rounded p-3" role="alert">
          {errorMessage}
        </div>
      )}

      {isSoloMode && (
        <section className="border rounded p-4 space-y-3" aria-labelledby="video-sync-solo-config">
          <h2 id="video-sync-solo-config" className="text-xl font-semibold">Solo setup</h2>
          <label className="block">
            <span className="block mb-1 font-medium">YouTube URL</span>
            <input
              className="border rounded p-2 w-full"
              type="url"
              value={sourceUrlInput}
              onChange={(event) => setSourceUrlInput(event.target.value)}
              placeholder="https://www.youtube.com/watch?v=... or https://youtu.be/..."
              aria-label="YouTube URL"
            />
          </label>
          <Button onClick={applySoloSource}>Load video</Button>
          <div className="flex gap-2">
            <Button onClick={() => updateSoloPlayback('play')} disabled={!state.videoId}>Play</Button>
            <Button onClick={() => updateSoloPlayback('pause')} disabled={!state.videoId}>Pause</Button>
            <Button onClick={() => updateSoloPlayback('seek-start')} disabled={!state.videoId}>Restart at start</Button>
          </div>
        </section>
      )}

      <section className="border rounded p-4" aria-labelledby="video-sync-player">
        <h2 id="video-sync-player" className="text-xl font-semibold mb-2">Player</h2>
        {state.videoId ? (
          <div className="w-full rounded border overflow-hidden bg-black aspect-video">
            <div ref={playerContainerRef} className="w-full h-full" aria-label="Video Sync player" />
          </div>
        ) : (
          <p className="text-sm text-gray-700">No video selected yet.</p>
        )}
        <div className="mt-3 text-sm text-gray-700" aria-live="polite">
          <div>Video ID: {state.videoId || 'Not configured'}</div>
          <div>Playing: {state.isPlaying ? 'Yes' : 'No'}</div>
          <div>Position: {displayPosition.toFixed(2)}s</div>
          <div>Start: {state.startSec.toFixed(2)}s</div>
          <div>Stop: {state.stopSec != null ? `${state.stopSec.toFixed(2)}s` : 'Not set'}</div>
        </div>
      </section>
    </div>
  )
}
