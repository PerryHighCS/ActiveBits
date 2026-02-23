import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import SessionHeader from '@src/components/common/SessionHeader'
import Button from '@src/components/ui/Button'
import ActivityRoster from '@src/components/common/ActivityRoster'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import type { PythonListPracticeStudent } from '../../pythonListPracticeTypes.js'
import {
  downloadCsv,
  computeManagerStats,
  sortStudents,
  QUESTION_TYPES,
  type SortColumn,
} from './managerUtils.js'
import '../styles.css'

interface WebSocketMessage {
  type: string
  payload?: Record<string, unknown>
}

const PythonListPracticeManager: FC = () => {
  const { sessionId } = useParams<{ sessionId?: string }>()
  const navigate = useNavigate()
  const [students, setStudents] = useState<PythonListPracticeStudent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set(['all']))
  const [sortBy, setSortBy] = useState<SortColumn>('name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  const loadSession = useCallback(
    async (showSpinner = true) => {
      if (sessionId == null) return
      if (showSpinner) {
        setLoading(true)
      }
      try {
        const res = await fetch(`/api/python-list-practice/${sessionId}`)
        if (res.ok !== true) throw new Error('Failed to fetch session')
        const data = (await res.json()) as Record<string, unknown>
        const list = Array.isArray(data.students) ? (data.students as PythonListPracticeStudent[]) : []
        setStudents(list)
        const types = Array.isArray(data.selectedQuestionTypes) ? data.selectedQuestionTypes : ['all']
        setSelectedTypes(new Set(types as string[]))
        setError(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load session'
        setError(message)
      } finally {
        setLoading(false)
      }
    },
    [sessionId],
  )

  const handleWsMessage = useCallback((evt: MessageEvent<string>) => {
    try {
      const msg = JSON.parse(evt.data) as WebSocketMessage
      if (msg.type === 'studentsUpdate') {
        const list = Array.isArray((msg.payload as Record<string, unknown>)?.students)
          ? ((msg.payload as Record<string, unknown>)?.students as PythonListPracticeStudent[])
          : []
        setStudents(list)
        setLoading(false)
      } else if (msg.type === 'questionTypesUpdate') {
        const types = Array.isArray((msg.payload as Record<string, unknown>)?.selectedQuestionTypes)
          ? ((msg.payload as Record<string, unknown>)?.selectedQuestionTypes as string[])
          : ['all']
        setSelectedTypes(new Set(types))
      }
    } catch (e) {
      console.error('WS parse error', e)
    }
  }, [])

  const handleWsError = useCallback(() => {
    setError('WebSocket error')
  }, [])

  const handleWsOpen = useCallback(() => {
    setError(null)
    void loadSession(false)
  }, [loadSession])

  const buildWsUrl = useCallback(() => {
    if (sessionId == null) return null
    const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}/ws/python-list-practice?sessionId=${encodeURIComponent(sessionId)}`
  }, [sessionId])

  const { connect, disconnect } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: sessionId != null,
    onOpen: handleWsOpen,
    onMessage: handleWsMessage,
    onError: handleWsError,
  })

  useEffect(() => {
    if (sessionId == null) return undefined
    void loadSession()
    void connect()
    return () => {
      disconnect()
    }
  }, [sessionId, loadSession, connect, disconnect])

  const persistQuestionTypes = useCallback(
    (nextSet: Set<string>) => {
      if (sessionId == null) return
      fetch(`/api/python-list-practice/${sessionId}/question-types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ types: Array.from(nextSet) }),
      }).catch((err) => {
        console.error('Failed to update question types', err)
        setError('Failed to update question types')
      })
    },
    [sessionId],
  )

  const handleToggleType = useCallback(
    (typeId: string) => {
      if (sessionId == null) return
      const next = new Set(selectedTypes)
      if (typeId === 'all') {
        next.clear()
        next.add('all')
      } else {
        if (next.has('all')) {
          next.clear()
        }
        if (next.has(typeId)) {
          next.delete(typeId)
        } else {
          next.add(typeId)
        }
        if (next.size === 0) {
          next.add('all')
        }
      }
      setSelectedTypes(next)
      persistQuestionTypes(next)
    },
    [selectedTypes, sessionId, persistQuestionTypes],
  )

  const stats = useMemo(() => computeManagerStats(students), [students])

  const sortedStudents = useMemo(() => sortStudents(students, sortBy, sortDirection), [students, sortBy, sortDirection])

  const handleSort = useCallback((columnId: string) => {
    const column = columnId as SortColumn
    setSortBy((current) => {
      if (current === column) {
        setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
        return current
      }
      setSortDirection(column === 'name' ? 'asc' : 'desc')
      return column
    })
  }, [])

  const endSession = useCallback(async () => {
    if (sessionId == null) return
    await fetch(`/api/session/${sessionId}`, { method: 'DELETE' })
    void navigate('/manage')
  }, [sessionId, navigate])

  return (
    <div className="python-list-manager">
      <div className="p-6 max-w-6xl mx-auto space-y-4">
        <SessionHeader activityName="Python List Practice" sessionId={sessionId} onEndSession={endSession} />

        <div className="python-list-card" style={{ marginTop: 0 }}>
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <div className="text-lg font-semibold text-emerald-900">{stats.connected} connected</div>
              <div className="text-sm text-emerald-800">{stats.totalStudents} total students</div>
            </div>
            <Button
              variant="outline"
              onClick={() => downloadCsv(sortedStudents)}
              className="border-emerald-300 text-emerald-800 hover:bg-emerald-50"
            >
              📊 Download CSV
            </Button>
            {error && <div className="text-red-600 text-sm">{error}</div>}
            {loading && <div className="text-sm text-emerald-700">Loading…</div>}
          </div>
        </div>

        <div className="python-list-card">
          <h3 className="text-lg font-semibold text-emerald-900 mb-2">Select question types to practice</h3>
          <p className="text-sm text-emerald-800 mb-3">Students will only see the skills you enable.</p>
          <div className="flex flex-wrap gap-2">
            {QUESTION_TYPES.map((type) => (
              <button
                key={type.id}
                onClick={() => handleToggleType(type.id)}
                className={`python-list-chip ${selectedTypes.has(type.id) ? 'selected' : ''}`}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        <ActivityRoster
          accent="emerald"
          students={sortedStudents}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onSort={handleSort}
          columns={[
            {
              id: 'name',
              label: 'Student',
              render: (s: PythonListPracticeStudent) => (
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${s.connected ? 'bg-emerald-500' : 'bg-gray-300'}`}></span>
                  <span className="font-medium">{s.name}</span>
                </div>
              ),
            },
            { id: 'total', label: 'Total', align: 'center', render: (s: PythonListPracticeStudent) => s.stats?.total || 0 },
            {
              id: 'correct',
              label: 'Correct',
              align: 'center',
              render: (s: PythonListPracticeStudent) => s.stats?.correct || 0,
            },
            {
              id: 'accuracy',
              label: 'Accuracy',
              align: 'center',
              render: (s: PythonListPracticeStudent) => {
                const total = s.stats?.total || 0
                const correct = s.stats?.correct || 0
                return total > 0 ? `${Math.round((correct / total) * 100)}%` : '0%'
              },
            },
            { id: 'streak', label: 'Streak', align: 'center', render: (s: PythonListPracticeStudent) => s.stats?.streak || 0 },
            {
              id: 'longestStreak',
              label: 'Longest Streak',
              align: 'center',
              render: (s: PythonListPracticeStudent) => s.stats?.longestStreak || 0,
            },
          ]}
          loading={loading}
          error={error}
          emptyMessage="No students yet. Share the join code above."
        />
      </div>
    </div>
  )
}

export default PythonListPracticeManager
