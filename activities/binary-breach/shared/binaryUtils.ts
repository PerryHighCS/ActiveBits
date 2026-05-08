export function maxUnsignedValueForBits(bits: number): number {
  if (!Number.isInteger(bits) || bits < 1 || bits > 16) return 0
  return (2 ** bits) - 1
}

export function decimalToBinary(value: number): string {
  if (!Number.isInteger(value) || value < 0) return ''
  return value.toString(2)
}

export function binaryToDecimal(binary: string): number | null {
  const normalized = normalizeBinaryAnswer(binary)
  if (normalized == null) return null
  return parseInt(normalized, 2)
}

export function normalizeBinaryAnswer(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/^0+(?=\d)/, '')
  const normalized = trimmed.length === 0 ? '0' : trimmed
  return /^[01]+$/.test(normalized) ? normalized : null
}

export function normalizeDecimalAnswer(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const trimmed = String(value).trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export function compareBinaryValues(left: string, right: string): number {
  const leftValue = binaryToDecimal(left) ?? 0
  const rightValue = binaryToDecimal(right) ?? 0
  return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1
}

export function orderBinaryValues(values: string[]): string[] {
  return [...values].sort((a, b) => {
    const delta = compareBinaryValues(a, b)
    return delta === 0 ? a.localeCompare(b) : delta
  })
}

export function buildPlaceValues(bits: number): number[] {
  const count = Math.max(1, Math.min(8, Math.floor(bits)))
  return Array.from({ length: count }, (_, index) => 2 ** (count - index - 1))
}

