import { useId } from 'react'
import { PHASES, PHASE_LABELS, checkPhaseTransition } from '../../shared/presentation.js'
import type { CommissionedIdeasPhase } from '../../shared/types.js'
import type { ManagerSnapshot } from '../hooks/useCommissionedIdeasSession.js'
import { useInstructorApi } from './useInstructorApi.js'

interface PhaseControlsProps {
  sessionId: string
  instructorPasscode: string
  snapshot: ManagerSnapshot
}

export default function PhaseControls({ sessionId, instructorPasscode, snapshot }: PhaseControlsProps) {
  const { call, busy, error, clearError } = useInstructorApi(sessionId, instructorPasscode)
  const idPrefix = useId()
  const ctx = { teamCount: Object.keys(snapshot.teams).length, ballotCount: snapshot.ballotsReceived }

  const goTo = async (phase: CommissionedIdeasPhase) => {
    await call('phase', { phase })
  }

  return (
    <nav aria-label="Activity phase" className="bg-white rounded-xl border border-gray-200 p-3 space-y-2">
      <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {PHASES.map((phase, index) => {
          const isCurrent = phase === snapshot.phase
          const check = checkPhaseTransition(snapshot.phase, phase, ctx)
          const reasonId = `${idPrefix}-${phase}-reason`
          const blocked = !isCurrent && !check.ok
          return (
            <li key={phase}>
              <button
                type="button"
                aria-current={isCurrent ? 'step' : undefined}
                aria-describedby={blocked ? reasonId : undefined}
                disabled={isCurrent || blocked || busy}
                onClick={() => { void goTo(phase) }}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  isCurrent
                    ? 'border-amber-500 bg-amber-50 text-amber-900 font-semibold'
                    : blocked
                      ? 'border-gray-200 text-gray-400 cursor-not-allowed'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="block text-[11px] uppercase tracking-wide text-gray-400">Step {index + 1}</span>
                {PHASE_LABELS[phase]}
                {isCurrent && <span className="sr-only"> (current)</span>}
              </button>
              {blocked && !check.ok && (
                <span id={reasonId} className="sr-only">{check.reason}</span>
              )}
            </li>
          )
        })}
      </ol>
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={clearError} aria-label="Dismiss error" className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}
    </nav>
  )
}
