import { useCallback, useState } from 'react'
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket'
import type {
  CommissionedIdeasBallot,
  CommissionedIdeasPhase,
  GroupingMode,
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
  groupingMode: GroupingMode
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
  groupingMode: GroupingMode
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
  code?: string
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

/** WebSocket URL for this activity. Identity is never put in the URL; sockets authenticate by message. */
export function buildCommissionedIdeasWsUrl(
  sessionId: string,
  role: 'student' | 'manager',
  location: Pick<Location, 'protocol' | 'host'> = window.location,
): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const params = new URLSearchParams({ sessionId })
  if (role === 'manager') params.set('role', 'manager')
  return `${proto}//${location.host}/ws/commissioned-ideas?${params.toString()}`
}

/** Close code the server uses for auth failures; reconnecting cannot fix these. */
const POLICY_VIOLATION_CLOSE_CODE = 1008

// ── Student hook ──────────────────────────────────────────────────────────────

interface UseStudentSessionOptions {
  sessionId: string | null | undefined
  participantId: string | null
  participantToken: string | null
  attachSessionEndedHandler?: (ws: WebSocket) => void
}

/** Error code the server sends when a participant credential is refused (not a transient failure). */
export const PARTICIPANT_AUTH_REFUSED = 'participant-auth-refused'

/** True only for the server's explicit credential refusal, never for transport or load errors. */
export function isParticipantAuthRefusal(msg: { type?: unknown; code?: unknown }): boolean {
  return msg.type === 'commissioned-ideas:error' && msg.code === PARTICIPANT_AUTH_REFUSED
}

interface UseStudentSessionResult {
  snapshot: StudentSnapshot | null
  /** The server refused the stored participant credential; the student must register again. */
  authRefused: boolean
  connect: () => WebSocket | null
  disconnect: () => void
}

export function useStudentSession({
  sessionId,
  participantId,
  participantToken,
  attachSessionEndedHandler,
}: UseStudentSessionOptions): UseStudentSessionResult {
  const [snapshot, setSnapshot] = useState<StudentSnapshot | null>(null)
  // Tagged with the token that was refused, so registering again (a new token) clears it.
  const [refusedToken, setRefusedToken] = useState<string | null>(null)
  const authRefused = participantToken !== null && refusedToken === participantToken

  const buildWsUrl = useCallback(
    () => (sessionId ? buildCommissionedIdeasWsUrl(sessionId, 'student') : null),
    [sessionId],
  )

  // Bind identity after connect by proving the participant token (never via the URL).
  const handleOpen = useCallback((_event: Event, ws: WebSocket) => {
    if (!participantId || !participantToken) return
    ws.send(JSON.stringify({ type: 'commissioned-ideas:participant-auth', participantId, token: participantToken }))
  }, [participantId, participantToken])

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string) as WsMessage
      if (isParticipantAuthRefusal(msg)) {
        setRefusedToken(participantToken)
      } else if (isSnapshotMessage(msg.type)) {
        setSnapshot(msg.data as StudentSnapshot)
      }
    } catch {
      // malformed WS frame — ignored
    }
  }, [participantToken])

  const { connect, disconnect } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(sessionId),
    onOpen: handleOpen,
    onMessage: handleMessage,
    attachSessionEndedHandler,
  })

  return { snapshot, authRefused, connect, disconnect }
}

// ── Manager hook ──────────────────────────────────────────────────────────────

/** Identity a manager snapshot belongs to; a change means a different session or credential. */
export function managerSessionIdentity(sessionId: string | null | undefined, instructorPasscode: string | null): string {
  return JSON.stringify([sessionId ?? null, instructorPasscode ?? null])
}

interface ManagerViewState {
  identity: string
  snapshot: ManagerSnapshot | null
  authError: string | null
}

/**
 * Manager state tagged with the identity it was received under. State from any other
 * identity is never shown, so switching session URLs in place cannot render the previous
 * session's roster, even for the first render after the switch.
 */
export function managerViewForIdentity(
  state: ManagerViewState,
  identity: string,
): Pick<ManagerViewState, 'snapshot' | 'authError'> {
  return state.identity === identity
    ? { snapshot: state.snapshot, authError: state.authError }
    : { snapshot: null, authError: null }
}

interface UseManagerSessionOptions {
  sessionId: string | null | undefined
  instructorPasscode: string | null
  attachSessionEndedHandler?: (ws: WebSocket) => void
}

interface UseManagerSessionResult {
  snapshot: ManagerSnapshot | null
  /** Set when the server refuses manager auth; reconnecting stops. */
  authError: string | null
  connect: () => WebSocket | null
  disconnect: () => void
  socketRef: ReturnType<typeof useResilientWebSocket>['socketRef']
}

export function useManagerSession({
  sessionId,
  instructorPasscode,
  attachSessionEndedHandler,
}: UseManagerSessionOptions): UseManagerSessionResult {
  const identity = managerSessionIdentity(sessionId, instructorPasscode)
  const [viewState, setViewState] = useState<ManagerViewState>({ identity, snapshot: null, authError: null })
  const { snapshot, authError } = managerViewForIdentity(viewState, identity)

  const buildWsUrl = useCallback(
    () => (sessionId && instructorPasscode ? buildCommissionedIdeasWsUrl(sessionId, 'manager') : null),
    [sessionId, instructorPasscode],
  )

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
        setViewState({ identity, snapshot: msg.data as ManagerSnapshot, authError: null })
      } else if (msg.type === 'commissioned-ideas:error') {
        const error = typeof msg.error === 'string' ? msg.error : 'Connection refused'
        setViewState((prev) => ({
          identity,
          snapshot: prev.identity === identity ? prev.snapshot : null,
          authError: error,
        }))
      }
    } catch {
      // malformed WS frame — ignored
    }
  }, [identity])

  const { connect, disconnect, socketRef } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(sessionId) && Boolean(instructorPasscode),
    // An auth refusal (1008) will not succeed on retry; stop instead of looping.
    isTerminalClose: (event) => event.code === POLICY_VIOLATION_CLOSE_CODE,
    onOpen: handleOpen,
    onMessage: handleMessage,
    attachSessionEndedHandler,
  })

  return { snapshot, authError, connect, disconnect, socketRef }
}
