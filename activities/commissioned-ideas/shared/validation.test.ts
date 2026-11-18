import test from 'node:test'
import assert from 'node:assert/strict'
import type { CommissionedIdeasSessionData, CommissionedIdeasTeam } from './types.js'
import {
  ballotEligibleTeamIds,
  requiredBallotAmounts,
  validateBallot,
  voterBallotStatus,
  withdrawBallotsFundingMissingTeams,
} from './validation.js'

function team(id: string): CommissionedIdeasTeam {
  return {
    id,
    groupName: null,
    projectName: null,
    registeredAt: 0,
    presenterOrder: null,
    locked: false,
    memberIds: [],
    proposedGroupNames: [],
    proposedProjectNames: [],
    groupNameVotes: {},
    projectNameVotes: {},
  }
}

function session(teamIds: string[], voterTeamId: string | null): CommissionedIdeasSessionData {
  return {
    instructorPasscode: 'X',
    phase: 'voting',
    studentGroupingLocked: true,
    namingLocked: true,
    maxTeamSize: 4,
    groupingMode: 'manual',
    presentationRound: 1,
    teams: Object.fromEntries(teamIds.map((id) => [id, team(id)])),
    participantRoster: {
      v: { id: 'v', name: 'Voter', teamId: voterTeamId, connected: true, lastSeen: 0, rejectedByInstructor: false, token: 'T' },
    },
    ballots: {},
    presentationHistory: [],
    currentPresentationTeamId: null,
    podiumRevealStep: 'hidden',
    podiumRevealKey: null,
  }
}

// ── Ballot size: top amounts for min(3, eligible teams) ──────────────────────

const sizeCases: { eligible: number; expected: number[] }[] = [
  { eligible: 0, expected: [] },
  { eligible: 1, expected: [500] },
  { eligible: 2, expected: [500, 300] },
  { eligible: 3, expected: [500, 300, 100] },
  { eligible: 7, expected: [500, 300, 100] },
  { eligible: -1, expected: [] },
]

for (const row of sizeCases) {
  void test(`requiredBallotAmounts(${row.eligible}) → [${row.expected.join(', ')}]`, () => {
    assert.deepEqual(requiredBallotAmounts(row.eligible), row.expected)
  })
}

void test('ballotEligibleTeamIds excludes only the voter team; ungrouped voters see every team', () => {
  const teams = { a: {}, b: {}, c: {} }
  assert.deepEqual(ballotEligibleTeamIds(teams, 'b'), ['a', 'c'])
  assert.deepEqual(ballotEligibleTeamIds(teams, null), ['a', 'b', 'c'])
  assert.deepEqual(ballotEligibleTeamIds(teams, 'b', true), ['a', 'b', 'c'])
})

// ── validateBallot equivalence classes ───────────────────────────────────────

const validationCases: {
  name: string
  teams: string[]
  voterTeam: string | null
  allocations: unknown
  valid: boolean
  error?: RegExp
}[] = [
  {
    name: 'full ballot (voter on a fourth team)',
    teams: ['a', 'b', 'c', 'v'], voterTeam: 'v',
    allocations: [{ teamId: 'a', amount: 500 }, { teamId: 'b', amount: 300 }, { teamId: 'c', amount: 100 }],
    valid: true,
  },
  {
    name: 'reduced two-award ballot (3 teams, voter on one)',
    teams: ['a', 'b', 'c'], voterTeam: 'a',
    allocations: [{ teamId: 'c', amount: 300 }, { teamId: 'b', amount: 500 }],
    valid: true,
  },
  {
    name: 'reduced one-award ballot (2 teams, voter on one)',
    teams: ['a', 'b'], voterTeam: 'a',
    allocations: [{ teamId: 'b', amount: 500 }],
    valid: true,
  },
  {
    name: 'reduced ballot must use the top amounts, not $100',
    teams: ['a', 'b', 'c'], voterTeam: 'a',
    allocations: [{ teamId: 'b', amount: 500 }, { teamId: 'c', amount: 100 }],
    valid: false, error: /Invalid amount/,
  },
  {
    name: 'too many awards for a reduced ballot',
    teams: ['a', 'b', 'c'], voterTeam: 'a',
    allocations: [{ teamId: 'b', amount: 500 }, { teamId: 'c', amount: 300 }, { teamId: 'a', amount: 100 }],
    valid: false, error: /exactly 2 awards: \$500, \$300/,
  },
  {
    name: 'only team is your own → no ballot possible',
    teams: ['a'], voterTeam: 'a',
    allocations: [],
    valid: false, error: /no other teams/,
  },
  {
    name: 'own team rejected even when the count is right',
    teams: ['a', 'b', 'c', 'd'], voterTeam: 'a',
    allocations: [{ teamId: 'a', amount: 500 }, { teamId: 'b', amount: 300 }, { teamId: 'c', amount: 100 }],
    valid: false, error: /own team/,
  },
  {
    name: 'same team twice',
    teams: ['a', 'b', 'c', 'v'], voterTeam: 'v',
    allocations: [{ teamId: 'a', amount: 500 }, { teamId: 'a', amount: 300 }, { teamId: 'c', amount: 100 }],
    valid: false, error: /different team/,
  },
  {
    name: 'same amount twice',
    teams: ['a', 'b', 'c', 'v'], voterTeam: 'v',
    allocations: [{ teamId: 'a', amount: 500 }, { teamId: 'b', amount: 500 }, { teamId: 'c', amount: 100 }],
    valid: false, error: /Duplicate amount/,
  },
  {
    name: 'unknown team',
    teams: ['a', 'b', 'c', 'v'], voterTeam: 'v',
    allocations: [{ teamId: 'a', amount: 500 }, { teamId: 'b', amount: 300 }, { teamId: 'zz', amount: 100 }],
    valid: false, error: /Unknown team/,
  },
  {
    name: 'not an array',
    teams: ['a', 'b', 'c', 'v'], voterTeam: 'v',
    allocations: { a: 500 },
    valid: false, error: /exactly 3 awards/,
  },
  {
    name: 'ungrouped voter (late arrival) cannot vote',
    teams: ['a', 'b', 'c'], voterTeam: null,
    allocations: [{ teamId: 'a', amount: 500 }, { teamId: 'b', amount: 300 }, { teamId: 'c', amount: 100 }],
    valid: false, error: /on a team/,
  },
  {
    name: 'malformed entry',
    teams: ['a', 'v'], voterTeam: 'v',
    allocations: ['a'],
    valid: false, error: /Invalid allocation/,
  },
]

