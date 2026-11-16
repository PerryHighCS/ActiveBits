import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PHASES,
  adjacentTeamId,
  checkPhaseTransition,
  isTeamPermutation,
  normalizePhaseValue,
  normalizePresenterOrder,
  orderedPresentationTeams,
  unpresentedTeamIds,
} from './presentation.js'
import type { CommissionedIdeasPhase } from './types.js'

// ── Phase transition decision table ───────────────────────────────────────────
// Expected outcome for every (from, to) pair with ordinary context (teams, no ballots).
const ordinary = { teamCount: 3, ballotCount: 0 }
const expectedOrdinary: Record<CommissionedIdeasPhase, Record<CommissionedIdeasPhase, boolean>> = {
  registration: { registration: false, presentation: true, voting: false, results: false },
  presentation: { registration: true, presentation: false, voting: true, results: false },
  voting: { registration: false, presentation: true, voting: false, results: true },
  results: { registration: false, presentation: true, voting: true, results: false },
}

for (const from of PHASES) {
  for (const to of PHASES) {
    void test(`checkPhaseTransition ${from} → ${to} (ordinary context)`, () => {
      assert.equal(checkPhaseTransition(from, to, ordinary).ok, expectedOrdinary[from][to])
    })
  }
}

const boundaryCases: {
  name: string
  from: CommissionedIdeasPhase
  to: CommissionedIdeasPhase
  ctx: { teamCount: number; ballotCount: number }
  ok: boolean
}[] = [
  { name: 'presentations need at least one team', from: 'registration', to: 'presentation', ctx: { teamCount: 0, ballotCount: 0 }, ok: false },
  { name: 'exactly one team is enough to present', from: 'registration', to: 'presentation', ctx: { teamCount: 1, ballotCount: 0 }, ok: true },
  { name: 'reopening registration is blocked once a ballot exists', from: 'presentation', to: 'registration', ctx: { teamCount: 3, ballotCount: 1 }, ok: false },
  { name: 'voting needs at least one team', from: 'presentation', to: 'voting', ctx: { teamCount: 0, ballotCount: 0 }, ok: false },
  { name: 'returning from results to presentation keeps working with ballots', from: 'results', to: 'presentation', ctx: { teamCount: 3, ballotCount: 9 }, ok: true },
]

for (const row of boundaryCases) {
  void test(`checkPhaseTransition: ${row.name}`, () => {
    const result = checkPhaseTransition(row.from, row.to, row.ctx)
    assert.equal(result.ok, row.ok)
    if (!result.ok) assert.ok(result.reason.length > 0, 'refusals carry a reason')
  })
}

void test('normalizePhaseValue accepts only known phases', () => {
  assert.equal(normalizePhaseValue('voting'), 'voting')
  assert.equal(normalizePhaseValue('lobby'), null)
  assert.equal(normalizePhaseValue(undefined), null)
})

// ── Ordering ─────────────────────────────────────────────────────────────────

function t(id: string, presenterOrder: number | null, registeredAt: number) {
  return { id, presenterOrder, registeredAt }
}

void test('orderedPresentationTeams puts explicit order first, then unordered by registration then id', () => {
  const teams = {
    late: t('late', null, 30),
    second: t('second', 1, 5),
    first: t('first', 0, 50),
    tieB: t('tieB', null, 20),
    tieA: t('tieA', null, 20),
  }
  assert.deepEqual(orderedPresentationTeams(teams).map((x) => x.id), ['first', 'second', 'tieA', 'tieB', 'late'])
})

void test('normalizePresenterOrder compacts gaps and appends unordered teams', () => {
  const teams = { a: t('a', 4, 0), b: t('b', null, 1), c: t('c', 9, 2) }
  normalizePresenterOrder(teams)
  assert.deepEqual([teams.a.presenterOrder, teams.c.presenterOrder, teams.b.presenterOrder], [0, 1, 2])
})

void test('isTeamPermutation requires every current team exactly once', () => {
  const teams = { a: {}, b: {} }
  assert.equal(isTeamPermutation(['b', 'a'], teams), true)
  assert.equal(isTeamPermutation(['a'], teams), false, 'missing team')
  assert.equal(isTeamPermutation(['a', 'a'], teams), false, 'duplicate')
  assert.equal(isTeamPermutation(['a', 'z'], teams), false, 'unknown team')
  assert.equal(isTeamPermutation('a,b', teams), false, 'not an array')
})

// ── Rounds ───────────────────────────────────────────────────────────────────

void test('unpresentedTeamIds only counts history from the given round and skips deleted teams', () => {
  const teams = { a: t('a', 0, 0), b: t('b', 1, 0), c: t('c', 2, 0) }
  const history = [
    { round: 1, teamId: 'a', presentedAt: 1 },
    { round: 2, teamId: 'b', presentedAt: 2 },
    { round: 2, teamId: 'gone', presentedAt: 3 },
  ]
  assert.deepEqual(unpresentedTeamIds(teams, history, 1), ['b', 'c'])
  assert.deepEqual(unpresentedTeamIds(teams, history, 2), ['a', 'c'])
  assert.deepEqual(unpresentedTeamIds(teams, history, 3), ['a', 'b', 'c'])
})

void test('adjacentTeamId walks the queue and stops at either end', () => {
  const ids = ['a', 'b', 'c']
  assert.equal(adjacentTeamId(ids, null, 'next'), 'a')
  assert.equal(adjacentTeamId(ids, null, 'previous'), 'c')
  assert.equal(adjacentTeamId(ids, 'a', 'next'), 'b')
  assert.equal(adjacentTeamId(ids, 'c', 'next'), null)
  assert.equal(adjacentTeamId(ids, 'a', 'previous'), null)
  assert.equal(adjacentTeamId(ids, 'missing', 'next'), 'a', 'unknown current behaves like no current')
  assert.equal(adjacentTeamId([], null, 'next'), null)
})
