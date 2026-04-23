import test from 'node:test'
import assert from 'node:assert/strict'
import { computeTeamScores, resolveLeadingProposal } from '../shared/scoring.js'
import { validateBallot, sanitizeDisplayName, coerceAllocations } from '../shared/validation.js'
import { normalizeTeam, buildStudentSnapshot } from './routes.js'
import type { CommissionedIdeasSessionData, CommissionedIdeasTeam } from '../shared/types.js'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTeam(id: string, registeredAt = 0): CommissionedIdeasTeam {
  return {
    id,
    groupName: id,
    projectName: null,
    registeredAt,
    presenterOrder: null,
    locked: false,
    memberIds: [],
    proposedGroupNames: [],
    proposedProjectNames: [],
    groupNameVotes: {},
    projectNameVotes: {},
  }
}

function makeSession(overrides: Partial<CommissionedIdeasSessionData> = {}): CommissionedIdeasSessionData {
  return {
    instructorPasscode: 'TESTPASS',
    phase: 'voting',
    studentGroupingLocked: true,
    namingLocked: true,
    maxTeamSize: 4,
    groupingMode: 'manual',
    presentationRound: 1,
    allowLateRegistration: true,
    teams: {
      t1: makeTeam('t1'),
      t2: makeTeam('t2'),
      t3: makeTeam('t3'),
    },
    participantRoster: {
      voter1: { id: 'voter1', name: 'Alice', teamId: null, connected: true, lastSeen: 0, rejectedByInstructor: false },
    },
    ballots: {},
    presentationHistory: [],
    currentPresentationTeamId: null,
    podiumRevealStep: 'hidden',
    ...overrides,
  }
}

// ── scoring ───────────────────────────────────────────────────────────────────

void test('computeTeamScores totals dollars per team', () => {
  const teams = {
    t1: makeTeam('t1'),
    t2: makeTeam('t2'),
    t3: makeTeam('t3'),
  }
  const ballots = {
    v1: {
      voterId: 'v1',
      voterName: 'Alice',
      voterTeamId: null,
      submittedAt: 0,
      allocations: [
        { teamId: 't1', amount: 500 as const },
        { teamId: 't2', amount: 300 as const },
        { teamId: 't3', amount: 100 as const },
      ],
    },
  }

  const [first, second, third] = computeTeamScores(teams, ballots)
  assert.ok(first && second && third)
  assert.equal(first.teamId, 't1')
  assert.equal(first.totalDollars, 500)
  assert.equal(second.teamId, 't2')
  assert.equal(third.teamId, 't3')
})

void test('computeTeamScores tiebreaker: earlier registration wins when dollars and $500 count match', () => {
  const teams = {
    early: makeTeam('early', 1000),
    late: makeTeam('late', 2000),
  }
  // v1: early=$500, late=$300, early=$100 → duplicate team in same ballot, but scoring aggregates across ballots
  // Use two separate ballots so each ballot is valid:
  // b1: early=$500, late=$300, early=$100 is invalid (duplicate team) — use a third dummy team
  // Use three teams to keep ballots valid
  const teams3 = {
    early: makeTeam('early', 1000),
    late: makeTeam('late', 2000),
    other: makeTeam('other', 3000),
  }
  const ballots = {
    b1: {
      voterId: 'b1',
      voterName: 'X',
      voterTeamId: null,
      submittedAt: 0,
      allocations: [
        { teamId: 'early', amount: 500 as const },
        { teamId: 'other', amount: 300 as const },
        { teamId: 'late', amount: 100 as const },
      ],
    },
    b2: {
      voterId: 'b2',
      voterName: 'Y',
      voterTeamId: null,
      submittedAt: 0,
      allocations: [
        { teamId: 'late', amount: 500 as const },
        { teamId: 'other', amount: 300 as const },
        { teamId: 'early', amount: 100 as const },
      ],
    },
  }
  // early: 500+100 = 600, $500×1
  // late: 100+500 = 600, $500×1
  // $500 count tie → $300 count: early=0, late=0 → registeredAt: early=1000 < late=2000 → early wins
  const [first, second] = computeTeamScores(teams3, ballots)
  assert.ok(first && second)
  assert.equal(first.teamId, 'early')
  assert.equal(first.totalDollars, 600)

  // Confirm teams arg didn't shadow outer teams
  void teams
})

void test('computeTeamScores full dollar ranking', () => {
  const teams = {
    winner: makeTeam('winner', 100),
    second: makeTeam('second', 200),
    third: makeTeam('third', 300),
  }
  const ballots = {
    b1: {
      voterId: 'b1',
      voterName: 'A',
      voterTeamId: null,
      submittedAt: 0,
      allocations: [
        { teamId: 'winner', amount: 500 as const },
        { teamId: 'second', amount: 300 as const },
        { teamId: 'third', amount: 100 as const },
      ],
    },
  }
  const [first, second, third] = computeTeamScores(teams, ballots)
  assert.ok(first && second && third)
  assert.equal(first.teamId, 'winner')
  assert.equal(second.teamId, 'second')
  assert.equal(third.teamId, 'third')
})

