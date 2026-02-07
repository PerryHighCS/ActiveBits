import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import Button from '@src/components/ui/Button'
import Modal from '@src/components/ui/Modal'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler'
import type { HostedFileAssignment, StudentTemplate } from '../../wwwSimTypes.js'
import DNSLookupTable from '../components/DNSLookupTable'
import StudentBrowserView from '../components/StudentBrowserView'
import StudentHostPalette from '../components/StudentHostPalette'
import Instructions from '../components/WwwSimInstructions'

interface WwwSimSessionData extends Record<string, unknown> {
  id?: string
}

interface WwwSimProps {
  sessionData?: WwwSimSessionData
}

interface WwwSimMessageEnvelope {
  type?: string
  payload?: unknown
}

interface StudentUpdatedPayload {
  oldHostname: string
  newHostname: string
}

interface StudentRemovedPayload {
  hostname: string
}

interface AssignedFragmentsPayload {
  host?: HostedFileAssignment[]
  requests?: StudentTemplate | null
}

interface TemplateAssignedPayload {
  hostname?: string
  template?: StudentTemplate | null
}

interface JoinResponse {
  message?: string
}

interface FragmentResponse {
  payload?: {
    host?: HostedFileAssignment[]
    requests?: StudentTemplate | null
  }
}

function parseMessage(data: string): WwwSimMessageEnvelope | null {
  try {
    return JSON.parse(data) as WwwSimMessageEnvelope
  } catch (error) {
    console.error('Failed to parse WS message', error)
    return null
  }
}

function isStudentUpdatedPayload(payload: unknown): payload is StudentUpdatedPayload {
  return (
    Boolean(payload) &&
    typeof payload === 'object' &&
    typeof (payload as StudentUpdatedPayload).oldHostname === 'string' &&
    typeof (payload as StudentUpdatedPayload).newHostname === 'string'
  )
}

function isStudentRemovedPayload(payload: unknown): payload is StudentRemovedPayload {
  return (
    Boolean(payload) &&
    typeof payload === 'object' &&
    typeof (payload as StudentRemovedPayload).hostname === 'string'
  )
}

function asAssignedFragmentsPayload(payload: unknown): AssignedFragmentsPayload {
  if (!payload || typeof payload !== 'object') {
    return {}
  }
  return payload as AssignedFragmentsPayload
}

function asTemplateAssignedPayload(payload: unknown): TemplateAssignedPayload {
  if (!payload || typeof payload !== 'object') {
    return {}
  }
  return payload as TemplateAssignedPayload
}

