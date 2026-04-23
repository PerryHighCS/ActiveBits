import { timingSafeEqual } from 'crypto'
import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import { createBroadcastSubscriptionHelper } from 'activebits-server/core/broadcastUtils.js'
import type { ActiveBitsWebSocket, WsRouter } from '../../../types/websocket.js'
import type {
  CommissionedIdeasSessionData,
  CommissionedIdeasTeam,
  CommissionedIdeasParticipant,
  CommissionedIdeasBallot,
  CommissionedIdeasPhase,
  PodiumRevealStep,
  GroupingMode,
  PresentationHistoryEntry,
  NameProposal,
  StudentSafeParticipant,
} from '../shared/types.js'
import { sanitizeDisplayName } from '../shared/validation.js'
import { resolveLeadingProposal } from '../shared/scoring.js'
import { generateShortId } from '../shared/id.js'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CommissionedIdeasSession extends SessionRecord {
  type?: string
  data: CommissionedIdeasSessionData
}

/** Extended socket that carries per-connection identity. */
interface CommissionedIdeasSocket extends ActiveBitsWebSocket {
  participantId?: string | null
  isManager?: boolean
}

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): JsonResponse | void
}

interface RouteRequest {
  params: Record<string, string | undefined>
  query?: Record<string, string | undefined>
  body?: unknown
  headers?: Record<string, string | string[] | undefined>
}

interface CommissionedIdeasRouteApp {
  post(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
  get(path: string, handler: (req: RouteRequest, res: JsonResponse) => void | Promise<void>): void
}

// ── Normalization helpers ─────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function ensurePlainObject(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {}
}

function normalizePhase(value: unknown): CommissionedIdeasPhase {
  if (value === 'presentation' || value === 'voting' || value === 'results') {
    return value
  }
  return 'registration'
}

function normalizePodiumStep(value: unknown): PodiumRevealStep {
  if (value === 'third' || value === 'second' || value === 'winner' || value === 'complete') {
    return value
  }
  return 'hidden'
}

function normalizeGroupingMode(value: unknown): GroupingMode {
  return value === 'random' ? 'random' : 'manual'
}

function normalizeNameProposals(value: unknown): NameProposal[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isPlainObject)
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : '',
      value: sanitizeDisplayName(item.value, 100) ?? '',
      proposedByParticipantId: typeof item.proposedByParticipantId === 'string' ? item.proposedByParticipantId : '',
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : 0,
      rejectedByInstructor: Boolean(item.rejectedByInstructor),
    }))
    .filter((p) => Boolean(p.id && p.value))
}

function normalizeVotesRecord(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return {}
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') result[k] = v
  }
  return result
}

function normalizeTeam(raw: unknown, id: string): CommissionedIdeasTeam {
  const item = ensurePlainObject(raw)
  const proposedGroupNames = normalizeNameProposals(item.proposedGroupNames)
  const proposedProjectNames = normalizeNameProposals(item.proposedProjectNames)
  const groupNameVotes = normalizeVotesRecord(item.groupNameVotes)
  const projectNameVotes = normalizeVotesRecord(item.projectNameVotes)

  // Resolve name from proposals when they exist; otherwise preserve the
  // persisted value so records with names-but-no-proposals (e.g. instructor
  // overrides, manual seeds) survive normalization unchanged.
  const groupName =
    proposedGroupNames.length > 0
      ? resolveLeadingProposal(proposedGroupNames, groupNameVotes)
      : (sanitizeDisplayName(item.groupName) ?? null)
  const projectName =
    proposedProjectNames.length > 0
      ? resolveLeadingProposal(proposedProjectNames, projectNameVotes)
      : (sanitizeDisplayName(item.projectName) ?? null)

  return {
    id,
    groupName,
    projectName,
    registeredAt: typeof item.registeredAt === 'number' ? item.registeredAt : Date.now(),
    presenterOrder: typeof item.presenterOrder === 'number' ? item.presenterOrder : null,
    locked: Boolean(item.locked),
    memberIds: Array.isArray(item.memberIds)
      ? item.memberIds.filter((m): m is string => typeof m === 'string')
      : [],
    proposedGroupNames,
    proposedProjectNames,
    groupNameVotes,
    projectNameVotes,
  }
}

