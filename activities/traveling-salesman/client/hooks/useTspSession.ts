import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useResilientWebSocket,
  type UseResilientWebSocketOptions,
} from '@src/hooks/useResilientWebSocket'
import type {
  ManagerLeaderboardEntry,
  TspSessionData,
  TspSessionMessage,
} from '../utils/tspUtilsTypes'

interface UseTspSessionOptions {
  sessionId?: string
  buildWsUrl?: UseResilientWebSocketOptions['buildUrl']
  shouldReconnect?: boolean
  refreshTypes?: string[]
  refreshDelay?: number
  includeLeaderboard?: boolean
  onMessage?: (message: TspSessionMessage) => void
  onOpen?: () => void
  onSession?: (session: TspSessionData) => void
  attachSessionEndedHandler?: (ws: WebSocket) => void
}

interface UseTspSessionResult {
  session: TspSessionData | null
  leaderboard: ManagerLeaderboardEntry[]
  fetchSession: () => Promise<void>
  fetchLeaderboard: () => Promise<void>
  scheduleRefresh: () => void
  connect: () => WebSocket | null
  disconnect: () => void
  setSession: (session: TspSessionData | null) => void
  setLeaderboard: (leaderboard: ManagerLeaderboardEntry[]) => void
}

export function shouldRefreshForMessageType(messageType: unknown, refreshTypes: string[]): boolean {
  return typeof messageType === 'string' && refreshTypes.includes(messageType)
}

export function useTspSession({
  sessionId,
  buildWsUrl,
  shouldReconnect = Boolean(sessionId),
  refreshTypes = [],
  refreshDelay = 100,
  includeLeaderboard = false,
  onMessage,
  onOpen,
  onSession,
  attachSessionEndedHandler,
}: UseTspSessionOptions): UseTspSessionResult {
  const [session, setSession] = useState<TspSessionData | null>(null)
  const [leaderboard, setLeaderboard] = useState<ManagerLeaderboardEntry[]>([])
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchSession = useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await fetch(`/api/traveling-salesman/${sessionId}/session`)
      if (!res.ok) throw new Error('Failed to fetch session')
      const data = (await res.json()) as TspSessionData
      setSession(data)
      onSession?.(data)
    } catch (err) {
      console.error('Failed to fetch session:', err)
    }
  }, [sessionId, onSession])

  const fetchLeaderboard = useCallback(async () => {
    if (!sessionId || !includeLeaderboard) return
    try {
      const res = await fetch(`/api/traveling-salesman/${sessionId}/leaderboard`)
      if (!res.ok) throw new Error('Failed to fetch leaderboard')
      const data = (await res.json()) as { leaderboard?: ManagerLeaderboardEntry[] }
      setLeaderboard(Array.isArray(data.leaderboard) ? data.leaderboard : [])
    } catch (err) {
      console.error('Failed to fetch leaderboard:', err)
    }
  }, [sessionId, includeLeaderboard])

  const scheduleRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) return
    refreshTimeoutRef.current = setTimeout(() => {
      refreshTimeoutRef.current = null
      void fetchSession()
      void fetchLeaderboard()
    }, refreshDelay)
  }, [fetchSession, fetchLeaderboard, refreshDelay])

  const handleWsMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data) as TspSessionMessage
        onMessage?.(message)
        if (shouldRefreshForMessageType(message.type, refreshTypes)) {
          scheduleRefresh()
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err)
      }
    },
    [onMessage, refreshTypes, scheduleRefresh],
  )

  const { connect, disconnect } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect,
    onOpen: () => {
      void fetchSession()
      void fetchLeaderboard()
      onOpen?.()
    },
    onMessage: handleWsMessage,
    attachSessionEndedHandler,
  })

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current)
      }
    }
  }, [])

  return {
    session,
    leaderboard,
    fetchSession,
    fetchLeaderboard,
    scheduleRefresh,
    connect,
    disconnect,
    setSession,
    setLeaderboard,
  }
}
