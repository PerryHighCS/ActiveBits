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