function normalizeTeams(value: unknown): Record<string, CommissionedIdeasTeam> {
  if (!isPlainObject(value)) return {}
  const result: Record<string, CommissionedIdeasTeam> = {}
  for (const [id, raw] of Object.entries(value)) {
    result[id] = normalizeTeam(raw, id)
  }
  return result
}

function normalizeParticipant(raw: unknown, id: string): CommissionedIdeasParticipant {
  const item = ensurePlainObject(raw)
  return {
    id,
    name: sanitizeDisplayName(item.name, 100) ?? '',
    teamId: typeof item.teamId === 'string' ? item.teamId : null,
    connected: Boolean(item.connected),
    lastSeen: typeof item.lastSeen === 'number' ? item.lastSeen : 0,
    rejectedByInstructor: Boolean(item.rejectedByInstructor),
  }
}

function normalizeParticipantRoster(value: unknown): Record<string, CommissionedIdeasParticipant> {
  if (!isPlainObject(value)) return {}
  const result: Record<string, CommissionedIdeasParticipant> = {}
  for (const [id, raw] of Object.entries(value)) {
    const p = normalizeParticipant(raw, id)
    if (p.id) result[id] = p
  }
  return result
}

function normalizeBallots(value: unknown): Record<string, CommissionedIdeasBallot> {
  if (!isPlainObject(value)) return {}
  const result: Record<string, CommissionedIdeasBallot> = {}
  for (const [id, raw] of Object.entries(value)) {
    if (!isPlainObject(raw)) continue
    if (!Array.isArray(raw.allocations)) continue
    result[id] = {
      voterId: typeof raw.voterId === 'string' ? raw.voterId : id,
      voterName: sanitizeDisplayName(raw.voterName, 100) ?? '',
      voterTeamId: typeof raw.voterTeamId === 'string' ? raw.voterTeamId : null,
      allocations: raw.allocations
        .filter(isPlainObject)
        .filter((a) => typeof a.teamId === 'string' && (a.amount === 100 || a.amount === 300 || a.amount === 500))
        .map((a) => ({ teamId: a.teamId as string, amount: a.amount as 100 | 300 | 500 })),
      submittedAt: typeof raw.submittedAt === 'number' ? raw.submittedAt : 0,
    }
  }
  return result
}

function normalizePresentationHistory(value: unknown): PresentationHistoryEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isPlainObject)
    .filter((e) => typeof e.teamId === 'string' && typeof e.round === 'number')
    .map((e) => ({
      round: e.round as number,
      teamId: e.teamId as string,
      presentedAt: typeof e.presentedAt === 'number' ? e.presentedAt : 0,
    }))
}

function normalizeSessionData(data: unknown): CommissionedIdeasSessionData {
  const source = ensurePlainObject(data)
  return {
    ...source,
    instructorPasscode: normalizeInstructorPasscode(source.instructorPasscode) ?? generatePasscode(),
    phase: normalizePhase(source.phase),
    studentGroupingLocked: Boolean(source.studentGroupingLocked),
    namingLocked: Boolean(source.namingLocked),
    maxTeamSize: typeof source.maxTeamSize === 'number' && source.maxTeamSize >= 1 ? source.maxTeamSize : 4,
    groupingMode: normalizeGroupingMode(source.groupingMode),
    presentationRound: typeof source.presentationRound === 'number' ? source.presentationRound : 1,
    allowLateRegistration: source.allowLateRegistration !== false,
    teams: normalizeTeams(source.teams),
    participantRoster: normalizeParticipantRoster(source.participantRoster),
    ballots: normalizeBallots(source.ballots),
    presentationHistory: normalizePresentationHistory(source.presentationHistory),
    currentPresentationTeamId:
      typeof source.currentPresentationTeamId === 'string' ? source.currentPresentationTeamId : null,
    podiumRevealStep: normalizePodiumStep(source.podiumRevealStep),
  }
}

// ── Instructor auth ───────────────────────────────────────────────────────────

function generatePasscode(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase()
}

function normalizeInstructorPasscode(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value.toUpperCase() : null
}