void test('resolveLeadingProposal returns null when no eligible proposals', () => {
  assert.equal(resolveLeadingProposal([], {}), null)
})

void test('resolveLeadingProposal skips rejected proposals', () => {
  const proposals = [
    { id: 'p1', value: 'Alpha', rejectedByInstructor: true },
    { id: 'p2', value: 'Beta', rejectedByInstructor: false },
  ]
  assert.equal(resolveLeadingProposal(proposals, {}), 'Beta')
})

void test('resolveLeadingProposal returns leading vote winner', () => {
  const proposals = [
    { id: 'p1', value: 'Alpha', rejectedByInstructor: false },
    { id: 'p2', value: 'Beta', rejectedByInstructor: false },
  ]
  const votes = { alice: 'p2', bob: 'p2', carol: 'p1' }
  assert.equal(resolveLeadingProposal(proposals, votes), 'Beta')
})

// ── validation ────────────────────────────────────────────────────────────────

void test('validateBallot accepts a valid $100/$300/$500 ballot', () => {
  const session = makeSession()
  const result = validateBallot(
    [
      { teamId: 't1', amount: 500 },
      { teamId: 't2', amount: 300 },
      { teamId: 't3', amount: 100 },
    ],
    'voter1',
    session,
  )
  assert.equal(result.valid, true)
})

void test('validateBallot rejects fewer than three allocations', () => {
  const session = makeSession()
  const result = validateBallot(
    [
      { teamId: 't1', amount: 500 },
      { teamId: 't2', amount: 300 },
    ],
    'voter1',
    session,
  )
  assert.equal(result.valid, false)
})

void test('validateBallot rejects duplicate amounts', () => {
  const session = makeSession()
  const result = validateBallot(
    [
      { teamId: 't1', amount: 500 },
      { teamId: 't2', amount: 500 },
      { teamId: 't3', amount: 100 },
    ],
    'voter1',
    session,
  )
  assert.equal(result.valid, false)
})

void test('validateBallot rejects duplicate team targets', () => {
  const session = makeSession()
  const result = validateBallot(
    [
      { teamId: 't1', amount: 500 },
      { teamId: 't1', amount: 300 },
      { teamId: 't3', amount: 100 },
    ],
    'voter1',
    session,
  )
  assert.equal(result.valid, false)
})

void test('validateBallot blocks self-vote when voter belongs to a team', () => {
  const session = makeSession({
    participantRoster: {
      voter1: { id: 'voter1', name: 'Alice', teamId: 't1', connected: true, lastSeen: 0, rejectedByInstructor: false },
    },
  })
  const result = validateBallot(
    [
      { teamId: 't1', amount: 500 },
      { teamId: 't2', amount: 300 },
      { teamId: 't3', amount: 100 },
    ],
    'voter1',
    session,
  )
  assert.equal(result.valid, false)
  assert.match(result.error ?? '', /own team/)
})

void test('validateBallot allows self-vote when allowSelfVote=true', () => {
  const session = makeSession({
    participantRoster: {
      voter1: { id: 'voter1', name: 'Alice', teamId: 't1', connected: true, lastSeen: 0, rejectedByInstructor: false },
    },
  })
  const result = validateBallot(
    [
      { teamId: 't1', amount: 500 },
      { teamId: 't2', amount: 300 },
      { teamId: 't3', amount: 100 },
    ],
    'voter1',
    session,
    true,
  )
  assert.equal(result.valid, true)
})

void test('sanitizeDisplayName trims and enforces maxLength', () => {
  assert.equal(sanitizeDisplayName('  hello  '), 'hello')
  assert.equal(sanitizeDisplayName(''), null)
  assert.equal(sanitizeDisplayName(null), null)
  const long = 'x'.repeat(200)
  assert.equal((sanitizeDisplayName(long, 10) ?? '').length, 10)
})

void test('coerceAllocations returns null for invalid input', () => {
  assert.equal(coerceAllocations(null), null)
  assert.equal(coerceAllocations([{ teamId: 't1', amount: 999 }]), null)
})

void test('coerceAllocations parses valid allocations', () => {
  const result = coerceAllocations([
    { teamId: 't1', amount: 500 },
    { teamId: 't2', amount: 300 },
    { teamId: 't3', amount: 100 },
  ])
  assert.ok(result)
  assert.equal(result.length, 3)
})

// ── normalizeTeam: name fallback ──────────────────────────────────────────────

void test('normalizeTeam preserves persisted groupName when no proposals exist', () => {
  const raw = {
    id: 't1',
    groupName: 'The Sharks',
    projectName: 'Fin Tracker',
    registeredAt: 1000,
    presenterOrder: null,
    locked: false,
    memberIds: [],
    proposedGroupNames: [],
    proposedProjectNames: [],
    groupNameVotes: {},
    projectNameVotes: {},
  }
  const team = normalizeTeam(raw, 't1')
  assert.equal(team.groupName, 'The Sharks')
  assert.equal(team.projectName, 'Fin Tracker')
})

