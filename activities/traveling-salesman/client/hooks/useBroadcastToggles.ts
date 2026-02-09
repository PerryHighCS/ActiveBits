import { useCallback, useRef, useState } from 'react'
import type { LegendRouteLike, TspSessionMessage } from '../utils/tspUtilsTypes'

type BroadcastMessage = TspSessionMessage

interface UseBroadcastTogglesOptions {
  sessionId?: string
}

interface UseBroadcastTogglesResult {
  broadcastIds: string[]
  broadcastSnapshot: LegendRouteLike[]
  setBroadcasts: (next: string[]) => Promise<void>
  initializeBroadcasts: (next: unknown) => void
  handleBroadcastMessage: (message: BroadcastMessage) => void
}

export function nextBroadcastSnapshot(
  currentSnapshot: LegendRouteLike[],
  message: BroadcastMessage,
  broadcastIdsLength: number,
): LegendRouteLike[] {
  const payload = message.payload
  const routes =
    payload != null && typeof payload === 'object' && Array.isArray((payload as { routes?: unknown }).routes)
      ? (((payload as { routes?: unknown }).routes as unknown[]) ?? []).filter(
          (route): route is LegendRouteLike => Boolean(route) && typeof route === 'object',
        )
      : []

  if (message.type === 'broadcastUpdate') {
    return routes
  }

  if (message.type === 'clearBroadcast') {
    if (broadcastIdsLength > 0) {
      return currentSnapshot
    }
    return []
  }

  if (message.type === 'problemUpdate') {
    return []
  }

  return currentSnapshot
}

export function useBroadcastToggles({ sessionId }: UseBroadcastTogglesOptions = {}): UseBroadcastTogglesResult {
  const [broadcastIds, setBroadcastIds] = useState<string[]>([])
  const [broadcastSnapshot, setBroadcastSnapshot] = useState<LegendRouteLike[]>([])
  const didInitRef = useRef(false)

  const handleBroadcastMessage = useCallback(
    (message: BroadcastMessage) => {
      setBroadcastSnapshot((currentSnapshot) => nextBroadcastSnapshot(currentSnapshot, message, broadcastIds.length))
    },
    [broadcastIds.length],
  )

  const setBroadcasts = useCallback(
    async (next: string[]) => {
      setBroadcastIds(next)
      if (!sessionId) return
      await fetch(`/api/traveling-salesman/${sessionId}/set-broadcasts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broadcasts: next }),
      })
    },
    [sessionId],
  )

  const initializeBroadcasts = useCallback((next: unknown) => {
    if (!Array.isArray(next)) return
    if (didInitRef.current) return
    didInitRef.current = true
    setBroadcastIds(next.filter((id): id is string => typeof id === 'string'))
  }, [])

  return {
    broadcastIds,
    broadcastSnapshot,
    setBroadcasts,
    initializeBroadcasts,
    handleBroadcastMessage,
  }
}
