import React, { useMemo, useState } from 'react'

export interface StudentPresenceEntry {
  participantId: string
  displayName: string
  connected: boolean
  secondaryLabel?: string
}

export interface StudentPresenceState {
  connectedCount: number
  entries: StudentPresenceEntry[]
}

export function normalizeStudentPresence(value: unknown): StudentPresenceState {
  const source = value != null && typeof value === 'object' ? value as { connectedCount?: unknown; entries?: unknown; students?: unknown } : {}
  const candidates = Array.isArray(source.entries) ? source.entries : Array.isArray(source.students) ? source.students : []
  const entries = candidates.flatMap((candidate): StudentPresenceEntry[] => {
    if (candidate == null || typeof candidate !== 'object') return []
    const record = candidate as { participantId?: unknown; studentId?: unknown; displayName?: unknown; name?: unknown; connected?: unknown }
    const participantId = typeof record.participantId === 'string' ? record.participantId.trim() : typeof record.studentId === 'string' ? record.studentId.trim() : ''
    if (!participantId) return []
    const displayName = typeof record.displayName === 'string' ? record.displayName.trim() : typeof record.name === 'string' ? record.name.trim() : ''
    return [{ participantId, displayName: displayName || 'Student', connected: record.connected === true }]
  }).sort((left, right) => Number(right.connected) - Number(left.connected) || left.displayName.localeCompare(right.displayName) || left.participantId.localeCompare(right.participantId))
  const suppliedCount = typeof source.connectedCount === 'number' && Number.isFinite(source.connectedCount) && source.connectedCount >= 0 ? source.connectedCount : null
  return { entries, connectedCount: suppliedCount ?? entries.filter((entry) => entry.connected).length }
}

export function StudentPresenceToggleButton({ connectedCount, isOpen, onToggle, controlsId, label = 'Students' }: { connectedCount: number; isOpen: boolean; onToggle: () => void; controlsId: string; label?: string }) {
  return <button type="button" onClick={onToggle} aria-expanded={isOpen} aria-controls={controlsId} className="px-2 py-1 rounded border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">{label}: {connectedCount}</button>
}

export function StudentPresencePanel({ isOpen, onClose, entries, title = 'Connected Students', controlsId, renderRowActions }: { isOpen: boolean; onClose: () => void; entries: StudentPresenceEntry[]; title?: string; controlsId: string; renderRowActions?: (entry: StudentPresenceEntry) => React.ReactNode }) {
  const [query, setQuery] = useState('')
  const visible = useMemo(() => entries.filter((entry) => entry.connected && `${entry.displayName} ${entry.participantId}`.toLowerCase().includes(query.trim().toLowerCase())), [entries, query])
  return <aside id={controlsId} className={`h-full bg-white shadow-lg overflow-hidden transition-[width] duration-200 ${isOpen ? 'w-80 border-l border-gray-200' : 'w-0 border-l-0'}`} aria-hidden={!isOpen}>
    <div className="h-full flex flex-col"><div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between"><h2 className="text-base font-semibold text-gray-800">{title}</h2><button type="button" onClick={onClose} aria-label={`Close ${title}`} className="text-sm text-gray-600 hover:text-gray-900">Close</button></div>
      <div className="p-4"><label className="sr-only" htmlFor={`${controlsId}-search`}>Search students</label><input id={`${controlsId}-search`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search students" className="w-full rounded border border-gray-300 px-2 py-1 text-sm" /></div>
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">{visible.length === 0 ? <p className="text-sm text-gray-600">No connected students yet.</p> : visible.map((entry) => <div key={entry.participantId} className="flex items-center justify-between gap-2 px-3 py-2 rounded border border-gray-200 bg-gray-50"><p className="min-w-0 text-sm font-medium text-gray-800 truncate">{entry.displayName}</p>{renderRowActions?.(entry)}</div>)}</div>
    </div>
  </aside>
}
