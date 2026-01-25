export function getProgressLabel(progressCurrent, progressTotal) {
  const current = Number(progressCurrent);
  const total = Number(progressTotal);
  if (!Number.isFinite(current) || !Number.isFinite(total)) return '';
  return `${current}/${total}`;
}

