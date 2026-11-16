import type { BallotAllocation, CommissionedIdeasSessionData } from './types.js'

export const BALLOT_AMOUNTS = [100, 300, 500] as const
export type BallotAmount = (typeof BALLOT_AMOUNTS)[number]

/** Award amounts from largest to smallest; smaller ballots keep the top amounts. */
export const BALLOT_AMOUNTS_DESC: readonly BallotAmount[] = [500, 300, 100]

export function sanitizeDisplayName(value: unknown, maxLength = 100): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed
}

export interface BallotValidationResult {
  valid: boolean
  error?: string
}

/**
 * Teams a voter may award money to: every existing team except their own
 * (unless self-voting is allowed). Ungrouped voters may vote for every team.
 */
export function ballotEligibleTeamIds(
  teams: Record<string, unknown>,
  voterTeamId: string | null,
  allowSelfVote = false,
): string[] {
  return Object.keys(teams).filter((id) => allowSelfVote || id !== voterTeamId)
}

/** The amounts a ballot must contain: the top `min(3, eligibleTeamCount)` amounts, largest first. */
export function requiredBallotAmounts(eligibleTeamCount: number): BallotAmount[] {
  const size = Math.max(0, Math.min(BALLOT_AMOUNTS_DESC.length, eligibleTeamCount))
  return BALLOT_AMOUNTS_DESC.slice(0, size)
}

function formatAmounts(amounts: readonly number[]): string {
  return amounts.map((a) => `$${a}`).join(', ')
}

export function validateBallot(
  allocations: unknown,
  voterId: string,
  session: CommissionedIdeasSessionData,
  allowSelfVote = false,
): BallotValidationResult {
  const voterTeamId = session.participantRoster[voterId]?.teamId ?? null
  const eligible = new Set(ballotEligibleTeamIds(session.teams, voterTeamId, allowSelfVote))
  const required = requiredBallotAmounts(eligible.size)

  if (required.length === 0) {
    return { valid: false, error: 'There are no other teams to vote for' }
  }

  if (!Array.isArray(allocations) || allocations.length !== required.length) {
    const plural = required.length === 1 ? '' : 's'
    return {
      valid: false,
      error: `Ballot must contain exactly ${required.length} award${plural}: ${formatAmounts(required)}`,
    }
  }

  const amounts = new Set<number>()
  const teamIds = new Set<string>()

  for (const alloc of allocations) {
    if (typeof alloc !== 'object' || alloc === null || !('teamId' in alloc) || !('amount' in alloc)) {
      return { valid: false, error: 'Invalid allocation entry' }
    }

    const { teamId, amount } = alloc as Record<string, unknown>

    if (typeof teamId !== 'string' || !session.teams[teamId]) {
      return { valid: false, error: `Unknown team: ${String(teamId)}` }
    }

    if (!eligible.has(teamId)) {
      return { valid: false, error: 'Cannot vote for your own team' }
    }

    if (!isValidBallotAmount(amount) || !required.includes(amount)) {
      return { valid: false, error: `Invalid amount: ${String(amount)}` }
    }

    if (amounts.has(amount)) {
      return { valid: false, error: `Duplicate amount $${amount}` }
    }

    if (teamIds.has(teamId)) {
      return { valid: false, error: 'Each award must go to a different team' }
    }

    amounts.add(amount)
    teamIds.add(teamId)
  }

  return { valid: true }
}

export function isValidBallotAmount(amount: unknown): amount is BallotAmount {
  return amount === 100 || amount === 300 || amount === 500
}

export function coerceAllocations(raw: unknown): BallotAllocation[] | null {
  if (!Array.isArray(raw)) return null
  const result: BallotAllocation[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null
    const { teamId, amount } = item as Record<string, unknown>
    if (typeof teamId !== 'string') return null
    if (!isValidBallotAmount(amount)) return null
    result.push({ teamId, amount })
  }
  return result
}
