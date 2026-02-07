import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ActivityRoster from '@src/components/common/ActivityRoster'
import SessionHeader from '@src/components/common/SessionHeader'
import Button from '@src/components/ui/Button'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import { arrayToCsv, downloadCsv } from '@src/utils/csvUtils'
import type { JavaStringMethodId, JavaStringStudentRecord } from '../../javaStringPracticeTypes.js'

type SortColumn = 'name' | 'total' | 'correct' | 'accuracy' | 'streak'
type SortDirection = 'asc' | 'desc'

interface StudentsResponse {
  students?: JavaStringStudentRecord[]
}

interface StudentsUpdateMessage {
  type?: string
  payload?: {
    students?: JavaStringStudentRecord[]
  }
}

const methodTypes: Array<{ id: JavaStringMethodId; label: string }> = [
  { id: 'all', label: 'All Methods' },
  { id: 'substring', label: 'substring()' },
  { id: 'indexOf', label: 'indexOf()' },
  { id: 'equals', label: 'equals()' },
  { id: 'length', label: 'length()' },
  { id: 'compareTo', label: 'compareTo()' },
]

export default function JavaStringPracticeManager() {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  const [students, setStudents] = useState<JavaStringStudentRecord[]>([])
  const [selectedMethods, setSelectedMethods] = useState<Set<JavaStringMethodId>>(new Set(['all']))
  const [sortBy, setSortBy] = useState<SortColumn>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const handleMethodToggle = (methodId: JavaStringMethodId): void => {
    const next = new Set(selectedMethods)

    if (methodId === 'all') {
      next.clear()
      next.add('all')
    } else {
      if (next.has('all')) {
        next.clear()
      }

      if (next.has(methodId)) {
        next.delete(methodId)
      } else {
        next.add(methodId)
      }

      if (next.size === 0) {
        next.add('all')
      }
    }

    setSelectedMethods(next)

    if (!sessionId) return
    fetch(`/api/java-string-practice/${sessionId}/methods`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ methods: Array.from(next) }),
    }).catch((error) => {
      console.error('Failed to update methods:', error)
    })
  }

  const fetchStudents = useCallback(async () => {
    if (!sessionId) return
    try {
      const response = await fetch(`/api/java-string-practice/${sessionId}/students`)
      if (!response.ok) throw new Error('Failed to fetch students')
      const data = (await response.json()) as StudentsResponse
      setStudents(Array.isArray(data.students) ? data.students : [])
    } catch (error) {
      console.error('Failed to fetch students:', error)
    }
  }, [sessionId])

  const handleWsMessage = useCallback((event: MessageEvent) => {
    try {
      const message = JSON.parse(String(event.data)) as StudentsUpdateMessage
      if (message.type === 'studentsUpdate') {
        setStudents(Array.isArray(message.payload?.students) ? message.payload.students : [])
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error)
    }
  }, [])

  const handleWsOpen = useCallback(() => {
    fetchStudents()
  }, [fetchStudents])

  const buildWsUrl = useCallback((): string | null => {
    if (!sessionId || typeof window === 'undefined') return null
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws/java-string-practice?sessionId=${sessionId}`
  }, [sessionId])

  const { connect, disconnect } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(sessionId),
    onOpen: handleWsOpen,
    onMessage: handleWsMessage,
    onError: (error) => console.error('Manager WebSocket error:', error),
    onClose: () => console.log('Manager WebSocket disconnected'),
  })

  useEffect(() => {
    if (!sessionId) return undefined
    void fetchStudents()
    connect()
    return () => {
      disconnect()
    }
  }, [connect, disconnect, fetchStudents, sessionId])

  const handleSort = (column: SortColumn): void => {
    if (sortBy === column) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(column)
      setSortDirection(column === 'name' ? 'asc' : 'desc')
    }
  }

  const sortedStudents = useMemo(() => {
    return [...students].sort((a, b) => {
      if (sortBy === 'name') {
        const aName = a.name.toLowerCase()
        const bName = b.name.toLowerCase()
        if (aName < bName) return sortDirection === 'asc' ? -1 : 1
        if (aName > bName) return sortDirection === 'asc' ? 1 : -1
        return 0
      }

      const aStats = a.stats ?? { total: 0, correct: 0, streak: 0, longestStreak: 0 }
      const bStats = b.stats ?? { total: 0, correct: 0, streak: 0, longestStreak: 0 }

      let aValue = 0
      let bValue = 0

      if (sortBy === 'total') {
        aValue = aStats.total
        bValue = bStats.total
      } else if (sortBy === 'correct') {
        aValue = aStats.correct
        bValue = bStats.correct
      } else if (sortBy === 'accuracy') {
        aValue = aStats.total > 0 ? aStats.correct / aStats.total : 0
        bValue = bStats.total > 0 ? bStats.correct / bStats.total : 0
      } else if (sortBy === 'streak') {
        aValue = aStats.longestStreak
        bValue = bStats.longestStreak
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
      return 0
    })
  }, [sortBy, sortDirection, students])

  const downloadCSV = (): void => {
    if (!sessionId) return
    const headers = ['Student Name', 'Total Attempts', 'Correct', 'Accuracy %', 'Longest Streak']
    const rows = sortedStudents.map((student) => {
      const total = student.stats?.total ?? 0
      const correct = student.stats?.correct ?? 0
      const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0
      return [student.name, total, correct, accuracy, student.stats?.longestStreak ?? 0]
    })

    const csvContent = arrayToCsv([headers, ...rows])
    const filename = `java-string-practice-${sessionId}-${new Date().toISOString().slice(0, 10)}`
    downloadCsv(csvContent, filename)
  }

  if (!sessionId) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-600 mb-4">No session ID provided</p>
        <Button onClick={() => navigate('/manage')}>Return to Dashboard</Button>
      </div>
    )
  }

  return (
    <div>
      <SessionHeader activityName="Java String Practice Session" sessionId={sessionId} />

      <div className="p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h3 className="text-xl font-semibold mb-4">Select Methods to Practice</h3>
            <div className="flex flex-wrap gap-2">
              {methodTypes.map((method) => (
                <button
                  key={method.id}
                  onClick={() => handleMethodToggle(method.id)}
                  className={`px-4 py-2 rounded transition-colors ${
                    selectedMethods.has(method.id)
                      ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                  }`}
                >
                  {method.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-xl font-semibold">Student Progress</h3>
                <p className="text-sm text-gray-600 mt-1">
                  {students.filter((student) => student.connected).length} connected / {students.length} total students
                </p>
              </div>
              <Button onClick={downloadCSV} variant="outline">
                📊 Download Report
              </Button>
            </div>

            <ActivityRoster<JavaStringStudentRecord>
              students={sortedStudents}
              accent="neutral"
              columns={[
                {
                  id: 'name',
                  label: 'Student',
                  render: (student) => (
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${student.connected ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <span className="font-medium">{student.name}</span>
                    </div>
                  ),
                },
                { id: 'total', label: 'Total Attempts', align: 'center', render: (student) => student.stats?.total || 0 },
                { id: 'correct', label: 'Correct', align: 'center', render: (student) => student.stats?.correct || 0 },
                {
                  id: 'accuracy',
                  label: 'Accuracy',
                  align: 'center',
                  render: (student) => {
                    const total = student.stats?.total || 0
                    const correct = student.stats?.correct || 0
                    return total > 0 ? `${Math.round((correct / total) * 100)}%` : '0%'
                  },
                },
                {
                  id: 'streak',
                  label: 'Longest Streak',
                  align: 'center',
                  render: (student) => student.stats?.longestStreak || 0,
                },
              ]}
              sortBy={sortBy}
              sortDirection={sortDirection}
              onSort={(column) => handleSort(column as SortColumn)}
              emptyMessage="No students have joined yet. Share the join code above."
            />
          </div>
        </div>
      </div>
    </div>
  )
}
