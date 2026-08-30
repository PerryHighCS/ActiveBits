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

export type BroadcastForwardPredicate = (client: BroadcastClient, message: unknown) => boolean

/**
 * Maps a raw cross-instance broadcast envelope to the client-facing payload.
 * Use it to strip routing metadata (audience, origin, …) so a socket receives
 * the same shape whether delivery was local or via pub/sub. Defaults to identity.
 */
export type BroadcastMessageTransform = (message: unknown) => unknown

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
  transformMessage: BroadcastMessageTransform = (message) => message,
) {
  const subscribedSessions = new Set<string>()

  return function ensureBroadcastSubscription(sessionId: string | null): void {
    if (sessions?.subscribeToBroadcast == null || sessionId == null || subscribedSessions.has(sessionId)) {
      return
    }

    const channel = `session:${sessionId}:broadcast`
    try {
      sessions.subscribeToBroadcast(channel, (message) => {
        // `shouldForward` inspects the raw envelope (audience/origin); clients get
        // the transformed shape so local and pub/sub delivery look identical.
        // Broadcast payloads can originate from other instances/builds: treat the
        // transform + serialization as untrusted and fail closed for this one
        // message rather than throwing out of the subscription handler.
        let payload: string
        try {
          payload = JSON.stringify(transformMessage(message))
        } catch (err) {
          console.error(JSON.stringify({ event: 'broadcast.transform-failed', sessionId, error: String(err) }))
          return
        }
        for (const client of ws.wss.clients) {
          if (client.readyState === 1 && client.sessionId === sessionId) {
            try {
              if (!shouldForward(client, message)) continue
              client.send(payload)
            } catch (err) {
              console.error(JSON.stringify({ event: 'broadcast.forward-failed', sessionId, error: String(err) }))
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
