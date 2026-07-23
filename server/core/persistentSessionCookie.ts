export const MAX_PERSISTENT_SESSIONS_PER_COOKIE = 20
export const MAX_PERSISTENT_SESSIONS_COOKIE_BYTES = 3_600

interface PersistentSessionCookieEntry {
  key: string
}

export function getPersistentSessionCookieValueByteLength(entries: readonly PersistentSessionCookieEntry[]): number {
  return Buffer.byteLength(encodeURIComponent(JSON.stringify(entries)), 'utf8')
}

/**
 * Keep the httpOnly instructor-code cookie below browser cookie-size limits.
 * Persistent session metadata remains server-side; this cookie is only the
 * browser's remembered teacher-authentication handoff. Express percent-encodes
 * the JSON value before emitting it, so size the encoded value that browsers
 * actually receive rather than the raw JSON string.
 */
export function boundPersistentSessionCookieEntries<T extends PersistentSessionCookieEntry>(
  entries: readonly T[],
): T[] {
  const candidates = entries.slice(-MAX_PERSISTENT_SESSIONS_PER_COOKIE)
  let bounded: T[] = []

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]
    if (!candidate) {
      continue
    }

    const next = [candidate, ...bounded]
    if (getPersistentSessionCookieValueByteLength(next) <= MAX_PERSISTENT_SESSIONS_COOKIE_BYTES) {
      bounded = next
    }
  }

  return bounded
}
