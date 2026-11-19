import { joinNames, type PodiumEntry, type PodiumPlace } from '../shared/podium.js'
import './PodiumStage.css'

interface PodiumStageProps {
  /** Revealed steps only. */
  entries: PodiumEntry[]
  /** How many podium steps exist (distinct funded totals, max 3). */
  placeCount: number
  labels: Map<string, string>
  /** Team to call out as "your team", if any. */
  highlightTeamId?: string | null
  size?: 'large' | 'compact'
}

const MEDALS: Record<PodiumPlace, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }
const PLACE_NAMES: Record<PodiumPlace, string> = { 1: '1st place', 2: '2nd place', 3: '3rd place' }
const PEDESTAL_HEIGHT: Record<PodiumPlace, string> = { 1: 'h-28', 2: 'h-20', 3: 'h-14' }
/** Classic podium layout: 2nd on the left, winner in the middle, 3rd on the right. */
const LAYOUT: PodiumPlace[] = [2, 1, 3]

export function entryNames(entry: PodiumEntry, labels: Map<string, string>): string[] {
  return entry.teams.map((team) => labels.get(team.teamId) ?? team.groupName ?? 'Team')
}

/** "🏆 A wins!" or "🏆 A and B tie for the win!" */
export function winnerHeadline(entry: PodiumEntry, labels: Map<string, string>): string {
  const names = entryNames(entry, labels)
  return names.length > 1 ? `🏆 ${joinNames(names)} tie for the win!` : `🏆 ${names[0]} wins!`
}

export default function PodiumStage({ entries, placeCount, labels, highlightTeamId = null, size = 'large' }: PodiumStageProps) {
  const byPlace = new Map(entries.map((entry) => [entry.place, entry]))
  const places = LAYOUT.filter((place) => place <= placeCount)
  const large = size === 'large'

  return (
    <section aria-label="Podium" aria-live="polite" className="w-full">
      <ol className="flex items-end justify-center gap-2 sm:gap-4">
        {places.map((place) => {
          const entry = byPlace.get(place)
          const names = entry ? entryNames(entry, labels) : []
          const tie = names.length > 1
          const mine = entry !== undefined && entry.teams.some((team) => team.teamId === highlightTeamId)
          return (
            <li
              key={place}
              data-testid={`ci-podium-place-${place}`}
              aria-label={entry
                ? `${PLACE_NAMES[place]}${tie ? ' (tie)' : ''}: ${joinNames(names)}, $${entry.totalDollars}`
                : `${PLACE_NAMES[place]}: not yet revealed`}
              className="flex min-w-0 flex-1 max-w-[12rem] flex-col items-center"
            >
              {entry ? (
                <div
                  key={entry.teams.map((team) => team.teamId).join('|')}
                  className={`${place === 1 ? 'ci-podium-winner border-amber-400 bg-amber-50' : 'ci-podium-reveal border-gray-200 bg-white'} ${
                    mine ? 'ring-2 ring-amber-500' : ''
                  } mb-2 w-full rounded-xl border p-3 text-center shadow-sm`}
                >
                  <div aria-hidden="true" className={large ? 'text-4xl' : 'text-2xl'}>{MEDALS[place]}</div>
                  {tie && <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Tie</p>}
                  <ul className={tie ? 'mt-1 space-y-2' : ''}>
                    {entry.teams.map((team, index) => (
                      <li key={team.teamId}>
                        <p className={`font-bold text-gray-900 break-words ${large && !tie ? 'text-xl' : 'text-base'}`} data-testid="ci-podium-team">
                          {names[index]}
                        </p>
                        {team.projectName && <p className="text-xs text-gray-600 italic break-words">{team.projectName}</p>}
                        {team.teamId === highlightTeamId && <p className="text-xs font-medium text-amber-700">Your team!</p>}
                      </li>
                    ))}
                  </ul>
                  <p className={`mt-1 font-semibold text-amber-700 ${large ? 'text-lg' : 'text-sm'}`}>
                    ${entry.totalDollars.toLocaleString()}{tie ? ' each' : ''}
                  </p>
                </div>
              ) : (
                <div aria-hidden="true" className="mb-2 w-full rounded-xl border-2 border-dashed border-gray-300 p-3 text-center text-3xl text-gray-300">
                  ?
                </div>
              )}
              <div
                aria-hidden="true"
                className={`ci-podium-pedestal ${PEDESTAL_HEIGHT[place]} w-full rounded-t-lg flex items-start justify-center pt-2 text-lg font-bold ${
                  place === 1 ? 'bg-amber-400 text-amber-900' : place === 2 ? 'bg-gray-300 text-gray-700' : 'bg-orange-300 text-orange-900'
                }`}
              >
                {place}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
