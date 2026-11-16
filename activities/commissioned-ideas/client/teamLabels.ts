import type { ClientTeam } from './hooks/useCommissionedIdeasSession.js'

/** Teams in stable display order (oldest first). */
export function sortTeams<T extends Pick<ClientTeam, 'registeredAt' | 'id'>>(teams: Record<string, T>): T[] {
  return Object.values(teams).sort((a, b) => a.registeredAt - b.registeredAt || a.id.localeCompare(b.id))
}

/** Display label: the voted team name when one exists, otherwise `Team N` by position. */
export function teamLabel(team: Pick<ClientTeam, 'groupName'>, index: number): string {
  return team.groupName ?? `Team ${index + 1}`
}

/** Stable label per team id, so "Team N" means the same team in every view. */
export function teamLabelsById<T extends Pick<ClientTeam, 'registeredAt' | 'id' | 'groupName'>>(
  teams: Record<string, T>,
): Map<string, string> {
  return new Map(sortTeams(teams).map((team, index) => [team.id, teamLabel(team, index)]))
}
