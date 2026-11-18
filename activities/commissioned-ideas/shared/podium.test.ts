import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPodium,
  fundingRanks,
  joinNames,
  nextPodiumStep,
  podiumPlaceCount,
  podiumRevealKey,
  podiumSequence,
  reconcilePodiumReveal,
  revealedPlaces,
  revealedPodium,
} from './podium.js'
import { computeTeamScores } from './scoring.js'
import type { CommissionedIdeasBallot, CommissionedIdeasTeam, PodiumRevealStep, TeamScore } from './types.js'

// ── Sequence per class size ──────────────────────────────────────────────────

const sequenceCases: { teams: number; expected: PodiumRevealStep[] }[] = [
  { teams: 0, expected: ['hidden'] },
  { teams: 1, expected: ['hidden', 'winner', 'complete'] },
  { teams: 2, expected: ['hidden', 'second', 'winner', 'complete'] },
  { teams: 3, expected: ['hidden', 'third', 'second', 'winner', 'complete'] },
  { teams: 9, expected: ['hidden', 'third', 'second', 'winner', 'complete'] },
]

for (const row of sequenceCases) {
  void test(`podiumSequence(${row.teams} places)`, () => {
    assert.deepEqual(podiumSequence(row.teams), row.expected)
  })
}

void test('nextPodiumStep walks the sequence and stops after complete', () => {
  assert.equal(nextPodiumStep('hidden', 5), 'third')
  assert.equal(nextPodiumStep('winner', 5), 'complete')
  assert.equal(nextPodiumStep('complete', 5), null)
  assert.equal(nextPodiumStep('hidden', 2), 'second', 'two teams skip third')
  assert.equal(nextPodiumStep('hidden', 0), null, 'nothing to reveal')
  assert.equal(nextPodiumStep('third', 2), 'second', 'a step that does not exist for this class restarts at the first reveal')
})

// ── Revealed places decision table ───────────────────────────────────────────

const revealCases: { step: PodiumRevealStep; teams: number; expected: number[] }[] = [
  { step: 'hidden', teams: 5, expected: [] },
  { step: 'third', teams: 5, expected: [3] },
  { step: 'second', teams: 5, expected: [3, 2] },
  { step: 'winner', teams: 5, expected: [3, 2, 1] },
  { step: 'complete', teams: 5, expected: [3, 2, 1] },
  { step: 'second', teams: 2, expected: [2] },
  { step: 'winner', teams: 2, expected: [2, 1] },
  { step: 'complete', teams: 1, expected: [1] },
  { step: 'third', teams: 2, expected: [] },
]

for (const row of revealCases) {
  void test(`revealedPlaces(${row.step}, ${row.teams} teams) → [${row.expected.join(', ')}]`, () => {
    assert.deepEqual(revealedPlaces(row.step, row.teams), row.expected)
  })
}

function score(teamId: string, totalDollars: number, registeredAt = 0): TeamScore {
  return {
    teamId, groupName: teamId.toUpperCase(), projectName: null, totalDollars,
    fiveHundredCount: 0, threeHundredCount: 0, oneHundredCount: 0, registeredAt,
  }
}

/** Compact view of a podium: [place, teamIds, total]. */
function shape(entries: ReturnType<typeof buildPodium>) {
  return entries.map((e) => [e.place, e.teams.map((t) => t.teamId), e.totalDollars])
}

void test('revealedPodium shows only revealed steps and never leaks unrevealed teams', () => {
  const ranking = [score('w', 1000), score('s', 900), score('t', 800), score('x', 700)]
  assert.deepEqual(shape(revealedPodium(ranking, 'third')), [[3, ['t'], 800]])
  assert.deepEqual(shape(revealedPodium(ranking, 'complete')), [[3, ['t'], 800], [2, ['s'], 900], [1, ['w'], 1000]])
  assert.equal(JSON.stringify(revealedPodium(ranking, 'second')).includes('"w"'), false)
  assert.deepEqual(revealedPodium(ranking, 'hidden'), [])
})

// ── Same funding → same step (dense ranking), $0 never on the podium ─────────

