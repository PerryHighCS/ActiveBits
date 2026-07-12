export function consumeSessionDataToken<T extends { data: Record<string, unknown> }>(
  session: T | null | undefined,
  field: string,
  token: string,
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

  delete session.data[field]
  return session
}
