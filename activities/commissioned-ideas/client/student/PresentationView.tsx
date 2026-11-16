import { orderedPresentationTeams, presentedTeamIds } from '../../shared/presentation.js'
import type { PresentationHistoryEntry, StudentSafeParticipant, StudentSafeTeam } from '../../shared/types.js'
import { teamLabelsById } from '../teamLabels.js'

interface PresentationViewProps {
  teams: Record<string, StudentSafeTeam>
  participants: Record<string, StudentSafeParticipant>
  currentTeamId: string | null
  round: number
  history: PresentationHistoryEntry[]
  myTeamId: string | null
}

export default function PresentationView({ teams, participants, currentTeamId, round, history, myTeamId }: PresentationViewProps) {
  const ordered = orderedPresentationTeams(teams)
  const labels = teamLabelsById(teams)
  const presented = presentedTeamIds(history, round)
  const current = currentTeamId ? teams[currentTeamId] : undefined
  const names = (team: StudentSafeTeam) =>
    team.memberIds.map((id) => participants[id]?.name).filter(Boolean).join(', ')

  return (
    <div className="p-4 space-y-4">
      <section
        aria-labelledby="ci-student-stage-title"
        aria-live="polite"
        className={`rounded-xl border p-5 text-center ${current ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white'}`}
      >
        <h2 id="ci-student-stage-title" className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Presentations · Round {round}
        </h2>
        {current && currentTeamId ? (
          <>
            <p className="mt-2 text-sm font-medium text-amber-700">
              {currentTeamId === myTeamId ? "You're on stage!" : 'Now presenting'}
            </p>
            <p className="text-2xl font-bold text-gray-900" data-testid="ci-student-spotlight">{labels.get(currentTeamId)}</p>
            {current.projectName && <p className="mt-1 text-gray-700 italic">{current.projectName}</p>}
            <p className="mt-1 text-sm text-gray-500">{names(current)}</p>
          </>
        ) : (
          <p className="mt-2 text-gray-500">Waiting for the next team…</p>
        )}
      </section>

      <section aria-labelledby="ci-student-queue-title">
        <h2 id="ci-student-queue-title" className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">Running order</h2>
        <ol className="space-y-1">
          {ordered.map((team, index) => {
            const isCurrent = team.id === currentTeamId
            return (
              <li
                key={team.id}
                aria-current={isCurrent ? 'true' : undefined}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                  isCurrent ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white'
                }`}
              >
                <span className="w-5 text-right text-sm font-mono text-gray-400">{index + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {labels.get(team.id)}
                    {team.id === myTeamId && <span className="ml-1 text-xs text-amber-600">(your team)</span>}
                  </p>
                  {team.projectName && <p className="text-xs text-gray-500 italic truncate">{team.projectName}</p>}
                </div>
                {presented.has(team.id) && !isCurrent && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">Presented</span>
                )}
                {isCurrent && <span className="text-xs font-semibold text-amber-700">On stage</span>}
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}
