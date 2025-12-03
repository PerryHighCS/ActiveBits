/**
 * Utility helpers for activity-level broadcast subscriptions.
 */

/**
 * Creates an ensureBroadcastSubscription helper for a given sessions store + ws router.
 * @param {object} sessions - Session store (may expose subscribeToBroadcast)
 * @param {object} ws - WebSocket router returned by createWsRouter
 * @returns {(sessionId: string | null) => void}
 */
export function createBroadcastSubscriptionHelper(sessions, ws) {
  const subscribedSessions = new Set();

  return function ensureBroadcastSubscription(sessionId) {
    if (
      !sessions?.subscribeToBroadcast ||
      !sessionId ||
      subscribedSessions.has(sessionId)
    ) {
      return;
    }

    const channel = `session:${sessionId}:broadcast`;
    try {
      sessions.subscribeToBroadcast(channel, (message) => {
        const payload = JSON.stringify(message);
        for (const client of ws.wss.clients) {
          if (client.readyState === 1 && client.sessionId === sessionId) {
            try {
              client.send(payload);
            } catch (err) {
              console.error('Failed to forward broadcast to client:', err);
            }
          }
        }
      });
      subscribedSessions.add(sessionId);
    } catch (err) {
      console.error(`Failed to subscribe to broadcast channel ${channel}:`, err);
    }
  };
}
