export function buildRangeSequence(start: number, stop: number, step: number): number[] {
  const values: number[] = []
  if (step === 0) return values
  if (step > 0) {
    for (let current = start; current < stop; current += step) {
      values.push(current)
    }
  } else {
    for (let current = start; current > stop; current += step) {
      values.push(current)
    }
  }
  return values
}
