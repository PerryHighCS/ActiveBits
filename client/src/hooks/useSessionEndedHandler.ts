import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import { useNavigate } from 'react-router-dom'

interface SessionEndedMessage {
  type?: unknown
}

export interface WebSocketMessageEventLike {
  data: unknown
}

export interface WebSocketMessageTargetLike {
  addEventListener(type: 'message', listener: (event: WebSocketMessageEventLike) => void): void
  removeEventListener(type: 'message', listener: (event: WebSocketMessageEventLike) => void): void
}

export type SessionEndedWebSocketRef = MutableRefObject<WebSocketMessageTargetLike | null> | null

function isSessionEndedMessage(message: unknown): message is { type: 'session-ended' } {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as SessionEndedMessage).type === 'session-ended'
  )
}

export function isSessionEndedMessageData(
  data: unknown,
  onParseError?: (error: unknown) => void,
): boolean {
  try {
    const message = JSON.parse(data as string)
    return isSessionEndedMessage(message)
  } catch (error) {
    onParseError?.(error)
    return false
  }
}

/**
 * useSessionEndedHandler - Custom hook to handle session-ended WebSocket messages
 * Automatically redirects to /session-ended when the session is terminated
 *
 * Usage in student components:
 * ```
 * const wsRef = useRef(null);
 * const attachSessionEndedHandler = useSessionEndedHandler(wsRef);
 *
 * useEffect(() => {
 *   const ws = new WebSocket(url);
 *   wsRef.current = ws;
 *   attachSessionEndedHandler(ws); // Attach handler after creating WebSocket
 *   // ... rest of setup
 * }, []);
 * ```
 *
 * @returns Function to attach handler to a WebSocket
 */
export function useSessionEndedHandler(wsRef: SessionEndedWebSocketRef = null) {
  const navigate = useNavigate()
  const cleanupRef = useRef<(() => void) | null>(null)
  // Track last WebSocket to avoid adding multiple listeners to the same instance
  const lastWsRef = useRef<WebSocketMessageTargetLike | null>(null)

  const attachHandler = useCallback(
    (ws: WebSocketMessageTargetLike | null | undefined) => {
      if (!ws) return

      // Clean up previous listener if any
      if (cleanupRef.current) {
        cleanupRef.current()
      }

      const handleMessage = (event: WebSocketMessageEventLike) => {
        const isSessionEnded = isSessionEndedMessageData(event.data, (error) => {
          // Silently ignore non-JSON messages (e.g., 'ping', 'pong') and JSON parse errors.
          if (import.meta.env?.DEV) {
            console.debug('[useSessionEndedHandler] Ignored non-JSON message:', event.data, error)
          }
        })

        if (isSessionEnded) {
          void navigate('/session-ended')
        }
      }

      ws.addEventListener('message', handleMessage)
      lastWsRef.current = ws

      cleanupRef.current = () => {
        ws.removeEventListener('message', handleMessage)
        if (lastWsRef.current === ws) {
          lastWsRef.current = null
        }
      }
    },
    [navigate],
  )

  useEffect(() => {
    if (!wsRef || !wsRef.current) return undefined
    if (wsRef.current === lastWsRef.current) return undefined

    attachHandler(wsRef.current)
    return () => cleanupRef.current?.()
  }, [attachHandler, wsRef])

  // Ensure cleanup on unmount
  useEffect(() => () => cleanupRef.current?.(), [])

  return attachHandler
}
