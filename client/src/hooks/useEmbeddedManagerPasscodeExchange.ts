import { useEffect, useMemo, useState } from 'react'
import {
  clearEmbeddedManagerTokenFromUrl,
  readEmbeddedManagerToken,
} from '@src/components/common/embeddedManagerBootstrap'

type EmbeddedManagerPasscodeResponse = { instructorPasscode?: unknown }

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
        if (passcode) {
          clearEmbeddedManagerTokenFromUrl()
        }
        setState({ key: exchangeKey, passcode, error: null, isResolving: false })
      } catch (error) {
        if (!cancelled) {
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
