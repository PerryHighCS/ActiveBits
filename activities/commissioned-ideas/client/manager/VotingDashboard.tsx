import { voterBallotStatus } from '../../shared/validation.js'
import type { ManagerParticipant, ManagerSnapshot } from '../hooks/useCommissionedIdeasSession.js'
import { sortTeams, teamLabelsById } from '../teamLabels.js'

interface VotingDashboardProps {
  snapshot: ManagerSnapshot
}

interface VoterGroup {
  key: string
  label: string
  voters: ManagerParticipant[]
}

export default function VotingDashboard({ snapshot }: VotingDashboardProps) {
  const labels = teamLabelsById(snapshot.teams)
  const submitted = new Set(snapshot.ballotSubmitterIds)
  const active = Object.values(snapshot.participantRoster).filter((p) => !p.rejectedByInstructor)
  const statusOf = (p: ManagerParticipant) => voterBallotStatus(p.teamId, snapshot.teams)
  const voters = active.filter((p) => statusOf(p).canVote)
  const votedCount = voters.filter((p) => submitted.has(p.id)).length
  // Late arrivals are listed (with placement controls) in the Late arrivals panel instead.
  const waitingForTeam = active.filter((p) => p.teamId === null).length
  const cannotVote = active.filter((p) => {
    const status = statusOf(p)
    return !status.canVote && status.reason === 'no-eligible-teams'
  })

  const groups: VoterGroup[] = sortTeams(snapshot.teams).map((team) => ({
    key: team.id,
    label: labels.get(team.id) ?? '',
    voters: voters.filter((p) => p.teamId === team.id),
  }))

  const percent = voters.length === 0 ? 0 : Math.round((votedCount / voters.length) * 100)

  return (
    <div className="space-y-4">
      <section aria-labelledby="ci-vote-progress-title" className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 id="ci-vote-progress-title" className="text-sm font-semibold text-gray-700">Ballots</h2>
        <p className="mt-1 text-3xl font-bold text-gray-900" data-testid="ci-vote-count">
          {votedCount} <span className="text-lg font-medium text-gray-400">of {voters.length} voted</span>
        </p>
        <div
          role="progressbar"
          aria-label="Voting progress"
          aria-valuemin={0}
          aria-valuemax={voters.length}
          aria-valuenow={votedCount}
          className="mt-3 h-2 rounded-full bg-gray-100 overflow-hidden"
        >
          <div className="h-full bg-amber-500 transition-all" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Totals stay hidden until you move to Results. Students can change their ballots until then.
        </p>
        {waitingForTeam > 0 && (
          <p className="mt-1 text-xs font-medium text-indigo-700" data-testid="ci-waiting-for-team">
            {waitingForTeam} student{waitingForTeam === 1 ? ' is' : 's are'} waiting for a team and can’t vote yet — see Late arrivals.
          </p>
        )}
      </section>

      <section aria-labelledby="ci-voters-title" className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        <h2 id="ci-voters-title" className="px-4 py-3 text-sm font-semibold text-gray-700">Who has voted</h2>
        {groups.filter((group) => group.voters.length > 0).map((group) => (
          <div key={group.key} className="px-4 py-3">
            <h3 className="text-xs font-medium text-gray-500 mb-1.5">{group.label}</h3>
            <ul className="flex flex-wrap gap-1.5">
              {group.voters
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => {
                  const done = submitted.has(p.id)
                  return (
                    <li
                      key={p.id}
                      data-testid="ci-voter"
                      data-voted={done ? 'true' : 'false'}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${
                        done ? 'border-green-300 bg-green-50 text-green-800' : 'border-gray-200 text-gray-500'
                      }`}
                    >
                      {done ? '✓ ' : ''}{p.name}
                      <span className="sr-only">{done ? ' (voted)' : ' (not yet voted)'}</span>
                    </li>
                  )
                })}
            </ul>
          </div>
        ))}
        {cannotVote.length > 0 && (
          <p className="px-4 py-3 text-xs text-gray-500">
            {cannotVote.map((p) => p.name).join(', ')} {cannotVote.length === 1 ? 'has' : 'have'} no other team to vote for.
          </p>
        )}
      </section>
    </div>
  )
}
