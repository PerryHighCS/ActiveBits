import { useCallback, useRef, useState } from 'react'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import type {
  CommissionedIdeasBallot,
  CommissionedIdeasPhase,
  CommissionedIdeasTeam,
  PodiumRevealStep,
  PresentationHistoryEntry,
  StudentSafeParticipant,
  StudentSafeTeam,
  TeamScore,
} from '../../shared/types.js'
import type { PodiumEntry } from '../../shared/podium.js'

// ── Client-side snapshot types ────────────────────────────────────────────────

/** Fields every client view of a team has. */
export type ClientTeam = Pick<StudentSafeTeam, 'id' | 'groupName' | 'projectName' | 'registeredAt' | 'memberIds'>

/** Manager snapshots carry the full team record, including proposals and votes. */
export type ManagerTeam = CommissionedIdeasTeam

export interface StudentSnapshot {
  phase: CommissionedIdeasPhase
  presentationRound: number
  presentationHistory: PresentationHistoryEntry[]
  studentGroupingLocked: boolean
  namingLocked: boolean
  maxTeamSize: number
  groupingMode: string
  participantRoster: Record<string, StudentSafeParticipant>
  teams: Record<string, StudentSafeTeam>
  ballotSubmitted: boolean
  myBallot: CommissionedIdeasBallot | null
  ballotsReceived: number
  currentPresentationTeamId: string | null
  podiumRevealStep: PodiumRevealStep
  /** Revealed podium places only; empty outside results. */
  podium: PodiumEntry[]
  /** Number of podium steps (distinct funded totals, max 3); 0 outside results. */
  podiumPlaceCount: number
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
  phase: CommissionedIdeasPhase
  presentationRound: number
  presentationHistory: PresentationHistoryEntry[]
  studentGroupingLocked: boolean
  namingLocked: boolean
  maxTeamSize: number
  groupingMode: string
  participantRoster: Record<string, ManagerParticipant>
  teams: Record<string, ManagerTeam>
  ballotsReceived: number
  /** Who has voted — ids only, never ballot contents. */
  ballotSubmitterIds: string[]
  currentPresentationTeamId: string | null
  podiumRevealStep: PodiumRevealStep
  /** Full ranking, best first; present only in the results phase. */
  results: TeamScore[] | null
}

interface WsMessage {
  type: string
  sessionId?: string
  data?: unknown
  error?: string
}

/** Every server broadcast that carries a full snapshot in `data`. */
const SNAPSHOT_MESSAGE_TYPES = new Set([
  'commissioned-ideas:session-state',
  'commissioned-ideas:registration-updated',
  'commissioned-ideas:phase-changed',
  'commissioned-ideas:podium-step',
])

export function isSnapshotMessage(type: string): boolean {
  return SNAPSHOT_MESSAGE_TYPES.has(type)
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
      if (isSnapshotMessage(msg.type)) {
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
    const params = new URLSearchParams({ sessionId, role: 'manager' })
    return `${proto}//${window.location.host}/ws/commissioned-ideas?${params.toString()}`
  }, [sessionId, instructorPasscode])

  const handleOpen = useCallback((_event: Event, ws: WebSocket) => {
    ws.send(JSON.stringify({
      type: 'commissioned-ideas:manager-auth',
      instructorPasscode,
    }))
  }, [instructorPasscode])

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string) as WsMessage
      if (isSnapshotMessage(msg.type)) {
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
    onOpen: handleOpen,
    onMessage: handleMessage,
    attachSessionEndedHandler,
  })

  return { snapshot, connect, disconnect, socketRef }
}
