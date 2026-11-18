import type { PodiumRevealStep, TeamScore } from './types.js'

export type PodiumPlace = 1 | 2 | 3

export interface PodiumTeam {
  teamId: string
  groupName: string | null
  projectName: string | null
}

/** One podium step. Every team on a step received the same total funding. */
export interface PodiumEntry {
  place: PodiumPlace
  totalDollars: number
  teams: PodiumTeam[]
}

const MAX_PLACES = 3

/**
 * Dense funding rank per team: equal totals share a rank (1, 1, 2, 3, …).
 * Teams with $0 get `null` — unfunded teams are never ranked onto the podium.
 * Single owner of the "same funding → same step" rule.
 */
export function fundingRanks(ranking: Pick<TeamScore, 'teamId' | 'totalDollars'>[]): Map<string, number | null> {
  const distinctTotals = [...new Set(ranking.map((r) => r.totalDollars).filter((total) => total > 0))].sort((a, b) => b - a)
  return new Map(ranking.map((r) => {
    const index = distinctTotals.indexOf(r.totalDollars)
    return [r.teamId, index === -1 ? null : index + 1]
  }))
}

/** Number of podium steps: distinct funded totals, capped at 3. */
export function podiumPlaceCount(ranking: Pick<TeamScore, 'teamId' | 'totalDollars'>[]): number {
  const funded = new Set(ranking.map((r) => r.totalDollars).filter((total) => total > 0))
  return Math.min(MAX_PLACES, funded.size)
}

/**
 * Reveal steps for a podium with `placeCount` places, skipping places that do
 * not exist. 3 places: hidden → third → second → winner → complete.
 */
export function podiumSequence(placeCount: number): PodiumRevealStep[] {
  const places = Math.max(0, Math.min(MAX_PLACES, placeCount))
  if (places === 0) return ['hidden']
  const steps: PodiumRevealStep[] = ['hidden']
  if (places >= 3) steps.push('third')
  if (places >= 2) steps.push('second')
  steps.push('winner', 'complete')
  return steps
}

/** The step after `current`, or null when the reveal is finished (or there is nothing to reveal). */
export function nextPodiumStep(current: PodiumRevealStep, placeCount: number): PodiumRevealStep | null {
  const steps = podiumSequence(placeCount)
  const index = steps.indexOf(current)
  if (index === -1) return steps[1] ?? null
  return steps[index + 1] ?? null
}

/** Places (1 = winner) visible at `step`, limited to places that exist. */
export function revealedPlaces(step: PodiumRevealStep, placeCount: number): PodiumPlace[] {
  const shown: PodiumPlace[] =
    step === 'third' ? [3]
      : step === 'second' ? [3, 2]
        : step === 'winner' || step === 'complete' ? [3, 2, 1]
          : []
  return shown.filter((place) => place <= Math.min(MAX_PLACES, placeCount))
}

/** Every podium step, with tied teams grouped. `ranking` must already be sorted best-first. */
export function buildPodium(ranking: TeamScore[]): PodiumEntry[] {
  const ranks = fundingRanks(ranking)
  const entries = new Map<number, PodiumEntry>()
  for (const score of ranking) {
    const rank = ranks.get(score.teamId)
    if (rank == null || rank > MAX_PLACES) continue
    const place = rank as PodiumPlace
    const entry = entries.get(place) ?? { place, totalDollars: score.totalDollars, teams: [] }
    entry.teams.push({ teamId: score.teamId, groupName: score.groupName, projectName: score.projectName })
    entries.set(place, entry)
  }
  return [...entries.values()].sort((a, b) => b.place - a.place)
}

/** Podium steps visible at `step` (3rd first). Unrevealed steps are omitted entirely. */
export function revealedPodium(ranking: TeamScore[], step: PodiumRevealStep): PodiumEntry[] {
  const visible = new Set(revealedPlaces(step, podiumPlaceCount(ranking)))
  return buildPodium(ranking).filter((entry) => visible.has(entry.place))
}

/** Button text for the instructor's next reveal action. */
export function podiumStepActionLabel(next: PodiumRevealStep | null): string {
  switch (next) {
    case 'third': return 'Reveal 3rd place'
    case 'second': return 'Reveal 2nd place'
    case 'winner': return 'Reveal the winner'
    case 'complete': return 'Show final podium'
    default: return 'Reveal complete'
  }
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Identity of the podium a reveal is showing: places, totals, and teams in order.
 * Names are excluded, so renaming a team does not count as a different podium.
 */
export function podiumRevealKey(ranking: TeamScore[]): string {
  return JSON.stringify(buildPodium(ranking).map((entry) => [entry.place, entry.totalDollars, entry.teams.map((team) => team.teamId)]))
}

export interface PodiumRevealState {
  podiumRevealStep: PodiumRevealStep
  /** `podiumRevealKey` of the ranking the current reveal started from; null while hidden. */
  podiumRevealKey: string | null
}

/**
 * Reveal invariant (owner of the rule): a revealed podium always shows the ranking it
 * was revealed for. If moderation changes the podium mid-reveal, the reveal returns to
 * `hidden` so a place never silently changes on screen. Changes that leave the podium
 * as it was (for example late placement of a student who has not voted) keep the reveal.
 * Mutates `state`; returns true when it reset the reveal.
 */
export function reconcilePodiumReveal(state: PodiumRevealState, ranking: TeamScore[]): boolean {
  if (state.podiumRevealStep === 'hidden') {
    state.podiumRevealKey = null
    return false
  }
  if (state.podiumRevealKey === podiumRevealKey(ranking)) return false
  state.podiumRevealStep = 'hidden'
  state.podiumRevealKey = null
  return true
}
