/**
 * Reads the one-time SyncDeck manager token from an embedded child manager URL.
 */
export function readEmbeddedManagerToken(search: string): string | null {
  const token = new URLSearchParams(search).get('embeddedManagerToken')
  return typeof token === 'string' && token.trim().length > 0 ? token.trim() : null
}