const podiumCases: { name: string; ranking: TeamScore[]; ranks: (number | null)[]; places: number; podium: unknown[] }[] = [
  {
    name: 'distinct totals',
    ranking: [score('a', 900), score('b', 500), score('c', 300), score('d', 100)],
    ranks: [1, 2, 3, 4], places: 3,
    podium: [[3, ['c'], 300], [2, ['b'], 500], [1, ['a'], 900]],
  },
  {
    name: 'tie for the win keeps 2nd and 3rd steps',
    ranking: [score('a', 500), score('b', 500), score('c', 300), score('d', 100)],
    ranks: [1, 1, 2, 3], places: 3,
    podium: [[3, ['d'], 100], [2, ['c'], 300], [1, ['a', 'b'], 500]],
  },
  {
    name: 'tie for 2nd',
    ranking: [score('a', 900), score('b', 400), score('c', 400), score('d', 100)],
    ranks: [1, 2, 2, 3], places: 3,
    podium: [[3, ['d'], 100], [2, ['b', 'c'], 400], [1, ['a'], 900]],
  },
  {
    name: 'tie for 3rd puts every tied team on the step',
    ranking: [score('a', 900), score('b', 500), score('c', 100), score('d', 100), score('e', 100)],
    ranks: [1, 2, 3, 3, 3], places: 3,
    podium: [[3, ['c', 'd', 'e'], 100], [2, ['b'], 500], [1, ['a'], 900]],
  },
  {
    name: '$0 teams never get a step',
    ranking: [score('a', 500), score('b', 300), score('c', 0), score('d', 0)],
    ranks: [1, 2, null, null], places: 2,
    podium: [[2, ['b'], 300], [1, ['a'], 500]],
  },
  {
    name: 'everyone tied',
    ranking: [score('a', 300), score('b', 300)],
    ranks: [1, 1], places: 1,
    podium: [[1, ['a', 'b'], 300]],
  },
  {
    name: 'no funding at all',
    ranking: [score('a', 0), score('b', 0)],
    ranks: [null, null], places: 0,
    podium: [],
  },
]

for (const row of podiumCases) {
  void test(`podium: ${row.name}`, () => {
    const ranks = fundingRanks(row.ranking)
    assert.deepEqual(row.ranking.map((r) => ranks.get(r.teamId)), row.ranks, 'funding ranks')
    assert.equal(podiumPlaceCount(row.ranking), row.places, 'place count')
    assert.deepEqual(shape(buildPodium(row.ranking)), row.podium, 'podium')
  })
}

void test('a tie for the win shortens nothing: the reveal still steps through every existing place', () => {
  const ranking = [score('a', 500), score('b', 500), score('c', 300), score('d', 100)]
  assert.deepEqual(podiumSequence(podiumPlaceCount(ranking)), ['hidden', 'third', 'second', 'winner', 'complete'])
})

void test('joinNames reads naturally', () => {
  assert.equal(joinNames(['A']), 'A')
  assert.equal(joinNames(['A', 'B']), 'A and B')
  assert.equal(joinNames(['A', 'B', 'C']), 'A, B and C')
  assert.equal(joinNames([]), '')
})

// ── Ranking tie-breakers (decision table) ────────────────────────────────────

function team(id: string, registeredAt: number): CommissionedIdeasTeam {
  return {
    id, groupName: id, projectName: null, registeredAt, presenterOrder: null, locked: false, memberIds: [],
    proposedGroupNames: [], proposedProjectNames: [], groupNameVotes: {}, projectNameVotes: {},
  }
}

function ballots(...awards: [string, 100 | 300 | 500][][]): Record<string, CommissionedIdeasBallot> {
  return Object.fromEntries(awards.map((allocs, i) => [`v${i}`, {
    voterId: `v${i}`, voterName: `V${i}`, voterTeamId: null, submittedAt: 0,
    allocations: allocs.map(([teamId, amount]) => ({ teamId, amount })),
  }]))
}