function verifyPasscode(expected: string, candidate: string): boolean {
  if (!expected || !candidate || expected.length !== candidate.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(candidate, 'utf8'))
  } catch {
    return false
  }
}

function checkInstructorAuth(req: RouteRequest, session: CommissionedIdeasSession): boolean {
  const raw = req.headers?.['x-commissioned-ideas-instructor-passcode']
  const header = Array.isArray(raw) ? raw[0] : raw
  return typeof header === 'string' && verifyPasscode(session.data.instructorPasscode, header.toUpperCase())
}

// ── Session normalizer ────────────────────────────────────────────────────────

registerSessionNormalizer('commissioned-ideas', (session) => {
  session.data = normalizeSessionData(session.data)
})

// ── Session helpers ───────────────────────────────────────────────────────────

async function getSession(
  sessions: SessionStore,
  sessionId: string,
): Promise<CommissionedIdeasSession | null> {
  const session = await sessions.get(sessionId)
  if (!session || session.type !== 'commissioned-ideas') return null
  session.data = normalizeSessionData(session.data)
  return session as CommissionedIdeasSession
}

function buildDefaultSessionData(): CommissionedIdeasSessionData {
  return {
    instructorPasscode: generatePasscode(),
    phase: 'registration',
    studentGroupingLocked: false,
    namingLocked: false,
    maxTeamSize: 4,
    groupingMode: 'manual',
    presentationRound: 1,
    allowLateRegistration: true,
    teams: {},
    participantRoster: {},
    ballots: {},
    presentationHistory: [],
    currentPresentationTeamId: null,
    podiumRevealStep: 'hidden',
  }
}

// ── Snapshot builders ─────────────────────────────────────────────────────────

/**
 * Student-safe snapshot. Strips:
 * - All ballot contents (replaced by submission count + own-ballot summary)
 * - Instructor-only participant fields: connected, lastSeen, rejectedByInstructor
 * - Rejected participants (hidden from peers until instructor approves/edits name)
 */
function buildStudentSnapshot(data: CommissionedIdeasSessionData, viewerParticipantId: string | null) {
  const { ballots: _ballots, participantRoster, instructorPasscode: _passcode, ...rest } = data

  const myBallot = viewerParticipantId ? (_ballots[viewerParticipantId] ?? null) : null

  const safeRoster: Record<string, StudentSafeParticipant> = {}
  for (const [id, p] of Object.entries(participantRoster)) {
    if (p.rejectedByInstructor) continue
    safeRoster[id] = { id: p.id, name: p.name, teamId: p.teamId }
  }

  return {
    ...rest,
    participantRoster: safeRoster,
    ballotSubmitted: Boolean(myBallot),
    myBallot,
    ballotsReceived: Object.keys(_ballots).length,
  }
}

/**
 * Manager snapshot. Keeps the full participant roster (including connection state
 * and moderation fields) but still omits raw ballot contents.
 */
function buildManagerSnapshot(data: CommissionedIdeasSessionData) {
  const { ballots: _ballots, ...rest } = data
  return {
    ...rest,
    ballotsReceived: Object.keys(_ballots).length,
  }
}

// ── Broadcast helpers ─────────────────────────────────────────────────────────

/**
 * Fan out a `commissioned-ideas:registration-updated` event to all sockets
 * attached to the session.  Manager sockets receive the full roster; student
 * sockets receive their ballot-aware student-safe snapshot.
 */
function broadcastRegistrationUpdate(
  ws: WsRouter,
  sessionId: string,
  data: CommissionedIdeasSessionData,
): void {
  const managerPayload = JSON.stringify({
    type: 'commissioned-ideas:registration-updated',
    sessionId,
    data: buildManagerSnapshot(data),
  })

  for (const client of ws.wss.clients as Set<CommissionedIdeasSocket>) {
    if (client.readyState !== 1 || client.sessionId !== sessionId) continue
    try {
      if (client.isManager) {
        client.send(managerPayload)
      } else {
        const snapshot = buildStudentSnapshot(data, client.participantId ?? null)
        client.send(JSON.stringify({
          type: 'commissioned-ideas:registration-updated',
          sessionId,
          data: snapshot,
        }))
      }
    } catch {
      // stale socket — ignored
    }
  }
}

