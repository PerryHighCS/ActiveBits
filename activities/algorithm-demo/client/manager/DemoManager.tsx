import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import SessionHeader from '../../../../client/src/components/common/SessionHeader'
import { useResilientWebSocket } from '../../../../client/src/hooks/useResilientWebSocket'
import AlgorithmPicker from '../components/AlgorithmPicker'
import {
  getAllAlgorithms,
  getAlgorithm,
  type AlgorithmState,
  type AlgorithmViewProps,
} from '../algorithms'
import {
  MESSAGE_TYPES,
  createMessage,
  hydrateAlgorithmState,
  messageReplacer,
  normalizeAlgorithmState,
} from '../utils'
import './DemoManager.css'

interface SessionResponseData {
  algorithmId?: string | null
  algorithmState?: unknown
}

interface SessionResponse {
  id?: string
  data: SessionResponseData
}

interface BroadcastMessage {
  type?: string
  algorithmId?: string | null
  payload?: unknown
}

function toAlgorithmState(value: unknown): AlgorithmState | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as AlgorithmState)
    : null
}

function resolveHydratedState(
  algorithmId: string | null | undefined,
  payload: unknown,
): AlgorithmState | null {
  const normalized = toAlgorithmState(normalizeAlgorithmState(payload))
  if (!algorithmId) return normalized
  const algorithm = getAlgorithm(algorithmId)
  if (!algorithm) return normalized
  return toAlgorithmState(hydrateAlgorithmState(algorithm, normalized))
}

