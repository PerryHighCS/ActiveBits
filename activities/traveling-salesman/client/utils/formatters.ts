export function formatDistance(value: unknown): string {
  if (value === null || value === undefined) return '—'
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return num.toFixed(1)
}

export function formatTime(value: unknown): string {
  if (value === null || value === undefined) return '—'
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  if (Number.isInteger(num)) return `${num}s`
  return `${num.toFixed(3)}s`
}