/** Generic broadcast to all session sockets (student-safe). Used for phase changes etc. */
function broadcastToAll(
  ws: WsRouter,
  sessionId: string,
  type: string,
  data: CommissionedIdeasSessionData,
): void {
  const managerPayload = JSON.stringify({ type, sessionId, data: buildManagerSnapshot(data) })

  for (const client of ws.wss.clients as Set<CommissionedIdeasSocket>) {
    if (client.readyState !== 1 || client.sessionId !== sessionId) continue
    try {
      if (client.isManager) {
        client.send(managerPayload)
      } else {
        const snapshot = buildStudentSnapshot(data, client.participantId ?? null)
        client.send(JSON.stringify({ type, sessionId, data: snapshot }))
      }
    } catch {
      // stale socket
    }
  }
}

// ── Route export ──────────────────────────────────────────────────────────────

export default function setupCommissionedIdeasRoutes(
  app: CommissionedIdeasRouteApp,
  sessions: SessionStore,
  ws: WsRouter,
): void {
  const ensureBroadcastSubscription = createBroadcastSubscriptionHelper(sessions, ws)

  // ── Create session ──────────────────────────────────────────────────────────
  app.post('/api/commissioned-ideas/create', async (_req, res) => {
    const session = await createSession(sessions, { data: {} })
    session.type = 'commissioned-ideas'
    session.data = buildDefaultSessionData()
    await sessions.set(session.id, session)
    console.log(`[commissioned-ideas] Session created: ${session.id}`)
    res.json({ id: session.id, instructorPasscode: session.data.instructorPasscode })
  })

  // ── Student-safe state snapshot ─────────────────────────────────────────────
  // `participantId` query param gives the viewer their own ballot summary.
  app.get('/api/commissioned-ideas/:sessionId/state', async (req, res) => {
    const { sessionId } = req.params
    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId' })
      return
    }

    const session = await getSession(sessions, sessionId)
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    // Always pass null: ballot context belongs to the WS channel, where the
    // server binds participantId at socket-open time. Accepting an arbitrary
    // query param here would let any student read another participant's ballot.
    const snapshot = buildStudentSnapshot(session.data, null)
    res.json({ sessionId, data: snapshot })
  })

  // ── Register / reconnect participant ────────────────────────────────────────
  app.post('/api/commissioned-ideas/:sessionId/register-participant', async (req, res) => {
    const { sessionId } = req.params
    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId' })
      return
    }

    const session = await getSession(sessions, sessionId)
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    const body = ensurePlainObject(req.body)
    const name = sanitizeDisplayName(body.name, 100)
    if (!name) {
      res.status(400).json({ error: 'name is required' })
      return
    }

    // Accept a client-provided id for reconnect; generate one for new registrations.
    const requestedId =
      typeof body.participantId === 'string' && /^[A-Z0-9]{6,12}$/i.test(body.participantId)
        ? body.participantId
        : null
    const existing = requestedId ? session.data.participantRoster[requestedId] : null

    let participantId: string
    if (existing) {
      // Reconnect: mark connected only. The server-side name is authoritative —
      // overwriting it here would silently undo instructor moderation applied
      // between the student's last visit and this reconnect.
      participantId = existing.id
      existing.connected = true
      existing.lastSeen = Date.now()
    } else {
      // New registration
      participantId = requestedId ?? generateShortId()
      const participant: CommissionedIdeasParticipant = {
        id: participantId,
        name,
        teamId: null,
        connected: true,
        lastSeen: Date.now(),
        rejectedByInstructor: false,
      }
      session.data.participantRoster[participantId] = participant
    }

    await sessions.set(sessionId, session)
    console.info(`[commissioned-ideas] Participant registered`, { sessionId, participantId, name })

    broadcastRegistrationUpdate(ws, sessionId, session.data)
    res.json({ participantId, name })
  })

  // ── Instructor: edit or reject a participant name ───────────────────────────
  app.post('/api/commissioned-ideas/:sessionId/participant-name', async (req, res) => {
    const { sessionId } = req.params
    if (!sessionId) {
      res.status(400).json({ error: 'Missing sessionId' })
      return
    }

    const session = await getSession(sessions, sessionId)
    if (!session) {
      res.status(404).json({ error: 'Session not found' })
      return
    }

    if (!checkInstructorAuth(req, session)) {
      res.status(403).json({ error: 'Instructor authentication required' })
      return
    }

    const body = ensurePlainObject(req.body)
    const participantId = typeof body.participantId === 'string' ? body.participantId : null
    if (!participantId) {
      res.status(400).json({ error: 'participantId is required' })
      return
    }

    const participant = session.data.participantRoster[participantId]
    if (!participant) {
      res.status(404).json({ error: 'Participant not found' })
      return
    }

    if ('name' in body) {
      const newName = sanitizeDisplayName(body.name, 100)
      if (!newName) {
        res.status(400).json({ error: 'name must be a non-empty string' })
        return
      }
      participant.name = newName
      // Editing the name clears a prior rejection so the student is visible again.
      participant.rejectedByInstructor = false
    }

    if ('rejected' in body) {
      participant.rejectedByInstructor = Boolean(body.rejected)
    }

    await sessions.set(sessionId, session)
    console.info(`[commissioned-ideas] Participant name moderated`, { sessionId, participantId })

    broadcastRegistrationUpdate(ws, sessionId, session.data)
    res.json({ ok: true })
  })

  // ── WebSocket ───────────────────────────────────────────────────────────────
  ws.register('/ws/commissioned-ideas', (socket, query) => {
    const sessionId = query.get('sessionId')
    if (!sessionId) {
      socket.close(1008, 'Missing sessionId')
      return
    }

    const typedSocket = socket as CommissionedIdeasSocket
    typedSocket.sessionId = sessionId
    typedSocket.participantId = query.get('participantId') ?? null
    const wantsManager = query.get('role') === 'manager'

    ensureBroadcastSubscription(sessionId)

    ;(async () => {
      const session = await getSession(sessions, sessionId)
      if (!session) {
        socket.send(JSON.stringify({ type: 'commissioned-ideas:error', error: 'Session not found' }))
        socket.close(1008, 'Session not found')
        return
      }

      // Verify instructor passcode before granting manager role.
      if (wantsManager) {
        const candidatePasscode = normalizeInstructorPasscode(query.get('instructorPasscode'))
        if (!candidatePasscode || !verifyPasscode(session.data.instructorPasscode, candidatePasscode)) {
          socket.send(JSON.stringify({ type: 'commissioned-ideas:error', error: 'Invalid instructor passcode' }))
          socket.close(1008, 'Invalid instructor passcode')
          return
        }
        typedSocket.isManager = true
      }

      const participantId = typedSocket.participantId
      if (participantId && session.data.participantRoster[participantId]) {
        const p = session.data.participantRoster[participantId]
        p.connected = true
        p.lastSeen = Date.now()
        await sessions.set(sessionId, session)
        broadcastRegistrationUpdate(ws, sessionId, session.data)
      }

      const initData = typedSocket.isManager
        ? buildManagerSnapshot(session.data)
        : buildStudentSnapshot(session.data, participantId ?? null)

      socket.send(JSON.stringify({
        type: 'commissioned-ideas:session-state',
        sessionId,
        data: initData,
      }))
    })().catch((err: unknown) => {
      console.error('[commissioned-ideas] WS init error', err)
      socket.send(JSON.stringify({ type: 'commissioned-ideas:error', error: 'Failed to load session' }))
    })

    socket.on('close', () => {
      const participantId = typedSocket.participantId
      if (!participantId) return

      void (async () => {
        const session = await getSession(sessions, sessionId)
        if (!session) return
        const p = session.data.participantRoster[participantId]
        if (!p) return
        p.connected = false
        p.lastSeen = Date.now()
        await sessions.set(sessionId, session)
        broadcastRegistrationUpdate(ws, sessionId, session.data)
      })()
    })
  })
}

// Re-export helpers used by other modules (Phase 2+)
export {
  getSession,
  normalizeSessionData,
  normalizeTeam,
  buildStudentSnapshot,
  buildManagerSnapshot,
  broadcastRegistrationUpdate,
  broadcastToAll,
}
