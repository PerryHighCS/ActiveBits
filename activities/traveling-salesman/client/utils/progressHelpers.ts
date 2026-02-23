export function getProgressLabel(progressCurrent: unknown, progressTotal: unknown): string {
  const current = Number(progressCurrent)
  const total = Number(progressTotal)
  if (!Number.isFinite(current) || !Number.isFinite(total)) return ''
  return `${current}/${total}`
}
