interface BroadcastClient {
  readyState: number
  sessionId?: string | null
  send(payload: string): void
}

interface BroadcastSessions {
  subscribeToBroadcast?: (channel: string, handler: (message: unknown) => void) => void
}

interface BroadcastWsRouter {
  wss: {
    clients: Iterable<BroadcastClient>
  }
}

type BroadcastForwardPredicate = (client: BroadcastClient, message: unknown) => boolean

/**
 * Utility helpers for activity-level broadcast subscriptions.
 */

/**
 * Creates an ensureBroadcastSubscription helper for a given sessions store + ws router.
 * @param sessions Session store (may expose subscribeToBroadcast)
 * @param ws WebSocket router returned by createWsRouter
 * @returns Function that ensures per-session subscription at most once
 */
export function createBroadcastSubscriptionHelper(
  sessions: BroadcastSessions,
  ws: BroadcastWsRouter,
  shouldForward: BroadcastForwardPredicate = () => true,
) {
  const subscribedSessions = new Set<string>()

  return function ensureBroadcastSubscription(sessionId: string | null): void {
    if (sessions?.subscribeToBroadcast == null || sessionId == null || subscribedSessions.has(sessionId)) {
      return
    }

    const channel = `session:${sessionId}:broadcast`
    try {
      sessions.subscribeToBroadcast(channel, (message) => {
        const payload = JSON.stringify(message)
        for (const client of ws.wss.clients) {
          if (client.readyState === 1 && client.sessionId === sessionId && shouldForward(client, message)) {
            try {
              client.send(payload)
            } catch (err) {
              console.error('Failed to forward broadcast to client:', err)
            }
          }
        }
      })
      subscribedSessions.add(sessionId)
    } catch (err) {
      console.error(`Failed to subscribe to broadcast channel ${channel}:`, err)
    }
  }
}
