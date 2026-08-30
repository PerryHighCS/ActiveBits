import { useEffect, useMemo, useRef, useState } from 'react'
import {
  clearEmbeddedManagerTokenFromUrl,
  readEmbeddedManagerToken,
  requestEmbeddedManagerBootstrapRefresh,
} from '@src/components/common/embeddedManagerBootstrap'
import {
  EmbeddedManagerPasscodeExchangeUnavailableError,
  nextEmbeddedManagerBootstrapRefreshAttempt,
} from './useEmbeddedManagerPasscodeExchange'

type CapabilityFetch = (input: string, init: RequestInit) => Promise<{ ok: boolean; status?: number }>

export async function fetchEmbeddedManagerCapability(params: {
  sessionId: string
  token: string
  fetchImpl?: CapabilityFetch
}): Promise<boolean> {
  const response = await (params.fetchImpl ?? fetch)(
    `/api/syncdeck/embedded-manager-capability?sessionId=${encodeURIComponent(params.sessionId)}&token=${encodeURIComponent(params.token)}`,
    { credentials: 'same-origin', cache: 'no-store' },
  )
  if (response.ok) return true
  if (typeof response.status === 'number' && Number.isInteger(response.status) && response.status >= 500) {
    throw new EmbeddedManagerPasscodeExchangeUnavailableError(response.status)
  }
  return false
}

export function useEmbeddedManagerCapabilityExchange(params: {
  sessionId: string | undefined
  search: string
  enabled?: boolean
}): { isAuthorized: boolean; isResolving: boolean; error: unknown | null } {
  const token = useMemo(() => readEmbeddedManagerToken(params.search), [params.search])
  const exchangeKey = params.enabled !== false && params.sessionId && token ? `${params.sessionId}:${token}` : null
  const [state, setState] = useState({ key: null as string | null, isAuthorized: false, error: null as unknown | null, isResolving: false })
  const refreshAttemptsBySessionIdRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    const sessionId = params.sessionId
    if (!exchangeKey || !sessionId || !token) return
    let cancelled = false
    void (async () => {
      await Promise.resolve()
      if (cancelled) return
      setState({ key: exchangeKey, isAuthorized: false, error: null, isResolving: true })
      try {
        clearEmbeddedManagerTokenFromUrl()
        const isAuthorized = await fetchEmbeddedManagerCapability({ sessionId, token })
        if (cancelled) return
        if (isAuthorized) {
          refreshAttemptsBySessionIdRef.current.delete(sessionId)
        } else {
          const nextAttempt = nextEmbeddedManagerBootstrapRefreshAttempt(refreshAttemptsBySessionIdRef.current.get(sessionId) ?? 0)
          if (nextAttempt != null) {
            refreshAttemptsBySessionIdRef.current.set(sessionId, nextAttempt)
            requestEmbeddedManagerBootstrapRefresh(sessionId)
          }
        }
        setState({ key: exchangeKey, isAuthorized, error: null, isResolving: false })
      } catch (error) {
        if (!cancelled) setState({ key: exchangeKey, isAuthorized: false, error, isResolving: false })
      }
    })()
    return () => { cancelled = true }
  }, [exchangeKey, params.sessionId, token])

  return {
    isAuthorized: state.key === exchangeKey && state.isAuthorized,
    isResolving: exchangeKey !== null && (state.key !== exchangeKey || state.isResolving),
    error: state.key === exchangeKey ? state.error : null,
  }
}
