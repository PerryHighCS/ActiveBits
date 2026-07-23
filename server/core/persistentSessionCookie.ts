export const MAX_PERSISTENT_SESSIONS_PER_COOKIE = 20
export const MAX_PERSISTENT_SESSIONS_COOKIE_BYTES = 3_600

interface PersistentSessionCookieEntry {
  key: string
}

/**
 * Keep the httpOnly instructor-code cookie below browser cookie-size limits.
 * Persistent session metadata remains server-side; this cookie is only the
 * browser's remembered teacher-authentication handoff.
 */
export function boundPersistentSessionCookieEntries<T extends PersistentSessionCookieEntry>(
  entries: readonly T[],
): T[] {
  let bounded = entries.slice(-MAX_PERSISTENT_SESSIONS_PER_COOKIE)

  while (
    bounded.length > 1
    && Buffer.byteLength(JSON.stringify(bounded), 'utf8') > MAX_PERSISTENT_SESSIONS_COOKIE_BYTES
  ) {
    bounded = bounded.slice(1)
  }

  return bounded
}
