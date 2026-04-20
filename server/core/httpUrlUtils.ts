export function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0
  } catch {
    return false
  }
}

export function normalizePossiblyEncodedHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  if (isValidHttpUrl(trimmed)) {
    return trimmed
  }

  let current = trimmed
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const decoded = decodeURIComponent(current)
      if (decoded === current) {
        return null
      }
      if (isValidHttpUrl(decoded)) {
        return decoded
      }
      current = decoded
    } catch {
      return null
    }
  }

  return null
}
