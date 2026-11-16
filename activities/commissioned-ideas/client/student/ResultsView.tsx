import type { PodiumEntry } from '../../shared/podium.js'
import type { PodiumRevealStep, StudentSafeTeam } from '../../shared/types.js'
import PodiumStage, { winnerHeadline } from '../PodiumStage.js'
import { teamLabelsById } from '../teamLabels.js'

interface ResultsViewProps {
  teams: Record<string, StudentSafeTeam>
  podium: PodiumEntry[]
  placeCount: number
  step: PodiumRevealStep
  myTeamId: string | null
}

const PLACE_TEXT: Record<number, string> = { 1: 'won', 2: 'placed 2nd', 3: 'placed 3rd' }
const TIE_TEXT: Record<number, string> = { 1: 'the win', 2: '2nd', 3: '3rd' }

export default function ResultsView({ teams, podium, placeCount, step, myTeamId }: ResultsViewProps) {
  const labels = teamLabelsById(teams)
  const mine = podium.find((entry) => entry.teams.some((team) => team.teamId === myTeamId))
  const winner = step === 'complete' ? podium.find((entry) => entry.place === 1) : undefined

  return (
    <div className="p-4 space-y-5">
      <div className="text-center" aria-live="polite">
        <h2 className="text-xl font-bold text-gray-900">
          {winner
            ? winnerHeadline(winner, labels)
            : placeCount === 0
              ? 'No funding was awarded'
              : podium.length === 0 ? '🥁 The results are in…' : 'And the funding goes to…'}
        </h2>
        {placeCount > 0 && podium.length === 0 && <p className="mt-1 text-sm text-gray-500">Watch the screen — your instructor is about to reveal the podium.</p>}
        {mine && (
          <p className="mt-1 text-sm font-semibold text-amber-700">
            Your team {mine.teams.length > 1 ? `tied for ${TIE_TEXT[mine.place]}` : PLACE_TEXT[mine.place]}!
          </p>
        )}
      </div>
      <PodiumStage
        entries={podium}
        placeCount={placeCount}
        labels={labels}
        highlightTeamId={myTeamId}
        size="compact"
      />
    </div>
  )
}
