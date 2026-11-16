import { useEffect, useId, useState, type FormEvent } from 'react'
import { MAX_PROPOSAL_LENGTH, type ProposalKind } from '../../shared/naming.js'
import type { StudentSafeProposal, StudentTeamNaming } from '../../shared/types.js'

interface TeamNamingPanelProps {
  naming: StudentTeamNaming
  groupName: string | null
  projectName: string | null
  namingLocked: boolean
  busy: boolean
  onPropose: (kind: ProposalKind, value: string) => Promise<boolean>
  onVote: (kind: ProposalKind, proposalId: string) => Promise<boolean>
}

export default function TeamNamingPanel({
  naming,
  groupName,
  projectName,
  namingLocked,
  busy,
  onPropose,
  onVote,
}: TeamNamingPanelProps) {
  return (
    <section aria-labelledby="ci-naming-title" className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
      <div>
        <h2 id="ci-naming-title" className="text-sm font-semibold text-gray-800">Name your team</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          {namingLocked
            ? 'Naming is locked by your instructor.'
            : 'Suggest names and vote. The name with the most votes from your team wins.'}
        </p>
      </div>
      <ProposalGroup
        kind="group"
        title="Team name"
        current={groupName}
        proposals={naming.groupProposals}
        myVote={naming.myGroupVote}
        locked={namingLocked}
        busy={busy}
        onPropose={onPropose}
        onVote={onVote}
      />
      <ProposalGroup
        kind="project"
        title="Project name"
        current={projectName}
        proposals={naming.projectProposals}
        myVote={naming.myProjectVote}
        locked={namingLocked}
        busy={busy}
        onPropose={onPropose}
        onVote={onVote}
      />
    </section>
  )
}

interface ProposalGroupProps {
  kind: ProposalKind
  title: string
  current: string | null
  proposals: StudentSafeProposal[]
  myVote: string | null
  locked: boolean
  busy: boolean
  onPropose: (kind: ProposalKind, value: string) => Promise<boolean>
  onVote: (kind: ProposalKind, proposalId: string) => Promise<boolean>
}

function ProposalGroup({ kind, title, current, proposals, myVote, locked, busy, onPropose, onVote }: ProposalGroupProps) {
  const [draft, setDraft] = useState('')
  // Optimistic selection while the vote round-trips; cleared once the server's myVote changes.
  const [pendingVote, setPendingVote] = useState<string | null>(null)
  const inputId = useId()
  const legendId = useId()

  useEffect(() => {
    setPendingVote(null)
  }, [myVote])

  const selected = pendingVote ?? myVote

  const handleVote = async (proposalId: string) => {
    setPendingVote(proposalId)
    if (!(await onVote(kind, proposalId))) setPendingVote(null)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const value = draft.trim()
    if (!value) return
    if (await onPropose(kind, value)) setDraft('')
  }

  return (
    <div className="space-y-2">
      <fieldset aria-describedby={legendId} disabled={locked || busy} className="space-y-1">
        <legend className="text-xs font-medium text-gray-600 uppercase tracking-wide">{title}</legend>
        <p id={legendId} className="text-sm text-gray-800">
          Current: <span className="font-semibold">{current ?? 'none yet'}</span>
        </p>
        {proposals.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No suggestions yet.</p>
        ) : (
          <ul className="space-y-1">
            {proposals.map((proposal) => (
              <li key={proposal.id}>
                <label className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-amber-50 cursor-pointer">
                  <input
                    type="radio"
                    name={`ci-${kind}-vote`}
                    value={proposal.id}
                    checked={selected === proposal.id}
                    onChange={() => { void handleVote(proposal.id) }}
                    className="accent-amber-600"
                  />
                  <span className="text-sm text-gray-800 flex-1">{proposal.value}</span>
                  <span className="text-xs text-gray-500">
                    {proposal.voteCount} vote{proposal.voteCount === 1 ? '' : 's'}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      {!locked && (
        <form onSubmit={(event) => { void handleSubmit(event) }} className="flex gap-2">
          <label htmlFor={inputId} className="sr-only">
            Suggest a {title.toLowerCase()}
          </label>
          <input
            id={inputId}
            type="text"
            value={draft}
            maxLength={MAX_PROPOSAL_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={`Suggest a ${title.toLowerCase()}…`}
            disabled={busy}
            className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || draft.trim().length === 0}
            className="rounded-md bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            Suggest
          </button>
        </form>
      )}
    </div>
  )
}
