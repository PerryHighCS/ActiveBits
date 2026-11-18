import type { ManagerParticipant, ManagerTeam } from '../hooks/useCommissionedIdeasSession.js'
import { sortTeams, teamLabel } from '../teamLabels.js'

/**
 * Where the instructor can put a student. Encoded as a string so the same value
 * works for a native <select> and for a drag/drop target.
 *   `team:<id>` | `ungrouped` | `new`
 */
export type MoveDestination = `team:${string}` | 'ungrouped' | 'new'

export interface MoveOption {
  value: MoveDestination
  label: string
  disabled: boolean
}

export function countActiveMembers(
  team: Pick<ManagerTeam, 'memberIds'>,
  roster: Record<string, ManagerParticipant>,
): number {
  return team.memberIds.filter((id) => {
    const p = roster[id]
    return p !== undefined && !p.rejectedByInstructor
  }).length
}

export function currentDestination(participant: Pick<ManagerParticipant, 'teamId'>): MoveDestination {
  return participant.teamId ? `team:${participant.teamId}` : 'ungrouped'
}

/**
 * Returns whether dropping `participant` on `destination` is a real, allowed move.
 * Mirrors the server rules: no-op moves and full teams are refused, rejected
 * participants can only be ungrouped.
 */
export function canMoveTo(
  participant: ManagerParticipant,
  destination: MoveDestination,
  teams: Record<string, ManagerTeam>,
  roster: Record<string, ManagerParticipant>,
  maxTeamSize: number,
): boolean {
  if (destination === currentDestination(participant)) return false
  if (destination === 'ungrouped') return true
  if (participant.rejectedByInstructor) return false
  if (destination === 'new') return true
  const team = teams[destination.slice('team:'.length)]
  if (!team) return false
  return countActiveMembers(team, roster) < maxTeamSize
}

/** Options for the keyboard-accessible "Move to" select, in board order. */
export function listMoveOptions(
  participant: ManagerParticipant,
  teams: Record<string, ManagerTeam>,
  roster: Record<string, ManagerParticipant>,
  maxTeamSize: number,
): MoveOption[] {
  const options: MoveOption[] = sortTeams(teams).map((team, index) => {
    const value: MoveDestination = `team:${team.id}`
    const full = countActiveMembers(team, roster) >= maxTeamSize && participant.teamId !== team.id
    return {
      value,
      label: `${teamLabel(team, index)}${full ? ' (full)' : ''}`,
      disabled: value !== currentDestination(participant) && !canMoveTo(participant, value, teams, roster, maxTeamSize),
    }
  })
  options.push(
    { value: 'new', label: 'New team', disabled: !canMoveTo(participant, 'new', teams, roster, maxTeamSize) },
    { value: 'ungrouped', label: 'Ungrouped', disabled: false },
  )
  return options
}

/** Request body for POST assign-participant. */
export function buildAssignBody(participantId: string, destination: MoveDestination): Record<string, unknown> {
  if (destination === 'new') return { participantId, newTeam: true }
  if (destination === 'ungrouped') return { participantId, teamId: null }
  return { participantId, teamId: destination.slice('team:'.length) }
}

/**
 * A keyboard ("Move to" select) move whose focus must be restored. The chip is
 * re-created under its destination list, so the focused select is lost on success.
 */
export interface MoveFocusRequest {
  participantId: string
  /** Where the participant was when the move was requested. */
  from: MoveDestination
  /** The request failed; focus the participant's select where it still is. */
  failed: boolean
}

/**
 * True when the chip for `participant` should take focus for `request` now:
 * the request is for this participant, controls are enabled again, and either the
 * server snapshot shows the participant moved or the request failed. Waiting for the
 * snapshot (not just the HTTP response) avoids focusing a chip that is about to unmount.
 */
export function moveFocusReady(
  request: MoveFocusRequest | null,
  participant: Pick<ManagerParticipant, 'id' | 'teamId'>,
  busy: boolean,
): boolean {
  if (!request || request.participantId !== participant.id || busy) return false
  return request.failed || currentDestination(participant) !== request.from
}

export type MaxTeamSizeBlurAction = { kind: 'submit'; value: number } | { kind: 'restore' }

/**
 * What leaving the max-team-size field does. Only an edited, valid (integer ≥ 2),
 * changed value is written; anything else restores the server value. Tabbing through
 * an unedited field must not write, or it could undo another instructor's change
 * this tab has not seen yet.
 */
export function maxTeamSizeBlurAction(input: string, edited: boolean, serverMax: number): MaxTeamSizeBlurAction {
  if (!edited) return { kind: 'restore' }
  const trimmed = input.trim()
  const value = trimmed === '' ? Number.NaN : Number(trimmed)
  if (!Number.isInteger(value) || value < 2 || value === serverMax) return { kind: 'restore' }
  return { kind: 'submit', value }
}
