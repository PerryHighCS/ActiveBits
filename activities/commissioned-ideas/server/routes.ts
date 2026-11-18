import { randomInt, timingSafeEqual } from 'crypto'
import { createSession, type SessionRecord, type SessionStore } from 'activebits-server/core/sessions.js'
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js'
import { createBroadcastSubscriptionHelper } from 'activebits-server/core/broadcastUtils.js'
import {
  issueActivityCapability,
  resolveActivityPrincipalFromCookies,
  writeActivityCapabilityCookie,
} from 'activebits-server/core/activityCapabilities.js'
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
import {
  coerceAllocations,
  isValidBallotAmount,
  sanitizeDisplayName,
  validateBallot,
  voterBallotStatus,
  withdrawBallotsFundingMissingTeams,
} from '../shared/validation.js'
import { computeTeamScores } from '../shared/scoring.js'
import { nextPodiumStep, podiumPlaceCount, podiumRevealKey, reconcilePodiumReveal, revealedPodium } from '../shared/podium.js'
import { checkInstructorMove, parseAssignTarget } from '../shared/membership.js'
import { ownEntry } from '../shared/records.js'
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
  studentAuth?: StudentSocketAuth
}

/**
 * Student socket auth state machine (owner: the `/ws/commissioned-ideas` handler).
 *
 *   pending ──auth msg──▶ authenticating ──valid + presence saved──▶ authenticated (final)
 *      ▲                        │  └──refused──▶ anonymous ──auth msg──▶ authenticating …
 *      └──store failure─────────┘ (state restored, socket closed 1011 so the client reconnects)
 *
 * - Only one attempt runs per socket (`authenticating` ignores further auth messages),
 *   so a late refusal can never overwrite a successful binding.
 * - `pending`/`authenticating` sockets receive no snapshots, so a client never renders
 *   an anonymous view first and then its own. `anonymous` receives the anonymous view.
 * - `participantId` is set only in `authenticated`.
 */
export type StudentSocketAuth = 'pending' | 'authenticating' | 'authenticated' | 'anonymous'

/** Which snapshot (if any) a socket should receive for a broadcast. */
function snapshotAudience(client: CommissionedIdeasSocket): 'manager' | 'student' | null {
  if (client.isManager) return 'manager'
  if (client.wantsManager) return null // manager socket still authenticating
  return client.studentAuth === 'authenticated' || client.studentAuth === 'anonymous' ? 'student' : null
}

const WS_OPEN = 1

/**
 * Presence rule (single owner): a participant is online while at least one open,
 * authenticated socket on this server is bound to them. Derived from live sockets,
 * not toggled per connection, so a second tab or a reload that overlaps the old
 * socket's close keeps the student online. Scope: per server process; with several
 * instances, the instance that handled the last close decides.
 */
function hasLiveParticipantSocket(ws: WsRouter, sessionId: string, participantId: string): boolean {
  for (const client of ws.wss.clients as Set<CommissionedIdeasSocket>) {
    if (
      client.readyState === WS_OPEN &&
      client.sessionId === sessionId &&
      client.studentAuth === 'authenticated' &&
      client.participantId === participantId
    ) {
      return true
    }
  }
  return false
}

interface JsonResponse {
  status(code: number): JsonResponse
  json(payload: unknown): JsonResponse | void
  setHeader?(name: string, value: string): void
  cookie?(name: string, value: string, options: Record<string, unknown>): void
}

