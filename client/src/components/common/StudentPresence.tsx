import React, { useMemo, useState } from 'react'
import type { StudentPresenceEntry } from './studentPresenceUtils'
export type { StudentPresenceEntry, StudentPresenceState } from './studentPresenceUtils'

export function StudentPresenceToggleButton({ connectedCount, isOpen, onToggle, controlsId, label = 'Students' }: { connectedCount: number; isOpen: boolean; onToggle: () => void; controlsId: string; label?: string }) {
  return <button id={`${controlsId}-toggle`} type="button" onClick={onToggle} aria-expanded={isOpen} aria-controls={controlsId} className="px-2 py-1 rounded border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">{label}: {connectedCount}</button>
}

export function StudentPresencePanel({ isOpen, onClose, entries, title = 'Connected Students', controlsId, showDisconnected = false, renderRowActions, renderRowContent, renderBadges, getRowClassName, getRowStyle }: { isOpen: boolean; onClose: () => void; entries: StudentPresenceEntry[]; title?: string; controlsId: string; showDisconnected?: boolean; renderRowActions?: (entry: StudentPresenceEntry) => React.ReactNode; renderRowContent?: (entry: StudentPresenceEntry) => React.ReactNode; renderBadges?: (entry: StudentPresenceEntry) => React.ReactNode; getRowClassName?: (entry: StudentPresenceEntry) => string | undefined; getRowStyle?: (entry: StudentPresenceEntry) => React.CSSProperties | undefined }) {
  const [query, setQuery] = useState('')
  const visible = useMemo(() => entries.filter((entry) => (showDisconnected || entry.connected) && `${entry.displayName} ${entry.participantId}`.toLowerCase().includes(query.trim().toLowerCase())), [entries, query, showDisconnected])
  if (!isOpen) return <aside id={controlsId} className="w-0" aria-hidden="true" />
  const close = () => { onClose(); document.getElementById(`${controlsId}-toggle`)?.focus() }
  return <aside id={controlsId} className="h-full w-80 border-l border-gray-200 bg-white shadow-lg overflow-hidden" aria-hidden="false">
    <div className="h-full flex flex-col"><div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between"><h2 className="text-base font-semibold text-gray-800">{title}</h2><button type="button" onClick={close} aria-label={`Close ${title}`} className="text-sm text-gray-600 hover:text-gray-900">Close</button></div>
      <div className="p-4"><label className="sr-only" htmlFor={`${controlsId}-search`}>Search students</label><input id={`${controlsId}-search`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search students" className="w-full rounded border border-gray-300 px-2 py-1 text-sm" /></div>
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">{visible.length === 0 ? <p className="text-sm text-gray-600">No connected students yet.</p> : visible.map((entry) => <div key={entry.participantId} className={`flex items-center justify-between gap-2 px-3 py-2 rounded border border-gray-200 bg-gray-50 ${getRowClassName?.(entry) ?? ''}`} style={getRowStyle?.(entry)}><div className="min-w-0">{renderRowContent?.(entry) ?? <p className="text-sm font-medium text-gray-800 truncate">{entry.displayName}</p>}{renderBadges?.(entry)}</div>{renderRowActions?.(entry)}</div>)}</div>
    </div>
  </aside>
}
