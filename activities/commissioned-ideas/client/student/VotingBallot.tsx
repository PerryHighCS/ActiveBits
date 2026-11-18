import { useEffect, useState } from 'react'
import { orderedPresentationTeams } from '../../shared/presentation.js'
import type { BallotAllocation, CommissionedIdeasBallot, StudentSafeTeam } from '../../shared/types.js'
import { voterBallotStatus, type BallotAmount } from '../../shared/validation.js'
import { teamLabelsById } from '../teamLabels.js'
import { assignAward, draftFromBallot, draftToAllocations, type BallotDraft } from './ballotDraft.js'

interface VotingBallotProps {
  teams: Record<string, StudentSafeTeam>
  myTeamId: string | null
  myBallot: CommissionedIdeasBallot | null
  busy: boolean
  onSubmit: (allocations: BallotAllocation[]) => Promise<boolean>
}

export default function VotingBallot({ teams, myTeamId, myBallot, busy, onSubmit }: VotingBallotProps) {
  const labels = teamLabelsById(teams)
  const status = voterBallotStatus(myTeamId, teams)
  const eligibleIds = new Set(status.canVote ? status.eligibleTeamIds : [])
  const eligibleTeams = orderedPresentationTeams(teams).filter((team) => eligibleIds.has(team.id))
  const required = status.canVote ? status.requiredAmounts : []

  const [draft, setDraft] = useState<BallotDraft>(() => draftFromBallot(myBallot, required, [...eligibleIds]))
  const [editing, setEditing] = useState(myBallot === null)
  // Shown until the server's snapshot (myBallot) catches up, so the form never flashes back after submit.
  const [justSubmitted, setJustSubmitted] = useState<BallotAllocation[] | null>(null)
  const serverSubmittedAt = myBallot?.submittedAt ?? null
  useEffect(() => {
    setJustSubmitted(null)
  }, [serverSubmittedAt])
  // Persistent polite live region (rendered in both the form and submitted views) so the
  // submit result is announced even though the form is replaced and focus does not move.
  const [announcement, setAnnouncement] = useState('')
  const statusRegion = (
    <p role="status" aria-live="polite" data-testid="ci-ballot-status" className="sr-only">{announcement}</p>
  )

  if (!status.canVote) {
    return (
      <section aria-labelledby="ci-ballot-title" className="p-4">
        <div className="rounded-xl border border-gray-200 bg-white p-5" role="status">
          <h2 id="ci-ballot-title" className="text-lg font-semibold text-gray-800">Voting is open</h2>
          <p className="mt-1 text-sm text-gray-600">
            {status.reason === 'not-on-team'
              ? 'You’re not on a team yet. Your instructor will place you on a team, and then you can vote.'
              : 'Your team is the only team, so there is no one else to fund this time.'}
          </p>
        </div>
      </section>
    )
  }

  const allocations = draftToAllocations(draft, required)

  const submit = async () => {
    if (!allocations) return
    const wasUpdate = myBallot !== null
    if (await onSubmit(allocations)) {
      setAnnouncement(wasUpdate ? 'Ballot updated.' : 'Ballot submitted.')
      setJustSubmitted(allocations)
      setEditing(false)
    }
  }

  const shownAllocations = justSubmitted ?? myBallot?.allocations ?? null

  if (shownAllocations && !editing) {
    return (
      <>
      {statusRegion}
      <section aria-labelledby="ci-ballot-title" className="p-4">
        <div className="rounded-xl border border-green-300 bg-green-50 p-5 space-y-3">
          <h2 id="ci-ballot-title" className="text-lg font-semibold text-green-800">✓ Ballot submitted</h2>
          <ul className="space-y-1" aria-label="Your awards">
            {[...shownAllocations]
              .sort((a, b) => b.amount - a.amount)
              .map((allocation) => (
                <li key={allocation.amount} className="flex justify-between text-sm text-gray-800">
                  <span className="font-semibold">${allocation.amount}</span>
                  <span>{labels.get(allocation.teamId) ?? 'Unknown team'}</span>
                </li>
              ))}
          </ul>
          <p className="text-xs text-gray-600">You can change your ballot until your instructor closes voting.</p>
          <button
            type="button"
            onClick={() => {
              setDraft(draftFromBallot({ allocations: shownAllocations }, required, [...eligibleIds]))
              setAnnouncement('')
              setEditing(true)
            }}
            className="rounded-md border border-green-400 px-3 py-1 text-sm font-medium text-green-800 hover:bg-green-100"
          >
            Change my ballot
          </button>
        </div>
      </section>
      </>
    )
  }

  const reduced = required.length < 3

  return (
    <>
    {statusRegion}
    <section aria-labelledby="ci-ballot-title" className="p-4 space-y-4">
      <div>
        <h2 id="ci-ballot-title" className="text-lg font-semibold text-gray-800">Fund the best ideas</h2>
        <p className="text-sm text-gray-600 mt-1">
          {reduced
            ? `There ${eligibleTeams.length === 1 ? 'is' : 'are'} only ${eligibleTeams.length} other team${eligibleTeams.length === 1 ? '' : 's'}, so you have ${required.length} award${required.length === 1 ? '' : 's'} to give.`
            : 'Give each award to a different team.'}
          {myTeamId ? ' You can’t fund your own team.' : ''}
        </p>
      </div>

      {required.map((amount) => (
        <AwardFieldset
          key={amount}
          amount={amount}
          teams={eligibleTeams}
          labels={labels}
          draft={draft}
          disabled={busy}
          onSelect={(teamId) => setDraft((current) => assignAward(current, amount, teamId))}
        />
      ))}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !allocations}
          onClick={() => { void submit() }}
          className="flex-1 rounded-lg bg-amber-600 py-2.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {myBallot ? 'Update ballot' : 'Submit ballot'}
        </button>
        {myBallot && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(false)}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>
    </section>
    </>
  )
}

interface AwardFieldsetProps {
  amount: BallotAmount
  teams: StudentSafeTeam[]
  labels: Map<string, string>
  draft: BallotDraft
  disabled: boolean
  onSelect: (teamId: string) => void
}

function AwardFieldset({ amount, teams, labels, draft, disabled, onSelect }: AwardFieldsetProps) {
  const holderAmount = (teamId: string): BallotAmount | null => {
    for (const [key, holder] of Object.entries(draft)) {
      if (holder === teamId) return Number(key) as BallotAmount
    }
    return null
  }

  return (
    <fieldset disabled={disabled} className="rounded-xl border border-gray-200 bg-white p-4">
      <legend className="px-1 text-base font-bold text-amber-700">${amount} award</legend>
      <ul className="mt-1 space-y-1">
        {teams.map((team) => {
          const heldAmount = holderAmount(team.id)
          const heldElsewhere = heldAmount !== null && heldAmount !== amount
          return (
            <li key={team.id}>
              <label className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-amber-50 cursor-pointer">
                <input
                  type="radio"
                  name={`ci-award-${amount}`}
                  value={team.id}
                  checked={draft[amount] === team.id}
                  onChange={() => onSelect(team.id)}
                  className="accent-amber-600"
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-gray-800">{labels.get(team.id)}</span>
                  {team.projectName && <span className="block text-xs text-gray-500 italic truncate">{team.projectName}</span>}
                </span>
                {heldElsewhere && <span className="text-xs text-gray-400">has your ${heldAmount}</span>}
              </label>
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}