void test('normalizeTeam resolves name from proposals when proposals exist', () => {
  const raw = {
    id: 't1',
    groupName: 'Old Name',
    projectName: 'Old Project',
    registeredAt: 1000,
    presenterOrder: null,
    locked: false,
    memberIds: [],
    proposedGroupNames: [
      { id: 'p1', value: 'New Name', proposedByParticipantId: 'a', createdAt: 0, rejectedByInstructor: false },
    ],
    proposedProjectNames: [],
    groupNameVotes: { a: 'p1' },
    projectNameVotes: {},
  }
  const team = normalizeTeam(raw, 't1')
  // Proposals exist for groupName, so resolution wins
  assert.equal(team.groupName, 'New Name')
  // No proposals for projectName, so persisted value is preserved
  assert.equal(team.projectName, 'Old Project')
})

void test('normalizeTeam returns null name when all proposals are rejected and no fallback', () => {
  const raw = {
    id: 't1',
    groupName: null,
    projectName: null,
    registeredAt: 1000,
    presenterOrder: null,
    locked: false,
    memberIds: [],
    proposedGroupNames: [
      { id: 'p1', value: 'Bad Name', proposedByParticipantId: 'a', createdAt: 0, rejectedByInstructor: true },
    ],
    proposedProjectNames: [],
    groupNameVotes: { a: 'p1' },
    projectNameVotes: {},
  }
  const team = normalizeTeam(raw, 't1')
  assert.equal(team.groupName, null)
})

// ── buildStudentSnapshot: privacy ─────────────────────────────────────────────

function makeFullSession(overrides: Partial<CommissionedIdeasSessionData> = {}): CommissionedIdeasSessionData {
  return {
    instructorPasscode: 'TESTPASS',
    phase: 'registration',
    studentGroupingLocked: false,
    namingLocked: false,
    maxTeamSize: 4,
    groupingMode: 'manual',
    presentationRound: 1,
    allowLateRegistration: true,
    teams: {},
    participantRoster: {
      p1: { id: 'p1', name: 'Alice', teamId: null, connected: true, lastSeen: 999, rejectedByInstructor: false },
      p2: { id: 'p2', name: 'BadName', teamId: null, connected: false, lastSeen: 100, rejectedByInstructor: true },
    },
    ballots: {
      p1: {
        voterId: 'p1',
        voterName: 'Alice',
        voterTeamId: null,
        allocations: [
          { teamId: 't1', amount: 500 },
          { teamId: 't2', amount: 300 },
          { teamId: 't3', amount: 100 },
        ],
        submittedAt: 0,
      },
    },
    presentationHistory: [],
    currentPresentationTeamId: null,
    podiumRevealStep: 'hidden',
    ...overrides,
  }
}

void test('buildStudentSnapshot strips connected, lastSeen, rejectedByInstructor from participants', () => {
  const snapshot = buildStudentSnapshot(makeFullSession(), null)
  const p1 = snapshot.participantRoster['p1']
  assert.ok(p1)
  assert.equal('connected' in p1, false)
  assert.equal('lastSeen' in p1, false)
  assert.equal('rejectedByInstructor' in p1, false)
  assert.equal(p1.id, 'p1')
  assert.equal(p1.name, 'Alice')
})

void test('buildStudentSnapshot does not expose instructorPasscode', () => {
  const snapshot = buildStudentSnapshot(makeFullSession(), null)
  assert.equal(
    'instructorPasscode' in snapshot,
    false,
    'instructorPasscode must not appear in student snapshot',
  )
})

void test('buildStudentSnapshot omits rejected participants from student roster', () => {
  const snapshot = buildStudentSnapshot(makeFullSession(), null)
  assert.equal('p2' in snapshot.participantRoster, false)
  assert.equal(Object.keys(snapshot.participantRoster).length, 1)
})

void test('buildStudentSnapshot exposes ballot count but not ballot contents', () => {
  const snapshot = buildStudentSnapshot(makeFullSession(), null)
  assert.equal(snapshot.ballotsReceived, 1)
  assert.equal('ballots' in snapshot, false)
  assert.equal(snapshot.myBallot, null)
})

void test('buildStudentSnapshot returns own ballot for the viewer', () => {
  const snapshot = buildStudentSnapshot(makeFullSession(), 'p1')
  assert.ok(snapshot.myBallot)
  assert.equal(snapshot.ballotSubmitted, true)
})

void test('buildStudentSnapshot does not include another participant ballot for viewer', () => {
  const snapshot = buildStudentSnapshot(makeFullSession(), 'p2')
  assert.equal(snapshot.myBallot, null)
  assert.equal(snapshot.ballotSubmitted, false)
})
