import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import SessionHeader from '@src/components/common/SessionHeader'
import Button from '@src/components/ui/Button'
import RosterPill from '@src/components/ui/RosterPill'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import type {
  HostedFragmentRecord,
  PassageDefinition,
  PresetPassage,
  StudentRecord,
  StudentTemplate,
  StudentTemplateMap,
} from '../../wwwSimTypes.js'
import StudentInfoPanel from '../components/StudentInfoPanel'

interface WwwSimSessionResponse {
  id: string
  students?: StudentRecord[]
  studentTemplates?: StudentTemplateMap
  hostingMap?: HostedFragmentRecord[]
  passage?: PassageDefinition
}

interface CreateSessionResponse {
  id: string
}

interface WwwSimMessageEnvelope {
  type?: string
  payload?: unknown
}

interface StudentJoinedPayload {
  hostname: string
  joined: number
}

interface StudentRemovedPayload {
  hostname: string
}

interface StudentUpdatedPayload {
  oldHostname: string
  newHostname: string
}

interface FragmentsAssignedPayload {
  studentTemplates?: StudentTemplateMap
  hostingMap?: HostedFragmentRecord[]
}

interface TemplateAssignedPayload {
  hostname?: string
  template?: StudentTemplate
}

function parseMessage(event: MessageEvent): WwwSimMessageEnvelope | null {
  if (typeof event.data !== 'string' || event.data === 'pong' || event.data === 'ping') {
    return null
  }

  try {
    return JSON.parse(event.data) as WwwSimMessageEnvelope
  } catch {
    return null
  }
}

function asStudentJoinedPayload(payload: unknown): StudentJoinedPayload | null {
  if (!payload || typeof payload !== 'object') return null
  const value = payload as StudentJoinedPayload
  if (typeof value.hostname !== 'string' || typeof value.joined !== 'number') return null
  return value
}

function asStudentRemovedPayload(payload: unknown): StudentRemovedPayload | null {
  if (!payload || typeof payload !== 'object') return null
  const value = payload as StudentRemovedPayload
  if (typeof value.hostname !== 'string') return null
  return value
}

function asStudentUpdatedPayload(payload: unknown): StudentUpdatedPayload | null {
  if (!payload || typeof payload !== 'object') return null
  const value = payload as StudentUpdatedPayload
  if (typeof value.oldHostname !== 'string' || typeof value.newHostname !== 'string') return null
  return value
}

function asFragmentsAssignedPayload(payload: unknown): FragmentsAssignedPayload {
  if (!payload || typeof payload !== 'object') return {}
  return payload as FragmentsAssignedPayload
}

function asTemplateAssignedPayload(payload: unknown): TemplateAssignedPayload {
  if (!payload || typeof payload !== 'object') return {}
  return payload as TemplateAssignedPayload
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return (await response.json()) as T
}

/**
 * Standard flow: instructor opens page, session is loaded or created, then students join via code.
 */
