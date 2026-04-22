import { useCallback, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import type { ManagerParticipant, ManagerSnapshot } from '../hooks/useCommissionedIdeasSession.js'

interface RegistrationDashboardProps {
  sessionId: string
  instructorPasscode: string
  snapshot: ManagerSnapshot
}

interface EditState {
  participantId: string
  name: string
}

export default function RegistrationDashboard({
  sessionId,
  instructorPasscode,
  snapshot,
}: RegistrationDashboardProps) {
  const [editState, setEditState] = useState<EditState | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const joinUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/${sessionId}` : `/${sessionId}`

  const roster = Object.values(snapshot.participantRoster).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  const totalCount = roster.length
  const connectedCount = roster.filter((p) => p.connected && !p.rejectedByInstructor).length
  const rejectedCount = roster.filter((p) => p.rejectedByInstructor).length

  const callModerationEndpoint = useCallback(
    async (body: Record<string, unknown>) => {
      setSaving(true)
      setSaveError(null)
      try {
        const res = await fetch(`/api/commissioned-ideas/${sessionId}/participant-name`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Commissioned-Ideas-Instructor-Passcode': instructorPasscode,
          },
          body: JSON.stringify(body),
        })
        const data = (await res.json()) as { error?: string }
        if (!res.ok) {
          setSaveError(data.error ?? 'Could not save. Please try again.')
          return false
        }
        return true
      } catch {
        setSaveError('Network error — could not save')
        return false
      } finally {
        setSaving(false)
      }
    },
    [sessionId, instructorPasscode],
  )

  const handleSaveEdit = async () => {
    if (!editState) return
    const ok = await callModerationEndpoint({
      participantId: editState.participantId,
      name: editState.name,
    })
    if (ok) setEditState(null)
  }

  const handleReject = async (participantId: string) => {
    await callModerationEndpoint({ participantId, rejected: true })
  }

  const handleApprove = async (participantId: string) => {
    await callModerationEndpoint({ participantId, rejected: false })
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
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-gray-800">{totalCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">Registered</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-green-700">{connectedCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">Online</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <p className="text-2xl font-bold text-red-600">{rejectedCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">Rejected</p>
        </div>
      </div>

      {/* Error banner */}
      {saveError && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {saveError}
        </div>
      )}

      {/* Participant list */}
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        <div className="px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-700">Participants</h2>
        </div>

        {roster.length === 0 && (
          <p className="px-4 py-6 text-sm text-gray-400 italic text-center">
            No students have joined yet.
          </p>
        )}

        {roster.map((p) => (
          <ParticipantRow
            key={p.id}
            participant={p}
            editState={editState?.participantId === p.id ? editState : null}
            saving={saving}
            onStartEdit={() => setEditState({ participantId: p.id, name: p.name })}
            onEditNameChange={(name) => setEditState((s) => s ? { ...s, name } : null)}
            onSaveEdit={() => { void handleSaveEdit() }}
            onCancelEdit={() => { setEditState(null); setSaveError(null) }}
            onReject={() => { void handleReject(p.id) }}
            onApprove={() => { void handleApprove(p.id) }}
          />
        ))}
      </div>
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
      {/* Connection indicator */}
      <span
        aria-label={connected && !rejectedByInstructor ? 'Online' : 'Offline'}
        title={connected && !rejectedByInstructor ? 'Online' : 'Offline'}
        className={`h-2 w-2 rounded-full shrink-0 ${
          connected && !rejectedByInstructor ? 'bg-green-500' : 'bg-gray-300'
        }`}
      />

      {/* Name / edit field */}
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
          <span
            className={`text-sm ${rejectedByInstructor ? 'line-through text-gray-400' : 'text-gray-800'}`}
          >
            {name}
          </span>
        )}
        <span className="text-xs text-gray-400 font-mono ml-1">{id}</span>
      </div>

      {/* Actions */}
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
