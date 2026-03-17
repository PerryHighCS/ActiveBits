import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

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

export default function EmbeddedTestManager() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const [participants, setParticipants] = useState<EmbeddedTestParticipant[]>([])
  const [messages, setMessages] = useState<EmbeddedTestMessage[]>([])
  const [draft, setDraft] = useState('')
  const socketReadyRef = useRef(false)

  const buildWsUrl = useCallback(() => {
    if (!sessionId || typeof window === 'undefined') {
      return null
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws/embedded-test?sessionId=${encodeURIComponent(sessionId)}&role=instructor`
  }, [sessionId])

  const { connect, disconnect, socketRef } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: true,
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
    if (!sessionId) {
      return undefined
    }
    connect()
    return () => disconnect()
  }, [sessionId, connect, disconnect])

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

  const handleEndSession = useCallback(async () => {
    if (!sessionId) {
      return
    }
    await fetch(`/api/session/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
    void navigate('/manage')
  }, [navigate, sessionId])

  if (!sessionId) {
    return <div style={{ padding: 24 }}>Missing session id.</div>
  }

  return (
    <div style={{ padding: 24, display: 'grid', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Embedded Test Manager</h1>
          <p style={{ margin: '6px 0 0', color: '#555' }}>
            Session {sessionId} • {connectedCount} student{connectedCount === 1 ? '' : 's'} connected
          </p>
        </div>
        <button type="button" onClick={handleEndSession}>End Session</button>
      </div>

      <section style={{ border: '1px solid #d7d7d7', borderRadius: 12, padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Students</h2>
        {participants.length === 0 ? (
          <p style={{ marginBottom: 0, color: '#666' }}>No students connected yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', paddingBottom: 8 }}>Name</th>
                <th style={{ textAlign: 'left', paddingBottom: 8 }}>Participant ID</th>
                <th style={{ textAlign: 'left', paddingBottom: 8 }}>Connected</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((participant) => (
                <tr key={participant.studentId}>
                  <td style={{ padding: '8px 0' }}>{participant.name}</td>
                  <td style={{ padding: '8px 0', fontFamily: 'monospace' }}>{participant.studentId}</td>
                  <td style={{ padding: '8px 0' }}>{participant.connected ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ border: '1px solid #d7d7d7', borderRadius: 12, padding: 16, display: 'grid', gap: 12 }}>
        <h2 style={{ marginTop: 0 }}>Manager Console</h2>
        <div style={{ display: 'grid', gap: 8, maxHeight: 260, overflow: 'auto', padding: 12, background: '#faf7ef', borderRadius: 10 }}>
          {messages.length === 0 ? (
            <p style={{ margin: 0, color: '#666' }}>No messages yet.</p>
          ) : (
            messages.map((message) => (
              <div key={message.id} style={{ padding: 10, borderRadius: 10, background: message.senderRole === 'manager' ? '#fff1cf' : '#ffffff' }}>
                <div style={{ fontSize: 12, color: '#6b5b00', marginBottom: 4 }}>
                  {message.senderName} ({message.senderRole})
                </div>
                <div>{message.text}</div>
              </div>
            ))
          )}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            aria-label="Manager message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                sendMessage()
              }
            }}
            placeholder={socketReadyRef.current ? 'Send a message to students' : 'Connecting...'}
            style={{ flex: 1, padding: '10px 12px' }}
          />
          <button type="button" onClick={sendMessage}>Send</button>
        </div>
      </section>
    </div>
  )
}