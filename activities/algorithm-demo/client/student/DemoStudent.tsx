import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler'
import AlgorithmPicker from '../components/AlgorithmPicker'
import {
  getAllAlgorithms,
  getAlgorithm,
  type AlgorithmState,
  type AlgorithmViewProps,
} from '../algorithms'
import { MESSAGE_TYPES, hydrateAlgorithmState, normalizeAlgorithmState } from '../utils'
import './DemoStudent.css'

interface DemoStudentProps {
  sessionData: {
    sessionId: string
  }
  persistentSessionInfo?: {
    queryParams?: {
      algorithm?: string
    }
  } | null
}

interface SessionResponse {
  data?: {
    algorithmId?: string | null
    algorithmState?: unknown
  }
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

function parseBroadcastMessage(rawData: unknown): BroadcastMessage | null {
  if (typeof rawData !== 'string') return null
  try {
    const parsed = JSON.parse(rawData) as BroadcastMessage
    return parsed != null && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export default function DemoStudent({ sessionData, persistentSessionInfo }: DemoStudentProps) {
  const { sessionId } = sessionData
  const [searchParams] = useSearchParams()
  const attachSessionEndedHandler = useSessionEndedHandler()

  const [algorithms] = useState(getAllAlgorithms())
  const [selectedAlgoId, setSelectedAlgoId] = useState<string | null>(null)
  const [algorithmState, setAlgorithmState] = useState<AlgorithmState | null>(null)
  const [isSoloMode] = useState(sessionId.startsWith('solo-'))
  const [isAutoSelectedFromParam, setIsAutoSelectedFromParam] = useState(false)
  const selectedAlgoIdRef = useRef<string | null>(selectedAlgoId)

  useEffect(() => {
    selectedAlgoIdRef.current = selectedAlgoId
  }, [selectedAlgoId])

  useEffect(() => {
    const algorithmParam = persistentSessionInfo?.queryParams?.algorithm ?? searchParams.get('algorithm')
    if (!algorithmParam || selectedAlgoId) return

    const algo = getAlgorithm(algorithmParam)
    if (algo) {
      console.log(`[algorithm-demo] Auto-detected algorithm from query params: ${algorithmParam}`)
      if (isSoloMode) {
        setSelectedAlgoId(algorithmParam)
        setAlgorithmState(algo.initState ? algo.initState() : {})
        setIsAutoSelectedFromParam(true)
      }
    } else {
      console.warn(
        `[algorithm-demo] Algorithm "${algorithmParam}" specified in URL but not found in available algorithms`,
      )
    }
  }, [persistentSessionInfo, searchParams, selectedAlgoId, isSoloMode])

  useEffect(() => {
    if (!sessionId || isSoloMode) return

    const fetchSession = async () => {
      try {
        const res = await fetch(`/api/algorithm-demo/${sessionId}/session`)
        if (!res.ok) return

        const data = (await res.json()) as SessionResponse
        if (typeof data.data?.algorithmId === 'string' && data.data.algorithmId.length > 0) {
          setSelectedAlgoId(data.data.algorithmId)
          setAlgorithmState(resolveHydratedState(data.data.algorithmId, data.data.algorithmState))
        }
      } catch (err) {
        console.error('Failed to fetch session:', err)
      }
    }

    void fetchSession()
    const pollInterval = setInterval(() => void fetchSession(), 3000)
    return () => clearInterval(pollInterval)
  }, [sessionId, isSoloMode])

  const buildWsUrl = useCallback(() => {
    if (!sessionId || isSoloMode) return null
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws/algorithm-demo?sessionId=${sessionId}`
  }, [sessionId, isSoloMode])

  const { connect, disconnect } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: !isSoloMode,
    attachSessionEndedHandler,
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
    if (isSoloMode) return
    void connect()
    return () => disconnect()
  }, [sessionId, isSoloMode, connect, disconnect])

  const handleSelectAlgorithm = (algoId: string) => {
    if (!isSoloMode) return

    setSelectedAlgoId(algoId)
    const algo = getAlgorithm(algoId)
    if (algo?.initState) {
      setAlgorithmState(algo.initState())
    }
  }

  const handleStateChange = (newState: AlgorithmState) => {
    if (!isSoloMode) return

    setAlgorithmState(newState)

    if (sessionId.startsWith('solo-')) {
      localStorage.setItem(
        `algorithm-demo-solo-${sessionId}`,
        JSON.stringify({
          algorithmId: selectedAlgoId,
          algorithmState: newState,
          timestamp: Date.now(),
        }),
      )
    }
  }

  const currentAlgo = selectedAlgoId ? getAlgorithm(selectedAlgoId) : undefined

  if (isSoloMode && !selectedAlgoId) {
    return (
      <div className="demo-student solo-mode">
        <h1>Algorithm Practice</h1>
        <p>Choose an algorithm to explore</p>
        <AlgorithmPicker
          algorithms={algorithms}
          selectedId={selectedAlgoId}
          onSelect={handleSelectAlgorithm}
          title="Select Algorithm"
        />
      </div>
    )
  }

  if (!currentAlgo) {
    return <div className="error">Waiting for instructor to select an algorithm...</div>
  }

  const CurrentStudentView = currentAlgo.StudentView as ComponentType<AlgorithmViewProps> | undefined
  if (!CurrentStudentView) {
    return <div className="error">Algorithm student view unavailable</div>
  }

  return (
    <div className="demo-student">
      {isSoloMode && !isAutoSelectedFromParam ? (
        <div className="solo-header">
          <h2>{currentAlgo.name}</h2>
          <button
            onClick={() => setSelectedAlgoId(null)}
            className="btn-switch"
          >
            Switch Algorithm
          </button>
        </div>
      ) : isSoloMode ? (
        <div className="solo-header">
          <h2>{currentAlgo.name}</h2>
        </div>
      ) : (
        <div className="shared-header">
          <h2>Now Demonstrating: {currentAlgo.name}</h2>
        </div>
      )}

      {algorithmState && (
        <div className="student-view">
          <CurrentStudentView
            session={{
              id: sessionId,
              data: { algorithmState, algorithmId: selectedAlgoId },
            }}
            onStateChange={isSoloMode ? handleStateChange : undefined}
          />
        </div>
      )}
    </div>
  )
}
