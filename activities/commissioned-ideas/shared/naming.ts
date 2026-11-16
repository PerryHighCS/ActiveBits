import type { CommissionedIdeasTeam, NameProposal } from './types.js'

export type ProposalKind = 'group' | 'project'

export const MAX_PROPOSALS_PER_KIND = 20
export const MAX_PROPOSAL_LENGTH = 60

type ProposalLike = Pick<NameProposal, 'id' | 'value' | 'rejectedByInstructor'> & { createdAt?: number }

/**
 * Returns the value of the leading non-rejected proposal.
 *
 * Only votes whose voter is in `eligibleVoterIds` (when provided) and whose
 * target is a non-rejected proposal count. Ties break by earlier `createdAt`,
 * then by earlier position in `proposals` (proposals are append-only, so array
 * order is creation order). No eligible proposal → `null`.
 */
export function resolveLeadingProposal(
  proposals: ProposalLike[],
  votes: Record<string, string>,
  eligibleVoterIds?: ReadonlySet<string>,
): string | null {
  const eligible = proposals.filter((p) => !p.rejectedByInstructor)
  if (eligible.length === 0) return null

  const tally = countVotes(eligible, votes, eligibleVoterIds)

  let leader: ProposalLike | null = null
  let leaderVotes = -1
  for (const proposal of eligible) {
    const count = tally.get(proposal.id) ?? 0
    if (count > leaderVotes || (count === leaderVotes && leader && breaksTieBefore(proposal, leader))) {
      leader = proposal
      leaderVotes = count
    }
  }

  return leader?.value ?? null
}

/** Candidates are visited in array order, so equal timestamps keep the earlier-listed incumbent. */
function breaksTieBefore(candidate: ProposalLike, incumbent: ProposalLike): boolean {
  return (candidate.createdAt ?? 0) < (incumbent.createdAt ?? 0)
}

/** Vote counts per non-rejected proposal id, restricted to eligible voters when given. */
export function countVotes(
  proposals: ProposalLike[],
  votes: Record<string, string>,
  eligibleVoterIds?: ReadonlySet<string>,
): Map<string, number> {
  const tally = new Map<string, number>()
  for (const proposal of proposals) {
    if (!proposal.rejectedByInstructor) tally.set(proposal.id, 0)
  }
  for (const [voterId, proposalId] of Object.entries(votes)) {
    if (eligibleVoterIds && !eligibleVoterIds.has(voterId)) continue
    const current = tally.get(proposalId)
    if (current !== undefined) tally.set(proposalId, current + 1)
  }
  return tally
}

/**
 * Single source of truth for a team's displayed group and project names.
 * Counts only votes from current team members.
 */
export function resolveTeamNames(
  team: Pick<
    CommissionedIdeasTeam,
    'memberIds' | 'proposedGroupNames' | 'proposedProjectNames' | 'groupNameVotes' | 'projectNameVotes'
  >,
): { groupName: string | null; projectName: string | null } {
  const members = new Set(team.memberIds)
  return {
    groupName: resolveLeadingProposal(team.proposedGroupNames, team.groupNameVotes, members),
    projectName: resolveLeadingProposal(team.proposedProjectNames, team.projectNameVotes, members),
  }
}

export function proposalsForKind(team: CommissionedIdeasTeam, kind: ProposalKind): NameProposal[] {
  return kind === 'group' ? team.proposedGroupNames : team.proposedProjectNames
}

export function votesForKind(team: CommissionedIdeasTeam, kind: ProposalKind): Record<string, string> {
  return kind === 'group' ? team.groupNameVotes : team.projectNameVotes
}

export function normalizeProposalKind(value: unknown): ProposalKind | null {
  return value === 'group' || value === 'project' ? value : null
}

/** Case- and whitespace-insensitive key used to detect duplicate proposals. */
export function proposalMatchKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}
