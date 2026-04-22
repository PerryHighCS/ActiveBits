import type {
  CommissionedIdeasBallot,
  CommissionedIdeasTeam,
  TeamScore,
} from './types.js'

export function computeTeamScores(
  teams: Record<string, CommissionedIdeasTeam>,
  ballots: Record<string, CommissionedIdeasBallot>,
): TeamScore[] {
  const scoreMap = new Map<string, TeamScore>()

  for (const team of Object.values(teams)) {
    scoreMap.set(team.id, {
      teamId: team.id,
      groupName: team.groupName,
      projectName: team.projectName,
      totalDollars: 0,
      fiveHundredCount: 0,
      threeHundredCount: 0,
      oneHundredCount: 0,
      registeredAt: team.registeredAt,
    })
  }

  for (const ballot of Object.values(ballots)) {
    for (const allocation of ballot.allocations) {
      const score = scoreMap.get(allocation.teamId)
      if (!score) continue
      score.totalDollars += allocation.amount
      if (allocation.amount === 500) score.fiveHundredCount++
      else if (allocation.amount === 300) score.threeHundredCount++
      else if (allocation.amount === 100) score.oneHundredCount++
    }
  }

  const scores = Array.from(scoreMap.values())
  scores.sort((a, b) => {
    if (b.totalDollars !== a.totalDollars) return b.totalDollars - a.totalDollars
    if (b.fiveHundredCount !== a.fiveHundredCount) return b.fiveHundredCount - a.fiveHundredCount
    if (b.threeHundredCount !== a.threeHundredCount) return b.threeHundredCount - a.threeHundredCount
    return a.registeredAt - b.registeredAt
  })

  return scores
}

export function resolveLeadingProposal(
  proposals: { id: string; value: string; rejectedByInstructor: boolean }[],
  votes: Record<string, string>,
): string | null {
  const eligible = proposals.filter((p) => !p.rejectedByInstructor)
  if (eligible.length === 0) return null

  const tally = new Map<string, number>()
  for (const proposal of eligible) {
    tally.set(proposal.id, 0)
  }

  for (const proposalId of Object.values(votes)) {
    if (tally.has(proposalId)) {
      tally.set(proposalId, (tally.get(proposalId) ?? 0) + 1)
    }
  }

  let leader: { id: string; value: string } | null = null
  let leaderVotes = -1

  for (const proposal of eligible) {
    const count = tally.get(proposal.id) ?? 0
    if (count > leaderVotes || (count === leaderVotes && leader && proposal.id < leader.id)) {
      leader = proposal
      leaderVotes = count
    }
  }

  return leader?.value ?? null
}
