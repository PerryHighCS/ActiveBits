import { useCallback, useRef, useState } from 'react'
import type { ManagerParticipant, ManagerSnapshot } from '../hooks/useCommissionedIdeasSession.js'
import { useRestoreFocusAfterRemoval } from '../useRestoreFocusAfterRemoval.js'
import { sortTeams, teamLabelsById } from '../teamLabels.js'
import { countActiveMembers } from './teamBoardModel.js'
import { useInstructorApi } from './useInstructorApi.js'

interface LateArrivalsPanelProps {
  sessionId: string
  instructorPasscode: string
  snapshot: ManagerSnapshot
}

const PLACE_SELECT_ATTR = 'data-late-arrival-select'

/**
 * Where focus goes after a late arrival's row is removed (placed or rejected): the
 * placement control of the student who was next to it (`preferredId`), else the first
 * one still waiting, else the "all placed" status that replaces the list.
 */
export function lateArrivalFocusTarget(
  list: ParentNode | null,
  preferredId: string | null,
  allPlaced: HTMLElement | null,
): HTMLElement | null {
  const selects = list ? [...list.querySelectorAll<HTMLElement>(`[${PLACE_SELECT_ATTR}]`)] : []
  return selects.find((el) => el.getAttribute(PLACE_SELECT_ATTR) === preferredId) ?? selects[0] ?? allPlaced
}

/**
 * After registration, students without a team (late arrivals) are listed here so
 * the instructor can place them on an existing team — they cannot vote until then.
 */
export default function LateArrivalsPanel({ sessionId, instructorPasscode, snapshot }: LateArrivalsPanelProps) {
  const { request, busy, error, clearError } = useInstructorApi(sessionId, instructorPasscode)

  const waiting: ManagerParticipant[] = Object.values(snapshot.participantRoster)
    .filter((p) => !p.rejectedByInstructor && p.teamId === null)
    .sort((a, b) => a.lastSeen - b.lastSeen || a.name.localeCompare(b.name))

  // Once arrivals were listed, an empty list shows "all placed" instead of vanishing,
  // so keyboard focus has a stable place to land after the last placement.
  const [hadArrivals, setHadArrivals] = useState(false)
  if (waiting.length > 0 && !hadArrivals) setHadArrivals(true)

  const listRef = useRef<HTMLUListElement>(null)
  const allPlacedRef = useRef<HTMLParagraphElement>(null)
  const nextIdRef = useRef<string | null>(null)
  const focusRestore = useRestoreFocusAfterRemoval(useCallback(
    () => lateArrivalFocusTarget(listRef.current, nextIdRef.current, allPlacedRef.current),
    [],
  ))

  const act = async (control: HTMLElement, index: number, path: string, body: Record<string, unknown>) => {
    nextIdRef.current = waiting[index + 1]?.id ?? waiting[index - 1]?.id ?? null
    focusRestore.begin(control)
    const outcome = await request(path, body)
    focusRestore.settle(outcome.kind === 'ok' ? 'committed' : outcome.kind)
  }

  if (waiting.length === 0) {
    if (!hadArrivals) return null
    return (
      <p
        ref={allPlacedRef}
        tabIndex={-1}
        role="status"
        data-testid="ci-late-arrivals-done"
        className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900"
      >
        All late arrivals are placed.
      </p>
    )
  }

  const teams = sortTeams(snapshot.teams)
  const labels = teamLabelsById(snapshot.teams)

  return (
    <section
      aria-labelledby="ci-late-title"
      aria-live="polite"
      className="rounded-xl border-2 border-indigo-300 bg-indigo-50 p-4 space-y-3"
    >
      <div>
        <h2 id="ci-late-title" className="text-sm font-semibold text-indigo-900">
          Late arrivals ({waiting.length})
        </h2>
        <p className="text-xs text-indigo-800 mt-0.5">
          {snapshot.phase === 'voting'
            ? 'These students can’t vote until you place them on a team.'
            : 'These students joined after teams were formed. Place them on a team so they can vote.'}
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={clearError} aria-label="Dismiss error" className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      <ul ref={listRef} className="space-y-1.5">
        {waiting.map((participant, index) => (
          <li
            key={participant.id}
            data-testid="ci-late-arrival"
            className="flex flex-wrap items-center gap-2 rounded-lg bg-white border border-indigo-200 px-3 py-2"
          >
            <span
              role="img"
              aria-label={participant.connected ? 'Online' : 'Offline'}
              className={`h-2 w-2 rounded-full shrink-0 ${participant.connected ? 'bg-green-500' : 'bg-gray-300'}`}
            />
            <span className="flex-1 min-w-0 text-sm font-medium text-gray-800 truncate">{participant.name}</span>
            <select
              aria-label={`Place ${participant.name} on a team`}
              {...{ [PLACE_SELECT_ATTR]: participant.id }}
              value=""
              disabled={busy || teams.length === 0}
              onChange={(event) => {
                if (event.target.value) {
                  void act(event.currentTarget, index, 'assign-participant', { participantId: participant.id, teamId: event.target.value })
                }
              }}
              className="text-sm border border-gray-300 rounded-md px-2 py-1 disabled:opacity-50"
            >
              <option value="" disabled>Place on team…</option>
              {teams.map((team) => {
                const size = countActiveMembers(team, snapshot.participantRoster)
                return (
                  <option key={team.id} value={team.id}>
                    {labels.get(team.id)} ({size}/{snapshot.maxTeamSize}{size >= snapshot.maxTeamSize ? ', over limit' : ''})
                  </option>
                )
              })}
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={(event) => { void act(event.currentTarget, index, 'participant-name', { participantId: participant.id, rejected: true }) }}
              aria-label={`Reject ${participant.name}`}
              className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Reject
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