export default function WwwSimManager() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const httpKeepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [displayCode, setDisplayCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [students, setStudents] = useState<StudentRecord[]>([])
  const [presetPassages, setPresetPassages] = useState<PresetPassage[]>([])
  const [passage, setPassage] = useState<PassageDefinition | null>(null)
  const [passageEdit, setPassageEdit] = useState(false)
  const [showFragments, setShowFragments] = useState(false)
  const [selectedStudent, setSelectedStudent] = useState<StudentRecord | null>(null)
  const [assignmentLocked, setAssignmentLocked] = useState(false)
  const [fragments, setFragments] = useState<HostedFragmentRecord[]>([])
  const [hostingMap, setHostingMap] = useState<HostedFragmentRecord[]>([])
  const [studentTemplates, setStudentTemplates] = useState<StudentTemplateMap>({})

  const hostingMapRef = useRef(hostingMap)
  const studentTemplatesRef = useRef(studentTemplates)
  const studentsRef = useRef(students)
  const selectedStudentRef = useRef(selectedStudent)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await api<PresetPassage[]>('/api/www-sim/passages')
        if (cancelled) return
        setPresetPassages(data)
        setPassage((current) => current || data[0] || null)
      } catch (fetchError) {
        console.error(fetchError)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    hostingMapRef.current = hostingMap
  }, [hostingMap])

  useEffect(() => {
    studentTemplatesRef.current = studentTemplates
  }, [studentTemplates])

  useEffect(() => {
    studentsRef.current = students
  }, [students])

  useEffect(() => {
    selectedStudentRef.current = selectedStudent
  }, [selectedStudent])

  useEffect(() => {
    let cancelled = false

    async function run(): Promise<void> {
      setBusy(true)
      setError(null)
      try {
        if (sessionId) {
          const session = await api<WwwSimSessionResponse>(`/api/www-sim/${sessionId}`)
          if (cancelled) return

          setStudents(session.students || [])
          if (session.passage) {
            setPassage(session.passage)
          }

          if (session.hostingMap?.length && session.studentTemplates && Object.keys(session.studentTemplates).length) {
            setHostingMap(session.hostingMap)
            setStudentTemplates(session.studentTemplates)
            setFragments(session.hostingMap)
            setAssignmentLocked(true)
          }

          hostingMapRef.current = session.hostingMap || []
          studentTemplatesRef.current = session.studentTemplates || {}
          studentsRef.current = session.students || []

          setDisplayCode(sessionId)
        } else {
          const created = await api<CreateSessionResponse>('/api/www-sim/create', {
            method: 'POST',
            body: JSON.stringify({ type: 'www-sim' }),
          })
          if (cancelled) return
          setDisplayCode(created.id)
          navigate(`/manage/www-sim/${created.id}`, { replace: true })
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError))
        }
      } finally {
        if (!cancelled) {
          setBusy(false)
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [navigate, sessionId])

  useEffect(() => {
    if (!displayCode) return undefined
    let cancelled = false

    ;(async () => {
      try {
        const data = await api<WwwSimSessionResponse>(`/api/www-sim/${displayCode}`)
        if (!cancelled) {
          setStudents(data.students || [])
        }
      } catch (fetchError) {
        console.error(fetchError)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [displayCode])

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

  const handleWsMessage = useCallback((event: MessageEvent) => {
    const message = parseMessage(event)
    if (!message || message.type === 'ping' || message.type === 'pong') return

    if (message.type === 'student-joined') {
      const payload = asStudentJoinedPayload(message.payload)
      if (!payload) return

      setStudents((previous) => {
        const index = previous.findIndex((student) => student.hostname === payload.hostname)
        if (index === -1) {
          return [...previous, payload]
        }

        return previous.map((student) =>
          student.hostname === payload.hostname ? { ...student, joined: payload.joined } : student,
        )
      })
      return
    }

    if (message.type === 'student-removed') {
      const payload = asStudentRemovedPayload(message.payload)
      if (!payload) return

      setStudents((previous) => previous.filter((student) => student.hostname !== payload.hostname))
      if (payload.hostname === selectedStudentRef.current?.hostname) {
        setSelectedStudent(null)
      }
      return
    }

    if (message.type === 'student-updated') {
      const payload = asStudentUpdatedPayload(message.payload)
      if (!payload) return

      const { oldHostname: oldName, newHostname: newName } = payload

      const nextHostingMap = hostingMapRef.current.map((fragment) => ({
        ...fragment,
        assignedTo: fragment.assignedTo.map((assignment) => ({
          ...assignment,
          hostname: assignment.hostname === oldName ? newName : assignment.hostname,
        })),
      }))

      const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(`//${escaped}/`, 'g')

      const nextTemplates = Object.fromEntries(
        Object.entries(studentTemplatesRef.current).map(([hostname, template]) => [
          hostname === oldName ? newName : hostname,
          {
            ...template,
            fragments: template.fragments.map((fragment) => ({
              ...fragment,
              url: fragment.url.replace(regex, `//${newName}/`),
            })),
          } satisfies StudentTemplate,
        ]),
      ) as StudentTemplateMap

      const nextRoster = studentsRef.current.map((student) =>
        student.hostname === oldName ? { ...student, hostname: newName } : student,
      )

      setHostingMap(nextHostingMap)
      setStudentTemplates(nextTemplates)
      setStudents(nextRoster)
      hostingMapRef.current = nextHostingMap
      studentTemplatesRef.current = nextTemplates
      studentsRef.current = nextRoster

      if (selectedStudentRef.current?.hostname === oldName) {
        setSelectedStudent({ ...selectedStudentRef.current, hostname: newName })
      }
      return
    }

    if (message.type === 'fragments-assigned') {
      const payload = asFragmentsAssignedPayload(message.payload)
      const nextTemplates = payload.studentTemplates || {}
      const nextHostingMap = payload.hostingMap || []

      setStudentTemplates(nextTemplates)
      setHostingMap(nextHostingMap)
      setFragments(nextHostingMap)
      setAssignmentLocked(Boolean(payload.studentTemplates && payload.hostingMap))
      return
    }

    if (message.type === 'template-assigned') {
      const payload = asTemplateAssignedPayload(message.payload)
      if (!payload.hostname || !payload.template) return

      setStudentTemplates((previous) => ({
        ...previous,
        [payload.hostname as string]: payload.template as StudentTemplate,
      }))
    }
  }, [])

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

  const buildWsUrl = useCallback(() => {
    if (!displayCode || typeof window === 'undefined') return null
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${protocol}://${window.location.host}/ws/www-sim?sessionId=${encodeURIComponent(displayCode)}`
  }, [displayCode])

  const { connect: connectWs, disconnect: disconnectWs } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(displayCode),
    onOpen: handleWsOpen,
    onMessage: handleWsMessage,
    onError: (errorEvent) => console.warn('WS error', errorEvent),
    onClose: handleWsClose,
  })

  useEffect(() => {
    if (!displayCode) {
      disconnectWs()
      return undefined
    }
    connectWs()
    return () => {
      disconnectWs()
    }
  }, [connectWs, disconnectWs, displayCode])

  async function removeStudent(hostname: string): Promise<void> {
    if (!displayCode) return
    try {
      await fetch(`/api/www-sim/${displayCode}/students/${encodeURIComponent(hostname)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      setStudents((previous) => previous.filter((student) => student.hostname !== hostname))
    } catch (removeError) {
      console.error(removeError)
    }
  }

  async function renameStudent(oldHostname: string, nextHostname: string): Promise<void> {
    if (!displayCode) return
    const normalized = (nextHostname || '').trim().toLowerCase()
    if (!normalized || normalized === oldHostname) return

    try {
      await fetch(`/api/www-sim/${displayCode}/students/${encodeURIComponent(oldHostname)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ newHostname: normalized }),
      })
    } catch (renameError) {
      console.error(renameError)
    }
  }

  const assignFragments = useCallback(async () => {
    const activeSessionId = sessionId || displayCode
    if (!activeSessionId) return

    try {
      await fetch(`/api/www-sim/${activeSessionId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passage }),
      })
      setAssignmentLocked(true)
    } catch (assignError) {
      console.error('Failed to assign fragments', assignError)
    }
  }, [displayCode, passage, sessionId])

  return (
    <div className="p-6 space-y-4">
      <SessionHeader activityName="Web Simulation: HTTP & DNS Protocols" sessionId={sessionId || displayCode || undefined} />

      {busy && <p>Loading session…</p>}
      {error && <p className="text-red-600">Error: {error}</p>}

      {assignmentLocked && (
        <>
          <h2 className="font-bold" onClick={() => setShowFragments((previous) => !previous)}>
            {showFragments ? '❌' : '🔽'} Fragments
          </h2>
          <ul className="list-disc">
            {showFragments &&
              fragments.map((fragment) => (
                <li key={fragment.hash}>{fragment.fragment}</li>
              ))}
          </ul>
        </>
      )}

      <h2 className="text-md font-bold">
        {students.length} student{students.length !== 1 ? 's' : ''} connected
      </h2>

      {students.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {students
            .slice()
            .sort((a, b) => a.hostname.localeCompare(b.hostname))
            .map((student) => (
              <RosterPill
                key={student.hostname}
                hostname={student.hostname}
                onRemove={() => void removeStudent(student.hostname)}
                onRename={(newHostname) => void renameStudent(student.hostname, newHostname)}
                onClick={() => setSelectedStudent(student)}
              />
            ))}
        </div>
      )}

      {assignmentLocked ? (
        selectedStudent && (
          <StudentInfoPanel
            hostname={selectedStudent.hostname}
            template={studentTemplates[selectedStudent.hostname]}
            hostingMap={hostingMap}
          />
        )
      ) : (
        <div className="space-y-2 flex flex-col">
          <div>
            <label htmlFor="preset" className="font-semibold">
              Choose a passage:
            </label>
            <select
              id="preset"
              className="border border-gray-300 rounded px-2 py-2 w-full max-w-md ml-2"
              onChange={(event) => {
                const selected = presetPassages.find((preset) => preset.label === event.target.value)
                if (selected) {
                  setPassage(selected)
                }
              }}
              value={passage?.label || ''}
            >
              {presetPassages.map((preset) => (
                <option key={preset.label} value={preset.label}>
                  {`${preset.label} - ${preset.title}`}
                </option>
              ))}
            </select>
            <Button className="ml-2" onClick={() => setPassageEdit((value) => !value)}>
              {passageEdit ? 'Hide' : 'View/Edit'}
            </Button>
          </div>

          {passageEdit && (
            <div className="transition-all duration-200 ease-in-out">
              <textarea
                className="w-full h-32 border border-gray-300 rounded px-2 py-1 text-sm font-mono"
                placeholder="Enter your own passage here..."
                value={passage?.value || ''}
                onChange={(event) =>
                  setPassage((current) => ({
                    ...(current ?? { value: '' }),
                    value: event.target.value,
                  }))
                }
              />
            </div>
          )}

          <div className="pt-4">
            <Button onClick={() => void assignFragments()} disabled={students.length === 0 || !passage}>
              Assign Fragments
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
