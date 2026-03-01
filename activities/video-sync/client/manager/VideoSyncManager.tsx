import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import SessionHeader from '@src/components/common/SessionHeader'
import Button from '@src/components/ui/Button'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import {
  parseVideoSyncEnvelope,
  type VideoSyncState,
  type VideoSyncTelemetry,
  type VideoSyncWsEnvelope,
} from '../protocol'
import { computeDesiredPositionSec, shouldCorrectDrift } from '../syncMath'
import {
  loadYoutubeIframeApi,
  resolveYoutubePlayerState,
  type YoutubeNamespace,
  type YoutubePlayerLike,
} from '../youtubeIframeApi'

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

const EMPTY_TELEMETRY: VideoSyncTelemetry = {
  connections: { activeCount: 0 },
  autoplay: { blockedCount: 0 },
  sync: { unsyncedStudents: 0, lastDriftSec: null, lastCorrectionResult: 'none' },
  error: { code: null, message: null },
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

function clampNumber(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export default function VideoSyncManager() {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  const [state, setState] = useState<VideoSyncState>(DEFAULT_STATE)
  const [telemetry, setTelemetry] = useState<VideoSyncTelemetry>(EMPTY_TELEMETRY)
  const [sourceUrlInput, setSourceUrlInput] = useState('')
  const [stopSecInput, setStopSecInput] = useState('')
  const [setupMode, setSetupMode] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [playerReady, setPlayerReady] = useState(false)

  const playerContainerRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YoutubePlayerLike | null>(null)
  const youtubeRef = useRef<YoutubeNamespace | null>(null)
  const loadedVideoIdRef = useRef<string | null>(null)
  const latestStateRef = useRef<VideoSyncState>(DEFAULT_STATE)
  const suppressPlayerEventsRef = useRef(false)
  const suppressPlayerEventsTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    latestStateRef.current = state
  }, [state])

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

  const sendCommand = useCallback(async (
    command: 'play' | 'pause' | 'seek',
    options?: { positionSec?: number; reportErrors?: boolean },
  ): Promise<void> => {
    if (!sessionId) return

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
        const failure = (await response.json()) as { message?: string }
        throw new Error(failure.message ?? 'Failed to send command')
      }

      const updated = (await response.json()) as CommandResponse
      if (updated.data?.state) {
        setState(updated.data.state)
      }
      if (updated.data?.telemetry) {
        setTelemetry(updated.data.telemetry)
      }
      setErrorMessage(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send command'
      if (options?.reportErrors === false) {
        console.error('Video sync command failed:', message)
      } else {
        setErrorMessage(message)
      }
    }
  }, [sessionId])

  const applyStateToPlayer = useCallback((nextState: VideoSyncState) => {
    const player = playerRef.current
    if (!player || !nextState.videoId) {
      return
    }

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
      if (shouldCorrectDrift(currentTimeSec, desiredPositionSec, SYNC_DRIFT_TOLERANCE_SEC)) {
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
        setState(data.data.state)
        setSetupMode(data.data.state.videoId.length === 0)
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
    if (!sessionId || typeof window === 'undefined') return null
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws/video-sync?sessionId=${encodeURIComponent(sessionId)}&role=manager`
  }, [sessionId])

  const handleEnvelope = useCallback((envelope: VideoSyncWsEnvelope) => {
    if (envelope.type === 'state-update' || envelope.type === 'state-snapshot' || envelope.type === 'heartbeat') {
      const payload = envelope.payload as { state?: VideoSyncState; telemetry?: VideoSyncTelemetry }
      if (payload.state) {
        setState(payload.state)
      }
      if (payload.telemetry) {
        setTelemetry(payload.telemetry)
      }
      return
    }

    if (envelope.type === 'telemetry-update') {
      const payload = envelope.payload as { telemetry?: VideoSyncTelemetry }
      if (payload.telemetry) {
        setTelemetry(payload.telemetry)
      }
      return
    }

    if (envelope.type === 'error') {
      const payload = envelope.payload as { message?: string }
      if (typeof payload.message === 'string' && payload.message.length > 0) {
        setErrorMessage(payload.message)
      }
    }
  }, [])

  useEffect(() => {
    if (setupMode) {
      setPlayerReady(false)
      loadedVideoIdRef.current = null
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
              applyStateToPlayer(latestStateRef.current)
            },
            onStateChange: (event) => {
              if (cancelled || suppressPlayerEventsRef.current) {
                return
              }

              const target = event.target
              const playerPosition = clampNumber(target.getCurrentTime())
              const states = resolveYoutubePlayerState(youtubeRef.current)

              if (event.data === states.PLAYING) {
                void sendCommand('play', { positionSec: playerPosition, reportErrors: false })
              } else if (event.data === states.PAUSED) {
                void sendCommand('pause', { positionSec: playerPosition, reportErrors: false })
              }
            },
            onError: () => {
              if (cancelled) return
              setErrorMessage('YouTube player failed to load. Try a different video URL.')
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
      playerRef.current?.destroy()
      playerRef.current = null
      clearPlayerEventSuppression()
    }
  }, [applyStateToPlayer, clearPlayerEventSuppression, sendCommand, setupMode])

  useEffect(() => {
    setStopSecInput(state.stopSec == null ? '' : String(state.stopSec))
  }, [state.stopSec])

  useEffect(() => {
    if (!playerReady) return
    applyStateToPlayer(state)
  }, [playerReady, state, applyStateToPlayer])

  const { connect, disconnect } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(sessionId),
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
    connect()
    return () => disconnect()
  }, [sessionId, fetchSession, connect, disconnect])

  const saveConfig = async (): Promise<void> => {
    if (!sessionId) return

    const stopSecValue = stopSecInput.trim().length === 0 ? null : Number(stopSecInput)
    try {
      const response = await fetch(`/api/video-sync/${sessionId}/session`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceUrl: sourceUrlInput,
          stopSec: stopSecValue,
        }),
      })

      if (!response.ok) {
        const failure = (await response.json()) as { message?: string }
        throw new Error(failure.message ?? 'Failed to save video config')
      }

      const updated = (await response.json()) as ConfigResponse
      if (updated.data?.state) {
        setState(updated.data.state)
        setSetupMode(updated.data.state.videoId.length === 0)
      }
      if (updated.data?.telemetry) {
        setTelemetry(updated.data.telemetry)
      }
      setErrorMessage(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save video config'
      setErrorMessage(message)
    }
  }

  const handleEndSession = async (): Promise<void> => {
    if (!sessionId) return
    await fetch(`/api/session/${sessionId}`, { method: 'DELETE' })
    void navigate('/manage')
  }

  const openSetupMode = (): void => {
    setSetupMode(true)
    if (state.videoId.length > 0) {
      setSourceUrlInput(`https://www.youtube.com/watch?v=${state.videoId}&start=${Math.floor(state.startSec)}`)
    }
  }

  const displayPosition = useMemo(() => computeDesiredPositionSec(state), [state])

  if (setupMode) {
    return (
      <div className="w-full p-4 space-y-4">
        <SessionHeader
          activityName="Video Sync"
          sessionId={sessionId}
          onEndSession={handleEndSession}
        />

        {errorMessage && (
          <div className="border border-red-300 bg-red-50 text-red-800 rounded p-3" role="alert">
            {errorMessage}
          </div>
        )}

        <section className="max-w-2xl border rounded p-4 space-y-3" aria-labelledby="video-sync-config-heading">
          <h2 id="video-sync-config-heading" className="text-xl font-semibold">Step 1: Configure video source</h2>
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

          <label className="block max-w-xs">
            <span className="block mb-1 font-medium">Advisory stop time (seconds)</span>
            <input
              className="border rounded p-2 w-full"
              type="number"
              min={0}
              step="0.1"
              value={stopSecInput}
              onChange={(event) => setStopSecInput(event.target.value)}
              aria-label="Stop time in seconds"
            />
          </label>

          <Button onClick={() => void saveConfig()}>Start instructor view</Button>
        </section>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-30 bg-black text-white">
      <div className="absolute top-0 left-0 right-0 z-20 px-3 py-2 bg-black/80 border-b border-white/10">
        <div className="flex items-center justify-between gap-3 text-sm">
          <div className="min-w-0 flex items-center gap-3">
            <span className="font-semibold whitespace-nowrap">Video Sync Instructor</span>
            <span className="text-gray-300 truncate">Session: {sessionId ?? '—'}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button onClick={openSetupMode}>Change video</Button>
            <Button onClick={() => void handleEndSession()}>End session</Button>
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className="absolute top-20 right-4 z-20 w-[min(28rem,calc(100vw-2rem))] border border-red-300 bg-red-50 text-red-800 rounded p-3" role="alert">
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