const tieCases: { name: string; ballots: Record<string, CommissionedIdeasBallot>; expectedOrder: string[] }[] = [
  {
    name: 'more dollars wins',
    ballots: ballots([['a', 300]], [['b', 500]]),
    expectedOrder: ['b', 'a'],
  },
  {
    name: 'equal dollars → more $500 awards wins',
    // a: 500+100 = 600 (one $500); b: 300+300 = 600 (no $500)
    ballots: ballots([['a', 500], ['b', 300]], [['a', 100], ['b', 300]]),
    expectedOrder: ['a', 'b'],
  },
  {
    name: 'equal dollars and $500s → more $300 awards wins',
    // a: 300+300 = 600 (two $300s); b: 300+100+100+100 = 600 (one $300); neither has a $500
    ballots: ballots([['a', 300], ['b', 300]], [['a', 300], ['b', 100]], [['b', 100]], [['b', 100]]),
    expectedOrder: ['a', 'b'],
  },
  {
    name: 'everything equal → earlier registration wins',
    ballots: ballots([['a', 500]], [['b', 500]]),
    expectedOrder: ['a', 'b'],
  },
]

for (const row of tieCases) {
  void test(`computeTeamScores ranking: ${row.name}`, () => {
    const teams = { a: team('a', 1), b: team('b', 2) }
    assert.deepEqual(computeTeamScores(teams, row.ballots).map((s) => s.teamId), row.expectedOrder)
  })
}

// ── Reveal invariant: a revealed podium matches the ranking it was revealed for ──
function revealScore(teamId: string, totalDollars: number, groupName: string | null = null): TeamScore {
  return { teamId, groupName, projectName: null, totalDollars, fiveHundredCount: 0, threeHundredCount: 0, oneHundredCount: 0, registeredAt: 0 }
}

const revealBaseRanking = [revealScore('A', 900), revealScore('B', 600), revealScore('C', 300)]
const podiumRevealCases: { name: string; step: PodiumRevealStep; keyFrom: TeamScore[] | null; now: TeamScore[]; reset: boolean }[] = [
  { name: 'hidden stays hidden and clears a stale key', step: 'hidden', keyFrom: revealBaseRanking, now: revealBaseRanking, reset: false },
  { name: 'unchanged podium keeps the reveal', step: 'second', keyFrom: revealBaseRanking, now: revealBaseRanking, reset: false },
  { name: 'renamed team keeps the reveal', step: 'third', keyFrom: revealBaseRanking, now: [revealScore('A', 900), revealScore('B', 600), revealScore('C', 300, 'Owls')], reset: false },
  { name: 'unfunded team added below the podium keeps the reveal', step: 'third', keyFrom: revealBaseRanking, now: [...revealBaseRanking, revealScore('D', 0)], reset: false },
  { name: 'withdrawn ballot changes a total', step: 'third', keyFrom: revealBaseRanking, now: [revealScore('A', 900), revealScore('B', 600), revealScore('C', 200)], reset: true },
  { name: 'deleted team changes the podium', step: 'winner', keyFrom: revealBaseRanking, now: [revealScore('A', 900), revealScore('C', 300)], reset: true },
  { name: 'teams swap places', step: 'complete', keyFrom: revealBaseRanking, now: [revealScore('B', 900), revealScore('A', 600), revealScore('C', 300)], reset: true },
  { name: 'missing key while revealed (inconsistent state) resets', step: 'third', keyFrom: null, now: revealBaseRanking, reset: true },
]

for (const row of podiumRevealCases) {
  void test(`reconcilePodiumReveal: ${row.name}`, () => {
    const state = { podiumRevealStep: row.step, podiumRevealKey: row.keyFrom ? podiumRevealKey(row.keyFrom) : null }
    let scored = 0
    assert.equal(reconcilePodiumReveal(state, () => { scored += 1; return row.now }), row.reset)
    if (row.step === 'hidden') assert.equal(scored, 0, 'no scoring while hidden')
    assert.equal(state.podiumRevealStep, row.reset ? 'hidden' : row.step)
    if (state.podiumRevealStep === 'hidden') assert.equal(state.podiumRevealKey, null)
  })
}
