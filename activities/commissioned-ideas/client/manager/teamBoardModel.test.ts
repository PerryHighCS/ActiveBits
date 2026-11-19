import test from 'node:test'
import assert from 'node:assert/strict'
import type { ManagerParticipant, ManagerTeam } from '../hooks/useCommissionedIdeasSession.js'
import {
  buildAssignBody,
  canMoveTo,
  focusCancelsMoveRequest,
  listMoveOptions,
  maxTeamSizeBlurAction,
  moveFocusReady,
  type MoveDestination,
  type MoveFocusRequest,
  type MoveOutcome,
} from './teamBoardModel.js'

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
const req = (outcome: MoveOutcome, from: MoveDestination = 'team:A'): MoveFocusRequest => ({ participantId: 'p', from, outcome })
const focusCases: { name: string; request: MoveFocusRequest | null; busy: boolean; snapshotRevision: number; expected: boolean }[] = [
  { name: 'no request', request: null, busy: false, snapshotRevision: 9, expected: false },
  { name: 'request for another participant', request: { ...req({ kind: 'refused' }), participantId: 'other' }, busy: false, snapshotRevision: 9, expected: false },
  { name: 'pending: never, even if the roster changed', request: req({ kind: 'pending' }), busy: false, snapshotRevision: 9, expected: false },
  { name: 'committed at r5, board still at r4', request: req({ kind: 'committed', revision: 5 }), busy: false, snapshotRevision: 4, expected: false },
  { name: 'committed at r5, board at r5', request: req({ kind: 'committed', revision: 5 }), busy: false, snapshotRevision: 5, expected: true },
  { name: 'committed at r5, a later move already at r7 (focus follows the student)', request: req({ kind: 'committed', revision: 5 }), busy: false, snapshotRevision: 7, expected: true },
  { name: 'committed but controls still busy', request: req({ kind: 'committed', revision: 5 }), busy: true, snapshotRevision: 5, expected: false },
  { name: 'refused: in place once controls re-enable', request: req({ kind: 'refused' }), busy: false, snapshotRevision: 1, expected: true },
  { name: 'refused but still busy', request: req({ kind: 'refused' }), busy: true, snapshotRevision: 1, expected: false },
  { name: 'unknown: in place, no roster change needed', request: req({ kind: 'unknown' }), busy: false, snapshotRevision: 1, expected: true },
  { name: 'unknown but still busy', request: req({ kind: 'unknown' }), busy: true, snapshotRevision: 1, expected: false },
]

for (const row of focusCases) {
  void test(`moveFocusReady: ${row.name}`, () => {
    assert.equal(moveFocusReady(row.request, { id: 'p' }, row.busy, row.snapshotRevision), row.expected)
  })
}

void test('focusCancelsMoveRequest: focus elsewhere cancels; the requested select does not', () => {
  assert.equal(focusCancelsMoveRequest(null, null), false)
  assert.equal(focusCancelsMoveRequest(req({ kind: 'pending' }), null), true, 'another control')
  assert.equal(focusCancelsMoveRequest(req({ kind: 'pending' }), 'someone-else'), true, 'another student’s select')
  assert.equal(focusCancelsMoveRequest(req({ kind: 'committed', revision: 2 }), 'p'), false, 'the moved student’s own select')
})

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
