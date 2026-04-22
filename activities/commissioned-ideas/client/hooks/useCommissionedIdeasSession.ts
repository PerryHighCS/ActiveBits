import { useCallback, useRef, useState } from 'react'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import type { StudentSafeParticipant } from '../../shared/types.js'

// ── Client-side snapshot types ────────────────────────────────────────────────

export interface StudentSnapshot {
  phase: string
  studentGroupingLocked: boolean
  namingLocked: boolean
  maxTeamSize: number
  groupingMode: string
  participantRoster: Record<string, StudentSafeParticipant>
  teams: Record<string, unknown>
  ballotSubmitted: boolean
  myBallot: unknown | null
  ballotsReceived: number
  currentPresentationTeamId: string | null
  podiumRevealStep: string
}

export interface ManagerParticipant {
  id: string
  name: string
  teamId: string | null
  connected: boolean
  lastSeen: number
  rejectedByInstructor: boolean
}

export interface ManagerSnapshot {
  phase: string
  studentGroupingLocked: boolean
  namingLocked: boolean
  maxTeamSize: number
  groupingMode: string
  participantRoster: Record<string, ManagerParticipant>
  teams: Record<string, unknown>
  ballotsReceived: number
  currentPresentationTeamId: string | null
  podiumRevealStep: string
}

interface WsMessage {
  type: string
  sessionId?: string
  data?: unknown
  error?: string
}

// ── Student hook ──────────────────────────────────────────────────────────────

interface UseStudentSessionOptions {
  sessionId: string | null | undefined
  participantId: string | null
  attachSessionEndedHandler?: (ws: WebSocket) => void
}

interface UseStudentSessionResult {
  snapshot: StudentSnapshot | null
  connect: () => WebSocket | null
  disconnect: () => void
}

export function useStudentSession({
  sessionId,
  participantId,
  attachSessionEndedHandler,
}: UseStudentSessionOptions): UseStudentSessionResult {
  const [snapshot, setSnapshot] = useState<StudentSnapshot | null>(null)

  const buildWsUrl = useCallback(() => {
    if (!sessionId) return null
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const params = new URLSearchParams({ sessionId })
    if (participantId) params.set('participantId', participantId)
    return `${proto}//${window.location.host}/ws/commissioned-ideas?${params.toString()}`
  }, [sessionId, participantId])

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string) as WsMessage
      if (
        msg.type === 'commissioned-ideas:session-state' ||
        msg.type === 'commissioned-ideas:registration-updated' ||
        msg.type === 'commissioned-ideas:phase-changed'
      ) {
        setSnapshot(msg.data as StudentSnapshot)
      }
    } catch {
      // malformed WS frame — ignored
    }
  }, [])

  const { connect, disconnect } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(sessionId),
    onMessage: handleMessage,
    attachSessionEndedHandler,
  })

  return { snapshot, connect, disconnect }
}

// ── Manager hook ──────────────────────────────────────────────────────────────

interface UseManagerSessionOptions {
  sessionId: string | null | undefined
  instructorPasscode: string | null
  attachSessionEndedHandler?: (ws: WebSocket) => void
}

interface UseManagerSessionResult {
  snapshot: ManagerSnapshot | null
  connect: () => WebSocket | null
  disconnect: () => void
  socketRef: ReturnType<typeof useResilientWebSocket>['socketRef']
}

export function useManagerSession({
  sessionId,
  instructorPasscode,
  attachSessionEndedHandler,
}: UseManagerSessionOptions): UseManagerSessionResult {
  const [snapshot, setSnapshot] = useState<ManagerSnapshot | null>(null)
  const mountedRef = useRef(true)

  const buildWsUrl = useCallback(() => {
    if (!sessionId || !instructorPasscode) return null
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const params = new URLSearchParams({ sessionId, role: 'manager', instructorPasscode })
    return `${proto}//${window.location.host}/ws/commissioned-ideas?${params.toString()}`
  }, [sessionId, instructorPasscode])

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string) as WsMessage
      if (
        msg.type === 'commissioned-ideas:session-state' ||
        msg.type === 'commissioned-ideas:registration-updated' ||
        msg.type === 'commissioned-ideas:phase-changed'
      ) {
        if (mountedRef.current) {
          setSnapshot(msg.data as ManagerSnapshot)
        }
      }
    } catch {
      // malformed WS frame — ignored
    }
  }, [])

  const { connect, disconnect, socketRef } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(sessionId) && Boolean(instructorPasscode),
    onMessage: handleMessage,
    attachSessionEndedHandler,
  })

  return { snapshot, connect, disconnect, socketRef }
}