for (const row of validationCases) {
  void test(`validateBallot: ${row.name}`, () => {
    const result = validateBallot(row.allocations, 'v', session(row.teams, row.voterTeam))
    assert.equal(result.valid, row.valid, result.error ?? 'expected invalid ballot')
    if (row.error) assert.match(result.error ?? '', row.error)
  })
}

// ── voterBallotStatus: who may vote, and with which awards ───────────────────

const statusCases: { name: string; teams: string[]; voterTeam: string | null; expected: unknown }[] = [
  { name: 'ungrouped student', teams: ['a', 'b'], voterTeam: null, expected: { canVote: false, reason: 'not-on-team' } },
  { name: 'team id that no longer exists', teams: ['a', 'b'], voterTeam: 'gone', expected: { canVote: false, reason: 'not-on-team' } },
  { name: 'only team', teams: ['a'], voterTeam: 'a', expected: { canVote: false, reason: 'no-eligible-teams' } },
  { name: 'two teams', teams: ['a', 'b'], voterTeam: 'a', expected: { canVote: true, eligibleTeamIds: ['b'], requiredAmounts: [500] } },
  { name: 'four teams', teams: ['a', 'b', 'c', 'd'], voterTeam: 'b', expected: { canVote: true, eligibleTeamIds: ['a', 'c', 'd'], requiredAmounts: [500, 300, 100] } },
]

for (const row of statusCases) {
  void test(`voterBallotStatus: ${row.name}`, () => {
    const status = voterBallotStatus(row.voterTeam, Object.fromEntries(row.teams.map((id) => [id, {}])))
    const { message: _message, ...rest } = status as Record<string, unknown>
    assert.deepEqual(rest, row.expected)
  })
}

// ── Ballots that fund a deleted team ─────────────────────────────────────────
void test('withdrawBallotsFundingMissingTeams withdraws only ballots that fund a missing team', () => {
  const data = {
    teams: { A: team('A'), C: team('C') },
    ballots: {
      fundsDeleted: { voterId: 'fundsDeleted', voterName: 'fundsDeleted', voterTeamId: null, allocations: [{ teamId: 'B', amount: 500 as const }, { teamId: 'C', amount: 300 as const }], submittedAt: 1 },
      intact: { voterId: 'intact', voterName: 'intact', voterTeamId: null, allocations: [{ teamId: 'A', amount: 500 as const }, { teamId: 'C', amount: 300 as const }], submittedAt: 2 },
      inherited: { voterId: 'inherited', voterName: 'inherited', voterTeamId: null, allocations: [{ teamId: 'toString', amount: 500 as const }], submittedAt: 3 },
    },
  }
  assert.deepEqual(withdrawBallotsFundingMissingTeams(data).sort(), ['fundsDeleted', 'inherited'])
  assert.deepEqual(Object.keys(data.ballots), ['intact'])
  assert.deepEqual(withdrawBallotsFundingMissingTeams(data), [], 'idempotent')
})
