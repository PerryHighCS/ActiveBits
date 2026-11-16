import { randomInt, timingSafeEqual } from 'crypto'
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
  StudentSafeProposal,
  StudentSafeTeam,
} from '../shared/types.js'
import { coerceAllocations, sanitizeDisplayName, validateBallot } from '../shared/validation.js'
import {
  MAX_PROPOSAL_LENGTH,
  MAX_PROPOSALS_PER_KIND,
  countVotes,
  normalizeProposalKind,
  proposalMatchKey,
  proposalsForKind,
  resolveTeamNames,
  votesForKind,
} from '../shared/naming.js'
import {
  checkPhaseTransition,
  isTeamPermutation,
  normalizePhaseValue,
  normalizePresenterOrder,
  presentedTeamIds,
  unpresentedTeamIds,
} from '../shared/presentation.js'
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
  wantsManager?: boolean
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

  const memberIds = Array.isArray(item.memberIds)
    ? item.memberIds.filter((m): m is string => typeof m === 'string')
    : []

  // Resolve names from proposals when they exist; otherwise preserve the
  // persisted value so records with names-but-no-proposals (e.g. instructor
  // overrides, manual seeds) survive normalization unchanged.
  const resolved = resolveTeamNames({
    memberIds,
    proposedGroupNames,
    proposedProjectNames,
    groupNameVotes,
    projectNameVotes,
  })
  const groupName =
    proposedGroupNames.length > 0 ? resolved.groupName : (sanitizeDisplayName(item.groupName) ?? null)
  const projectName =
    proposedProjectNames.length > 0 ? resolved.projectName : (sanitizeDisplayName(item.projectName) ?? null)

  return {
    id,
    groupName,
    projectName,
    registeredAt: typeof item.registeredAt === 'number' ? item.registeredAt : Date.now(),
    presenterOrder: typeof item.presenterOrder === 'number' ? item.presenterOrder : null,
    locked: Boolean(item.locked),
    memberIds,
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
    token: typeof item.token === 'string' && item.token.length > 0 ? item.token : generatePasscode(),
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
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let passcode = ''
  for (let index = 0; index < 8; index += 1) {
    passcode += alphabet[randomInt(0, alphabet.length)]
  }
  return passcode
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

/**
 * Verifies that the caller owns the participantId they are acting on.
 * Reads the participantId from the request body and the token from the
 * `X-Commissioned-Ideas-Participant-Token` header, then does a constant-time
 * comparison against the stored token.  Returns the verified participant or
 * null on any failure (missing token, bad token, unknown id, rejected).
 */
function checkParticipantAuth(
  req: RouteRequest,
  session: CommissionedIdeasSession,
): CommissionedIdeasParticipant | null {
  const body = ensurePlainObject(req.body)
  const participantId = typeof body.participantId === 'string' ? body.participantId : null
  if (!participantId) return null

  const raw = req.headers?.['x-commissioned-ideas-participant-token']
  const tokenHeader = Array.isArray(raw) ? raw[0] : raw
  if (typeof tokenHeader !== 'string' || tokenHeader.length === 0) return null

  const participant = session.data.participantRoster[participantId]
  if (!participant || participant.rejectedByInstructor) return null

  return verifyPasscode(participant.token, tokenHeader.toUpperCase()) ? participant : null
}

function parseSocketMessage(raw: unknown): Record<string, unknown> | null {
  const text = typeof raw === 'string'
    ? raw
    : Buffer.isBuffer(raw)
      ? raw.toString('utf8')
      : null

  if (!text) {
    return null
  }

  try {
    return ensurePlainObject(JSON.parse(text))
  } catch {
    return null
  }
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

function toStudentProposals(
  team: CommissionedIdeasTeam,
  proposals: NameProposal[],
  votes: Record<string, string>,
  viewerParticipantId: string,
): StudentSafeProposal[] {
  const tally = countVotes(proposals, votes, new Set(team.memberIds))
  return proposals
    .filter((p) => !p.rejectedByInstructor)
    .map((p) => ({
      id: p.id,
      value: p.value,
      voteCount: tally.get(p.id) ?? 0,
      proposedByMe: p.proposedByParticipantId === viewerParticipantId,
    }))
}

function eligibleVote(proposals: NameProposal[], proposalId: string | undefined): string | null {
  if (!proposalId) return null
  return proposals.some((p) => p.id === proposalId && !p.rejectedByInstructor) ? proposalId : null
}

/**
 * Student-visible team. Raw vote maps and instructor-rejected proposals never
 * leave the server; naming details are attached only for the viewer's own team.
 */
function buildStudentTeam(team: CommissionedIdeasTeam, viewerParticipantId: string | null): StudentSafeTeam {
  const safe: StudentSafeTeam = {
    id: team.id,
    groupName: team.groupName,
    projectName: team.projectName,
    registeredAt: team.registeredAt,
    presenterOrder: team.presenterOrder,
    memberIds: [...team.memberIds],
  }
  if (viewerParticipantId && team.memberIds.includes(viewerParticipantId)) {
    safe.naming = {
      groupProposals: toStudentProposals(team, team.proposedGroupNames, team.groupNameVotes, viewerParticipantId),
      projectProposals: toStudentProposals(team, team.proposedProjectNames, team.projectNameVotes, viewerParticipantId),
      myGroupVote: eligibleVote(team.proposedGroupNames, team.groupNameVotes[viewerParticipantId]),
      myProjectVote: eligibleVote(team.proposedProjectNames, team.projectNameVotes[viewerParticipantId]),
    }
  }
  return safe
}

/**
 * Student-safe snapshot. Strips:
 * - All ballot contents (replaced by submission count + own-ballot summary)
 * - Instructor-only participant fields: connected, lastSeen, rejectedByInstructor
 * - Rejected participants (hidden from peers until instructor approves/edits name)
 * - Raw name votes and every team's proposals except the viewer's own (non-rejected only)
 */
function buildStudentSnapshot(data: CommissionedIdeasSessionData, viewerParticipantId: string | null) {
  const { ballots: _ballots, participantRoster, instructorPasscode: _passcode, teams, ...rest } = data

  const myBallot = viewerParticipantId ? (_ballots[viewerParticipantId] ?? null) : null

  const safeRoster: Record<string, StudentSafeParticipant> = {}
  for (const [id, p] of Object.entries(participantRoster)) {
    if (p.rejectedByInstructor) continue
    safeRoster[id] = { id: p.id, name: p.name, teamId: p.teamId }
  }

  const safeTeams: Record<string, StudentSafeTeam> = {}
  for (const [id, team] of Object.entries(teams)) {
    safeTeams[id] = buildStudentTeam(team, viewerParticipantId)
  }

  return {
    ...rest,
    teams: safeTeams,
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
    ballotSubmitterIds: Object.keys(_ballots),
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

// ── Team formation helpers ────────────────────────────────────────────────────
//
// Membership contract (see .agent/plans/commissioned-ideas-activity-plan.md):
// participant.teamId === team.id  ⇔  participant.id ∈ team.memberIds.
// Empty teams are deleted; leaving a team drops that member's name votes.

export type RandomAssignmentScope = 'ungrouped' | 'all'

function createTeamRecord(data: CommissionedIdeasSessionData): CommissionedIdeasTeam {
  const teamId = generateShortId()
  const team: CommissionedIdeasTeam = {
    id: teamId,
    groupName: null,
    projectName: null,
    registeredAt: Date.now(),
    presenterOrder: null,
    locked: false,
    memberIds: [],
    proposedGroupNames: [],
    proposedProjectNames: [],
    groupNameVotes: {},
    projectNameVotes: {},
  }
  data.teams[teamId] = team
  return team
}

/** Recomputes a team's displayed names from its proposals and current members' votes. */
function refreshTeamNames(team: CommissionedIdeasTeam): void {
  const resolved = resolveTeamNames(team)
  if (team.proposedGroupNames.length > 0) team.groupName = resolved.groupName
  if (team.proposedProjectNames.length > 0) team.projectName = resolved.projectName
}

/**
 * Removes `participant` from their current team's memberIds, drops their name
 * votes, and clears teamId. Deletes the team record if it becomes empty.
 */
function removeParticipantFromTeam(
  data: CommissionedIdeasSessionData,
  participant: CommissionedIdeasParticipant,
): void {
  const team = participant.teamId ? data.teams[participant.teamId] : null
  if (team) {
    team.memberIds = team.memberIds.filter((id) => id !== participant.id)
    delete team.groupNameVotes[participant.id]
    delete team.projectNameVotes[participant.id]
    if (team.memberIds.length === 0) {
      delete data.teams[team.id]
    } else {
      refreshTeamNames(team)
    }
  }
  participant.teamId = null
}

/** Moves `participant` into `team`, leaving any previous team first. Caller checks capacity. */
function addParticipantToTeam(
  data: CommissionedIdeasSessionData,
  participant: CommissionedIdeasParticipant,
  team: CommissionedIdeasTeam,
): void {
  if (participant.teamId === team.id) return
  if (participant.teamId) removeParticipantFromTeam(data, participant)
  team.memberIds.push(participant.id)
  participant.teamId = team.id
  refreshTeamNames(team)
}

function countActiveMembers(data: CommissionedIdeasSessionData, team: CommissionedIdeasTeam): number {
  return team.memberIds.filter((id) => {
    const p = data.participantRoster[id]
    return p !== undefined && !p.rejectedByInstructor
  }).length
}

function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1)
    const tmp = items[i]!
    items[i] = items[j]!
    items[j] = tmp
  }
}

/**
 * Randomly places non-rejected participants into teams, keeping team sizes
 * balanced and never exceeding `maxTeamSize`.
 *
 * - `ungrouped`: only participants without a team are placed. Each goes to the
 *   open team with the fewest members (earliest registered on ties); a new team
 *   is created only when every existing team is full.
 * - `all`: every team is dissolved and all non-rejected participants are
 *   redistributed across `ceil(n / maxTeamSize)` new teams.
 */
function assignRandom(data: CommissionedIdeasSessionData, scope: RandomAssignmentScope): void {
  if (scope === 'all') {
    for (const participant of Object.values(data.participantRoster)) {
      participant.teamId = null
    }
    data.teams = {}
  }

  const toPlace = Object.values(data.participantRoster).filter(
    (p) => !p.rejectedByInstructor && p.teamId === null,
  )
  if (toPlace.length === 0) return
  shuffleInPlace(toPlace)

  const maxSize = data.maxTeamSize
  if (scope === 'all') {
    const teamCount = Math.ceil(toPlace.length / maxSize)
    for (let i = 0; i < teamCount; i++) createTeamRecord(data)
  }

  for (const participant of toPlace) {
    const open = Object.values(data.teams)
      .filter((t) => countActiveMembers(data, t) < maxSize)
      .sort((a, b) => countActiveMembers(data, a) - countActiveMembers(data, b) || a.registeredAt - b.registeredAt)
    const target = open[0] ?? createTeamRecord(data)
    addParticipantToTeam(data, participant, target)
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
    let participantToken: string
    if (existing) {
      // Reconnect: mark connected only. The server-side name is authoritative —
      // overwriting it here would silently undo instructor moderation applied
      // between the student's last visit and this reconnect.
      participantId = existing.id
      participantToken = existing.token
      existing.connected = true
      existing.lastSeen = Date.now()
    } else {
      // New registration
      participantId = requestedId ?? generateShortId()
      participantToken = generatePasscode()
      const participant: CommissionedIdeasParticipant = {
        id: participantId,
        name,
        teamId: null,
        connected: true,
        lastSeen: Date.now(),
        rejectedByInstructor: false,
        token: participantToken,
      }
      session.data.participantRoster[participantId] = participant
    }

    await sessions.set(sessionId, session)
    console.info(`[commissioned-ideas] Participant registered`, { sessionId, participantId, name })

    broadcastRegistrationUpdate(ws, sessionId, session.data)
    res.json({ participantId, name, token: participantToken })
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

    // Membership contract: rejected participants are never team members.
    if (participant.rejectedByInstructor && participant.teamId) {
      removeParticipantFromTeam(session.data, participant)
    }
    // Ballot contract: a rejected participant's ballot does not count.
    if (participant.rejectedByInstructor) {
      delete session.data.ballots[participant.id]
    }

    await sessions.set(sessionId, session)
    console.info(`[commissioned-ideas] Participant name moderated`, { sessionId, participantId })

    broadcastRegistrationUpdate(ws, sessionId, session.data)
    res.json({ ok: true })
  })

  // ── Instructor: update session settings ────────────────────────────────────
  app.post('/api/commissioned-ideas/:sessionId/settings', async (req, res) => {
    const { sessionId } = req.params
    if (!sessionId) { res.status(400).json({ error: 'Missing sessionId' }); return }

    const session = await getSession(sessions, sessionId)
    if (!session) { res.status(404).json({ error: 'Session not found' }); return }

    if (!checkInstructorAuth(req, session)) {
      res.status(403).json({ error: 'Instructor authentication required' })
      return
    }

    const body = ensurePlainObject(req.body)
    if ('maxTeamSize' in body) {
      const v = body.maxTeamSize
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
        res.status(400).json({ error: 'maxTeamSize must be a positive integer' })
        return
      }
      session.data.maxTeamSize = v
    }
    if ('groupingMode' in body) {
      session.data.groupingMode = normalizeGroupingMode(body.groupingMode)
    }
    if ('studentGroupingLocked' in body) {
      session.data.studentGroupingLocked = Boolean(body.studentGroupingLocked)
    }
    if ('namingLocked' in body) {
      session.data.namingLocked = Boolean(body.namingLocked)
    }
    if ('allowLateRegistration' in body) {
      session.data.allowLateRegistration = Boolean(body.allowLateRegistration)
    }

    await sessions.set(sessionId, session)
    console.info('[commissioned-ideas] Settings updated', { sessionId })
    broadcastToAll(ws, sessionId, 'commissioned-ideas:registration-updated', session.data)
    res.json({ ok: true })
  })

  // ── Shared route guards ─────────────────────────────────────────────────────

  async function loadSession(req: RouteRequest, res: JsonResponse): Promise<CommissionedIdeasSession | null> {
    const { sessionId } = req.params
    if (!sessionId) { res.status(400).json({ error: 'Missing sessionId' }); return null }
    const session = await getSession(sessions, sessionId)
    if (!session) { res.status(404).json({ error: 'Session not found' }); return null }
    return session
  }

  async function loadInstructorSession(req: RouteRequest, res: JsonResponse): Promise<CommissionedIdeasSession | null> {
    const session = await loadSession(req, res)
    if (!session) return null
    if (!checkInstructorAuth(req, session)) {
      res.status(403).json({ error: 'Instructor authentication required' })
      return null
    }
    return session
  }

  async function loadParticipantSession(
    req: RouteRequest,
    res: JsonResponse,
  ): Promise<{ session: CommissionedIdeasSession; participant: CommissionedIdeasParticipant } | null> {
    const session = await loadSession(req, res)
    if (!session) return null
    const participant = checkParticipantAuth(req, session)
    if (!participant) {
      res.status(403).json({ error: 'Participant authentication required' })
      return null
    }
    return { session, participant }
  }

  function requireRegistrationPhase(session: CommissionedIdeasSession, res: JsonResponse): boolean {
    if (session.data.phase !== 'registration') {
      res.status(409).json({ error: 'Team changes are only allowed during registration' })
      return false
    }
    return true
  }

  /** Student self-grouping guard: registration phase, manual mode, grouping unlocked. */
  function requireStudentGrouping(session: CommissionedIdeasSession, res: JsonResponse): boolean {
    if (!requireRegistrationPhase(session, res)) return false
    if (session.data.studentGroupingLocked) {
      res.status(403).json({ error: 'Grouping is locked' })
      return false
    }
    if (session.data.groupingMode !== 'manual') {
      res.status(403).json({ error: 'Self-grouping is not allowed in random mode' })
      return false
    }
    return true
  }

  async function saveAndBroadcast(session: CommissionedIdeasSession): Promise<void> {
    await sessions.set(session.id, session)
    broadcastRegistrationUpdate(ws, session.id, session.data)
  }

  // ── Student: create a new team and join it ──────────────────────────────────
  app.post('/api/commissioned-ideas/:sessionId/create-team', async (req, res) => {
    const ctx = await loadParticipantSession(req, res)
    if (!ctx) return
    const { session, participant } = ctx
    if (!requireStudentGrouping(session, res)) return

    const team = createTeamRecord(session.data)
    addParticipantToTeam(session.data, participant, team)

    await saveAndBroadcast(session)
    console.info('[commissioned-ideas] Team created', { sessionId: session.id, teamId: team.id, participantId: participant.id })
    res.json({ teamId: team.id })
  })

  // ── Student: join (or switch to) an existing team ───────────────────────────
  app.post('/api/commissioned-ideas/:sessionId/join-team', async (req, res) => {
    const ctx = await loadParticipantSession(req, res)
    if (!ctx) return
    const { session, participant } = ctx

    const body = ensurePlainObject(req.body)
    const teamId = typeof body.teamId === 'string' ? body.teamId : null
    if (!teamId) { res.status(400).json({ error: 'teamId is required' }); return }

    if (!requireStudentGrouping(session, res)) return

    const team = session.data.teams[teamId]
    if (!team) { res.status(404).json({ error: 'Team not found' }); return }

    if (participant.teamId !== teamId && countActiveMembers(session.data, team) >= session.data.maxTeamSize) {
      res.status(409).json({ error: 'Team is full' })
      return
    }

    addParticipantToTeam(session.data, participant, team)

    await saveAndBroadcast(session)
    console.info('[commissioned-ideas] Participant joined team', { sessionId: session.id, teamId, participantId: participant.id })
    res.json({ ok: true })
  })

  // ── Student: leave current team ─────────────────────────────────────────────
  app.post('/api/commissioned-ideas/:sessionId/leave-team', async (req, res) => {
    const ctx = await loadParticipantSession(req, res)
    if (!ctx) return
    const { session, participant } = ctx
    if (!requireStudentGrouping(session, res)) return

    if (!participant.teamId) {
      res.status(409).json({ error: 'Participant is not in a team' })
      return
    }

    removeParticipantFromTeam(session.data, participant)

    await saveAndBroadcast(session)
    console.info('[commissioned-ideas] Participant left team', { sessionId: session.id, participantId: participant.id })
    res.json({ ok: true })
  })

  // ── Instructor: move a participant to a team, a new team, or ungrouped ─────
  // Body: { participantId, teamId: string | null } or { participantId, newTeam: true }
  app.post('/api/commissioned-ideas/:sessionId/assign-participant', async (req, res) => {
    const session = await loadInstructorSession(req, res)
    if (!session) return
    if (!requireRegistrationPhase(session, res)) return

    const body = ensurePlainObject(req.body)
    const participantId = typeof body.participantId === 'string' ? body.participantId : null
    if (!participantId) { res.status(400).json({ error: 'participantId is required' }); return }

    const participant = session.data.participantRoster[participantId]
    if (!participant) { res.status(404).json({ error: 'Participant not found' }); return }

    const newTeam = body.newTeam === true
    const targetTeamId = typeof body.teamId === 'string' ? body.teamId : null

    if ((newTeam || targetTeamId !== null) && participant.rejectedByInstructor) {
      res.status(409).json({ error: 'Rejected participants cannot be placed on a team' })
      return
    }

    let resultTeamId: string | null = null
    if (newTeam) {
      const team = createTeamRecord(session.data)
      addParticipantToTeam(session.data, participant, team)
      resultTeamId = team.id
    } else if (targetTeamId !== null) {
      const team = session.data.teams[targetTeamId]
      if (!team) { res.status(404).json({ error: 'Team not found' }); return }
      if (participant.teamId !== targetTeamId && countActiveMembers(session.data, team) >= session.data.maxTeamSize) {
        res.status(409).json({ error: 'Team is full' })
        return
      }
      addParticipantToTeam(session.data, participant, team)
      resultTeamId = team.id
    } else if (participant.teamId) {
      removeParticipantFromTeam(session.data, participant)
    }

    await saveAndBroadcast(session)
    console.info('[commissioned-ideas] Instructor assigned participant', {
      sessionId: session.id,
      participantId,
      teamId: resultTeamId,
      newTeam,
    })
    res.json({ ok: true, teamId: resultTeamId })
  })

  // ── Instructor: random assignment ───────────────────────────────────────────
  // scope 'ungrouped' (default) places only students without a team.
  // scope 'all' dissolves every team and redistributes; refused once grouping is locked.
  app.post('/api/commissioned-ideas/:sessionId/assign-random', async (req, res) => {
    const session = await loadInstructorSession(req, res)
    if (!session) return
    if (!requireRegistrationPhase(session, res)) return

    const body = ensurePlainObject(req.body)
    const scope: RandomAssignmentScope = body.scope === 'all' ? 'all' : 'ungrouped'

    if (scope === 'all' && session.data.studentGroupingLocked) {
      console.warn('[commissioned-ideas] Full reshuffle refused while grouping locked', { sessionId: session.id })
      res.status(409).json({ error: 'Unlock grouping before reshuffling every team' })
      return
    }

    assignRandom(session.data, scope)

    await saveAndBroadcast(session)
    console.info('[commissioned-ideas] Random assignment complete', { sessionId: session.id, scope })
    res.json({ ok: true })
  })

  // ── Student: propose a team or project name ─────────────────────────────────
  // Body: { participantId, kind: 'group' | 'project', value }
  app.post('/api/commissioned-ideas/:sessionId/team/proposal', async (req, res) => {
    const ctx = await loadParticipantSession(req, res)
    if (!ctx) return
    const { session, participant } = ctx

    const body = ensurePlainObject(req.body)
    const kind = normalizeProposalKind(body.kind)
    if (!kind) { res.status(400).json({ error: "kind must be 'group' or 'project'" }); return }
    const value = sanitizeDisplayName(body.value, MAX_PROPOSAL_LENGTH)
    if (!value) { res.status(400).json({ error: 'value is required' }); return }

    if (!requireRegistrationPhase(session, res)) return
    if (session.data.namingLocked) { res.status(403).json({ error: 'Naming is locked' }); return }

    const team = participant.teamId ? session.data.teams[participant.teamId] : null
    if (!team) { res.status(409).json({ error: 'Join a team before proposing names' }); return }

    const proposals = proposalsForKind(team, kind)
    const votes = votesForKind(team, kind)
    const key = proposalMatchKey(value)
    const duplicate = proposals.find((p) => proposalMatchKey(p.value) === key)

    let proposalId: string
    if (duplicate) {
      if (duplicate.rejectedByInstructor) {
        res.status(409).json({ error: 'That name is not available' })
        return
      }
      proposalId = duplicate.id
    } else {
      if (proposals.length >= MAX_PROPOSALS_PER_KIND) {
        res.status(409).json({ error: 'This team has reached the proposal limit' })
        return
      }
      proposalId = generateShortId()
      proposals.push({
        id: proposalId,
        value,
        proposedByParticipantId: participant.id,
        createdAt: Date.now(),
        rejectedByInstructor: false,
      })
    }
    votes[participant.id] = proposalId
    refreshTeamNames(team)

    await saveAndBroadcast(session)
    console.info('[commissioned-ideas] Name proposed', {
      sessionId: session.id,
      teamId: team.id,
      participantId: participant.id,
      kind,
      proposalId,
      duplicate: Boolean(duplicate),
    })
    res.json({ ok: true, proposalId })
  })

  // ── Student: vote for a proposal within their own team ──────────────────────
  // Body: { participantId, kind, proposalId }
  app.post('/api/commissioned-ideas/:sessionId/team/proposal-vote', async (req, res) => {
    const ctx = await loadParticipantSession(req, res)
    if (!ctx) return
    const { session, participant } = ctx

    const body = ensurePlainObject(req.body)
    const kind = normalizeProposalKind(body.kind)
    if (!kind) { res.status(400).json({ error: "kind must be 'group' or 'project'" }); return }
    const proposalId = typeof body.proposalId === 'string' ? body.proposalId : null
    if (!proposalId) { res.status(400).json({ error: 'proposalId is required' }); return }

    if (!requireRegistrationPhase(session, res)) return
    if (session.data.namingLocked) { res.status(403).json({ error: 'Naming is locked' }); return }

    const team = participant.teamId ? session.data.teams[participant.teamId] : null
    if (!team) { res.status(409).json({ error: 'Join a team before voting on names' }); return }

    const proposal = proposalsForKind(team, kind).find((p) => p.id === proposalId)
    if (!proposal) { res.status(404).json({ error: 'Proposal not found on your team' }); return }
    if (proposal.rejectedByInstructor) { res.status(409).json({ error: 'That proposal was removed' }); return }

    votesForKind(team, kind)[participant.id] = proposalId
    refreshTeamNames(team)

    await saveAndBroadcast(session)
    console.info('[commissioned-ideas] Name vote cast', {
      sessionId: session.id,
      teamId: team.id,
      participantId: participant.id,
      kind,
      proposalId,
    })
    res.json({ ok: true })
  })

  // ── Instructor: reject or restore a proposal ────────────────────────────────
  // Body: { teamId, kind, proposalId, rejected: boolean }
  app.post('/api/commissioned-ideas/:sessionId/team/proposal-moderation', async (req, res) => {
    const session = await loadInstructorSession(req, res)
    if (!session) return

    const body = ensurePlainObject(req.body)
    const kind = normalizeProposalKind(body.kind)
    if (!kind) { res.status(400).json({ error: "kind must be 'group' or 'project'" }); return }
    const teamId = typeof body.teamId === 'string' ? body.teamId : null
    const proposalId = typeof body.proposalId === 'string' ? body.proposalId : null
    if (!teamId || !proposalId) { res.status(400).json({ error: 'teamId and proposalId are required' }); return }
    if (typeof body.rejected !== 'boolean') { res.status(400).json({ error: 'rejected must be a boolean' }); return }

    const team = session.data.teams[teamId]
    if (!team) { res.status(404).json({ error: 'Team not found' }); return }
    const proposal = proposalsForKind(team, kind).find((p) => p.id === proposalId)
    if (!proposal) { res.status(404).json({ error: 'Proposal not found' }); return }

    proposal.rejectedByInstructor = body.rejected
    refreshTeamNames(team)

    await saveAndBroadcast(session)
    console.info('[commissioned-ideas] Proposal moderated', {
      sessionId: session.id,
      teamId,
      kind,
      proposalId,
      rejected: body.rejected,
    })
    res.json({ ok: true })
  })

  // ── Student: submit or replace a ballot ─────────────────────────────────────
  // Body: { participantId, allocations: [{ teamId, amount }] }
  // Ballot size and amounts follow shared/validation.ts (reduced for small classes).
  app.post('/api/commissioned-ideas/:sessionId/ballot', async (req, res) => {
    const ctx = await loadParticipantSession(req, res)
    if (!ctx) return
    const { session, participant } = ctx

    if (session.data.phase !== 'voting') {
      res.status(409).json({ error: 'Voting is not open' })
      return
    }

    const body = ensurePlainObject(req.body)
    const result = validateBallot(body.allocations, participant.id, session.data)
    const allocations = result.valid ? coerceAllocations(body.allocations) : null
    if (!result.valid || !allocations) {
      console.warn('[commissioned-ideas] Invalid ballot rejected', {
        sessionId: session.id,
        participantId: participant.id,
        error: result.error ?? 'Malformed allocations',
      })
      res.status(400).json({ error: result.error ?? 'Malformed allocations' })
      return
    }

    const replaced = participant.id in session.data.ballots
    session.data.ballots[participant.id] = {
      voterId: participant.id,
      voterName: participant.name,
      voterTeamId: participant.teamId,
      allocations,
      submittedAt: Date.now(),
    }

    await saveAndBroadcast(session)
    console.info('[commissioned-ideas] Ballot submitted', { sessionId: session.id, participantId: participant.id, replaced })
    res.json({ ok: true, replaced })
  })

  // ── Instructor: change phase ────────────────────────────────────────────────
  // Body: { phase }. Allowed transitions live in shared/presentation.ts.
  app.post('/api/commissioned-ideas/:sessionId/phase', async (req, res) => {
    const session = await loadInstructorSession(req, res)
    if (!session) return

    const body = ensurePlainObject(req.body)
    const to = normalizePhaseValue(body.phase)
    if (!to) { res.status(400).json({ error: 'phase must be registration, presentation, voting, or results' }); return }

    const from = session.data.phase
    const check = checkPhaseTransition(from, to, {
      teamCount: Object.keys(session.data.teams).length,
      ballotCount: Object.keys(session.data.ballots).length,
    })
    if (!check.ok) {
      console.warn('[commissioned-ideas] Phase transition refused', { sessionId: session.id, from, to, reason: check.reason })
      res.status(409).json({ error: check.reason })
      return
    }

    session.data.phase = to
    session.data.podiumRevealStep = 'hidden'
    if (to === 'presentation') {
      normalizePresenterOrder(session.data.teams)
      const current = session.data.currentPresentationTeamId
      if (current && !session.data.teams[current]) session.data.currentPresentationTeamId = null
    }

    await sessions.set(session.id, session)
    broadcastToAll(ws, session.id, 'commissioned-ideas:phase-changed', session.data)
    console.info('[commissioned-ideas] Phase changed', { sessionId: session.id, from, to })
    res.json({ ok: true, phase: to })
  })

  function requirePresentationPhase(session: CommissionedIdeasSession, res: JsonResponse): boolean {
    if (session.data.phase !== 'presentation') {
      res.status(409).json({ error: 'Only available during presentations' })
      return false
    }
    return true
  }

  /** Spotlights a team and records it as presented in the current round (once per round). */
  function spotlightTeam(data: CommissionedIdeasSessionData, teamId: string | null): void {
    data.currentPresentationTeamId = teamId
    if (teamId && !presentedTeamIds(data.presentationHistory, data.presentationRound).has(teamId)) {
      data.presentationHistory.push({ round: data.presentationRound, teamId, presentedAt: Date.now() })
    }
  }

  // ── Instructor: set presentation order ──────────────────────────────────────
  // Body: { teamIds: string[] } — the full permutation of current team ids.
  app.post('/api/commissioned-ideas/:sessionId/presentation-order', async (req, res) => {
    const session = await loadInstructorSession(req, res)
    if (!session) return
    if (session.data.phase !== 'registration' && session.data.phase !== 'presentation') {
      res.status(409).json({ error: 'Presentation order is locked after presentations end' })
      return
    }

    const body = ensurePlainObject(req.body)
    if (!isTeamPermutation(body.teamIds, session.data.teams)) {
      res.status(400).json({ error: 'teamIds must list every current team exactly once' })
      return
    }
    body.teamIds.forEach((teamId, index) => {
      session.data.teams[teamId]!.presenterOrder = index
    })

    await saveAndBroadcast(session)
    console.info('[commissioned-ideas] Presentation order updated', { sessionId: session.id })
    res.json({ ok: true })
  })

  // ── Instructor: spotlight a team (or clear with teamId: null) ───────────────
  app.post('/api/commissioned-ideas/:sessionId/presentation-active', async (req, res) => {
    const session = await loadInstructorSession(req, res)
    if (!session) return
    if (!requirePresentationPhase(session, res)) return

    const body = ensurePlainObject(req.body)
    if (!('teamId' in body)) { res.status(400).json({ error: 'teamId is required (string or null)' }); return }
    const teamId = typeof body.teamId === 'string' ? body.teamId : null
    if (body.teamId !== null && teamId === null) { res.status(400).json({ error: 'teamId must be a string or null' }); return }
    if (teamId && !session.data.teams[teamId]) { res.status(404).json({ error: 'Team not found' }); return }

    spotlightTeam(session.data, teamId)

    await saveAndBroadcast(session)
    console.info('[commissioned-ideas] Presenting team set', { sessionId: session.id, teamId, round: session.data.presentationRound })
    res.json({ ok: true })
  })

  // ── Instructor: spotlight a random team that has not presented this round ───
  app.post('/api/commissioned-ideas/:sessionId/presentation-randomize', async (req, res) => {
    const session = await loadInstructorSession(req, res)
    if (!session) return
    if (!requirePresentationPhase(session, res)) return

    const eligible = unpresentedTeamIds(session.data.teams, session.data.presentationHistory, session.data.presentationRound)
    if (eligible.length === 0) {
      res.status(409).json({ error: 'Every team has presented this round' })
      return
    }
    const teamId = eligible[randomInt(0, eligible.length)]!
    spotlightTeam(session.data, teamId)

    await saveAndBroadcast(session)
    console.info('[commissioned-ideas] Random presenting team', { sessionId: session.id, teamId, round: session.data.presentationRound })
    res.json({ ok: true, teamId })
  })

  // ── Instructor: next round or reset the current round ───────────────────────
  // Body: { action: 'next' | 'reset' }
  app.post('/api/commissioned-ideas/:sessionId/presentation-round', async (req, res) => {
    const session = await loadInstructorSession(req, res)
    if (!session) return
    if (!requirePresentationPhase(session, res)) return

    const body = ensurePlainObject(req.body)
    const action = body.action
    if (action !== 'next' && action !== 'reset') {
      res.status(400).json({ error: "action must be 'next' or 'reset'" })
      return
    }

    const round = session.data.presentationRound
    if (action === 'next') {
      session.data.presentationRound = round + 1
    } else {
      session.data.presentationHistory = session.data.presentationHistory.filter((entry) => entry.round !== round)
    }
    session.data.currentPresentationTeamId = null

    await saveAndBroadcast(session)
    console.info('[commissioned-ideas] Presentation round updated', { sessionId: session.id, action, round: session.data.presentationRound })
    res.json({ ok: true, round: session.data.presentationRound })
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
    typedSocket.wantsManager = query.get('role') === 'manager'

    ensureBroadcastSubscription(sessionId)

    ;(async () => {
      const session = await getSession(sessions, sessionId)
      if (!session) {
        socket.send(JSON.stringify({ type: 'commissioned-ideas:error', error: 'Session not found' }))
        socket.close(1008, 'Session not found')
        return
      }

      const participantId = typedSocket.participantId
      if (participantId && session.data.participantRoster[participantId]) {
        const p = session.data.participantRoster[participantId]
        p.connected = true
        p.lastSeen = Date.now()
        await sessions.set(sessionId, session)
        broadcastRegistrationUpdate(ws, sessionId, session.data)
      }

      if (!typedSocket.wantsManager) {
        socket.send(JSON.stringify({
          type: 'commissioned-ideas:session-state',
          sessionId,
          data: buildStudentSnapshot(session.data, participantId ?? null),
        }))
      }
    })().catch((err: unknown) => {
      console.error('[commissioned-ideas] WS init error', err)
      socket.send(JSON.stringify({ type: 'commissioned-ideas:error', error: 'Failed to load session' }))
    })

    socket.on('message', (raw: unknown) => {
      void (async () => {
        if (typedSocket.isManager || !typedSocket.wantsManager) {
          return
        }

        const message = parseSocketMessage(raw)
        if (message?.type !== 'commissioned-ideas:manager-auth') {
          return
        }

        const session = await getSession(sessions, sessionId)
        if (!session) {
          socket.send(JSON.stringify({ type: 'commissioned-ideas:error', error: 'Session not found' }))
          socket.close(1008, 'Session not found')
          return
        }

        const candidatePasscode = normalizeInstructorPasscode(message.instructorPasscode)
        if (!candidatePasscode || !verifyPasscode(session.data.instructorPasscode, candidatePasscode)) {
          socket.send(JSON.stringify({ type: 'commissioned-ideas:error', error: 'Invalid instructor passcode' }))
          socket.close(1008, 'Invalid instructor passcode')
          return
        }

        typedSocket.isManager = true
        socket.send(JSON.stringify({
          type: 'commissioned-ideas:session-state',
          sessionId,
          data: buildManagerSnapshot(session.data),
        }))
      })().catch((err: unknown) => {
        console.error('[commissioned-ideas] WS manager auth error', err)
        socket.send(JSON.stringify({ type: 'commissioned-ideas:error', error: 'Failed to authenticate manager' }))
      })
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
  removeParticipantFromTeam,
  addParticipantToTeam,
  assignRandom,
  buildStudentTeam,
}
