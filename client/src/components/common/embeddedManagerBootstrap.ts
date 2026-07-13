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

export const EMBEDDED_MANAGER_BOOTSTRAP_REFRESH_REQUEST = 'syncdeck-embedded-manager-bootstrap-refresh'

/**
 * Parses a credentialed child iframe's request for a replacement one-time
 * token. The request carries only the child session id, never a passcode.
 */
export function readEmbeddedManagerBootstrapRefreshRequest(payload: unknown): string | null {
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  const request = payload as { type?: unknown; childSessionId?: unknown }
  if (request.type !== EMBEDDED_MANAGER_BOOTSTRAP_REFRESH_REQUEST || typeof request.childSessionId !== 'string') {
    return null
  }

  const childSessionId = request.childSessionId.trim()
  return childSessionId.length > 0 ? childSessionId : null
}

/** Requests a replacement manager-entry token from the same-origin SyncDeck parent. */
export function requestEmbeddedManagerBootstrapRefresh(childSessionId: string): void {
  if (typeof window === 'undefined' || window.parent === window) {
    return
  }

  window.parent.postMessage({
    type: EMBEDDED_MANAGER_BOOTSTRAP_REFRESH_REQUEST,
    childSessionId,
  }, window.location.origin)
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
