import {
  persistSessionParticipantIdentity,
  resolveInitialEntryParticipantIdentity,
} from '@src/components/common/entryParticipantIdentityUtils'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface EmbeddedTestStudentProps {
  sessionData?: {
    sessionId?: string
  }
}

interface EmbeddedTestParticipant {
  studentId: string
  name: string
  connected: boolean
  joinedAt: number
  lastSeenAt: number
}

interface EmbeddedTestMessage {
  id: string
  senderRole: 'manager' | 'student'
  senderId: string
  senderName: string
  text: string
  sentAt: number
}

interface EmbeddedTestStatePayload {
  type?: string
  participants?: EmbeddedTestParticipant[]
  messages?: EmbeddedTestMessage[]
  connectedCount?: number
}

function parseStatePayload(raw: unknown): EmbeddedTestStatePayload | null {
  if (typeof raw !== 'string') {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as { payload?: EmbeddedTestStatePayload }
    return parsed?.payload?.type === 'embedded-test-state' ? parsed.payload : null
  } catch {
    return null
  }
}

function createFallbackStudentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `embedded-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function EmbeddedTestStudent({ sessionData }: EmbeddedTestStudentProps) {
  const sessionId = sessionData?.sessionId ?? null
  const attachSessionEndedHandler = useSessionEndedHandler()
  const [identityResolved, setIdentityResolved] = useState(false)
  const [studentName, setStudentName] = useState('')
  const [studentId, setStudentId] = useState<string | null>(null)
  const [participants, setParticipants] = useState<EmbeddedTestParticipant[]>([])
  const [messages, setMessages] = useState<EmbeddedTestMessage[]>([])
  const [draft, setDraft] = useState('')
  const studentIdRef = useRef<string | null>(null)
  const socketReadyRef = useRef(false)

  useEffect(() => {
    studentIdRef.current = studentId
  }, [studentId])

  useEffect(() => {
    if (typeof window === 'undefined' || !sessionId) {
      setIdentityResolved(true)
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const identity = await resolveInitialEntryParticipantIdentity({
          activityName: 'embedded-test',
          sessionId,
          isSoloSession: false,
          localStorage: window.localStorage,
          sessionStorage: window.sessionStorage,
        })
        if (cancelled) {
          return
        }

        const resolvedName = identity.studentName.trim() || 'Embedded Test Student'
        const resolvedId = identity.studentId?.trim() || createFallbackStudentId()
        persistSessionParticipantIdentity(window.localStorage, sessionId, resolvedName, resolvedId)
        setStudentName(resolvedName)
        setStudentId(resolvedId)
      } catch (error) {
        console.error('Failed to resolve embedded-test participant identity:', error)
      } finally {
        if (!cancelled) {
          setIdentityResolved(true)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [sessionId])

  const buildWsUrl = useCallback(() => {
    if (!sessionId || !identityResolved || !studentIdRef.current || typeof window === 'undefined') {
      return null
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const query = new URLSearchParams({
      sessionId,
      studentId: studentIdRef.current,
      studentName,
    })
    return `${protocol}//${window.location.host}/ws/embedded-test?${query.toString()}`
  }, [identityResolved, sessionId, studentName])

  const { connect, disconnect, socketRef } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(identityResolved && sessionId),
    attachSessionEndedHandler,
    onOpen: () => {
      socketReadyRef.current = true
    },
    onClose: () => {
      socketReadyRef.current = false
    },
    onMessage: (event) => {
      const payload = parseStatePayload(event.data)
      if (!payload) {
        return
      }
      setParticipants(Array.isArray(payload.participants) ? payload.participants : [])
      setMessages(Array.isArray(payload.messages) ? payload.messages : [])
    },
  })

  useEffect(() => {
    if (!identityResolved || !sessionId) {
      return undefined
    }
    connect()
    return () => disconnect()
  }, [identityResolved, sessionId, connect, disconnect])

  const connectedCount = useMemo(
    () => participants.filter((participant) => participant.connected).length,
    [participants],
  )

  const sendMessage = useCallback(() => {
    const text = draft.trim()
    if (!text || socketRef.current?.readyState !== WebSocket.OPEN) {
      return
    }
    socketRef.current.send(JSON.stringify({ type: 'chat-message', text }))
    setDraft('')
  }, [draft, socketRef])

  if (!sessionId) {
    return <div style={{ padding: 24 }}>Missing session id.</div>
  }

  return (
    <div style={{ padding: 24, display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ margin: 0 }}>Embedded Test Student</h1>
        <p style={{ margin: '6px 0 0', color: '#555' }}>
          Display name: {studentName || 'Resolving...'}
        </p>
        <p style={{ margin: '6px 0 0', color: '#555', fontFamily: 'monospace' }}>
          Participant ID: {studentId ?? 'Resolving...'}
        </p>
      </div>

      <section style={{ border: '1px solid #d7d7d7', borderRadius: 12, padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Session Snapshot</h2>
        <p style={{ margin: '0 0 8px' }}>Connected students: {connectedCount}</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {participants.map((participant) => (
            <li key={participant.studentId}>
              {participant.name} • {participant.studentId} • {participant.connected ? 'connected' : 'offline'}
            </li>
          ))}
        </ul>
      </section>

      <section style={{ border: '1px solid #d7d7d7', borderRadius: 12, padding: 16, display: 'grid', gap: 12 }}>
        <h2 style={{ marginTop: 0 }}>Student Console</h2>
        <div style={{ display: 'grid', gap: 8, maxHeight: 260, overflow: 'auto', padding: 12, background: '#eef6ff', borderRadius: 10 }}>
          {messages.length === 0 ? (
            <p style={{ margin: 0, color: '#666' }}>No messages yet.</p>
          ) : (
            messages.map((message) => (
              <div key={message.id} style={{ padding: 10, borderRadius: 10, background: message.senderRole === 'student' ? '#dfefff' : '#ffffff' }}>
                <div style={{ fontSize: 12, color: '#24527a', marginBottom: 4 }}>
                  {message.senderName} ({message.senderRole})
                </div>
                <div>{message.text}</div>
              </div>
            ))
          )}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            aria-label="Student message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                sendMessage()
              }
            }}
            placeholder={socketReadyRef.current ? 'Reply to manager' : 'Connecting...'}
            style={{ flex: 1, padding: '10px 12px' }}
          />
          <button type="button" onClick={sendMessage}>Send</button>
        </div>
      </section>
    </div>
  )
}