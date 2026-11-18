import type { CommissionedIdeasPhase } from './types.js'

/** Where the instructor wants to put a student. */
export type InstructorMoveTarget =
  | { kind: 'team'; teamId: string }
  | { kind: 'new-team' }
  | { kind: 'ungrouped' }

export interface InstructorMoveInput {
  phase: CommissionedIdeasPhase
  participantTeamId: string | null
  rejected: boolean
  target: InstructorMoveTarget
}

export type InstructorMoveDecision =
  | { ok: true; enforceCapacity: boolean; latePlacement: boolean }
  | { ok: false; status: 409; error: string }

/**
 * Single owner of which instructor team moves are allowed (membership contract).
 *
 * - During registration: any move; capacity is enforced.
 * - After registration: only late placement — an ungrouped student onto an
 *   existing team. Capacity is not enforced (the size setting can no longer be
 *   edited). Anything else would invalidate ballots or the presentation queue.
 * - Rejected students can never be placed on a team.
 */
export function checkInstructorMove(input: InstructorMoveInput): InstructorMoveDecision {
  const { phase, participantTeamId, rejected, target } = input

  if (rejected && target.kind !== 'ungrouped') {
    return { ok: false, status: 409, error: 'Rejected participants cannot be placed on a team' }
  }

  if (phase === 'registration') {
    return { ok: true, enforceCapacity: true, latePlacement: false }
  }

  if (target.kind === 'team' && participantTeamId === null) {
    return { ok: true, enforceCapacity: false, latePlacement: true }
  }

  return {
    ok: false,
    status: 409,
    error: 'After registration you can only place students who are not on a team onto an existing team',
  }
}

export type ParsedAssignTarget =
  | { ok: true; target: InstructorMoveTarget }
  | { ok: false; error: string }

/**
 * Reads the `assign-participant` target from a request body. Exactly one explicit
 * target is accepted: `newTeam: true`, `teamId: '<id>'`, or `teamId: null` (ungrouped).
 * `newTeam: false` is allowed but selects nothing, so it still needs an explicit
 * `teamId` (`{ newTeam: false, teamId: 'T1' }` moves to T1). A missing or non-string
 * `teamId` is an error, never an implicit move to Ungrouped, which could otherwise
 * dissolve a student's team.
 */
export function parseAssignTarget(body: Record<string, unknown>): ParsedAssignTarget {
  const hasTeamId = Object.hasOwn(body, 'teamId')
  if (body.newTeam === true) {
    if (hasTeamId) return { ok: false, error: 'Send either teamId or newTeam, not both' }
    return { ok: true, target: { kind: 'new-team' } }
  }
  if (Object.hasOwn(body, 'newTeam') && body.newTeam !== false) {
    return { ok: false, error: 'newTeam must be a boolean; true creates a team, false needs a teamId' }
  }
  if (!hasTeamId) return { ok: false, error: 'teamId (string or null) or newTeam: true is required' }
  if (body.teamId === null) return { ok: true, target: { kind: 'ungrouped' } }
  if (typeof body.teamId === 'string' && body.teamId.length > 0) {
    return { ok: true, target: { kind: 'team', teamId: body.teamId } }
  }
  return { ok: false, error: 'teamId must be a team id or null' }
}
