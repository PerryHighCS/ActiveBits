import test from 'node:test'
import assert from 'node:assert/strict'
import type { ManagerParticipant, ManagerTeam } from '../hooks/useCommissionedIdeasSession.js'
import { buildAssignBody, canMoveTo, listMoveOptions, maxTeamSizeBlurAction, moveFocusReady, type MoveDestination } from './teamBoardModel.js'

function participant(id: string, teamId: string | null, rejected = false): ManagerParticipant {
  return { id, name: id, teamId, connected: true, lastSeen: 0, rejectedByInstructor: rejected }
}

function team(id: string, memberIds: string[], registeredAt = 0, groupName: string | null = null): ManagerTeam {
  return {
    id,
    groupName,
    projectName: null,
    registeredAt,
    presenterOrder: null,
    locked: false,
    memberIds,
    proposedGroupNames: [],
    proposedProjectNames: [],
    groupNameVotes: {},
    projectNameVotes: {},
  }
}

const roster: Record<string, ManagerParticipant> = {
  a1: participant('a1', 'A'),
  a2: participant('a2', 'A'),
  b1: participant('b1', 'B'),
  loose: participant('loose', null),
  banned: participant('banned', null, true),
  ghostMember: participant('ghostMember', 'B', true),
}
const teams: Record<string, ManagerTeam> = {
  A: team('A', ['a1', 'a2'], 1, 'Owls'),
  B: team('B', ['b1', 'ghostMember'], 2),
}
const MAX = 2

const cases: { name: string; who: string; to: MoveDestination; expected: boolean }[] = [
  { name: 'ungrouped → team with space', who: 'loose', to: 'team:B', expected: true },
  { name: 'ungrouped → full team', who: 'loose', to: 'team:A', expected: false },
  { name: 'team → other team with space', who: 'a1', to: 'team:B', expected: true },
  { name: 'team → same team is a no-op', who: 'a1', to: 'team:A', expected: false },
  { name: 'team → ungrouped', who: 'a1', to: 'ungrouped', expected: true },
  { name: 'ungrouped → ungrouped is a no-op', who: 'loose', to: 'ungrouped', expected: false },
  { name: 'anyone → new team', who: 'b1', to: 'new', expected: true },
  { name: 'rejected → team refused', who: 'banned', to: 'team:B', expected: false },
  { name: 'rejected → new team refused', who: 'banned', to: 'new', expected: false },
  { name: 'unknown team refused', who: 'loose', to: 'team:missing', expected: false },
  { name: 'rejected members do not count toward capacity', who: 'a1', to: 'team:B', expected: true },
]

for (const row of cases) {
  void test(`canMoveTo: ${row.name}`, () => {
    assert.equal(canMoveTo(roster[row.who]!, row.to, teams, roster, MAX), row.expected)
  })
}

void test('listMoveOptions orders teams by registration, labels full teams, keeps current selectable', () => {
  const options = listMoveOptions(roster['b1']!, teams, roster, MAX)
  assert.deepEqual(
    options.map((o) => [o.value, o.label, o.disabled]),
    [
      ['team:A', 'Owls (full)', true],
      ['team:B', 'Team 2', false],
      ['new', 'New team', false],
      ['ungrouped', 'Ungrouped', false],
    ],
  )
})

void test('buildAssignBody encodes each destination for the assign-participant route', () => {
  assert.deepEqual(buildAssignBody('p', 'team:X'), { participantId: 'p', teamId: 'X' })
  assert.deepEqual(buildAssignBody('p', 'new'), { participantId: 'p', newTeam: true })
  assert.deepEqual(buildAssignBody('p', 'ungrouped'), { participantId: 'p', teamId: null })
})

// ── Keyboard move focus restoration ──────────────────────────────────────────
const focusCases: {
  name: string
  request: Parameters<typeof moveFocusReady>[0]
  teamId: string | null
  busy: boolean
  expected: boolean
}[] = [
  { name: 'no request', request: null, teamId: 'B', busy: false, expected: false },
  { name: 'request for another participant', request: { participantId: 'other', from: 'team:A', failed: false }, teamId: 'B', busy: false, expected: false },
  { name: 'moved, still busy', request: { participantId: 'p', from: 'team:A', failed: false }, teamId: 'B', busy: true, expected: false },
  { name: 'HTTP done, snapshot not yet arrived', request: { participantId: 'p', from: 'team:A', failed: false }, teamId: 'A', busy: false, expected: false },
  { name: 'snapshot confirms team → team', request: { participantId: 'p', from: 'team:A', failed: false }, teamId: 'B', busy: false, expected: true },
  { name: 'snapshot confirms new team', request: { participantId: 'p', from: 'ungrouped', failed: false }, teamId: 'NEW', busy: false, expected: true },
  { name: 'snapshot confirms ungrouped', request: { participantId: 'p', from: 'team:A', failed: false }, teamId: null, busy: false, expected: true },
  { name: 'failed move refocuses in place', request: { participantId: 'p', from: 'team:A', failed: true }, teamId: 'A', busy: false, expected: true },
  { name: 'failed move waits for controls', request: { participantId: 'p', from: 'team:A', failed: true }, teamId: 'A', busy: true, expected: false },
]

for (const row of focusCases) {
  void test(`moveFocusReady: ${row.name}`, () => {
    assert.equal(moveFocusReady(row.request, { id: 'p', teamId: row.teamId }, row.busy), row.expected)
  })
}

// ── Max team size field ──────────────────────────────────────────────────────
const blurCases: { name: string; input: string; edited: boolean; expected: ReturnType<typeof maxTeamSizeBlurAction> }[] = [
  { name: 'unedited field never writes', input: '4', edited: false, expected: { kind: 'restore' } },
  { name: 'unedited stale value never writes', input: '7', edited: false, expected: { kind: 'restore' } },
  { name: 'edited, unchanged', input: '4', edited: true, expected: { kind: 'restore' } },
  { name: 'edited, valid change', input: '6', edited: true, expected: { kind: 'submit', value: 6 } },
  { name: 'edited, whitespace around valid', input: ' 5 ', edited: true, expected: { kind: 'submit', value: 5 } },
  { name: 'minimum boundary', input: '2', edited: true, expected: { kind: 'submit', value: 2 } },
  { name: 'below minimum', input: '1', edited: true, expected: { kind: 'restore' } },
  { name: 'fractional', input: '2.5', edited: true, expected: { kind: 'restore' } },
  { name: 'blank', input: '  ', edited: true, expected: { kind: 'restore' } },
  { name: 'not a number', input: 'abc', edited: true, expected: { kind: 'restore' } },
]

for (const row of blurCases) {
  void test(`maxTeamSizeBlurAction: ${row.name}`, () => {
    assert.deepEqual(maxTeamSizeBlurAction(row.input, row.edited, 4), row.expected)
  })
}
