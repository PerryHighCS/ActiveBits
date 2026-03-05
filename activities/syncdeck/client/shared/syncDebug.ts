export const SYNCDECK_DEBUG_QUERY_PARAM = 'syncdeckDebug'
export const SYNCDECK_DEBUG_STORAGE_KEY = 'syncdeck_debug'

export function isSyncDeckDebugEnabledFromValues(search: string | null, storageValue: string | null): boolean {
  if (typeof search === 'string') {
    try {
      const params = new URLSearchParams(search)
      if (params.get(SYNCDECK_DEBUG_QUERY_PARAM) === '1') {
        return true
      }
    } catch {
      // Ignore malformed query-string inputs.
    }
  }

  return storageValue === '1'
}

export function isSyncDeckDebugEnabled(win: Window | undefined = typeof window !== 'undefined' ? window : undefined): boolean {
  if (!win) {
    return false
  }

  const search = typeof win.location?.search === 'string' ? win.location.search : null

  const storageValue = (() => {
    try {
      return win.localStorage.getItem(SYNCDECK_DEBUG_STORAGE_KEY)
    } catch {
      return null
    }
  })()

  return isSyncDeckDebugEnabledFromValues(search, storageValue)
}
