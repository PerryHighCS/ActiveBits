import { useEffect, useMemo, useRef, useState } from 'react'
import {
  clearEmbeddedManagerTokenFromUrl,
  readEmbeddedManagerToken,
  requestEmbeddedManagerBootstrapRefresh,
} from '@src/components/common/embeddedManagerBootstrap'

type EmbeddedManagerPasscodeResponse = { instructorPasscode?: unknown }

export const MAX_EMBEDDED_MANAGER_BOOTSTRAP_REFRESH_ATTEMPTS = 3

export function nextEmbeddedManagerBootstrapRefreshAttempt(
  currentAttempt: number,
  maxAttempts = MAX_EMBEDDED_MANAGER_BOOTSTRAP_REFRESH_ATTEMPTS,
): number | null {
  if (!Number.isInteger(currentAttempt) || currentAttempt < 0 || currentAttempt >= maxAttempts) {
    return null
  }
  return currentAttempt + 1
}

type EmbeddedManagerPasscodeFetch = (
  input: string,
  init: RequestInit,
) => Promise<{ ok: boolean; json(): Promise<unknown> }>

export async function fetchEmbeddedManagerPasscode(params: {
  sessionId: string
  token: string
  fetchImpl?: EmbeddedManagerPasscodeFetch
}): Promise<string | null> {
  const fetchImpl = params.fetchImpl ?? fetch
  const response = await fetchImpl(
    `/api/syncdeck/embedded-manager-passcode?sessionId=${encodeURIComponent(params.sessionId)}&token=${encodeURIComponent(params.token)}`,
    { credentials: 'same-origin', cache: 'no-store' },
  )
  if (!response.ok) return null

  const payload = await response.json() as EmbeddedManagerPasscodeResponse
  const passcode = typeof payload.instructorPasscode === 'string' ? payload.instructorPasscode.trim() : ''
  return passcode || null
}

export function useEmbeddedManagerPasscodeExchange(params: {
  sessionId: string | undefined
  search: string
  enabled?: boolean
}): {
  passcode: string | null
  isResolving: boolean
  error: unknown | null
} {
  const token = useMemo(() => readEmbeddedManagerToken(params.search), [params.search])
  const exchangeKey = params.enabled !== false && params.sessionId && token
    ? `${params.sessionId}:${token}`
    : null
  const [state, setState] = useState<{ key: string | null; passcode: string | null; error: unknown | null; isResolving: boolean }>({
    key: null,
    passcode: null,
    error: null,
    isResolving: false,
  })
  const refreshAttemptsBySessionIdRef = useRef<Map<string, number>>(new Map())

  const requestRefresh = (sessionId: string): void => {
    const nextAttempt = nextEmbeddedManagerBootstrapRefreshAttempt(
      refreshAttemptsBySessionIdRef.current.get(sessionId) ?? 0,
    )
    if (nextAttempt == null) {
      return
    }
    refreshAttemptsBySessionIdRef.current.set(sessionId, nextAttempt)
    requestEmbeddedManagerBootstrapRefresh(sessionId)
  }

  useEffect(() => {
    const sessionId = params.sessionId
    if (!exchangeKey || !sessionId || !token) {
      return
    }

    let cancelled = false
    void (async () => {
      // Let React StrictMode's setup/cleanup pass cancel before consuming the single-use token.
      await Promise.resolve()
      if (cancelled) return
      setState({ key: exchangeKey, passcode: null, error: null, isResolving: true })

      try {
        const passcode = await fetchEmbeddedManagerPasscode({ sessionId, token })
        if (cancelled) return
        // The one-time token has now been presented, even if the server could
        // not exchange it. Parent-mediated recovery supplies any replacement.
        clearEmbeddedManagerTokenFromUrl()
        if (passcode) {
          refreshAttemptsBySessionIdRef.current.delete(sessionId)
        } else {
          requestRefresh(sessionId)
        }
        setState({ key: exchangeKey, passcode, error: null, isResolving: false })
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to exchange embedded manager token:', error)
          clearEmbeddedManagerTokenFromUrl()
          requestRefresh(sessionId)
          setState({ key: exchangeKey, passcode: null, error, isResolving: false })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [exchangeKey, params.sessionId, token])

  const isResolving = exchangeKey !== null && (state.key !== exchangeKey || state.isResolving)
  return {
    passcode: state.key === exchangeKey ? state.passcode : null,
    isResolving,
    error: state.key === exchangeKey ? state.error : null,
  }
}
