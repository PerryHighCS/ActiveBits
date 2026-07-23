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
  let bounded = entries.slice(-MAX_PERSISTENT_SESSIONS_PER_COOKIE)

  while (
    bounded.length > 0
    && getPersistentSessionCookieValueByteLength(bounded) > MAX_PERSISTENT_SESSIONS_COOKIE_BYTES
  ) {
    bounded = bounded.slice(1)
  }

  return bounded
}
