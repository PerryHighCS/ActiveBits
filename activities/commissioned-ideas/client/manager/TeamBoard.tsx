import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { countVotes, type ProposalKind } from '../../shared/naming.js'
import type { NameProposal } from '../../shared/types.js'
import type { ManagerParticipant, ManagerTeam } from '../hooks/useCommissionedIdeasSession.js'
import { sortTeams, teamLabel } from '../teamLabels.js'
import {
  canMoveTo,
  countActiveMembers,
  currentDestination,
  listMoveOptions,
  focusCancelsMoveRequest,
  MOVE_SELECT_PARTICIPANT_ATTR,
  moveFocusReady,
  type MoveDestination,
  type MoveFocusRequest,
  type MoveOutcome,
} from './teamBoardModel.js'

interface TeamBoardProps {
  teams: Record<string, ManagerTeam>
  participantRoster: Record<string, ManagerParticipant>
  maxTeamSize: number
  busy: boolean
  /** Revision of the snapshot the board is showing. */
  snapshotRevision: number
  /** Resolves with the server's answer (committed with the confirmed team, refused, or unknown). */
  onMove: (participantId: string, destination: MoveDestination) => Promise<MoveOutcome>
  onModerateProposal: (teamId: string, kind: ProposalKind, proposalId: string, rejected: boolean) => void
}

const DRAG_MIME = 'text/plain'

