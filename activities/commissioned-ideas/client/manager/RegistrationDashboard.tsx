import { useCallback, useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import type { ClientTeam, ManagerParticipant, ManagerSnapshot } from '../hooks/useCommissionedIdeasSession.js'

interface RegistrationDashboardProps {
  sessionId: string
  instructorPasscode: string
  snapshot: ManagerSnapshot
}

// ── API helpers ───────────────────────────────────────────────────────────────

function useApi(sessionId: string, instructorPasscode: string) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const call = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<boolean> => {
      setBusy(true)
      setError(null)
      try {
        const res = await fetch(`/api/commissioned-ideas/${sessionId}/${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Commissioned-Ideas-Instructor-Passcode': instructorPasscode,
          },
          body: JSON.stringify(body),
        })
        const data = (await res.json()) as { error?: string }
        if (!res.ok) {
          setError(data.error ?? 'Request failed. Please try again.')
          return false
        }
        return true
      } catch {
        setError('Network error — please try again.')
        return false
      } finally {
        setBusy(false)
      }
    },
    [sessionId, instructorPasscode],
  )

  return { call, busy, error, clearError: () => setError(null) }
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

  const roster = Object.values(snapshot.participantRoster)
  const teams = Object.values(snapshot.teams).sort((a, b) => a.registeredAt - b.registeredAt)
  const ungrouped = roster.filter(
    (p) => !p.rejectedByInstructor && p.teamId === null,
  )
  const rejected = roster.filter((p) => p.rejectedByInstructor)
  const connectedActive = roster.filter((p) => p.connected && !p.rejectedByInstructor).length

  // ── Settings ────────────────────────────────────────────────────────────────

  const handleToggleLock = async (field: 'studentGroupingLocked' | 'namingLocked') => {
    await call('settings', { [field]: !snapshot[field] })
  }

  const handleMaxTeamSize = async (value: number) => {
    if (!Number.isInteger(value) || value < 2) return
    await call('settings', { maxTeamSize: value })
  }

  const handleGroupingMode = async (mode: 'manual' | 'random') => {
    await call('settings', { groupingMode: mode })
  }

  // ── Team actions ─────────────────────────────────────────────────────────────

  const handleAssignRandom = async () => {
    await call('assign-random', {})
  }

  const handleAssignParticipant = async (participantId: string, teamId: string | null) => {
    await call('assign-participant', { participantId, teamId })
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
            <button
              type="button"
              onClick={() => { void navigator.clipboard.writeText(joinUrl) }}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Copy link
            </button>
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
          <p className="text-2xl font-bold text-amber-700">{teams.length}</p>
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

      {/* Team roster */}
      <TeamRoster
        teams={teams}
        participantRoster={snapshot.participantRoster}
        studentGroupingLocked={snapshot.studentGroupingLocked}
        busy={busy}
        onAssignParticipant={handleAssignParticipant}
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
  onMaxTeamSize: (value: number) => void
  onGroupingMode: (mode: 'manual' | 'random') => void
  onAssignRandom: () => void
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
  const serverMax = snapshot.maxTeamSize

  // When the server pushes a new maxTeamSize (e.g. another admin changed it),
  // update the local input so it doesn't show a stale value. This runs only
  // when serverMax actually changes, so it never interrupts the user mid-type.
  useEffect(() => {
    setMaxInput(String(serverMax))
  }, [serverMax])

  const handleMaxBlur = () => {
    const v = parseInt(maxInput, 10)
    if (!Number.isNaN(v) && v >= 2) {
      onMaxTeamSize(v)
    } else {
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
              onClick={() => { setMaxInput(String(serverMax - 1)); onMaxTeamSize(serverMax - 1) }}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              −
            </button>
            <input
              id="max-team-size"
              type="number"
              min={2}
              value={maxInput}
              onChange={(e) => setMaxInput(e.target.value)}
              onBlur={handleMaxBlur}
              disabled={busy}
              className="w-16 border border-gray-300 rounded-md px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
            />
            <button
              type="button"
              aria-label="Increase max team size"
              disabled={busy}
              onClick={() => { setMaxInput(String(serverMax + 1)); onMaxTeamSize(serverMax + 1) }}
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

        {/* Assign random */}
        {snapshot.groupingMode === 'random' && (
          <button
            type="button"
            disabled={busy}
            onClick={onAssignRandom}
            className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
          >
            {snapshot.studentGroupingLocked ? 'Place ungrouped' : 'Assign random groups'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Team Roster ───────────────────────────────────────────────────────────────

interface TeamRosterProps {
  teams: ClientTeam[]
  participantRoster: Record<string, ManagerParticipant>
  studentGroupingLocked: boolean
  busy: boolean
  onAssignParticipant: (participantId: string, teamId: string | null) => void
}

function TeamRoster({
  teams,
  participantRoster,
  studentGroupingLocked,
  busy,
  onAssignParticipant,
}: TeamRosterProps) {
  const [assignTarget, setAssignTarget] = useState<string | null>(null)

  const ungrouped = Object.values(participantRoster).filter(
    (p) => !p.rejectedByInstructor && p.teamId === null,
  )

  const getParticipant = (id: string): ManagerParticipant | undefined =>
    participantRoster[id]

  if (teams.length === 0 && ungrouped.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
      <div className="px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-700">Teams</h2>
      </div>

      {/* Teams */}
      {teams.map((team, idx) => (
        <div key={team.id} className="px-4 py-3">
          <p className="text-xs font-medium text-gray-500 mb-2">
            Team {idx + 1}
            {team.groupName ? ` — ${team.groupName}` : ''}
            <span className="ml-2 text-gray-400">({team.memberIds.length} member{team.memberIds.length !== 1 ? 's' : ''})</span>
          </p>
          <ul className="space-y-1">
            {team.memberIds.map((memberId) => {
              const p = getParticipant(memberId)
              if (!p) return null
              return (
                <li key={memberId} className="flex items-center gap-2">
                  <span
                    aria-label={p.connected ? 'Online' : 'Offline'}
                    className={`h-2 w-2 rounded-full shrink-0 ${p.connected ? 'bg-green-500' : 'bg-gray-300'}`}
                  />
                  <span className="text-sm text-gray-800 flex-1">{p.name}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onAssignParticipant(memberId, null)}
                    aria-label={`Remove ${p.name} from team`}
                    className="text-xs text-gray-400 hover:text-red-500 disabled:opacity-40"
                  >
                    Remove
                  </button>
                </li>
              )
            })}
          </ul>

          {/* Assign ungrouped to this team */}
          {ungrouped.length > 0 && (
            <div className="mt-2">
              {assignTarget === team.id ? (
                <div className="flex flex-wrap gap-1 mt-1">
                  {ungrouped.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        onAssignParticipant(p.id, team.id)
                        setAssignTarget(null)
                      }}
                      className="rounded-full border border-indigo-300 bg-indigo-50 px-2.5 py-0.5 text-xs text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                    >
                      + {p.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setAssignTarget(null)}
                    className="rounded-full border border-gray-200 px-2.5 py-0.5 text-xs text-gray-500 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setAssignTarget(team.id)}
                  className="mt-1 text-xs text-indigo-600 hover:underline disabled:opacity-40"
                >
                  + Add student here
                </button>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Ungrouped */}
      {ungrouped.length > 0 && (
        <div className="px-4 py-3">
          <p className="text-xs font-medium text-gray-500 mb-2">Ungrouped ({ungrouped.length})</p>
          <ul className="space-y-1">
            {ungrouped.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <span
                  aria-label={p.connected ? 'Online' : 'Offline'}
                  className={`h-2 w-2 rounded-full shrink-0 ${p.connected ? 'bg-green-500' : 'bg-gray-300'}`}
                />
                <span className="text-sm text-gray-800 flex-1">{p.name}</span>
                {studentGroupingLocked && teams.length > 0 && (
                  <select
                    aria-label={`Assign ${p.name} to team`}
                    disabled={busy}
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) onAssignParticipant(p.id, e.target.value)
                    }}
                    className="text-xs border border-gray-300 rounded px-1.5 py-0.5 disabled:opacity-50"
                  >
                    <option value="" disabled>Assign to team…</option>
                    {teams.map((t, idx) => (
                      <option key={t.id} value={t.id}>
                        Team {idx + 1}{t.groupName ? ` — ${t.groupName}` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
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
    if (!editState) return
    const ok = await callModeration({ participantId: editState.participantId, name: editState.name })
    if (ok) setEditState(null)
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

  return (
    <div className={`px-4 py-3 flex items-center gap-3 ${rejectedByInstructor ? 'bg-red-50' : ''}`}>
      <span
        aria-label={connected && !rejectedByInstructor ? 'Online' : 'Offline'}
        title={connected && !rejectedByInstructor ? 'Online' : 'Offline'}
        className={`h-2 w-2 rounded-full shrink-0 ${
          connected && !rejectedByInstructor ? 'bg-green-500' : 'bg-gray-300'
        }`}
      />

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
              type="button"
              onClick={onStartEdit}
              aria-label={`Edit name for ${name}`}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              Edit
            </button>
            {rejectedByInstructor ? (
              <button
                type="button"
                onClick={onApprove}
                aria-label={`Approve ${name}`}
                className="rounded-md border border-green-300 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50"
              >
                Approve
              </button>
            ) : (
              <button
                type="button"
                onClick={onReject}
                aria-label={`Reject ${name}`}
                className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
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
