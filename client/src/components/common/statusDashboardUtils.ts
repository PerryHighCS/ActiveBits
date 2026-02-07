export interface StatusSession {
  id?: string
  type?: string
  socketCount?: number
  lastActivity?: string
  expiresAt?: string
  ttlRemainingMs?: number
  approxBytes?: number
}

export interface SessionRow {
  id?: string
  type: string
  socketCount: number
  lastActivity: string
  expiresAt: string
  ttl: string
  approxBytes: number | undefined
}

export function fmtInt(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '-'
}

export function fmtBytes(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let unitIndex = 0
  let normalizedValue = value

  while (normalizedValue >= 1024 && unitIndex < units.length - 1) {
    normalizedValue /= 1024
    unitIndex += 1
  }

  const fixed = normalizedValue < 10 ? normalizedValue.toFixed(1) : normalizedValue.toFixed(0)
  return `${fixed} ${units[unitIndex]}`
}

function parseTimestamp(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : 0
  return Number.isFinite(parsed) ? parsed : 0
}

export function buildByTypeEntries(
  activityIds: readonly string[],
  byType: Record<string, number | undefined> = {},
): Array<[string, number]> {
  const allTypes: Record<string, number> = {}

  for (const activityId of activityIds) {
    allTypes[activityId] = byType[activityId] ?? 0
  }

  return Object.entries(allTypes).sort(([left], [right]) => left.localeCompare(right))
}

export function buildSessionRows(list: readonly StatusSession[] = []): SessionRow[] {
  return [...list]
    .sort((left, right) => parseTimestamp(right.lastActivity) - parseTimestamp(left.lastActivity))
    .map((session) => ({
      id: session.id,
      type: session.type || '-',
      socketCount: session.socketCount || 0,
      lastActivity: session.lastActivity || '-',
      expiresAt: session.expiresAt || '-',
      ttl:
        typeof session.ttlRemainingMs === 'number'
          ? `${Math.max(0, Math.floor(session.ttlRemainingMs / 1000))}s`
          : '-',
      approxBytes: session.approxBytes,
    }))
}