export function parseBroadcastMessage(rawData: unknown): BroadcastMessage | null {
  if (typeof rawData !== 'string') return null
  try {
    const parsed = JSON.parse(rawData) as BroadcastMessage
    return parsed != null && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export default function DemoManager() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const algorithms = getAllAlgorithms()
  const [session, setSession] = useState<SessionResponse | null>(null)
  const [selectedAlgoId, setSelectedAlgoId] = useState<string | null>(algorithms[0]?.id ?? null)
  const [algorithmState, setAlgorithmState] = useState<AlgorithmState | null>(null)
  const [hasAutoSelected, setHasAutoSelected] = useState(false)
  const [invalidAlgorithm, setInvalidAlgorithm] = useState<string | null>(null)
  const selectedAlgoIdRef = useRef<string | null>(selectedAlgoId)

  useEffect(() => {
    selectedAlgoIdRef.current = selectedAlgoId
  }, [selectedAlgoId])

  useEffect(() => {
    if (!sessionId) return

    const fetchSession = async () => {
      try {
        const res = await fetch(`/api/algorithm-demo/${sessionId}/session`)
        if (!res.ok) return

        const data = (await res.json()) as SessionResponse
        setSession(data)

        if (typeof data.data?.algorithmId === 'string' && data.data.algorithmId.length > 0) {
          setSelectedAlgoId(data.data.algorithmId)
          setAlgorithmState(resolveHydratedState(data.data.algorithmId, data.data.algorithmState))
          setHasAutoSelected(true)
        }
      } catch (err) {
        console.error('Failed to fetch session:', err)
      }
    }

    void fetchSession()
  }, [sessionId])

  const buildWsUrl = useCallback(() => {
    if (!sessionId) return null
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws/algorithm-demo?sessionId=${sessionId}`
  }, [sessionId])

  const { connect, disconnect, socketRef } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: true,
    onMessage: (event) => {
      const msg = parseBroadcastMessage(event.data)
      if (!msg?.type) return

      if (msg.type === MESSAGE_TYPES.ALGORITHM_SELECTED) {
        if (typeof msg.algorithmId === 'string') {
          setSelectedAlgoId(msg.algorithmId)
        }
        setAlgorithmState(resolveHydratedState(msg.algorithmId, msg.payload))
      } else if (msg.type === MESSAGE_TYPES.STATE_SYNC) {
        const fallbackAlgorithmId = selectedAlgoIdRef.current
        setAlgorithmState(resolveHydratedState(msg.algorithmId ?? fallbackAlgorithmId, msg.payload))
      }
    },
  })

  useEffect(() => {
    if (!sessionId) return
    connect()
    return () => disconnect()
  }, [sessionId, connect, disconnect])

  const handleSelectAlgorithm = useCallback(
    async (algoId: string) => {
      if (!sessionId) return

      setSelectedAlgoId(algoId)
      const algo = getAlgorithm(algoId)
      if (!algo) return

      const newState = algo.initState ? algo.initState() : {}
      setAlgorithmState(newState)

      if (socketRef.current?.readyState === 1) {
        socketRef.current.send(
          JSON.stringify(
            createMessage(MESSAGE_TYPES.ALGORITHM_SELECTED, newState, {
              algorithmId: algoId,
              sessionId,
            }),
            messageReplacer,
          ),
        )
      }

      await fetch(`/api/algorithm-demo/${sessionId}/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ algorithmId: algoId, algorithmState: newState }, messageReplacer),
      })
    },
    [sessionId, socketRef],
  )

  useEffect(() => {
    const algorithmParam = searchParams.get('algorithm')
    if (!algorithmParam || hasAutoSelected || !sessionId || !session) return

    const algo = getAlgorithm(algorithmParam)
    if (!algo) {
      console.warn(`[algorithm-demo] Algorithm "${algorithmParam}" not found in available algorithms`)
      setInvalidAlgorithm(algorithmParam)
      setHasAutoSelected(true)
      return
    }

    if (!session.data.algorithmId) {
      console.log(`[algorithm-demo] Auto-selecting algorithm from URL: ${algorithmParam}`)
      void handleSelectAlgorithm(algorithmParam)
    }
    setHasAutoSelected(true)
  }, [searchParams, hasAutoSelected, sessionId, session, handleSelectAlgorithm])

  const handleStateChange = async (newState: AlgorithmState) => {
    if (!sessionId) return

    setAlgorithmState(newState)

    if (socketRef.current?.readyState === 1) {
      socketRef.current.send(
        JSON.stringify(
          createMessage(MESSAGE_TYPES.STATE_SYNC, newState, {
            algorithmId: selectedAlgoId,
            sessionId,
          }),
          messageReplacer,
        ),
      )
    }

    await fetch(`/api/algorithm-demo/${sessionId}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ algorithmState: newState }, messageReplacer),
    })
  }

  const handleEndSession = async () => {
    if (!sessionId) return
    await fetch(`/api/session/${sessionId}`, { method: 'DELETE' })
    void navigate('/manage')
  }

  const currentAlgo = selectedAlgoId ? getAlgorithm(selectedAlgoId) : undefined
  if (!currentAlgo) {
    return <div className="error">Algorithm not found</div>
  }

  const CurrentManagerView = currentAlgo.ManagerView as ComponentType<AlgorithmViewProps> | undefined
  if (!CurrentManagerView) {
    return <div className="error">Algorithm manager view unavailable</div>
  }

  const isDeepLink = Boolean(searchParams.get('algorithm'))

  return (
    <div className="demo-manager">
      <SessionHeader
        activityName="Algorithm Demonstrations"
        sessionId={sessionId}
        onEndSession={handleEndSession}
      />

      {(invalidAlgorithm || !isDeepLink) && (
        <>
          {invalidAlgorithm && (
            <div className="bg-red-50 border-2 border-red-200 rounded p-4 mb-4">
              <p className="text-red-700 font-semibold">⚠️ Algorithm not found</p>
              <p className="text-red-600 text-sm">
                The algorithm "{invalidAlgorithm}" was not found. Please select an algorithm below.
              </p>
            </div>
          )}
          <AlgorithmPicker
            algorithms={algorithms}
            selectedId={selectedAlgoId}
            onSelect={(algoId) => {
              setInvalidAlgorithm(null)
              void handleSelectAlgorithm(algoId)
            }}
            title="Select Algorithm to Demonstrate"
          />
        </>
      )}

      {algorithmState && (
        <div className="manager-view">
          <CurrentManagerView
            session={{
              id: sessionId ?? null,
              data: { algorithmState, algorithmId: selectedAlgoId },
            }}
            onStateChange={handleStateChange}
          />
        </div>
      )}
    </div>
  )
}