interface RouteRequest {
  params: Record<string, string | undefined>
  query?: Record<string, string | undefined>
  body?: unknown
  headers?: Record<string, string | string[] | undefined>
  cookies?: Record<string, unknown>
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
    // Fail closed: an empty token never verifies. Tokens are issued only at registration.
    token: typeof item.token === 'string' && item.token.length > 0 ? item.token : '',
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
        .flatMap((a) => (typeof a.teamId === 'string' && isValidBallotAmount(a.amount) ? [{ teamId: a.teamId, amount: a.amount }] : [])),
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

/**
 * True for a record core has just created (persistent-link start) that has none
 * of this activity's fields yet. Core normalizes on write, so a passcode
 * generated for such a record is persisted with it.
 */
function isUninitializedSessionData(source: Record<string, unknown>): boolean {
  return !('instructorPasscode' in source) && !('participantRoster' in source) && !('teams' in source)
}

function normalizeSessionData(data: unknown): CommissionedIdeasSessionData {
  const source = ensurePlainObject(data)
  return {
    ...source,
    // Generate only while initializing. An initialized record that has lost its
    // passcode normalizes to '' and fails closed instead of minting an unknown
    // secret on every read.
    instructorPasscode:
      normalizeInstructorPasscode(source.instructorPasscode)
      ?? (isUninitializedSessionData(source) ? generatePasscode() : ''),
    phase: normalizePhase(source.phase),
    studentGroupingLocked: Boolean(source.studentGroupingLocked),
    namingLocked: Boolean(source.namingLocked),
    maxTeamSize: typeof source.maxTeamSize === 'number' && source.maxTeamSize >= 1 ? source.maxTeamSize : 4,
    groupingMode: normalizeGroupingMode(source.groupingMode),
    presentationRound: typeof source.presentationRound === 'number' ? source.presentationRound : 1,
    teams: normalizeTeams(source.teams),
    participantRoster: normalizeParticipantRoster(source.participantRoster),
    ballots: normalizeBallots(source.ballots),
    presentationHistory: normalizePresentationHistory(source.presentationHistory),
    currentPresentationTeamId:
      typeof source.currentPresentationTeamId === 'string' ? source.currentPresentationTeamId : null,
    podiumRevealStep: normalizePodiumStep(source.podiumRevealStep),
    podiumRevealKey: typeof source.podiumRevealKey === 'string' ? source.podiumRevealKey : null,
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
function readParticipantToken(req: RouteRequest): string | null {
  const raw = req.headers?.['x-commissioned-ideas-participant-token']
  const header = Array.isArray(raw) ? raw[0] : raw
  return typeof header === 'string' && header.length > 0 ? header : null
}

/**
 * Single owner of participant credential checks (HTTP actions, reconnect, and
 * WebSocket binding). Constant-time token comparison; an empty stored token
 * never verifies. Rejected participants are refused unless `allowRejected`
 * (reconnect keeps a rejected student as themselves, still rejected).
 */
function verifyParticipantCredential(
  data: CommissionedIdeasSessionData,
  participantId: unknown,
  token: unknown,
  { allowRejected = false }: { allowRejected?: boolean } = {},
): CommissionedIdeasParticipant | null {
  if (typeof participantId !== 'string' || typeof token !== 'string' || token.length === 0) return null
  const participant = ownEntry(data.participantRoster, participantId)
  if (!participant) return null
  if (participant.rejectedByInstructor && !allowRejected) return null
  return verifyPasscode(participant.token, token.toUpperCase()) ? participant : null
}

/** Authenticates a participant action: `participantId` in the body plus the token header. */
function checkParticipantAuth(
  req: RouteRequest,
  session: CommissionedIdeasSession,
): CommissionedIdeasParticipant | null {
  const body = ensurePlainObject(req.body)
  return verifyParticipantCredential(session.data, body.participantId, readParticipantToken(req))
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

/**
 * A request refused by a check inside a session mutation. Throwing it aborts the
 * compare-and-set (nothing is written, no revision bump); the route sends `status`.
 */
class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    readonly log?: { message: string; fields: Record<string, unknown> },
  ) {
    super(error)
    this.name = 'Refusal'
  }
}

function refuse(status: number, error: string, log?: Refusal['log']): never {
  throw new Refusal(status, error, log)
}

/** Thrown inside a mutation when the stored record is not a Commissioned Ideas session. */
class NotCommissionedIdeasSession extends Error {}

/**
 * Atomic-write contract (see "Deferred follow-ups → A" in the activity plan): every
 * write to a Commissioned Ideas session goes through here, on top of the store's
 * `updateAtomic`. `mutate` receives a fresh normalized copy and may run more than once
 * on a revision conflict, so it must not have external side effects. Cross-field
 * invariants run here on every write:
 * - podium reveal: a revealed podium always matches the ranking it was revealed for
 *   (`reconcilePodiumReveal`); moderation that changes the podium resets the reveal.
 *
 * Returns the committed session, or null when there is no such session. A `Refusal`
 * (or any other error) thrown by `mutate` propagates without writing.
 */
async function atomicUpdate(
  sessions: SessionStore,
  sessionId: string,
  mutate: (session: CommissionedIdeasSession) => void,
): Promise<CommissionedIdeasSession | null> {
  let podiumReset = false
  const apply = (draft: SessionRecord): SessionRecord => {
    if (draft.type !== 'commissioned-ideas') throw new NotCommissionedIdeasSession()
    const session = draft as CommissionedIdeasSession
    session.data = normalizeSessionData(session.data)
    mutate(session)
    podiumReset = reconcilePodiumReveal(session.data, computeTeamScores(session.data.teams, session.data.ballots))
    return session
  }

  let committed: SessionRecord | null
  try {
    if (typeof sessions.updateAtomic === 'function') {
      committed = await sessions.updateAtomic(sessionId, apply)
    } else {
      // Only minimal test doubles lack updateAtomic; both production stores have it.
      const current = await sessions.get(sessionId)
      committed = current ? apply(current) : null
      if (committed) await sessions.set(sessionId, committed)
    }
  } catch (err) {
    if (err instanceof NotCommissionedIdeasSession) return null
    throw err
  }
  if (!committed || committed.type !== 'commissioned-ideas') return null
  if (podiumReset) console.info('[commissioned-ideas] Podium reveal reset after the ranking changed', { sessionId })
  committed.data = normalizeSessionData(committed.data)
  return committed as CommissionedIdeasSession
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
    teams: {},
    participantRoster: {},
    ballots: {},
    presentationHistory: [],
    currentPresentationTeamId: null,
    podiumRevealStep: 'hidden',
    podiumRevealKey: null,
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
/**
 * Session settings and progress that every client may see. Snapshots are built
 * from this explicit list — never by spreading session data — so server-only
 * fields (instructorPasscode, activityCapabilities, participant tokens, anything
 * core adds later) cannot leak to a browser.
 */
function sharedSessionFields(data: CommissionedIdeasSessionData) {
  return {
    phase: data.phase,
    studentGroupingLocked: data.studentGroupingLocked,
    namingLocked: data.namingLocked,
    maxTeamSize: data.maxTeamSize,
    groupingMode: data.groupingMode,
    presentationRound: data.presentationRound,
    presentationHistory: data.presentationHistory,
    currentPresentationTeamId: data.currentPresentationTeamId,
    podiumRevealStep: data.podiumRevealStep,
  }
}

function buildStudentSnapshot(data: CommissionedIdeasSessionData, viewerParticipantId: string | null) {
  const { ballots: _ballots, participantRoster, teams } = data

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
    ...sharedSessionFields(data),
    teams: safeTeams,
    participantRoster: safeRoster,
    ballotSubmitted: Boolean(myBallot),
    myBallot,
    ballotsReceived: Object.keys(_ballots).length,
    ...buildStudentPodium(data),
  }
}

/**
 * Results contract: students only ever see podium steps already revealed, plus
 * how many steps exist (so the stage can draw placeholders). Empty outside results.
 */
function buildStudentPodium(data: CommissionedIdeasSessionData) {
  if (data.phase !== 'results') return { podium: [], podiumPlaceCount: 0 }
  const ranking = computeTeamScores(data.teams, data.ballots)
  return {
    podium: revealedPodium(ranking, data.podiumRevealStep),
    podiumPlaceCount: podiumPlaceCount(ranking),
  }
}

/**
 * Manager snapshot. Includes moderation fields (connection state, rejection),
 * full team records, and ballot progress — but never participant tokens, the
 * instructor passcode, capability records, or raw ballot contents. The full
 * ranking is included only in the results phase.
 */
function buildManagerSnapshot(data: CommissionedIdeasSessionData) {
  const roster: Record<string, ManagerParticipantView> = {}
  for (const [id, p] of Object.entries(data.participantRoster)) {
    roster[id] = {
      id: p.id,
      name: p.name,
      teamId: p.teamId,
      connected: p.connected,
      lastSeen: p.lastSeen,
      rejectedByInstructor: p.rejectedByInstructor,
    }
  }
  return {
    ...sharedSessionFields(data),
    participantRoster: roster,
    teams: data.teams,
    ballotsReceived: Object.keys(data.ballots).length,
    ballotSubmitterIds: Object.keys(data.ballots),
    results: data.phase === 'results' ? computeTeamScores(data.teams, data.ballots) : null,
  }
}

type ManagerParticipantView = Omit<CommissionedIdeasParticipant, 'token'>

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
    const audience = snapshotAudience(client)
    if (audience === null) continue
    try {
      if (audience === 'manager') {
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
    const audience = snapshotAudience(client)
    if (audience === null) continue
    try {
      if (audience === 'manager') {
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
  const team = ownEntry(data.teams, participant.teamId)
  if (team) {
    team.memberIds = team.memberIds.filter((id) => id !== participant.id)
    delete team.groupNameVotes[participant.id]
    delete team.projectNameVotes[participant.id]
    if (team.memberIds.length === 0) {
      deleteTeam(data, team.id)
    } else {
      refreshTeamNames(team)
    }
  }
  participant.teamId = null
}

/**
 * Deletes an (empty) team and everything that pointed at it. Ballot contract: a ballot
 * that funded the team is withdrawn so its voter can vote again (see
 * `withdrawBallotsFundingMissingTeams`). Single owner of team deletion.
 */
function deleteTeam(data: CommissionedIdeasSessionData, teamId: string): void {
  delete data.teams[teamId]
  if (data.currentPresentationTeamId === teamId) data.currentPresentationTeamId = null
  const withdrawn = withdrawBallotsFundingMissingTeams(data)
  if (withdrawn.length > 0) {
    console.info('[commissioned-ideas] Ballots withdrawn after team removal', { teamId, voterCount: withdrawn.length })
  }
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
    const p = ownEntry(data.participantRoster, id)
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

  // ── Mutation plumbing (atomic-write contract) ──────────────────────────────

  /**
   * Runs `run` as one atomic session update for a route. All checks belong inside
   * `run` (they then see the state being committed) and refuse by throwing
   * `Refusal`. Responds with 400/404/refusal/500 itself and returns null; on
   * commit, returns the committed session and `run`'s value for the route to
   * broadcast, log, and respond with.
   */
  async function mutateSession<T>(
    req: RouteRequest,
    res: JsonResponse,
    run: (session: CommissionedIdeasSession) => T,
  ): Promise<{ session: CommissionedIdeasSession; value: T } | null> {
    const { sessionId } = req.params
    if (!sessionId) { res.status(400).json({ error: 'Missing sessionId' }); return null }
    try {
      let value: T | undefined
      const session = await atomicUpdate(sessions, sessionId, (draft) => { value = run(draft) })
      if (!session) { res.status(404).json({ error: 'Session not found' }); return null }
      return { session, value: value as T }
    } catch (err) {
      if (err instanceof Refusal) {
        if (err.log) console.warn(err.log.message, err.log.fields)
        res.status(err.status).json({ error: err.error })
        return null
      }
      console.error('[commissioned-ideas] Session update failed', { sessionId, err })
      res.status(500).json({ error: 'Could not save the change. Please try again.' })
      return null
    }
  }

  function requireInstructor(req: RouteRequest, session: CommissionedIdeasSession): void {
    if (!checkInstructorAuth(req, session)) refuse(403, 'Instructor authentication required')
  }

  function requireParticipant(req: RouteRequest, session: CommissionedIdeasSession): CommissionedIdeasParticipant {
    return checkParticipantAuth(req, session) ?? refuse(403, 'Participant authentication required')
  }

  function requireRegistrationPhase(session: CommissionedIdeasSession): void {
    if (session.data.phase !== 'registration') refuse(409, 'Team changes are only allowed during registration')
  }

  /** Student self-grouping guard: registration phase, manual mode, grouping unlocked. */
  function requireStudentGrouping(session: CommissionedIdeasSession): void {
    requireRegistrationPhase(session)
    if (session.data.studentGroupingLocked) refuse(403, 'Grouping is locked')
    if (session.data.groupingMode !== 'manual') refuse(403, 'Self-grouping is not allowed in random mode')
  }

  function requirePresentationPhase(session: CommissionedIdeasSession): void {
    if (session.data.phase !== 'presentation') refuse(409, 'Only available during presentations')
  }

  async function loadSession(req: RouteRequest, res: JsonResponse): Promise<CommissionedIdeasSession | null> {
    const { sessionId } = req.params
    if (!sessionId) { res.status(400).json({ error: 'Missing sessionId' }); return null }
    const session = await getSession(sessions, sessionId)
    if (!session) { res.status(404).json({ error: 'Session not found' }); return null }
    return session
  }

  // ── Create session ──────────────────────────────────────────────────────────
  app.post('/api/commissioned-ideas/create', async (_req, res) => {
    try {
      const created = await createSession(sessions, { data: {} })
      // Reload recovery: an httpOnly manager capability (only its digest is stored)
      // lets this browser exchange for the passcode later via /instructor-passcode.
      let managerToken = ''
      const update = (draft: SessionRecord): SessionRecord => {
        draft.type = 'commissioned-ideas'
        draft.data = buildDefaultSessionData()
        managerToken = issueActivityCapability(draft, 'manager').token
        return draft
      }
      const session = typeof sessions.updateAtomic === 'function'
        ? await sessions.updateAtomic(created.id, update)
        : await (async () => { const s = update(created); await sessions.set(created.id, s); return s })()
      if (!session) throw new Error('Created session disappeared before initialization')
      const data = normalizeSessionData(session.data)
      res.setHeader?.('Cache-Control', 'no-store')
      if (res.cookie) {
        writeActivityCapabilityCookie({ cookie: res.cookie.bind(res) }, session.id, 'manager', managerToken)
      }
      console.info('[commissioned-ideas] Session created', { sessionId: session.id })
      res.json({ id: session.id, instructorPasscode: data.instructorPasscode })
    } catch (err) {
      console.error('[commissioned-ideas] Session creation failed', { err })
      res.status(500).json({ error: 'Could not create the session. Please try again.' })
    }
  })

  // ── Instructor: recover the passcode after a reload ─────────────────────────
  // Requires the httpOnly manager capability cookie issued by /create or by core
  // persistent-link Teacher Join. Never accepts the passcode itself as proof.
  app.get('/api/commissioned-ideas/:sessionId/instructor-passcode', async (req, res) => {
    res.setHeader?.('Cache-Control', 'no-store')
    const session = await loadSession(req, res)
    if (!session) return

    const principal = resolveActivityPrincipalFromCookies(session, session.id, 'manager', req.cookies)
    if (!principal) {
      console.warn('[commissioned-ideas] Instructor passcode recovery refused', { sessionId: session.id })
      res.status(403).json({ error: 'Instructor authentication required' })
      return
    }

    if (!session.data.instructorPasscode) {
      console.error('[commissioned-ideas] Session has no instructor passcode', { sessionId: session.id })
      res.status(409).json({ error: 'This session can no longer be managed' })
      return
    }

    console.info('[commissioned-ideas] Instructor passcode recovered', {
      sessionId: session.id,
      capabilityId: principal.capabilityId,
    })
    res.json({ instructorPasscode: session.data.instructorPasscode })
  })

  // ── Student-safe state snapshot ─────────────────────────────────────────────
  app.get('/api/commissioned-ideas/:sessionId/state', async (req, res) => {
    const session = await loadSession(req, res)
    if (!session) return
    // Always pass null: ballot context belongs to the WS channel, where the
    // server binds the participant only after verified auth. Accepting an arbitrary
    // query param here would let any student read another participant's ballot.
    res.json({ sessionId: session.id, data: buildStudentSnapshot(session.data, null) })
  })

  // ── Register / reconnect participant ────────────────────────────────────────
  app.post('/api/commissioned-ideas/:sessionId/register-participant', async (req, res) => {
    const result = await mutateSession(req, res, (session) => {
      const body = ensurePlainObject(req.body)
      const name = sanitizeDisplayName(body.name, 100)
      if (!name) refuse(400, 'name is required')

      // Accept a client-provided id for reconnect; generate one for new registrations.
      const requestedId =
        typeof body.participantId === 'string' && /^[A-Z0-9]{6,12}$/i.test(body.participantId)
          ? body.participantId
          : null
      const requested = ownEntry(session.data.participantRoster, requestedId)
      // Reconnect only with proof of ownership: participant ids are visible to every
      // student, so an id alone must never return that participant's token.
      const existing = requested
        ? verifyParticipantCredential(session.data, requestedId, readParticipantToken(req), { allowRejected: true })
        : null

      if (existing) {
        // Reconnect: mark connected only. The server-side name is authoritative —
        // overwriting it here would silently undo instructor moderation applied
        // between the student's last visit and this reconnect.
        existing.connected = true
        existing.lastSeen = Date.now()
        return { participantId: existing.id, name: existing.name, token: existing.token, reconnected: true, refusedId: null }
      }

      // New registration. Never reuse a requested id that already belongs to someone.
      const participantId = requestedId && !requested ? requestedId : generateShortId()
      const token = generatePasscode()
      session.data.participantRoster[participantId] = {
        id: participantId,
        name,
        teamId: null,
        connected: true,
        lastSeen: Date.now(),
        rejectedByInstructor: false,
        token,
      }
      return { participantId, name, token, reconnected: false, refusedId: requested ? requestedId : null }
    })
    if (!result) return
    const { session, value } = result

    if (value.refusedId) {
      console.warn('[commissioned-ideas] Reconnect without a valid participant token; registered as new', {
        sessionId: session.id,
        requestedId: value.refusedId,
      })
    }
    console.info('[commissioned-ideas] Participant registered', {
      sessionId: session.id,
      participantId: value.participantId,
      reconnected: value.reconnected,
    })
    broadcastRegistrationUpdate(ws, session.id, session.data)
    res.json({ participantId: value.participantId, name: value.name, token: value.token })
  })

  // ── Instructor: edit or reject a participant name ───────────────────────────
  app.post('/api/commissioned-ideas/:sessionId/participant-name', async (req, res) => {
    const result = await mutateSession(req, res, (session) => {
      requireInstructor(req, session)
      const body = ensurePlainObject(req.body)
      const participantId = typeof body.participantId === 'string' ? body.participantId : null
      if (!participantId) refuse(400, 'participantId is required')

      const participant = ownEntry(session.data.participantRoster, participantId) ?? refuse(404, 'Participant not found')

      if ('name' in body) {
        const newName = sanitizeDisplayName(body.name, 100) ?? refuse(400, 'name must be a non-empty string')
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
      return participantId
    })
    if (!result) return

    console.info('[commissioned-ideas] Participant name moderated', { sessionId: result.session.id, participantId: result.value })
    broadcastRegistrationUpdate(ws, result.session.id, result.session.data)
    res.json({ ok: true })
  })

  // ── Instructor: update session settings ────────────────────────────────────
  app.post('/api/commissioned-ideas/:sessionId/settings', async (req, res) => {
    const result = await mutateSession(req, res, (session) => {
      requireInstructor(req, session)
      // Team-formation settings only mean something while teams are forming. After
      // registration the size limit is fixed (late placement may exceed it).
      if (session.data.phase !== 'registration') {
        refuse(409, 'Session settings can only be changed during registration', {
          message: '[commissioned-ideas] Settings change refused outside registration',
          fields: { sessionId: session.id, phase: session.data.phase },
        })
      }

      const body = ensurePlainObject(req.body)
      if ('maxTeamSize' in body) {
        const v = body.maxTeamSize
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) refuse(400, 'maxTeamSize must be a positive integer')
        session.data.maxTeamSize = v
      }
      if ('groupingMode' in body) session.data.groupingMode = normalizeGroupingMode(body.groupingMode)
      if ('studentGroupingLocked' in body) session.data.studentGroupingLocked = Boolean(body.studentGroupingLocked)
      if ('namingLocked' in body) session.data.namingLocked = Boolean(body.namingLocked)
    })
    if (!result) return

    console.info('[commissioned-ideas] Settings updated', { sessionId: result.session.id })
    broadcastToAll(ws, result.session.id, 'commissioned-ideas:registration-updated', result.session.data)
    res.json({ ok: true })
  })

  // ── Student: create a new team and join it ──────────────────────────────────
  app.post('/api/commissioned-ideas/:sessionId/create-team', async (req, res) => {
    const result = await mutateSession(req, res, (session) => {
      const participant = requireParticipant(req, session)
      requireStudentGrouping(session)
      const team = createTeamRecord(session.data)
      addParticipantToTeam(session.data, participant, team)
      return { teamId: team.id, participantId: participant.id }
    })
    if (!result) return

    broadcastRegistrationUpdate(ws, result.session.id, result.session.data)
    console.info('[commissioned-ideas] Team created', { sessionId: result.session.id, ...result.value })
    res.json({ teamId: result.value.teamId })
  })

  // ── Student: join (or switch to) an existing team ───────────────────────────
  app.post('/api/commissioned-ideas/:sessionId/join-team', async (req, res) => {
    const result = await mutateSession(req, res, (session) => {
      const participant = requireParticipant(req, session)
      const body = ensurePlainObject(req.body)
      const teamId = typeof body.teamId === 'string' ? body.teamId : null
      if (!teamId) refuse(400, 'teamId is required')
      requireStudentGrouping(session)

      const team = ownEntry(session.data.teams, teamId) ?? refuse(404, 'Team not found')
      // Checked against the state being committed, so two concurrent joins cannot both pass.
      if (participant.teamId !== teamId && countActiveMembers(session.data, team) >= session.data.maxTeamSize) {
        refuse(409, 'Team is full')
      }
      addParticipantToTeam(session.data, participant, team)
      return { teamId, participantId: participant.id }
    })
    if (!result) return

    broadcastRegistrationUpdate(ws, result.session.id, result.session.data)
    console.info('[commissioned-ideas] Participant joined team', { sessionId: result.session.id, ...result.value })
    res.json({ ok: true })
  })

  // ── Student: leave current team ─────────────────────────────────────────────
  app.post('/api/commissioned-ideas/:sessionId/leave-team', async (req, res) => {
    const result = await mutateSession(req, res, (session) => {
      const participant = requireParticipant(req, session)
      requireStudentGrouping(session)
      if (!participant.teamId) refuse(409, 'Participant is not in a team')
      removeParticipantFromTeam(session.data, participant)
      return participant.id
    })
    if (!result) return

    broadcastRegistrationUpdate(ws, result.session.id, result.session.data)
    console.info('[commissioned-ideas] Participant left team', { sessionId: result.session.id, participantId: result.value })
    res.json({ ok: true })
  })

  // ── Instructor: move a participant to a team, a new team, or ungrouped ─────
  // Body: { participantId, teamId: string | null } or { participantId, newTeam: true }
  app.post('/api/commissioned-ideas/:sessionId/assign-participant', async (req, res) => {
    const result = await mutateSession(req, res, (session) => {
      requireInstructor(req, session)
      const body = ensurePlainObject(req.body)
      const participantId = typeof body.participantId === 'string' ? body.participantId : null
      if (!participantId) refuse(400, 'participantId is required')
      const participant = ownEntry(session.data.participantRoster, participantId) ?? refuse(404, 'Participant not found')

      const parsed = parseAssignTarget(body)
      if (!parsed.ok) {
        refuse(400, parsed.error, {
          message: '[commissioned-ideas] Instructor move refused: invalid target',
          fields: { sessionId: session.id, participantId, error: parsed.error },
        })
      }
      const { target } = parsed

      // Membership contract: which moves are allowed in which phase lives in shared/membership.ts.
      const decision = checkInstructorMove({
        phase: session.data.phase,
        participantTeamId: participant.teamId,
        rejected: participant.rejectedByInstructor,
        target,
      })
      if (!decision.ok) {
        refuse(decision.status, decision.error, {
          message: '[commissioned-ideas] Instructor move refused',
          fields: { sessionId: session.id, participantId, phase: session.data.phase, error: decision.error },
        })
      }

      let teamId: string | null = null
      if (target.kind === 'new-team') {
        const team = createTeamRecord(session.data)
        addParticipantToTeam(session.data, participant, team)
        teamId = team.id
      } else if (target.kind === 'team') {
        const team = ownEntry(session.data.teams, target.teamId) ?? refuse(404, 'Team not found')
        if (
          decision.enforceCapacity &&
          participant.teamId !== target.teamId &&
          countActiveMembers(session.data, team) >= session.data.maxTeamSize
        ) {
          refuse(409, 'Team is full')
        }
        addParticipantToTeam(session.data, participant, team)
        teamId = team.id
      } else if (participant.teamId) {
        removeParticipantFromTeam(session.data, participant)
      }
      return { participantId, teamId, newTeam: target.kind === 'new-team', latePlacement: decision.latePlacement }
    })
    if (!result) return

    broadcastRegistrationUpdate(ws, result.session.id, result.session.data)
    console.info('[commissioned-ideas] Instructor assigned participant', { sessionId: result.session.id, ...result.value })
    res.json({ ok: true, teamId: result.value.teamId })
  })

  // ── Instructor: random assignment ───────────────────────────────────────────
  // scope 'ungrouped' (default) places only students without a team.
  // scope 'all' dissolves every team and redistributes; refused once grouping is locked.
  app.post('/api/commissioned-ideas/:sessionId/assign-random', async (req, res) => {
    const result = await mutateSession(req, res, (session) => {
      requireInstructor(req, session)
      requireRegistrationPhase(session)
      const body = ensurePlainObject(req.body)
      const scope: RandomAssignmentScope = body.scope === 'all' ? 'all' : 'ungrouped'
      if (scope === 'all' && session.data.studentGroupingLocked) {
        refuse(409, 'Unlock grouping before reshuffling every team', {
          message: '[commissioned-ideas] Full reshuffle refused while grouping locked',
          fields: { sessionId: session.id },
        })
      }
      assignRandom(session.data, scope)
      return scope
    })
    if (!result) return

    broadcastRegistrationUpdate(ws, result.session.id, result.session.data)
    console.info('[commissioned-ideas] Random assignment complete', { sessionId: result.session.id, scope: result.value })
    res.json({ ok: true })
  })

  // ── Student: propose a team or project name ─────────────────────────────────
  // Body: { participantId, kind: 'group' | 'project', value }
  app.post('/api/commissioned-ideas/:sessionId/team/proposal', async (req, res) => {
    const result = await mutateSession(req, res, (session) => {
      const participant = requireParticipant(req, session)
      const body = ensurePlainObject(req.body)
      const kind = normalizeProposalKind(body.kind) ?? refuse(400, "kind must be 'group' or 'project'")
      const value = sanitizeDisplayName(body.value, MAX_PROPOSAL_LENGTH) ?? refuse(400, 'value is required')

      requireRegistrationPhase(session)
      if (session.data.namingLocked) refuse(403, 'Naming is locked')
      const team = ownEntry(session.data.teams, participant.teamId) ?? refuse(409, 'Join a team before proposing names')

      const proposals = proposalsForKind(team, kind)
      const key = proposalMatchKey(value)
      const duplicate = proposals.find((p) => proposalMatchKey(p.value) === key)

      let proposalId: string
      if (duplicate) {
        if (duplicate.rejectedByInstructor) refuse(409, 'That name is not available')
        proposalId = duplicate.id
      } else {
        if (proposals.length >= MAX_PROPOSALS_PER_KIND) refuse(409, 'This team has reached the proposal limit')
        proposalId = generateShortId()
        proposals.push({
          id: proposalId,
          value,
          proposedByParticipantId: participant.id,
          createdAt: Date.now(),
          rejectedByInstructor: false,
        })
      }
      votesForKind(team, kind)[participant.id] = proposalId
      refreshTeamNames(team)
      return { teamId: team.id, participantId: participant.id, kind, proposalId, duplicate: Boolean(duplicate) }
    })
    if (!result) return

    broadcastRegistrationUpdate(ws, result.session.id, result.session.data)
    console.info('[commissioned-ideas] Name proposed', { sessionId: result.session.id, ...result.value })
    res.json({ ok: true, proposalId: result.value.proposalId })
  })

  // ── Student: vote for a proposal within their own team ──────────────────────
  // Body: { participantId, kind, proposalId }
  app.post('/api/commissioned-ideas/:sessionId/team/proposal-vote', async (req, res) => {
    const result = await mutateSession(req, res, (session) => {
      const participant = requireParticipant(req, session)
      const body = ensurePlainObject(req.body)
      const kind = normalizeProposalKind(body.kind) ?? refuse(400, "kind must be 'group' or 'project'")
      const proposalId = typeof body.proposalId === 'string' ? body.proposalId : null
      if (!proposalId) refuse(400, 'proposalId is required')

      requireRegistrationPhase(session)
      if (session.data.namingLocked) refuse(403, 'Naming is locked')
      const team = ownEntry(session.data.teams, participant.teamId) ?? refuse(409, 'Join a team before voting on names')

      const proposal = proposalsForKind(team, kind).find((p) => p.id === proposalId) ?? refuse(404, 'Proposal not found on your team')
      if (proposal.rejectedByInstructor) refuse(409, 'That proposal was removed')

      votesForKind(team, kind)[participant.id] = proposalId
      refreshTeamNames(team)
      return { teamId: team.id, participantId: participant.id, kind, proposalId }
    })
    if (!result) return

    broadcastRegistrationUpdate(ws, result.session.id, result.session.data)
    console.info('[commissioned-ideas] Name vote cast', { sessionId: result.session.id, ...result.value })
    res.json({ ok: true })
  })

  // ── Instructor: reject or restore a proposal ────────────────────────────────
  // Body: { teamId, kind, proposalId, rejected: boolean }
  app.post('/api/commissioned-ideas/:sessionId/team/proposal-moderation', async (req, res) => {
    const result = await mutateSession(req, res, (session) => {
      requireInstructor(req, session)
      const body = ensurePlainObject(req.body)
      const kind = normalizeProposalKind(body.kind) ?? refuse(400, "kind must be 'group' or 'project'")
      const teamId = typeof body.teamId === 'string' ? body.teamId : null
      const proposalId = typeof body.proposalId === 'string' ? body.proposalId : null
      if (!teamId || !proposalId) refuse(400, 'teamId and proposalId are required')
      const rejected = body.rejected
      if (typeof rejected !== 'boolean') refuse(400, 'rejected must be a boolean')

      const team = ownEntry(session.data.teams, teamId) ?? refuse(404, 'Team not found')
      const proposal = proposalsForKind(team, kind).find((p) => p.id === proposalId) ?? refuse(404, 'Proposal not found')
      proposal.rejectedByInstructor = rejected
      refreshTeamNames(team)
      return { teamId, kind, proposalId, rejected }
    })
    if (!result) return

    broadcastRegistrationUpdate(ws, result.session.id, result.session.data)
    console.info('[commissioned-ideas] Proposal moderated', { sessionId: result.session.id, ...result.value })
    res.json({ ok: true })
  })

  // ── Student: submit or replace a ballot ─────────────────────────────────────
  // Body: { participantId, allocations: [{ teamId, amount }] }
  // Ballot size and amounts follow shared/validation.ts (reduced for small classes).
  app.post('/api/commissioned-ideas/:sessionId/ballot', async (req, res) => {
    const result = await mutateSession(req, res, (session) => {
      const participant = requireParticipant(req, session)
      if (session.data.phase !== 'voting') refuse(409, 'Voting is not open')

      // Ballot contract: late arrivals and other ungrouped students wait for placement.
      const status = voterBallotStatus(participant.teamId, session.data.teams)
      if (!status.canVote) refuse(409, status.message)

      const body = ensurePlainObject(req.body)
      const validation = validateBallot(body.allocations, participant.id, session.data)
      const allocations = validation.valid ? coerceAllocations(body.allocations) : null
      if (!validation.valid || !allocations) {
        const error = validation.error ?? 'Malformed allocations'
        refuse(400, error, {
          message: '[commissioned-ideas] Invalid ballot rejected',
          fields: { sessionId: session.id, participantId: participant.id, error },
        })
      }

      const replaced = Object.hasOwn(session.data.ballots, participant.id)
      session.data.ballots[participant.id] = {
        voterId: participant.id,
        voterName: participant.name,
        voterTeamId: participant.teamId,
        allocations,
        submittedAt: Date.now(),
      }
      return { participantId: participant.id, replaced }
    })
    if (!result) return

    broadcastRegistrationUpdate(ws, result.session.id, result.session.data)
    console.info('[commissioned-ideas] Ballot submitted', { sessionId: result.session.id, ...result.value })
    res.json({ ok: true, replaced: result.value.replaced })
  })

  // ── Instructor: advance or reset the podium reveal ──────────────────────────
  // Body: { action: 'next' | 'reset' }. Sequence lives in shared/podium.ts.
  app.post('/api/commissioned-ideas/:sessionId/podium-step', async (req, res) => {
    const result = await mutateSession(req, res, (session) => {
      requireInstructor(req, session)
      if (session.data.phase !== 'results') refuse(409, 'The podium is only available in Results')
      const body = ensurePlainObject(req.body)
      if (body.action !== 'next' && body.action !== 'reset') refuse(400, "action must be 'next' or 'reset'")

      const from = session.data.podiumRevealStep
      if (body.action === 'reset') {
        session.data.podiumRevealStep = 'hidden'
        session.data.podiumRevealKey = null
      } else {
        const ranking = computeTeamScores(session.data.teams, session.data.ballots)
        const next = nextPodiumStep(from, podiumPlaceCount(ranking)) ?? refuse(409, 'The podium is already fully revealed')
        session.data.podiumRevealStep = next
        // The reveal is pinned to this podium; see reconcilePodiumReveal.
        if (from === 'hidden') session.data.podiumRevealKey = podiumRevealKey(ranking)
      }
      return { from, to: session.data.podiumRevealStep }
    })
    if (!result) return

    broadcastToAll(ws, result.session.id, 'commissioned-ideas:podium-step', result.session.data)
    console.info('[commissioned-ideas] Podium step', { sessionId: result.session.id, ...result.value })
    res.json({ ok: true, step: result.session.data.podiumRevealStep })
  })

  // ── Instructor: change phase ────────────────────────────────────────────────
  // Body: { phase }. Allowed transitions live in shared/presentation.ts.
  app.post('/api/commissioned-ideas/:sessionId/phase', async (req, res) => {
    const result = await mutateSession(req, res, (session) => {
      requireInstructor(req, session)
      const body = ensurePlainObject(req.body)
      const to = normalizePhaseValue(body.phase) ?? refuse(400, 'phase must be registration, presentation, voting, or results')

      const from = session.data.phase
      const check = checkPhaseTransition(from, to, {
        teamCount: Object.keys(session.data.teams).length,
        ballotCount: Object.keys(session.data.ballots).length,
      })
      if (!check.ok) {
        refuse(409, check.reason, {
          message: '[commissioned-ideas] Phase transition refused',
          fields: { sessionId: session.id, from, to, reason: check.reason },
        })
      }

      session.data.phase = to
      session.data.podiumRevealStep = 'hidden'
      session.data.podiumRevealKey = null
      if (to === 'presentation') {
        normalizePresenterOrder(session.data.teams)
        const current = session.data.currentPresentationTeamId
        if (current && !ownEntry(session.data.teams, current)) session.data.currentPresentationTeamId = null
      }
      return { from, to }
    })
    if (!result) return

    broadcastToAll(ws, result.session.id, 'commissioned-ideas:phase-changed', result.session.data)
    console.info('[commissioned-ideas] Phase changed', { sessionId: result.session.id, ...result.value })
    res.json({ ok: true, phase: result.value.to })
  })

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
    const result = await mutateSession(req, res, (session) => {
      requireInstructor(req, session)
      if (session.data.phase !== 'registration' && session.data.phase !== 'presentation') {
        refuse(409, 'Presentation order is locked after presentations end')
      }
      const body = ensurePlainObject(req.body)
      const teamIds = body.teamIds
      if (!isTeamPermutation(teamIds, session.data.teams)) refuse(400, 'teamIds must list every current team exactly once')
      teamIds.forEach((teamId, index) => {
        session.data.teams[teamId]!.presenterOrder = index
      })
    })
    if (!result) return

    broadcastRegistrationUpdate(ws, result.session.id, result.session.data)
    console.info('[commissioned-ideas] Presentation order updated', { sessionId: result.session.id })
    res.json({ ok: true })
  })

  // ── Instructor: spotlight a team (or clear with teamId: null) ───────────────
  app.post('/api/commissioned-ideas/:sessionId/presentation-active', async (req, res) => {
    const result = await mutateSession(req, res, (session) => {
      requireInstructor(req, session)
      requirePresentationPhase(session)
      const body = ensurePlainObject(req.body)
      if (!('teamId' in body)) refuse(400, 'teamId is required (string or null)')
      const teamId = typeof body.teamId === 'string' ? body.teamId : null
      if (body.teamId !== null && teamId === null) refuse(400, 'teamId must be a string or null')
      if (teamId && !ownEntry(session.data.teams, teamId)) refuse(404, 'Team not found')
      spotlightTeam(session.data, teamId)
      return { teamId, round: session.data.presentationRound }
    })
    if (!result) return

    broadcastRegistrationUpdate(ws, result.session.id, result.session.data)
    console.info('[commissioned-ideas] Presenting team set', { sessionId: result.session.id, ...result.value })
    res.json({ ok: true })
  })

  // ── Instructor: spotlight a random team that has not presented this round ───
  app.post('/api/commissioned-ideas/:sessionId/presentation-randomize', async (req, res) => {
    const result = await mutateSession(req, res, (session) => {
      requireInstructor(req, session)
      requirePresentationPhase(session)
      const eligible = unpresentedTeamIds(session.data.teams, session.data.presentationHistory, session.data.presentationRound)
      if (eligible.length === 0) refuse(409, 'Every team has presented this round')
      const teamId = eligible[randomInt(0, eligible.length)]!
      spotlightTeam(session.data, teamId)
      return { teamId, round: session.data.presentationRound }
    })
    if (!result) return

    broadcastRegistrationUpdate(ws, result.session.id, result.session.data)
    console.info('[commissioned-ideas] Random presenting team', { sessionId: result.session.id, ...result.value })
    res.json({ ok: true, teamId: result.value.teamId })
  })

  // ── Instructor: next round or reset the current round ───────────────────────
  // Body: { action: 'next' | 'reset' }
  app.post('/api/commissioned-ideas/:sessionId/presentation-round', async (req, res) => {
    const result = await mutateSession(req, res, (session) => {
      requireInstructor(req, session)
      requirePresentationPhase(session)
      const body = ensurePlainObject(req.body)
      const action = body.action
      if (action !== 'next' && action !== 'reset') refuse(400, "action must be 'next' or 'reset'")

      const round = session.data.presentationRound
      if (action === 'next') {
        session.data.presentationRound = round + 1
      } else {
        session.data.presentationHistory = session.data.presentationHistory.filter((entry) => entry.round !== round)
      }
      session.data.currentPresentationTeamId = null
      return { action, round: session.data.presentationRound }
    })
    if (!result) return

    broadcastRegistrationUpdate(ws, result.session.id, result.session.data)
    console.info('[commissioned-ideas] Presentation round updated', { sessionId: result.session.id, ...result.value })
    res.json({ ok: true, round: result.value.round })
  })

  // ── WebSocket ───────────────────────────────────────────────────────────────

  /** Re-derives one participant's `connected` flag from live sockets; persists and broadcasts on change. */
  async function syncParticipantPresence(sessionId: string, participantId: string): Promise<void> {
    // Cheap read first: most closes (another tab still open) change nothing.
    const current = await getSession(sessions, sessionId)
    const known = current ? ownEntry(current.data.participantRoster, participantId) : undefined
    if (!known || known.connected === hasLiveParticipantSocket(ws, sessionId, participantId)) return

    const committed = await atomicUpdate(sessions, sessionId, (session) => {
      const participant = ownEntry(session.data.participantRoster, participantId)
      if (!participant) return
      // Derived at commit time, so a retry sees the sockets as they are now.
      participant.connected = hasLiveParticipantSocket(ws, sessionId, participantId)
      participant.lastSeen = Date.now()
    })
    if (committed) broadcastRegistrationUpdate(ws, sessionId, committed.data)
  }

  function sendWsError(socket: CommissionedIdeasSocket, error: string, code?: string): void {
    socket.send(JSON.stringify({ type: 'commissioned-ideas:error', error, ...(code ? { code } : {}) }))
  }

  async function authenticateParticipantSocket(
    socket: CommissionedIdeasSocket,
    sessionId: string,
    message: Record<string, unknown>,
  ): Promise<void> {
    const previous = socket.studentAuth === 'anonymous' ? 'anonymous' : 'pending'
    socket.studentAuth = 'authenticating'

    let bound = false
    try {
      const session = await getSession(sessions, sessionId)
      if (socket.readyState !== WS_OPEN) return // closed while reading: never mark online
      if (!session) {
        sendWsError(socket, 'Session not found', 'session-not-found')
        socket.close(1008, 'Session not found')
        return
      }
      const participant = verifyParticipantCredential(session.data, message.participantId, message.token, { allowRejected: true })
      if (!participant) {
        console.warn('[commissioned-ideas] WS participant auth refused', { sessionId })
        socket.studentAuth = 'anonymous'
        sendWsError(socket, 'Invalid participant credentials', 'participant-auth-refused')
        socket.send(JSON.stringify({
          type: 'commissioned-ideas:session-state',
          sessionId,
          data: buildStudentSnapshot(session.data, null),
        }))
        return
      }

      // Bind before writing presence so a close during the write is seen by the
      // close handler, which then re-derives presence from the remaining sockets.
      socket.participantId = participant.id
      socket.studentAuth = 'authenticated'
      bound = true
      const committed = await atomicUpdate(sessions, sessionId, (draft) => {
        const entry = ownEntry(draft.data.participantRoster, participant.id)
        if (!entry) return
        entry.connected = true
        entry.lastSeen = Date.now()
      })
      if (!committed) throw new Error('Session disappeared during participant auth')
      // The broadcast includes this socket's personalized snapshot.
      broadcastRegistrationUpdate(ws, sessionId, committed.data)
      // Closed during the write: our `connected = true` may have landed after the
      // close handler's update, so derive presence once more.
      if (socket.readyState !== WS_OPEN) await syncParticipantPresence(sessionId, participant.id)
    } catch (err: unknown) {
      console.error('[commissioned-ideas] WS participant auth failed', { sessionId, err })
      if (socket.studentAuth === 'authenticating' || bound) {
        socket.participantId = null
        socket.studentAuth = previous
      }
      // Retryable: the client reconnects on a non-policy close and authenticates again.
      if (socket.readyState === WS_OPEN) {
        sendWsError(socket, 'Failed to authenticate', 'participant-auth-failed')
        socket.close(1011, 'Authentication failed')
      }
    } finally {
      // A socket that closed before resolving must not stay `authenticating`.
      if (socket.studentAuth === 'authenticating') socket.studentAuth = previous
    }
  }

  ws.register('/ws/commissioned-ideas', (socket, query) => {
    const sessionId = query.get('sessionId')
    if (!sessionId) {
      socket.close(1008, 'Missing sessionId')
      return
    }

    const typedSocket = socket as CommissionedIdeasSocket
    typedSocket.sessionId = sessionId
    // Identity is bound only after a verified auth message (participant token or
    // instructor passcode) — never from the URL.
    typedSocket.participantId = null
    typedSocket.wantsManager = query.get('role') === 'manager'
    typedSocket.studentAuth = typedSocket.wantsManager ? undefined : 'pending'

    socket.on('error', (err: unknown) => {
      console.warn('[commissioned-ideas] WS transport error', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      })
    })

    ;(async () => {
      const session = await getSession(sessions, sessionId)
      if (!session) {
        sendWsError(typedSocket, 'Session not found', 'session-not-found')
        socket.close(1008, 'Session not found')
        return
      }
      // Subscribe only for sessions that exist, so stale links cannot add
      // permanent subscription entries.
      ensureBroadcastSubscription(sessionId)
      // Students get their first snapshot after participant-auth (personalized)
      // or after a failed auth (anonymous) — never an anonymous view first.
    })().catch((err: unknown) => {
      console.error('[commissioned-ideas] WS init error', { sessionId, err })
      sendWsError(typedSocket, 'Failed to load session')
    })

    socket.on('message', (raw: unknown) => {
      void (async () => {
        const message = parseSocketMessage(raw)

        if (message?.type === 'commissioned-ideas:participant-auth') {
          // Retry is allowed after a refusal, never during an attempt or after success.
          if (typedSocket.studentAuth === 'pending' || typedSocket.studentAuth === 'anonymous') {
            await authenticateParticipantSocket(typedSocket, sessionId, message)
          }
          return
        }

        if (typedSocket.isManager || !typedSocket.wantsManager) {
          return
        }

        if (message?.type !== 'commissioned-ideas:manager-auth') {
          return
        }

        const session = await getSession(sessions, sessionId)
        if (!session) {
          sendWsError(typedSocket, 'Session not found', 'session-not-found')
          socket.close(1008, 'Session not found')
          return
        }

        const candidatePasscode = normalizeInstructorPasscode(message.instructorPasscode)
        if (!candidatePasscode || !verifyPasscode(session.data.instructorPasscode, candidatePasscode)) {
          sendWsError(typedSocket, 'Invalid instructor passcode')
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
        console.error('[commissioned-ideas] WS auth error', { sessionId, err })
        sendWsError(typedSocket, 'Failed to authenticate')
      })
    })

    socket.on('close', () => {
      const participantId = typedSocket.participantId
      if (!participantId || typedSocket.studentAuth !== 'authenticated') return

      void syncParticipantPresence(sessionId, participantId).catch((err: unknown) => {
        console.error('[commissioned-ideas] WS close cleanup error', { sessionId, participantId, err })
      })
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
