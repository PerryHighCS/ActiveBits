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

const EMPTY_TELEMETRY: VideoSyncTelemetry = {
  connections: { activeCount: 0 },
  autoplay: { blockedCount: 0 },
  sync: { unsyncEvents: 0, lastDriftSec: null, lastCorrectionResult: 'none' },
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

export default function VideoSyncManager() {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  const [state, setState] = useState<VideoSyncState>(DEFAULT_STATE)
  const [telemetry, setTelemetry] = useState<VideoSyncTelemetry>(EMPTY_TELEMETRY)
  const [sourceUrlInput, setSourceUrlInput] = useState('')
  const [stopSecInput, setStopSecInput] = useState('')
  const [seekSecInput, setSeekSecInput] = useState('0')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [playerReady, setPlayerReady] = useState(false)

  const playerContainerRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YoutubePlayerLike | null>(null)
  const youtubeRef = useRef<YoutubeNamespace | null>(null)
  const loadedVideoIdRef = useRef<string | null>(null)

  const applyStateToPlayer = useCallback((nextState: VideoSyncState) => {
    const player = playerRef.current
    if (!player || !nextState.videoId) {
      return
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
      if (shouldCorrectDrift(currentTimeSec, desiredPositionSec, 0.75)) {
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
  }, [])

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
            controls: 1,
            rel: 0,
            modestbranding: 1,
          },
          events: {
            onReady: () => {
              if (cancelled) return
              setPlayerReady(true)
              applyStateToPlayer(state)
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
    }
  }, [applyStateToPlayer, state.videoId])

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

  const sendCommand = async (command: 'play' | 'pause' | 'seek'): Promise<void> => {
    if (!sessionId) return

    const payload: Record<string, unknown> = { type: command }
    if (command === 'seek') {
      payload.positionSec = clampNumber(Number(seekSecInput))
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
      setErrorMessage(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send command'
      setErrorMessage(message)
    }
  }

  const handleEndSession = async (): Promise<void> => {
    if (!sessionId) return
    await fetch(`/api/session/${sessionId}`, { method: 'DELETE' })
    void navigate('/manage')
  }

  const displayPosition = useMemo(() => computeDesiredPositionSec(state), [state])

  return (
    <div className="w-full max-w-6xl mx-auto p-4 space-y-4">
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

      <section className="border rounded p-4 space-y-3" aria-labelledby="video-sync-config-heading">
        <h2 id="video-sync-config-heading" className="text-xl font-semibold">Video configuration</h2>
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

        <Button onClick={() => void saveConfig()}>Save video settings</Button>
      </section>

      <section className="border rounded p-4 space-y-3" aria-labelledby="video-sync-controls-heading">
        <h2 id="video-sync-controls-heading" className="text-xl font-semibold">Playback controls</h2>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void sendCommand('play')}>Play</Button>
          <Button onClick={() => void sendCommand('pause')}>Pause</Button>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="block max-w-xs">
            <span className="block mb-1 font-medium">Seek to (seconds)</span>
            <input
              className="border rounded p-2 w-full"
              type="number"
              min={0}
              step="0.1"
              value={seekSecInput}
              onChange={(event) => setSeekSecInput(event.target.value)}
              aria-label="Seek time in seconds"
            />
          </label>
          <Button onClick={() => void sendCommand('seek')}>Seek</Button>
        </div>

        <div className="text-sm text-gray-700" aria-live="polite">
          <div>Video ID: {state.videoId || 'Not configured'}</div>
          <div>Playing: {state.isPlaying ? 'Yes' : 'No'}</div>
          <div>Current position: {displayPosition.toFixed(2)}s</div>
          <div>Start: {state.startSec.toFixed(2)}s</div>
          <div>Stop: {state.stopSec != null ? `${state.stopSec.toFixed(2)}s` : 'Not set'}</div>
        </div>
      </section>

      <section className="border rounded p-4 space-y-2" aria-labelledby="video-sync-telemetry-heading">
        <h2 id="video-sync-telemetry-heading" className="text-xl font-semibold">Sync telemetry</h2>
        <div className="text-sm">
          <div>Active connections: {telemetry.connections.activeCount}</div>
          <div>Autoplay blocked: {telemetry.autoplay.blockedCount}</div>
          <div>Unsync events: {telemetry.sync.unsyncEvents}</div>
          <div>Last drift: {telemetry.sync.lastDriftSec != null ? `${telemetry.sync.lastDriftSec.toFixed(2)}s` : 'n/a'}</div>
          <div>Last correction: {telemetry.sync.lastCorrectionResult}</div>
          <div>Last error: {telemetry.error.code ? `${telemetry.error.code}: ${telemetry.error.message ?? ''}` : 'none'}</div>
        </div>
      </section>

      <section className="border rounded p-4" aria-labelledby="video-sync-preview-heading">
        <h2 id="video-sync-preview-heading" className="text-xl font-semibold mb-2">Video preview</h2>
        {state.videoId ? (
          <div className="w-full aspect-video rounded border overflow-hidden">
            <div ref={playerContainerRef} className="w-full h-full" aria-label="Video Sync manager preview" />
          </div>
        ) : (
          <p className="text-sm text-gray-700">Configure a YouTube URL to preview the synchronized video.</p>
        )}
      </section>
    </div>
  )
}
