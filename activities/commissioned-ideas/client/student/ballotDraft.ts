import type { BallotAllocation, CommissionedIdeasBallot } from '../../shared/types.js'
import type { BallotAmount } from '../../shared/validation.js'

/** In-progress ballot: which team (if any) holds each award amount. */
export type BallotDraft = Partial<Record<BallotAmount, string>>

/**
 * Gives `amount` to `teamId`. A team can hold only one award, so if the team
 * already held a different amount, that amount becomes unassigned.
 */
export function assignAward(draft: BallotDraft, amount: BallotAmount, teamId: string): BallotDraft {
  const next: BallotDraft = {}
  for (const [key, holder] of Object.entries(draft) as [string, string | undefined][]) {
    const existingAmount = Number(key) as BallotAmount
    if (holder && holder !== teamId && existingAmount !== amount) next[existingAmount] = holder
  }
  next[amount] = teamId
  return next
}

/** Seeds a draft from a saved ballot, dropping entries no longer valid for this voter. */
export function draftFromBallot(
  ballot: Pick<CommissionedIdeasBallot, 'allocations'> | null,
  required: readonly BallotAmount[],
  eligibleTeamIds: readonly string[],
): BallotDraft {
  const draft: BallotDraft = {}
  if (!ballot) return draft
  const eligible = new Set(eligibleTeamIds)
  for (const allocation of ballot.allocations) {
    if (required.includes(allocation.amount) && eligible.has(allocation.teamId)) {
      draft[allocation.amount] = allocation.teamId
    }
  }
  return draft
}

/** Allocations to submit, or null while any required award is unassigned. */
export function draftToAllocations(draft: BallotDraft, required: readonly BallotAmount[]): BallotAllocation[] | null {
  const allocations: BallotAllocation[] = []
  for (const amount of required) {
    const teamId = draft[amount]
    if (!teamId) return null
    allocations.push({ teamId, amount })
  }
  return allocations
}
