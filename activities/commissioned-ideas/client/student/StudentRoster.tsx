import type { StudentSafeParticipant } from '../../shared/types.js'

interface StudentRosterProps {
  participants: Record<string, StudentSafeParticipant>
  myParticipantId: string
  phase: string
}

export default function StudentRoster({ participants, myParticipantId, phase }: StudentRosterProps) {
  const list = Object.values(participants).sort((a, b) => a.name.localeCompare(b.name))
  const ungrouped = list.filter((p) => p.teamId === null)
  const grouped = list.filter((p) => p.teamId !== null)

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-700">
          {phase === 'registration' ? 'Students' : 'Participants'} ({list.length})
        </h2>
      </div>

      {list.length === 0 && (
        <p className="text-sm text-gray-400 italic">Waiting for classmates to join…</p>
      )}

      {ungrouped.length > 0 && (
        <section aria-label="Ungrouped students">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            Ungrouped ({ungrouped.length})
          </h3>
          <ul className="space-y-1">
            {ungrouped.map((p) => (
              <li
                key={p.id}
                aria-current={p.id === myParticipantId ? 'true' : undefined}
                className={`text-sm px-3 py-1.5 rounded-lg ${
                  p.id === myParticipantId
                    ? 'bg-amber-100 text-amber-800 font-medium'
                    : 'text-gray-700'
                }`}
              >
                {p.name}
                {p.id === myParticipantId && (
                  <span className="ml-1 text-amber-600 text-xs">(you)</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {grouped.length > 0 && (
        <section aria-label="Grouped students" className="mt-4">
          <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
            In teams ({grouped.length})
          </h3>
          <ul className="space-y-1">
            {grouped.map((p) => (
              <li
                key={p.id}
                aria-current={p.id === myParticipantId ? 'true' : undefined}
                className={`text-sm px-3 py-1.5 rounded-lg ${
                  p.id === myParticipantId
                    ? 'bg-amber-100 text-amber-800 font-medium'
                    : 'text-gray-700'
                }`}
              >
                {p.name}
                {p.id === myParticipantId && (
                  <span className="ml-1 text-amber-600 text-xs">(you)</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
