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
