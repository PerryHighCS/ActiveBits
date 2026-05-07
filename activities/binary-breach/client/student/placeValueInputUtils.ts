export function toggleBinaryPlaceValueAnswer(answer: string, bits: number, index: number): string {
  const sanitized = answer.replace(/[^01]/g, '')
  const padded = sanitized.padStart(bits, '0').slice(-bits).split('')
  const currentBit = padded[index]
  if (currentBit == null) return sanitized
  padded[index] = currentBit === '1' ? '0' : '1'
  const next = padded.join('').replace(/^0+(?=\d)/, '')
  return next === '' ? '0' : next
}

export function appendCalculatorInput(expression: string, input: string): string {
  if (/^\d$/.test(input)) {
    return expression === '0' ? input : `${expression}${input}`
  }
  if (input !== '+' && input !== '-') return expression
  if (expression.length === 0) return input === '-' ? '-' : expression
  return /[+-]$/.test(expression) ? `${expression.slice(0, -1)}${input}` : `${expression}${input}`
}

export function backspaceCalculatorInput(expression: string): string {
  return expression.slice(0, -1)
}

export function evaluateCalculatorExpression(expression: string): string {
  const compact = expression.replace(/\s/g, '')
  if (!/^-?\d+(?:[+-]\d+)*$/.test(compact)) return expression
  const tokens = compact.match(/[+-]?\d+/g) ?? []
  const total = tokens.reduce((sum, token) => sum + Number.parseInt(token, 10), 0)
  return String(total)
}