export default function TeamBoard({
  teams,
  participantRoster,
  maxTeamSize,
  busy,
  snapshotRevision,
  onMove,
  onModerateProposal,
}: TeamBoardProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<MoveDestination | null>(null)
  const [focusRequest, setFocusRequest] = useState<MoveFocusRequest | null>(null)

  // Keyboard moves re-create the chip under another list; keep focus on its select.
  const moveWithKeyboard = async (participant: ManagerParticipant, destination: MoveDestination) => {
    const from = currentDestination(participant)
    const request: MoveFocusRequest = { participantId: participant.id, from, outcome: { kind: 'pending' } }
    setFocusRequest(request)
    const outcome = await onMove(participant.id, destination)
    // Only update our own request: a newer move or a cancellation wins.
    setFocusRequest((current) => (current === request ? { ...request, outcome } : current))
  }

  // The instructor moving focus to any other control cancels a pending restoration.
  // A select that loses focus because it was disabled or removed fires no `focusin`.
  useEffect(() => {
    if (!focusRequest) return
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const targetParticipant = target?.getAttribute(MOVE_SELECT_PARTICIPANT_ATTR) ?? null
      if (focusCancelsMoveRequest(focusRequest, targetParticipant)) setFocusRequest(null)
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [focusRequest])

  const orderedTeams = sortTeams(teams)
  const ungrouped = Object.values(participantRoster)
    .filter((p) => !p.rejectedByInstructor && p.teamId === null)
    .sort((a, b) => a.name.localeCompare(b.name))
  const dragged = draggedId ? participantRoster[draggedId] : undefined

  const dropAllowed = (destination: MoveDestination): boolean =>
    !busy && dragged !== undefined && canMoveTo(dragged, destination, teams, participantRoster, maxTeamSize)

  const dropZoneProps = (destination: MoveDestination) => ({
    onDragOver: (event: DragEvent) => {
      if (!dropAllowed(destination)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (dragOver !== destination) setDragOver(destination)
    },
    onDragLeave: (event: DragEvent) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
      setDragOver((current) => (current === destination ? null : current))
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      const participantId = draggedId ?? event.dataTransfer.getData(DRAG_MIME)
      setDraggedId(null)
      setDragOver(null)
      const participant = participantId ? participantRoster[participantId] : undefined
      if (participant && canMoveTo(participant, destination, teams, participantRoster, maxTeamSize)) {
        void onMove(participant.id, destination)
      }
    },
  })

  const zoneClass = (destination: MoveDestination, base: string): string => {
    if (dragOver === destination) return `${base} ring-2 ring-amber-400 bg-amber-50`
    if (dragged && !dropAllowed(destination) && currentDestination(dragged) !== destination) return `${base} opacity-50`
    return base
  }

  const renderMember = (participant: ManagerParticipant): ReactNode => (
    <MemberChip
      key={participant.id}
      participant={participant}
      options={listMoveOptions(participant, teams, participantRoster, maxTeamSize)}
      busy={busy}
      isDragging={draggedId === participant.id}
      onDragStart={(event) => {
        setDraggedId(participant.id)
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData(DRAG_MIME, participant.id)
      }}
      onDragEnd={() => {
        setDraggedId(null)
        setDragOver(null)
      }}
      onMove={(destination) => { void moveWithKeyboard(participant, destination) }}
      takeFocus={moveFocusReady(focusRequest, participant, busy, snapshotRevision)}
      onFocusTaken={() => setFocusRequest(null)}
    />
  )

  return (
    <section aria-labelledby="ci-team-board-title" className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div>
        <h2 id="ci-team-board-title" className="text-sm font-semibold text-gray-700">Teams</h2>
        <p id="ci-team-board-help" className="text-xs text-gray-500 mt-0.5">
          Drag students between teams, or use each student&apos;s “Move to” menu.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {orderedTeams.map((team, index) => {
          const destination: MoveDestination = `team:${team.id}`
          const label = teamLabel(team, index)
          const members = team.memberIds
            .map((id) => participantRoster[id])
            .filter((p): p is ManagerParticipant => p !== undefined)
          const size = countActiveMembers(team, participantRoster)
          return (
            <section
              key={team.id}
              aria-label={label}
              data-testid="ci-team-card"
              className={zoneClass(destination, 'rounded-lg border border-gray-200 p-3 transition-colors')}
              {...dropZoneProps(destination)}
            >
              <header className="flex items-baseline justify-between gap-2 mb-2">
                <h3 className="text-sm font-semibold text-gray-800 truncate">{label}</h3>
                <span className={`text-xs ${size >= maxTeamSize ? 'text-amber-700 font-medium' : 'text-gray-400'}`}>
                  {size}/{maxTeamSize}
                </span>
              </header>
              {team.projectName && (
                <p className="text-xs text-gray-500 -mt-1 mb-2 italic truncate">Project: {team.projectName}</p>
              )}
              <ul className="space-y-1" aria-label={`${label} members`}>
                {members.map(renderMember)}
              </ul>
              <ProposalModeration team={team} onModerate={onModerateProposal} busy={busy} />
            </section>
          )
        })}

        <section
          aria-label="New team"
          aria-describedby="ci-team-board-help"
          data-testid="ci-new-team-zone"
          className={zoneClass(
            'new',
            'rounded-lg border-2 border-dashed border-gray-300 p-3 flex items-center justify-center text-sm text-gray-500 min-h-24 transition-colors',
          )}
          {...dropZoneProps('new')}
        >
          Drop a student here to start a new team
        </section>
      </div>

      <section
        aria-label="Ungrouped students"
        data-testid="ci-ungrouped-zone"
        className={zoneClass('ungrouped', 'rounded-lg border border-gray-200 bg-gray-50 p-3 transition-colors')}
        {...dropZoneProps('ungrouped')}
      >
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
          Ungrouped ({ungrouped.length})
        </h3>
        {ungrouped.length === 0 ? (
          <p className="text-xs text-gray-400 italic">Everyone is on a team. Drop a student here to remove them from their team.</p>
        ) : (
          <ul className="space-y-1" aria-label="Ungrouped students list">
            {ungrouped.map(renderMember)}
          </ul>
        )}
      </section>
    </section>
  )
}

// ── Member chip ───────────────────────────────────────────────────────────────

interface MemberChipProps {
  participant: ManagerParticipant
  options: ReturnType<typeof listMoveOptions>
  busy: boolean
  isDragging: boolean
  onDragStart: (event: DragEvent) => void
  onDragEnd: () => void
  onMove: (destination: MoveDestination) => void
  /** Focus this chip's select now (a keyboard move for this participant settled). */
  takeFocus: boolean
  onFocusTaken: () => void
}

function MemberChip({
  participant,
  options,
  busy,
  isDragging,
  onDragStart,
  onDragEnd,
  onMove,
  takeFocus,
  onFocusTaken,
}: MemberChipProps) {
  const current = currentDestination(participant)
  const selectRef = useRef<HTMLSelectElement>(null)
  useEffect(() => {
    if (!takeFocus) return
    selectRef.current?.focus()
    onFocusTaken()
  }, [takeFocus, onFocusTaken])
  return (
    <li
      draggable={!busy}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-testid="ci-member-chip"
      data-participant-name={participant.name}
      className={`flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1 cursor-grab active:cursor-grabbing ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <span aria-hidden="true" className="text-gray-300 select-none">⋮⋮</span>
      <span
        role="img"
        aria-label={participant.connected ? 'Online' : 'Offline'}
        className={`h-2 w-2 rounded-full shrink-0 ${participant.connected ? 'bg-green-500' : 'bg-gray-300'}`}
      />
      <span className="text-sm text-gray-800 flex-1 truncate">{participant.name}</span>
      <select
        ref={selectRef}
        {...{ [MOVE_SELECT_PARTICIPANT_ATTR]: participant.id }}
        aria-label={`Move ${participant.name} to`}
        value={current}
        disabled={busy}
        onChange={(event) => {
          const next = event.target.value as MoveDestination
          if (next !== current) onMove(next)
        }}
        className="text-xs border border-gray-300 rounded px-1 py-0.5 max-w-[8rem] disabled:opacity-50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </li>
  )
}

// ── Proposal moderation ───────────────────────────────────────────────────────

interface ProposalModerationProps {
  team: ManagerTeam
  busy: boolean
  onModerate: (teamId: string, kind: ProposalKind, proposalId: string, rejected: boolean) => void
}

function ProposalModeration({ team, busy, onModerate }: ProposalModerationProps) {
  if (team.proposedGroupNames.length === 0 && team.proposedProjectNames.length === 0) return null
  const members = new Set(team.memberIds)
  const renderKind = (kind: ProposalKind, title: string, proposals: NameProposal[], votes: Record<string, string>) => {
    if (proposals.length === 0) return null
    const tally = countVotes(proposals, votes, members)
    return (
      <div>
        <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{title}</p>
        <ul className="mt-1 flex flex-wrap gap-1">
          {proposals.map((proposal) => (
            <li
              key={proposal.id}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                proposal.rejectedByInstructor
                  ? 'border-red-200 bg-red-50 text-red-400 line-through'
                  : 'border-gray-200 bg-gray-50 text-gray-700'
              }`}
            >
              <span>{proposal.value}</span>
              {!proposal.rejectedByInstructor && (
                <span className="text-gray-400" aria-label={`${tally.get(proposal.id) ?? 0} votes`}>
                  · {tally.get(proposal.id) ?? 0}
                </span>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => onModerate(team.id, kind, proposal.id, !proposal.rejectedByInstructor)}
                aria-label={`${proposal.rejectedByInstructor ? 'Restore' : 'Reject'} ${title.toLowerCase()} “${proposal.value}”`}
                className={`ml-0.5 no-underline disabled:opacity-40 ${
                  proposal.rejectedByInstructor ? 'text-green-600 hover:text-green-800' : 'text-gray-400 hover:text-red-600'
                }`}
              >
                {proposal.rejectedByInstructor ? '↺' : '✕'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  return (
    <div className="mt-3 pt-2 border-t border-gray-100 space-y-2">
      {renderKind('group', 'Team name', team.proposedGroupNames, team.groupNameVotes)}
      {renderKind('project', 'Project name', team.proposedProjectNames, team.projectNameVotes)}
    </div>
  )
}
