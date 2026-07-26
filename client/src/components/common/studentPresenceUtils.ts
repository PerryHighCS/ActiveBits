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

export function getStudentPresenceEmptyMessage(query: string, showDisconnected: boolean): string {
  if (query.trim()) return 'No students match your search.'
  return showDisconnected ? 'No students yet.' : 'No connected students yet.'
}

export function normalizeStudentPresence(value: unknown): StudentPresenceState {
  const source = value != null && typeof value === 'object' ? value as { connectedCount?: unknown; entries?: unknown; students?: unknown } : {}
  const candidates = Array.isArray(source.entries) ? source.entries : Array.isArray(source.students) ? source.students : []
  const entries = candidates.flatMap((candidate): StudentPresenceEntry[] => {
    if (candidate == null || typeof candidate !== 'object') return []
    const record = candidate as { participantId?: unknown; studentId?: unknown; displayName?: unknown; name?: unknown; connected?: unknown; secondaryLabel?: unknown }
    const participantId = typeof record.participantId === 'string' ? record.participantId.trim() : typeof record.studentId === 'string' ? record.studentId.trim() : ''
    if (!participantId) return []
    const displayName = typeof record.displayName === 'string' ? record.displayName.trim() : typeof record.name === 'string' ? record.name.trim() : ''
    const secondaryLabel = typeof record.secondaryLabel === 'string' ? record.secondaryLabel.trim() : ''
    return [{ participantId, displayName: displayName || 'Student', connected: record.connected === true, ...(secondaryLabel ? { secondaryLabel } : {}) }]
  }).sort((left, right) => Number(right.connected) - Number(left.connected) || left.displayName.localeCompare(right.displayName) || left.participantId.localeCompare(right.participantId))
  const suppliedCount = typeof source.connectedCount === 'number' && Number.isInteger(source.connectedCount) && source.connectedCount >= 0 ? source.connectedCount : null
  return { entries, connectedCount: suppliedCount ?? entries.filter((entry) => entry.connected).length }
}
