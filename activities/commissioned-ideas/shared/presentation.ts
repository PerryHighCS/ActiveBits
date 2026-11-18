import { ownEntry } from './records.js'
import type {
  CommissionedIdeasPhase,
  CommissionedIdeasTeam,
  PresentationHistoryEntry,
} from './types.js'

export const PHASES: readonly CommissionedIdeasPhase[] = ['registration', 'presentation', 'voting', 'results']

export const PHASE_LABELS: Record<CommissionedIdeasPhase, string> = {
  registration: 'Registration',
  presentation: 'Presentations',
  voting: 'Voting',
  results: 'Results',
}

export function normalizePhaseValue(value: unknown): CommissionedIdeasPhase | null {
  return PHASES.includes(value as CommissionedIdeasPhase) ? (value as CommissionedIdeasPhase) : null
}

export interface PhaseTransitionContext {
  teamCount: number
  ballotCount: number
}

export type PhaseTransitionResult = { ok: true } | { ok: false; reason: string }

/**
 * Single source of truth for which phase changes are allowed.
 * See the "Phase and presentation contract" in the activity plan.
 */
export function checkPhaseTransition(
  from: CommissionedIdeasPhase,
  to: CommissionedIdeasPhase,
  ctx: PhaseTransitionContext,
): PhaseTransitionResult {
  if (from === to) return { ok: false, reason: 'Already in that phase' }

  switch (to) {
    case 'registration':
      if (from !== 'presentation') return { ok: false, reason: 'Registration can only be reopened from presentations' }
      if (ctx.ballotCount > 0) return { ok: false, reason: 'Ballots have been submitted' }
      return { ok: true }
    case 'presentation':
      if (ctx.teamCount < 1) return { ok: false, reason: 'Form at least one team first' }
      return { ok: true }
    case 'voting':
      if (from === 'registration') return { ok: false, reason: 'Run presentations before voting' }
      if (ctx.teamCount < 1) return { ok: false, reason: 'There are no teams to vote for' }
      return { ok: true }
    case 'results':
      if (from !== 'voting') return { ok: false, reason: 'Results follow voting' }
      return { ok: true }
  }
}

type OrderableTeam = Pick<CommissionedIdeasTeam, 'id' | 'presenterOrder' | 'registeredAt'>

/** Teams in presentation order: explicit order first, then unordered teams by registration time, then id. */
export function orderedPresentationTeams<T extends OrderableTeam>(teams: Record<string, T>): T[] {
  return Object.values(teams).sort((a, b) => {
    const ao = a.presenterOrder ?? Number.POSITIVE_INFINITY
    const bo = b.presenterOrder ?? Number.POSITIVE_INFINITY
    if (ao !== bo) return ao - bo
    if (a.registeredAt !== b.registeredAt) return a.registeredAt - b.registeredAt
    return a.id.localeCompare(b.id)
  })
}

/** Rewrites presenterOrder so existing teams hold exactly 0..n-1 in their current relative order. */
export function normalizePresenterOrder(teams: Record<string, OrderableTeam>): void {
  orderedPresentationTeams(teams).forEach((team, index) => {
    team.presenterOrder = index
  })
}

/** True when `teamIds` is exactly a permutation of the current team ids. */
export function isTeamPermutation(teamIds: unknown, teams: Record<string, unknown>): teamIds is string[] {
  if (!Array.isArray(teamIds)) return false
  const existing = Object.keys(teams)
  if (teamIds.length !== existing.length) return false
  const seen = new Set<string>()
  for (const id of teamIds) {
    if (typeof id !== 'string' || ownEntry(teams, id) === undefined || seen.has(id)) return false
    seen.add(id)
  }
  return true
}

export function presentedTeamIds(history: PresentationHistoryEntry[], round: number): Set<string> {
  return new Set(history.filter((entry) => entry.round === round).map((entry) => entry.teamId))
}

/** Existing teams (in presentation order) that have not presented in `round`. */
export function unpresentedTeamIds(
  teams: Record<string, OrderableTeam>,
  history: PresentationHistoryEntry[],
  round: number,
): string[] {
  const presented = presentedTeamIds(history, round)
  return orderedPresentationTeams(teams)
    .map((team) => team.id)
    .filter((id) => !presented.has(id))
}

/**
 * The team before/after `currentId` in `orderedIds`. With no current team,
 * `next` starts at the first team and `previous` at the last. Returns null past either end.
 */
export function adjacentTeamId(
  orderedIds: string[],
  currentId: string | null,
  direction: 'next' | 'previous',
): string | null {
  if (orderedIds.length === 0) return null
  const index = currentId ? orderedIds.indexOf(currentId) : -1
  if (index === -1) return direction === 'next' ? orderedIds[0]! : orderedIds[orderedIds.length - 1]!
  const target = direction === 'next' ? index + 1 : index - 1
  return orderedIds[target] ?? null
}
