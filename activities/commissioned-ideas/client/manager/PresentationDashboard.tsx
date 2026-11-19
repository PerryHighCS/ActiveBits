import {
  adjacentTeamId,
  orderedPresentationTeams,
  presentedTeamIds,
  unpresentedTeamIds,
} from '../../shared/presentation.js'
import type { ManagerParticipant, ManagerSnapshot, ManagerTeam } from '../hooks/useCommissionedIdeasSession.js'
import { useState } from 'react'
import { lockedUntilSnapshot } from '../requestOutcome.js'
import { teamLabelsById } from '../teamLabels.js'
import { useInstructorApi } from './useInstructorApi.js'

interface PresentationDashboardProps {
  sessionId: string
  instructorPasscode: string
  snapshot: ManagerSnapshot
}

function memberNames(team: ManagerTeam, roster: Record<string, ManagerParticipant>): string {
  return team.memberIds
    .map((id) => roster[id]?.name)
    .filter((name): name is string => Boolean(name))
    .join(', ')
}

export default function PresentationDashboard({ sessionId, instructorPasscode, snapshot }: PresentationDashboardProps) {
  const { call, request, busy, error, clearError } = useInstructorApi(sessionId, instructorPasscode)

  const ordered = orderedPresentationTeams(snapshot.teams)
  const orderedIds = ordered.map((team) => team.id)
  const labels = teamLabelsById(snapshot.teams)
  const round = snapshot.presentationRound
  const presented = presentedTeamIds(snapshot.teams, snapshot.presentationHistory, round)
  const remaining = unpresentedTeamIds(snapshot.teams, snapshot.presentationHistory, round)
  const currentId = snapshot.currentPresentationTeamId
  const current = currentId ? snapshot.teams[currentId] : undefined
  const previousId = adjacentTeamId(orderedIds, currentId, 'previous')
  const nextId = adjacentTeamId(orderedIds, currentId, 'next')

  const spotlight = (teamId: string | null) => { void call('presentation-active', { teamId }) }

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= orderedIds.length) return
    const next = [...orderedIds]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved!)
    void call('presentation-order', { teamIds: next })
  }

  // Round actions name the round shown; the buttons stay disabled until the snapshot
  // reflecting a committed round change arrives, so "Start round N" is never stale.
  const [awaitedRevision, setAwaitedRevision] = useState<number | null>(null)
  const roundBusy = lockedUntilSnapshot(busy, awaitedRevision, snapshot.revision)
  const changeRound = async (action: 'next' | 'reset') => {
    const outcome = await request('presentation-round', { action, round })
    if (outcome.kind === 'ok' && typeof outcome.data.revision === 'number') setAwaitedRevision(outcome.data.revision)
  }

  const resetRound = () => {
    if (window.confirm(`Clear who has presented in round ${round}?`)) {
      void changeRound('reset')
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={clearError} aria-label="Dismiss error" className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
        </div>
      )}

      <section
        aria-labelledby="ci-spotlight-title"
        className={`rounded-xl border p-6 text-center ${current ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white'}`}
      >
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Round {round} · {presented.size}/{orderedIds.length} presented
        </p>
        <h2 id="ci-spotlight-title" className="sr-only">Now presenting</h2>
        <div aria-live="polite">
          {current && currentId ? (
            <>
              <p className="mt-2 text-sm text-amber-700 font-medium">Now presenting</p>
              <p className="text-3xl font-bold text-gray-900" data-testid="ci-spotlight-team">{labels.get(currentId)}</p>
              {current.projectName && <p className="mt-1 text-lg text-gray-700 italic">{current.projectName}</p>}
              <p className="mt-2 text-sm text-gray-500">{memberNames(current, snapshot.participantRoster)}</p>
            </>
          ) : (
            <p className="mt-2 text-lg text-gray-500">No team on stage</p>
          )}
        </div>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            disabled={busy || previousId === null}
            onClick={() => spotlight(previousId)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            ← Previous
          </button>
          <button
            type="button"
            disabled={busy || remaining.length === 0}
            onClick={() => { void call('presentation-randomize', {}) }}
            className="rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
          >
            🎲 Random team ({remaining.length} left)
          </button>
          <button
            type="button"
            disabled={busy || nextId === null}
            onClick={() => spotlight(nextId)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            Next →
          </button>
          {current && (
            <button
              type="button"
              disabled={busy}
              onClick={() => spotlight(null)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-40"
            >
              Clear stage
            </button>
          )}
        </div>
      </section>

      <section aria-labelledby="ci-queue-title" className="bg-white rounded-xl border border-gray-200">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
          <h2 id="ci-queue-title" className="text-sm font-semibold text-gray-700">Presentation queue</h2>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={roundBusy || presented.size === 0}
              onClick={resetRound}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              Reset round
            </button>
            <button
              type="button"
              disabled={roundBusy}
              onClick={() => { void changeRound('next') }}
              className="rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-40"
            >
              Start round {round + 1}
            </button>
          </div>
        </div>
        <ol className="divide-y divide-gray-100">
          {ordered.map((team, index) => {
            const label = labels.get(team.id) ?? ''
            const isCurrent = team.id === currentId
            const done = presented.has(team.id)
            return (
              <li
                key={team.id}
                data-testid="ci-queue-item"
                data-team-label={label}
                aria-current={isCurrent ? 'true' : undefined}
                className={`flex items-center gap-3 px-4 py-2 ${isCurrent ? 'bg-amber-50' : ''}`}
              >
                <span className="w-6 text-right text-sm font-mono text-gray-400">{index + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {label}
                    {done && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">Presented</span>}
                  </p>
                  {team.projectName && <p className="text-xs text-gray-500 italic truncate">{team.projectName}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Move ${label} earlier`}
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                    className="rounded border border-gray-200 px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${label} later`}
                    disabled={busy || index === ordered.length - 1}
                    onClick={() => move(index, 1)}
                    className="rounded border border-gray-200 px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-pressed={isCurrent}
                    aria-label={`Spotlight ${label}`}
                    disabled={busy}
                    onClick={() => spotlight(isCurrent ? null : team.id)}
                    className={`ml-1 rounded-md px-2.5 py-1 text-xs font-medium ${
                      isCurrent ? 'bg-amber-600 text-white' : 'border border-amber-300 text-amber-700 hover:bg-amber-50'
                    } disabled:opacity-40`}
                  >
                    {isCurrent ? 'On stage' : 'Present'}
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}
