export function buildRangeSequence(start, stop, step) {
  const values = [];
  if (step === 0) return values;
  if (step > 0) {
    for (let current = start; current < stop; current += step) {
      values.push(current);
    }
  } else {
    for (let current = start; current > stop; current += step) {
      values.push(current);
    }
  }
  return values;
}
