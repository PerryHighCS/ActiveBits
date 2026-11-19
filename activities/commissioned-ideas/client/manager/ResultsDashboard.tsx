import { useState } from 'react'
import {
  fundingRanks,
  nextPodiumStep,
  podiumPlaceCount,
  podiumStepActionLabel,
  revealedPodium,
} from '../../shared/podium.js'
import type { ManagerSnapshot } from '../hooks/useCommissionedIdeasSession.js'
import PodiumStage, { winnerHeadline } from '../PodiumStage.js'
import { teamLabelsById } from '../teamLabels.js'
import { useInstructorApi } from './useInstructorApi.js'

interface ResultsDashboardProps {
  sessionId: string
  instructorPasscode: string
  snapshot: ManagerSnapshot
}

/** A podium reveal the instructor started and the board has not yet confirmed. */
export type RevealRequest =
  | { kind: 'in-flight' }
  | { kind: 'awaiting-snapshot'; revision: number }
  | null

/** True while the reveal's own snapshot (at or after its committed revision) has not arrived. */
export function isRevealPending(reveal: RevealRequest, snapshotRevision: number): boolean {
  if (!reveal) return false
  return reveal.kind === 'in-flight' || snapshotRevision < reveal.revision
}

export default function ResultsDashboard({ sessionId, instructorPasscode, snapshot }: ResultsDashboardProps) {
  const { call, request, busy, error, clearError } = useInstructorApi(sessionId, instructorPasscode)
  const ranking = snapshot.results ?? []
  const labels = teamLabelsById(snapshot.teams)
  const step = snapshot.podiumRevealStep
  // A reveal stays pending until the board shows a snapshot at or after the reveal's
  // committed revision (the HTTP response can arrive before the snapshot, and a socket
  // reconnect delivers a fresh one). A changed step alone is not proof: a concurrent
  // reset can produce the same step. The request also names the step it was made from,
  // so the server refuses a click that no longer matches the podium.
  const [reveal, setReveal] = useState<RevealRequest>(null)
  const revealPending = isRevealPending(reveal, snapshot.revision)
  const placeCount = podiumPlaceCount(ranking)
  const next = nextPodiumStep(step, placeCount)
  const entries = revealedPodium(ranking, step)
  const winner = step === 'complete' ? entries.find((entry) => entry.place === 1) : undefined
  const ranks = fundingRanks(ranking)

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={clearError} aria-label="Dismiss error" className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
        </div>
      )}

      <section aria-labelledby="ci-results-title" className="rounded-xl border border-gray-200 bg-white p-6 space-y-6">
        <div className="text-center">
          <h2 id="ci-results-title" className="text-2xl font-bold text-gray-900">
            {winner ? winnerHeadline(winner, labels) : placeCount === 0 ? 'No funding was awarded' : 'And the funding goes to…'}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Based on {snapshot.ballotsReceived} ballot{snapshot.ballotsReceived === 1 ? '' : 's'}
          </p>
        </div>

        {placeCount > 0 && <PodiumStage entries={entries} placeCount={placeCount} labels={labels} />}

        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            disabled={busy || revealPending || next === null}
            aria-busy={revealPending}
            onClick={() => {
              setReveal({ kind: 'in-flight' })
              void request('podium-step', { action: 'next', toStep: next }).then((outcome) => {
                const revision = outcome.kind === 'ok' ? outcome.data.revision : undefined
                setReveal(typeof revision === 'number' ? { kind: 'awaiting-snapshot', revision } : null)
              })
            }}
            className="rounded-lg bg-amber-600 px-6 py-2.5 text-base font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
          >
            {podiumStepActionLabel(next)}
          </button>
          <button
            type="button"
            disabled={busy || revealPending || step === 'hidden'}
            onClick={() => { void call('podium-step', { action: 'reset' }) }}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            Reset reveal
          </button>
        </div>
      </section>

      <details className="rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-700">
          Full rankings <span className="font-normal text-gray-400">(spoilers — hide before projecting)</span>
        </summary>
        <div className="overflow-x-auto px-4 pb-4">
          <table className="w-full text-sm">
            <caption className="sr-only">All teams ranked by funding</caption>
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th scope="col" className="py-2 pr-2">#</th>
                <th scope="col" className="py-2 pr-2">Team</th>
                <th scope="col" className="py-2 pr-2 text-right">Total</th>
                <th scope="col" className="py-2 pr-2 text-right">$500s</th>
                <th scope="col" className="py-2 pr-2 text-right">$300s</th>
                <th scope="col" className="py-2 text-right">$100s</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((row) => (
                <tr key={row.teamId} className="border-b border-gray-100 last:border-0" data-testid="ci-ranking-row">
                  <td className="py-2 pr-2 font-mono text-gray-400">{ranks.get(row.teamId) ?? '–'}</td>
                  <th scope="row" className="py-2 pr-2 text-left font-medium text-gray-800">
                    {labels.get(row.teamId)}
                    {row.projectName && <span className="block text-xs font-normal italic text-gray-500">{row.projectName}</span>}
                  </th>
                  <td className="py-2 pr-2 text-right font-semibold">${row.totalDollars.toLocaleString()}</td>
                  <td className="py-2 pr-2 text-right">{row.fiveHundredCount}</td>
                  <td className="py-2 pr-2 text-right">{row.threeHundredCount}</td>
                  <td className="py-2 text-right">{row.oneHundredCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
