export function factorial(n: number): number {
  // Note: factorial grows fast and will exceed Number.MAX_SAFE_INTEGER for n >= 18.
  // Current max city count keeps (n - 1)! within safe integer range.
  let result = 1
  for (let i = 2; i <= n; i++) {
    result *= i
  }
  return result
}
