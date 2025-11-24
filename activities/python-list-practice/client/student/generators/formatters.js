export function formatForRangeDetail(label, start, stop, step) {
  const displayStep = step !== 1 ? `, ${step}` : '';
  const direction = step > 0 ? 'up' : 'down';
  const magnitude = Math.abs(step) === 1 ? '' : ` in jumps of ${Math.abs(step)}`;
  return `${label} uses range(${start}, ${stop}${displayStep}), so it counts ${direction}${magnitude} and stops before ${stop}.`;
}

export function formatRangeLenDetail(label, info) {
  const { start, stop, step } = info;
  const stepText = step === 1 ? '' : ` with a step of ${step}`;
  return `${label} walks indexes from ${start} up to ${stop} via range(len(list))${stepText}, stopping before ${stop}.`;
}

export function formatList(list) {
  return `[${list.map((v) => (typeof v === 'string' ? `'${v}'` : v)).join(', ')}]`;
}
