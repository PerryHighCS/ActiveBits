export function toggleDecimalPlaceValueAnswer(answer: string, power: number): string {
  const trimmed = answer.trim()
  const current = /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : 0
  const next = (current & power) === power ? current - power : current + power
  return String(Math.max(0, next))
}

export function toggleBinaryPlaceValueAnswer(answer: string, bits: number, index: number): string {
  const sanitized = answer.replace(/[^01]/g, '')
  const padded = sanitized.padStart(bits, '0').slice(-bits).split('')
  const currentBit = padded[index]
  if (currentBit == null) return sanitized
  padded[index] = currentBit === '1' ? '0' : '1'
  const next = padded.join('').replace(/^0+(?=\d)/, '')
  return next === '' ? '0' : next
}

export function getSelectedDecimalPlaceValues(answer: string, bits: number): number[] {
  const trimmed = answer.trim()
  const current = /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : 0
  return Array.from({ length: bits }, (_unused, index) => 2 ** (bits - index - 1))
    .filter((power) => (current & power) === power)
}
