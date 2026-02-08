export interface Challenge {
  type?: 'list' | 'other' | string
  expected?: string | number
}

export function normalizeListAnswer(text: string): string {
  if (!text) return ''
  const trimmed = text.trim()
  if (!trimmed) return ''
  const noBrackets = trimmed.replace(/^\[|\]$/g, '')
  return noBrackets
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => token.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1'))
    .join(',')
}

export function normalizeExpected(challenge: Challenge | null | undefined): string {
  if (!challenge || challenge.expected === undefined) return ''
  if (challenge.type === 'list') {
    return normalizeListAnswer(String(challenge.expected))
  }
  return String(challenge.expected).trim()
}
