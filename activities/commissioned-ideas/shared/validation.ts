import type { BallotAllocation, CommissionedIdeasSessionData } from './types.js'

export const BALLOT_AMOUNTS = [100, 300, 500] as const
export type BallotAmount = (typeof BALLOT_AMOUNTS)[number]

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

export function validateBallot(
  allocations: unknown,
  voterId: string,
  session: CommissionedIdeasSessionData,
  allowSelfVote = false,
): BallotValidationResult {
  if (!Array.isArray(allocations) || allocations.length !== 3) {
    return { valid: false, error: 'Ballot must contain exactly three allocations' }
  }

  const amounts = new Set<number>()
  const teamIds = new Set<string>()

  for (const alloc of allocations) {
    if (
      typeof alloc !== 'object' ||
      alloc === null ||
      !('teamId' in alloc) ||
      !('amount' in alloc)
    ) {
      return { valid: false, error: 'Invalid allocation entry' }
    }

    const { teamId, amount } = alloc as Record<string, unknown>

    if (typeof teamId !== 'string' || !session.teams[teamId]) {
      return { valid: false, error: `Unknown team: ${String(teamId)}` }
    }

    if (amount !== 100 && amount !== 300 && amount !== 500) {
      return { valid: false, error: `Invalid amount: ${String(amount)}` }
    }

    if (amounts.has(amount as number)) {
      return { valid: false, error: `Duplicate amount $${String(amount)}` }
    }

    if (teamIds.has(teamId as string)) {
      return { valid: false, error: 'All three teams must be distinct' }
    }

    amounts.add(amount as number)
    teamIds.add(teamId as string)
  }

  if (!amounts.has(100) || !amounts.has(300) || !amounts.has(500)) {
    return { valid: false, error: 'Ballot must include $100, $300, and $500' }
  }

  if (!allowSelfVote) {
    const voter = session.participantRoster[voterId]
    if (voter?.teamId && teamIds.has(voter.teamId)) {
      return { valid: false, error: 'Cannot vote for your own team' }
    }
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