export default function WwwSim({ sessionData }: WwwSimProps) {
  const sessionId = typeof sessionData?.id === 'string' ? sessionData.id : undefined
  const storageKey = sessionId ? `${sessionId}-wwwsim` : 'wwwsim'

  const [hostname, setHostname] = useState(() => {
    try {
      return localStorage.getItem(storageKey) || ''
    } catch {
      return ''
    }
  })
  const [connecting, setConnecting] = useState(false)
  const [joined, setJoined] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [showInstructions, setShowInstructions] = useState(false)
  const [hostAssignments, setHostAssignments] = useState<HostedFileAssignment[]>([])
  const [templateRequests, setTemplateRequests] = useState<StudentTemplate | null>(null)

  const templateRequestsRef = useRef<StudentTemplate | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const httpKeepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const attachSessionEndedHandler = useSessionEndedHandler()

  useEffect(() => {
    templateRequestsRef.current = templateRequests
  }, [templateRequests])

  const clearWsIntervals = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
    if (httpKeepAliveRef.current) {
      clearInterval(httpKeepAliveRef.current)
      httpKeepAliveRef.current = null
    }
  }, [])

  const handleWsMessage = useCallback(
    (event: MessageEvent) => {
      const raw = typeof event.data === 'string' ? event.data : ''
      if (!raw || raw === 'pong' || raw === 'ping') return

      const msg = parseMessage(raw)
      if (!msg || msg.type === 'ping' || msg.type === 'pong') return

      switch (msg.type) {
        case 'student-updated': {
          if (!isStudentUpdatedPayload(msg.payload)) break

          const { oldHostname, newHostname } = msg.payload
          if (oldHostname === hostname) {
            setHostname(newHostname)
            localStorage.setItem(storageKey, newHostname)
            setMessage(`Hostname updated to "${newHostname}"`)
          }

          if (templateRequestsRef.current?.fragments?.length) {
            const escaped = oldHostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const regex = new RegExp(`//${escaped}/`, 'g')

            const nextFragments = templateRequestsRef.current.fragments.map((fragment) => ({
              ...fragment,
              url: fragment.url.replace(regex, `//${newHostname}/`),
            }))

            setTemplateRequests((prev) => ({
              title: prev?.title,
              fragments: nextFragments,
            }))
          }
          break
        }

        case 'student-removed': {
          if (!isStudentRemovedPayload(msg.payload)) break

          if (msg.payload.hostname === hostname) {
            setMessage('You have been removed by the instructor.')
            setJoined(false)
            setHostname('')
            localStorage.removeItem(storageKey)
          }
          break
        }

        case 'assigned-fragments': {
          const payload = asAssignedFragmentsPayload(msg.payload)
          setHostAssignments(Array.isArray(payload.host) ? payload.host : [])
          setTemplateRequests(payload.requests ?? null)
          break
        }

        case 'template-assigned': {
          const payload = asTemplateAssignedPayload(msg.payload)
          if (payload.hostname === hostname) {
            setTemplateRequests(payload.template ?? null)
          }
          break
        }

        default:
          break
      }
    },
    [hostname, storageKey],
  )

  const handleWsOpen = useCallback(
    (_event: Event, ws: WebSocket) => {
      clearWsIntervals()
      heartbeatRef.current = setInterval(() => {
        try {
          ws.send('ping')
        } catch {
          // Ignore failed ping.
        }
      }, 30_000)

      const keepAlive = () => fetch('/', { method: 'HEAD' }).catch(() => {})
      void keepAlive()
      httpKeepAliveRef.current = setInterval(() => {
        void keepAlive()
      }, 300_000)
    },
    [clearWsIntervals],
  )

  const handleWsClose = useCallback(() => {
    clearWsIntervals()
  }, [clearWsIntervals])

  const buildWsUrl = useCallback((): string | null => {
    if (!joined || !sessionId || typeof window === 'undefined') return null
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws/www-sim?sessionId=${sessionId}&hostname=${hostname}`
  }, [hostname, joined, sessionId])

  const { connect: connectWs, disconnect: disconnectWs } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(joined && sessionId),
    onOpen: handleWsOpen,
    onMessage: handleWsMessage,
    onError: (event) => console.error('WebSocket error (student)', event),
    onClose: handleWsClose,
    attachSessionEndedHandler,
  })

  useEffect(() => {
    if (!joined || !sessionId) {
      disconnectWs()
      return undefined
    }
    connectWs()
    return () => {
      disconnectWs()
    }
  }, [connectWs, disconnectWs, joined, sessionId, hostname])

  async function handleConnect(): Promise<void> {
    if (!sessionId || !hostname || connecting) return
    const ok = window.confirm(`Join as "${hostname}"?`)
    if (!ok) return

    setConnecting(true)
    setError('')
    setMessage('Connecting…')

    try {
      const response = await fetch(`/api/www-sim/${sessionId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostname }),
        credentials: 'include',
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || `${response.status} ${response.statusText}`)
      }

      const data = (await response.json()) as JoinResponse
      setJoined(true)
      setShowInstructions(true)
      localStorage.setItem(storageKey, hostname)
      setMessage(data.message || 'Joined! Waiting for instructor to start…')

      const fragmentsResponse = await fetch(`/api/www-sim/${sessionId}/fragments/${hostname}`, {
        credentials: 'include',
      })
      if (fragmentsResponse.ok) {
        const fragmentData = (await fragmentsResponse.json()) as FragmentResponse
        setHostAssignments(fragmentData.payload?.host ?? [])
        setTemplateRequests(fragmentData.payload?.requests ?? null)
      }
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : String(joinError))
      setMessage('')
    } finally {
      setConnecting(false)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      void handleConnect()
    }
  }

  if (!sessionData) {
    return <div className="p-6">Loading session…</div>
  }

  return (
    <div className="p-6 space-y-4">
      <Modal open={showInstructions} onClose={() => setShowInstructions(false)} title="Instructions">
        <Instructions />
      </Modal>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h1 className="text-2xl font-bold">Web Simulation: HTTP & DNS Protocols</h1>
        {joined && <p className="text-green-600 font-mono text-lg">{hostname}</p>}
        <div className="flex items-center gap-2">
          <p className="text-gray-600">
            Join Code: <span className="font-mono">{sessionData.id}</span>
          </p>
          {joined && (
            <Button variant="outline" onClick={() => setShowInstructions(true)}>
              Instructions
            </Button>
          )}
        </div>
      </div>

      {!joined && (
        <div className="flex justify-center sm:flex-row items-center gap-2">
          <input
            type="text"
            placeholder="Enter your hostname from code.org"
            value={hostname}
            onChange={(event) => setHostname(event.target.value.trim().toLowerCase())}
            onKeyDown={onKeyDown}
            disabled={joined}
            className="border border-gray-300 rounded px-2 py-1 text-sm w-full max-w-xs font-mono"
          />
          <Button onClick={() => void handleConnect()} disabled={!hostname || connecting}>
            {connecting ? 'Connecting…' : 'Connect'}
          </Button>
        </div>
      )}

      {message && (
        <div className="text-sm text-gray-700" role="status">
          {message}
        </div>
      )}
      {error && (
        <div className="text-sm text-red-600" role="alert">
          {error}
        </div>
      )}

      {joined && (
        <div className="flex mt-4 gap-4">
          <StudentHostPalette fragments={hostAssignments} hostname={hostname} />
          <div className="flex-1 text-sm text-gray-800 space-y-4">
            <DNSLookupTable template={templateRequests} onChange={(map) => console.log('DNS mapping:', map)} sessionId={sessionId} />
            <StudentBrowserView template={templateRequests} sessionId={sessionId} />
          </div>
        </div>
      )}
    </div>
  )
}
