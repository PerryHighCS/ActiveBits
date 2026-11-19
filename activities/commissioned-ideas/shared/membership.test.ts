import test from 'node:test'
import assert from 'node:assert/strict'
import { checkInstructorMove, parseAssignTarget, type InstructorMoveTarget } from './membership.js'
import type { CommissionedIdeasPhase } from './types.js'

const toTeam: InstructorMoveTarget = { kind: 'team', teamId: 't1' }
const toNew: InstructorMoveTarget = { kind: 'new-team' }
const toNone: InstructorMoveTarget = { kind: 'ungrouped' }

// Decision table: [phase, current team, rejected, target] → allowed, capacity enforced, late placement
const cases: {
  phase: CommissionedIdeasPhase
  from: string | null
  rejected: boolean
  target: InstructorMoveTarget
  ok: boolean
  enforceCapacity?: boolean
  late?: boolean
}[] = [
  // Registration: anything goes, capacity enforced.
  { phase: 'registration', from: null, rejected: false, target: toTeam, ok: true, enforceCapacity: true, late: false },
  { phase: 'registration', from: 't2', rejected: false, target: toTeam, ok: true, enforceCapacity: true, late: false },
  { phase: 'registration', from: 't2', rejected: false, target: toNew, ok: true, enforceCapacity: true, late: false },
  { phase: 'registration', from: 't2', rejected: false, target: toNone, ok: true, enforceCapacity: true, late: false },
  // Rejected students never go onto a team, in any phase; removing them is fine.
  { phase: 'registration', from: null, rejected: true, target: toTeam, ok: false },
  { phase: 'registration', from: null, rejected: true, target: toNew, ok: false },
  { phase: 'registration', from: 't2', rejected: true, target: toNone, ok: true, enforceCapacity: true, late: false },
  { phase: 'voting', from: null, rejected: true, target: toTeam, ok: false },
  // After registration: late placement only, without the capacity limit.
  { phase: 'presentation', from: null, rejected: false, target: toTeam, ok: true, enforceCapacity: false, late: true },
  { phase: 'voting', from: null, rejected: false, target: toTeam, ok: true, enforceCapacity: false, late: true },
  { phase: 'results', from: null, rejected: false, target: toTeam, ok: true, enforceCapacity: false, late: true },
  { phase: 'voting', from: 't2', rejected: false, target: toTeam, ok: false },
  { phase: 'voting', from: null, rejected: false, target: toNew, ok: false },
  { phase: 'presentation', from: 't2', rejected: false, target: toNone, ok: false },
  { phase: 'presentation', from: null, rejected: false, target: toNone, ok: false },
]

for (const row of cases) {
  const name = `${row.phase}: ${row.from ?? 'ungrouped'}${row.rejected ? ' (rejected)' : ''} → ${row.target.kind} = ${row.ok ? 'allowed' : 'refused'}`
  void test(`checkInstructorMove ${name}`, () => {
    const decision = checkInstructorMove({ phase: row.phase, participantTeamId: row.from, rejected: row.rejected, target: row.target })
    assert.equal(decision.ok, row.ok)
    if (decision.ok) {
      assert.equal(decision.enforceCapacity, row.enforceCapacity)
      assert.equal(decision.latePlacement, row.late)
    } else {
      assert.equal(decision.status, 409)
      assert.ok(decision.error.length > 0)
    }
  })
}

// ── assign-participant target parsing ────────────────────────────────────────
const targetCases: [string, Record<string, unknown>, ReturnType<typeof parseAssignTarget>['ok'], InstructorMoveTarget | null][] = [
  ['existing team id', { teamId: 'T1' }, true, { kind: 'team', teamId: 'T1' }],
  ['explicit null → ungrouped', { teamId: null }, true, { kind: 'ungrouped' }],
  ['newTeam: true', { newTeam: true }, true, { kind: 'new-team' }],
  ['newTeam: false with teamId', { newTeam: false, teamId: 'T1' }, true, { kind: 'team', teamId: 'T1' }],
  ['no target at all', {}, false, null],
  ['teamId undefined is not ungrouped', { teamId: undefined }, false, null],
  ['numeric teamId', { teamId: 42 }, false, null],
  ['empty teamId', { teamId: '' }, false, null],
  ['newTeam truthy non-boolean', { newTeam: 'yes' }, false, null],
  ['both teamId and newTeam', { newTeam: true, teamId: 'T1' }, false, null],
]

for (const [name, body, ok, target] of targetCases) {
  void test(`parseAssignTarget: ${name}`, () => {
    const parsed = parseAssignTarget(body)
    assert.equal(parsed.ok, ok)
    if (parsed.ok) assert.deepEqual(parsed.target, target)
  })
}
