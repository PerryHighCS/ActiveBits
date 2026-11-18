import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import type { ProposalKind } from '../../shared/naming.js'
import type { ManagerParticipant, ManagerSnapshot } from '../hooks/useCommissionedIdeasSession.js'
import TeamBoard from './TeamBoard.js'
import { useInstructorApi as useApi } from './useInstructorApi.js'
import { buildAssignBody, maxTeamSizeBlurAction, type MoveDestination } from './teamBoardModel.js'

interface RegistrationDashboardProps {
  sessionId: string
  instructorPasscode: string
  snapshot: ManagerSnapshot
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RegistrationDashboard({
  sessionId,
  instructorPasscode,
  snapshot,
}: RegistrationDashboardProps) {
  const { call, busy, error, clearError } = useApi(sessionId, instructorPasscode)

  const joinUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/${sessionId}` : `/${sessionId}`
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const handleCopyLink = async () => {
    try {
      // Undefined outside secure contexts, despite the DOM typings.
      if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(joinUrl)
      setCopyStatus('copied')
    } catch {
      setCopyStatus('failed')
    }
  }

  const roster = Object.values(snapshot.participantRoster)
  const teamCount = Object.keys(snapshot.teams).length
  const ungrouped = roster.filter(
    (p) => !p.rejectedByInstructor && p.teamId === null,
  )
  const rejected = roster.filter((p) => p.rejectedByInstructor)
  const connectedActive = roster.filter((p) => p.connected && !p.rejectedByInstructor).length

  // ── Settings ────────────────────────────────────────────────────────────────

  const handleToggleLock = async (field: 'studentGroupingLocked' | 'namingLocked') => {
    await call('settings', { [field]: !snapshot[field] })
  }

  const handleMaxTeamSize = async (value: number): Promise<boolean> => {
    if (!Number.isInteger(value) || value < 2) return false
    return call('settings', { maxTeamSize: value })
  }

  const handleGroupingMode = async (mode: 'manual' | 'random') => {
    await call('settings', { groupingMode: mode })
  }

  // ── Team actions ─────────────────────────────────────────────────────────────

  const handleAssignRandom = async (scope: 'ungrouped' | 'all') => {
    if (scope === 'all' && teamCount > 0 && !window.confirm('Dissolve every team and reshuffle all students? Team name proposals will be lost.')) {
      return
    }
    await call('assign-random', { scope })
  }

  const handleMove = (participantId: string, destination: MoveDestination): Promise<boolean> =>
    call('assign-participant', buildAssignBody(participantId, destination))

  const handleModerateProposal = async (teamId: string, kind: ProposalKind, proposalId: string, rejected: boolean) => {
    await call('team/proposal-moderation', { teamId, kind, proposalId, rejected })
  }

  return (
    <div className="space-y-6">
      {/* Join link + QR code */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
          Student join link
        </p>
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          <div className="flex justify-center sm:justify-start">
            <QRCodeSVG value={joinUrl} size={160} level="M" />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <code className="block w-full rounded bg-gray-50 border border-gray-200 px-3 py-2 text-sm font-mono text-gray-800 break-all">
              {joinUrl}
            </code>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => { void handleCopyLink() }}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Copy link
              </button>
              <span role="status" data-testid="ci-copy-status" className={`text-xs ${copyStatus === 'failed' ? 'text-red-700' : 'text-green-700'}`}>
                {copyStatus === 'copied' && 'Link copied.'}
                {copyStatus === 'failed' && 'Could not copy automatically. Select the link above and copy it.'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Summary counts */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-gray-800">
            {roster.filter((p) => !p.rejectedByInstructor).length}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">Registered</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-green-700">{connectedActive}</p>
          <p className="text-xs text-gray-500 mt-0.5">Online</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-amber-700">{teamCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">Teams</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-gray-500">{ungrouped.length}</p>
          <p className="text-xs text-gray-500 mt-0.5">Ungrouped</p>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={clearError} aria-label="Dismiss error" className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
        </div>
      )}

      {/* Settings panel */}
      <SettingsPanel
        snapshot={snapshot}
        busy={busy}
        onToggleLock={handleToggleLock}
        onMaxTeamSize={handleMaxTeamSize}
        onGroupingMode={handleGroupingMode}
        onAssignRandom={handleAssignRandom}
      />

      {/* Team board (drag/drop + keyboard move menu) */}
      <TeamBoard
        teams={snapshot.teams}
        participantRoster={snapshot.participantRoster}
        maxTeamSize={snapshot.maxTeamSize}
        busy={busy}
        onMove={handleMove}
        onModerateProposal={(teamId, kind, proposalId, rejected) => {
          void handleModerateProposal(teamId, kind, proposalId, rejected)
        }}
      />

      {/* Participant list (name moderation) */}
      <ParticipantModerationPanel
        sessionId={sessionId}
        instructorPasscode={instructorPasscode}
        roster={roster}
        rejected={rejected}
      />
    </div>
  )
}

// ── Settings Panel ────────────────────────────────────────────────────────────

interface SettingsPanelProps {
  snapshot: ManagerSnapshot
  busy: boolean
  onToggleLock: (field: 'studentGroupingLocked' | 'namingLocked') => void
  /** Resolves false when the server refused the change. */
  onMaxTeamSize: (value: number) => Promise<boolean>
  onGroupingMode: (mode: 'manual' | 'random') => void
  onAssignRandom: (scope: 'ungrouped' | 'all') => void
}

function SettingsPanel({
  snapshot,
  busy,
  onToggleLock,
  onMaxTeamSize,
  onGroupingMode,
  onAssignRandom,
}: SettingsPanelProps) {
  const [maxInput, setMaxInput] = useState(String(snapshot.maxTeamSize))
  const [maxEdited, setMaxEdited] = useState(false)
  const serverMax = snapshot.maxTeamSize
  // Latest confirmed value, read after an await so a rollback never restores a stale size.
  const serverMaxRef = useRef(serverMax)

  // When the server pushes a new maxTeamSize (e.g. another admin changed it),
  // update the local input so it doesn't show a stale value. This runs only
  // when serverMax actually changes, so it never interrupts the user mid-type.
  useEffect(() => {
    serverMaxRef.current = serverMax
    setMaxInput(String(serverMax))
  }, [serverMax])

  // Show the requested size immediately, and fall back to the latest confirmed
  // value if the request fails.
  const requestMaxTeamSize = async (value: number) => {
    setMaxEdited(false)
    setMaxInput(String(value))
    if (!(await onMaxTeamSize(value))) setMaxInput(String(serverMaxRef.current))
  }

  const handleMaxBlur = () => {
    const action = maxTeamSizeBlurAction(maxInput, maxEdited, serverMax)
    if (action.kind === 'submit') {
      void requestMaxTeamSize(action.value)
    } else {
      setMaxEdited(false)
      setMaxInput(String(serverMax))
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
      <h2 className="text-sm font-semibold text-gray-700">Session settings</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Max team size */}
        <div>
          <label htmlFor="max-team-size" className="block text-xs font-medium text-gray-600 mb-1">
            Max team size
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Decrease max team size"
              disabled={busy || serverMax <= 2}
              onClick={() => { void requestMaxTeamSize(serverMax - 1) }}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              −
            </button>
            <input
              id="max-team-size"
              type="number"
              min={2}
              value={maxInput}
              onChange={(e) => {
                setMaxEdited(true)
                setMaxInput(e.target.value)
              }}
              onBlur={handleMaxBlur}
              disabled={busy}
              className="w-16 border border-gray-300 rounded-md px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
            />
            <button
              type="button"
              aria-label="Increase max team size"
              disabled={busy}
              onClick={() => { void requestMaxTeamSize(serverMax + 1) }}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              +
            </button>
          </div>
        </div>

        {/* Grouping mode */}
        <div>
          <p className="text-xs font-medium text-gray-600 mb-1">Grouping mode</p>
          <div className="flex items-center gap-2" role="group" aria-label="Grouping mode">
            <button
              type="button"
              aria-pressed={snapshot.groupingMode === 'manual'}
              disabled={busy}
              onClick={() => onGroupingMode('manual')}
              className={`rounded-md border px-3 py-1 text-sm font-medium disabled:opacity-50 ${
                snapshot.groupingMode === 'manual'
                  ? 'bg-amber-600 border-amber-600 text-white'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              Manual
            </button>
            <button
              type="button"
              aria-pressed={snapshot.groupingMode === 'random'}
              disabled={busy}
              onClick={() => onGroupingMode('random')}
              className={`rounded-md border px-3 py-1 text-sm font-medium disabled:opacity-50 ${
                snapshot.groupingMode === 'random'
                  ? 'bg-amber-600 border-amber-600 text-white'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              Random
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
        {/* Grouping lock */}
        <button
          type="button"
          aria-pressed={snapshot.studentGroupingLocked}
          disabled={busy}
          onClick={() => onToggleLock('studentGroupingLocked')}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
            snapshot.studentGroupingLocked
              ? 'bg-amber-100 border-amber-400 text-amber-800'
              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          {snapshot.studentGroupingLocked ? '🔒 Grouping locked' : 'Lock grouping'}
        </button>

        {/* Naming lock */}
        <button
          type="button"
          aria-pressed={snapshot.namingLocked}
          disabled={busy}
          onClick={() => onToggleLock('namingLocked')}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
            snapshot.namingLocked
              ? 'bg-amber-100 border-amber-400 text-amber-800'
              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          {snapshot.namingLocked ? '🔒 Naming locked' : 'Lock naming'}
        </button>

        {/* Random placement */}
        {snapshot.groupingMode === 'random' && !snapshot.studentGroupingLocked && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAssignRandom('all')}
            className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
          >
            {Object.keys(snapshot.teams).length > 0 ? 'Reshuffle all teams' : 'Assign random teams'}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onAssignRandom('ungrouped')}
          className="rounded-lg border border-indigo-300 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
        >
          Randomly place ungrouped
        </button>
      </div>
    </div>
  )
}

// ── Participant moderation (name edit / reject / approve) ─────────────────────

interface ParticipantModerationPanelProps {
  sessionId: string
  instructorPasscode: string
  roster: ManagerParticipant[]
  rejected: ManagerParticipant[]
}

interface EditState {
  participantId: string
  name: string
}

function ParticipantModerationPanel({
  sessionId,
  instructorPasscode,
  roster,
  rejected,
}: ParticipantModerationPanelProps) {
  const { call, busy, error, clearError } = useApi(sessionId, instructorPasscode)
  const [editState, setEditState] = useState<EditState | null>(null)

  const callModeration = async (body: Record<string, unknown>): Promise<boolean> => {
    return call('participant-name', body)
  }

  const handleSaveEdit = async () => {
    // Same rule as the disabled Save button, so Enter cannot submit a blank name.
    if (!editState || busy || editState.name.trim().length === 0) return
    const submittedId = editState.participantId
    const ok = await callModeration({ participantId: submittedId, name: editState.name })
    // Only close the editor that was saved; another row may have been opened meanwhile.
    if (ok) setEditState((current) => (current?.participantId === submittedId ? null : current))
  }

  const handleReject = async (participantId: string) => {
    await callModeration({ participantId, rejected: true })
  }

  const handleApprove = async (participantId: string) => {
    await callModeration({ participantId, rejected: false })
  }

  const active = roster.filter((p) => !p.rejectedByInstructor).sort((a, b) => a.name.localeCompare(b.name))
  const allParticipants = [...active, ...rejected.sort((a, b) => a.name.localeCompare(b.name))]

  if (allParticipants.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
      <div className="px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-700">Participants</h2>
      </div>

      {error && (
        <div role="alert" className="px-4 py-2 text-sm text-red-700 bg-red-50 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={clearError} aria-label="Dismiss error" className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {allParticipants.map((p) => (
        <ParticipantRow
          key={p.id}
          participant={p}
          editState={editState?.participantId === p.id ? editState : null}
          saving={busy}
          onStartEdit={() => setEditState({ participantId: p.id, name: p.name })}
          onEditNameChange={(name) => setEditState((s) => s ? { ...s, name } : null)}
          onSaveEdit={() => { void handleSaveEdit() }}
          onCancelEdit={() => { setEditState(null); clearError() }}
          onReject={() => { void handleReject(p.id) }}
          onApprove={() => { void handleApprove(p.id) }}
        />
      ))}
    </div>
  )
}

interface ParticipantRowProps {
  participant: ManagerParticipant
  editState: EditState | null
  saving: boolean
  onStartEdit: () => void
  onEditNameChange: (name: string) => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onReject: () => void
  onApprove: () => void
}

function ParticipantRow({
  participant,
  editState,
  saving,
  onStartEdit,
  onEditNameChange,
  onSaveEdit,
  onCancelEdit,
  onReject,
  onApprove,
}: ParticipantRowProps) {
  const { id, name, connected, rejectedByInstructor } = participant
  const isEditing = editState !== null

  // Return keyboard focus to the Edit button when leaving edit mode (save or cancel).
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const wasEditingRef = useRef(isEditing)
  useEffect(() => {
    if (wasEditingRef.current && !isEditing) editButtonRef.current?.focus()
    wasEditingRef.current = isEditing
  }, [isEditing])

  return (
    <div className={`px-4 py-3 flex items-center gap-3 ${rejectedByInstructor ? 'bg-red-50' : ''}`}>
      <span
        aria-hidden="true"
        title={connected && !rejectedByInstructor ? 'Online' : 'Offline'}
        className={`h-2 w-2 rounded-full shrink-0 ${
          connected && !rejectedByInstructor ? 'bg-green-500' : 'bg-gray-300'
        }`}
      />
      <span className="sr-only">{connected && !rejectedByInstructor ? 'Online' : 'Offline'}</span>

      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            type="text"
            value={editState.name}
            onChange={(e) => onEditNameChange(e.target.value)}
            maxLength={100}
            autoFocus
            disabled={saving}
            aria-label="Edit participant name"
            className="w-full border border-amber-400 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveEdit()
              if (e.key === 'Escape') onCancelEdit()
            }}
          />
        ) : (
          <span className={`text-sm ${rejectedByInstructor ? 'line-through text-gray-400' : 'text-gray-800'}`}>
            {name}
          </span>
        )}
        <span className="text-xs text-gray-400 font-mono ml-1">{id}</span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {isEditing ? (
          <>
            <button
              type="button"
              onClick={onSaveEdit}
              disabled={saving || editState.name.trim().length === 0}
              className="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              disabled={saving}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              ref={editButtonRef}
              type="button"
              onClick={onStartEdit}
              disabled={saving}
              aria-label={`Edit name for ${name}`}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Edit
            </button>
            {rejectedByInstructor ? (
              <button
                type="button"
                onClick={onApprove}
                disabled={saving}
                aria-label={`Approve ${name}`}
                className="rounded-md border border-green-300 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
              >
                Approve
              </button>
            ) : (
              <button
                type="button"
                onClick={onReject}
                disabled={saving}
                aria-label={`Reject ${name}`}
                className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Reject
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
