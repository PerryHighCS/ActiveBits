/**
 * Reads the one-time SyncDeck manager token from an embedded child manager URL.
 */
export function readEmbeddedManagerToken(search: string): string | null {
  const token = new URLSearchParams(search).get('embeddedManagerToken')
  return typeof token === 'string' && token.trim().length > 0 ? token.trim() : null
}

/** Removes the one-time manager token after a successful child-manager exchange. */
export function removeEmbeddedManagerToken(search: string): string {
  const params = new URLSearchParams(search)
  params.delete('embeddedManagerToken')
  const nextSearch = params.toString()
  return nextSearch ? `?${nextSearch}` : ''
}

/** Replaces the current same-origin URL without leaving a reusable token in history. */
export function clearEmbeddedManagerTokenFromUrl(): void {
  if (typeof window === 'undefined') return

  const nextSearch = removeEmbeddedManagerToken(window.location.search)
  if (nextSearch === window.location.search) return

  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${nextSearch}${window.location.hash}`,
  )
}
