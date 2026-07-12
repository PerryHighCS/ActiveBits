export function consumeSessionDataToken<T extends { data: Record<string, unknown> }>(
  session: T | null | undefined,
  field: string,
  token: string,
  now = Date.now(),
): T | null {
  if (!session) {
    return null
  }

  const entry = session.data[field]
  if (
    entry == null
    || typeof entry !== 'object'
    || Array.isArray(entry)
    || (entry as { value?: unknown }).value !== token
  ) {
    return null
  }

  const expiresAt = (entry as { expiresAt?: unknown }).expiresAt
  const hasExpiresAt = Object.prototype.hasOwnProperty.call(entry, 'expiresAt')
  if (
    hasExpiresAt
    && (
      typeof expiresAt !== 'number'
      || !Number.isFinite(expiresAt)
      || expiresAt <= now
    )
  ) {
    return null
  }

  delete session.data[field]
  return session
}
