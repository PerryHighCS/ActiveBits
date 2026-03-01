import { useCallback, useEffect, useMemo, useState } from 'react'
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

function clampNumber(value: number, min = 0): number {
  return Number.isFinite(value) ? Math.max(min, value) : min
}

function getDisplayPositionSec(state: VideoSyncState): number {
  if (!state.isPlaying) {
    return clampNumber(state.positionSec)
  }

  const elapsedSec = Math.max(0, (Date.now() - state.serverTimestampMs) / 1000)
  const current = clampNumber(state.positionSec + elapsedSec)

  if (state.stopSec != null) {
    return Math.min(current, state.stopSec)
  }

  return current
}

function getEmbedUrl(state: VideoSyncState): string {
  if (!state.videoId) {
    return ''
  }

  const start = Math.floor(Math.max(state.startSec, 0))
  const params = new URLSearchParams({
    start: String(start),
    controls: '1',
    rel: '0',
    modestbranding: '1',
  })

  if (state.isPlaying) {
    params.set('autoplay', '1')
    params.set('mute', '1')
  }

  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(state.videoId)}?${params.toString()}`
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

  const displayPosition = useMemo(() => getDisplayPositionSec(state), [state])
  const embedUrl = useMemo(() => getEmbedUrl(state), [state])

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
        {embedUrl ? (
          <iframe
            title="Video Sync manager preview"
            src={embedUrl}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            className="w-full aspect-video rounded border"
          />
        ) : (
          <p className="text-sm text-gray-700">Configure a YouTube URL to preview the synchronized video.</p>
        )}
      </section>
    </div>
  )
}
