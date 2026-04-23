import { useState } from 'react'
import type { ClientTeam } from '../hooks/useCommissionedIdeasSession.js'
import type { StudentSafeParticipant } from '../../shared/types.js'

interface StudentRosterProps {
  participants: Record<string, StudentSafeParticipant>
  teams: Record<string, ClientTeam>
  myParticipantId: string
  participantToken: string
  sessionId: string
  studentGroupingLocked: boolean
  groupingMode: string
}

export default function StudentRoster({
  participants,
  teams,
  myParticipantId,
  participantToken,
  sessionId,
  studentGroupingLocked,
  groupingMode,
}: StudentRosterProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const me = participants[myParticipantId]
  const myTeamId = me?.teamId ?? null

  const teamList = Object.values(teams).sort((a, b) => a.registeredAt - b.registeredAt)
  const ungrouped = Object.values(participants)
    .filter((p) => p.teamId === null)
    .sort((a, b) => a.name.localeCompare(b.name))

  // ── API helpers ─────────────────────────────────────────────────────────────

  const post = async (path: string, body: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/commissioned-ideas/${sessionId}/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Commissioned-Ideas-Participant-Token': participantToken,
        },
        body: JSON.stringify({ ...body, participantId: myParticipantId }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.')
      }
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  const handleCreateTeam = () => { void post('create-team', {}) }
  const handleJoinTeam = (teamId: string) => { void post('join-team', { teamId }) }
  const handleLeaveTeam = () => { void post('leave-team', {}) }

  const isManual = groupingMode === 'manual'

  return (
    <div className="p-4 space-y-5">
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error" className="text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {/* My status */}
      <MyTeamStatus
        myTeamId={myTeamId}
        teams={teams}
        participants={participants}
        studentGroupingLocked={studentGroupingLocked}
        busy={busy}
        onLeave={handleLeaveTeam}
      />

      {/* Random mode waiting message */}
      {!isManual && myTeamId === null && studentGroupingLocked && (
        <p className="text-sm text-gray-500 italic">
          Your instructor will assign you to a team.
        </p>
      )}

      {/* Teams */}
      {teamList.length > 0 && (
        <section aria-label="Teams">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Teams ({teamList.length})
          </h3>
          <div className="space-y-2">
            {teamList.map((team, idx) => {
              const members = team.memberIds
                .map((id) => participants[id])
                .filter((p): p is StudentSafeParticipant => p !== undefined)
                .sort((a, b) => a.name.localeCompare(b.name))
              const isMine = team.id === myTeamId
              const memberCount = members.length
              const canJoin = isManual && !isMine && myTeamId === null && !studentGroupingLocked

              return (
                <div
                  key={team.id}
                  className={`rounded-lg border px-3 py-2 ${isMine ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-xs font-semibold text-gray-600">
                      Team {idx + 1}
                      {team.groupName ? ` — ${team.groupName}` : ''}
                      <span className="ml-1 font-normal text-gray-400">({memberCount})</span>
                    </p>
                    {canJoin && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleJoinTeam(team.id)}
                        className="rounded-full border border-amber-400 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                      >
                        Join
                      </button>
                    )}
                    {isMine && (
                      <span className="text-xs font-medium text-amber-600">Your team</span>
                    )}
                  </div>
                  <ul className="space-y-0.5">
                    {members.map((p) => (
                      <li
                        key={p.id}
                        className={`text-sm px-1 py-0.5 rounded ${
                          p.id === myParticipantId ? 'text-amber-800 font-medium' : 'text-gray-700'
                        }`}
                      >
                        {p.name}
                        {p.id === myParticipantId && (
                          <span className="ml-1 text-amber-600 text-xs">(you)</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Ungrouped students */}
      {ungrouped.length > 0 && (
        <section aria-label="Ungrouped students">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            {isManual && myTeamId === null && !studentGroupingLocked
              ? 'Ungrouped — create a team to invite classmates'
              : `Ungrouped (${ungrouped.length})`}
          </h3>
          <ul className="space-y-1">
            {ungrouped.map((p) => {
              const isMe = p.id === myParticipantId
              return (
                <li key={p.id}>
                  <span
                    aria-current={isMe ? 'true' : undefined}
                    className={`text-sm px-3 py-1.5 rounded-lg inline-block ${
                      isMe ? 'bg-amber-100 text-amber-800 font-medium' : 'text-gray-700'
                    }`}
                  >
                    {p.name}
                    {isMe && <span className="ml-1 text-amber-600 text-xs">(you)</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Create team */}
      {isManual && myTeamId === null && !studentGroupingLocked && (
        <button
          type="button"
          disabled={busy}
          onClick={handleCreateTeam}
          className="w-full rounded-lg border-2 border-dashed border-amber-300 py-3 text-sm font-medium text-amber-600 hover:bg-amber-50 disabled:opacity-50"
        >
          + Create a new team
        </button>
      )}

      {ungrouped.length === 0 && teamList.length === 0 && (
        <p className="text-sm text-gray-400 italic">Waiting for classmates to join…</p>
      )}
    </div>
  )
}

// ── My team status strip ──────────────────────────────────────────────────────

interface MyTeamStatusProps {
  myTeamId: string | null
  teams: Record<string, ClientTeam>
  participants: Record<string, StudentSafeParticipant>
  studentGroupingLocked: boolean
  busy: boolean
  onLeave: () => void
}

function MyTeamStatus({
  myTeamId,
  teams,
  participants,
  studentGroupingLocked,
  busy,
  onLeave,
}: MyTeamStatusProps) {
  if (myTeamId === null) return null

  const team = teams[myTeamId]
  if (!team) return null

  const members = team.memberIds
    .map((id) => participants[id])
    .filter((p): p is StudentSafeParticipant => p !== undefined)
  const names = members.map((p) => p.name).join(', ')

  return (
    <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-amber-800">
          {team.groupName ?? 'Your team'}
        </p>
        <p className="text-xs text-amber-700 mt-0.5">{names}</p>
      </div>
      {!studentGroupingLocked && (
        <button
          type="button"
          disabled={busy}
          onClick={onLeave}
          className="rounded-md border border-amber-400 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
        >
          Leave team
        </button>
      )}
    </div>
  )
}
