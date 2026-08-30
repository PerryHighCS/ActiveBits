import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'

export type WebSocketUrlBuilder = (() => string | null | undefined) | string | null | undefined

export interface UseResilientWebSocketOptions {
  buildUrl?: WebSocketUrlBuilder
  shouldReconnect?: boolean
  connectOnMount?: boolean
  reconnectDelayBase?: number
  reconnectDelayMax?: number
  attachSessionEndedHandler?: (ws: WebSocket) => void
  onOpen?: (event: Event, ws: WebSocket) => void
  onMessage?: (event: MessageEvent, ws: WebSocket) => void
  onClose?: (event: CloseEvent, ws: WebSocket) => void
  onError?: (event: Event, ws: WebSocket) => void
  isTerminalClose?: (event: CloseEvent) => boolean
}

export interface UseResilientWebSocketResult {
  connect: () => WebSocket | null
  disconnect: () => void
  socketRef: MutableRefObject<WebSocket | null>
}

/**
 * Resolves a websocket URL from either a literal string or a callback.
 */
export function resolveWebSocketUrl(buildUrl: WebSocketUrlBuilder): string | null {
  const resolved = typeof buildUrl === 'function' ? buildUrl() : buildUrl
  return resolved ?? null
}

/**
 * Calculates exponential reconnect delay clamped to a maximum.
 */
export function getReconnectDelay(attempt: number, baseDelay: number, maxDelay: number): number {
  return Math.min(maxDelay, baseDelay * 2 ** attempt)
}

/**
 * useResilientWebSocket - Manages a WebSocket connection with automatic reconnects.
 */
export function useResilientWebSocket({
  buildUrl,
  shouldReconnect = true,
  connectOnMount = false,
  reconnectDelayBase = 1000,
  reconnectDelayMax = 30000,
  attachSessionEndedHandler,
  onOpen,
  onMessage,
  onClose,
  onError,
  isTerminalClose,
}: UseResilientWebSocketOptions = {}): UseResilientWebSocketResult {
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectFnRef = useRef<() => WebSocket | null>(() => null)
  const reconnectAttemptsRef = useRef(0)
  const manualCloseRef = useRef(false)
  // Sockets abandoned because a newer connect() replaced them. Their trailing
  // close event is not meaningful to the consumer and must stay suppressed
  // regardless of any later disconnect() on the hook.
  const replacedSocketsRef = useRef<WeakSet<WebSocket>>(new WeakSet())
  const onOpenRef = useRef(onOpen)
  const onMessageRef = useRef(onMessage)
  const onCloseRef = useRef(onClose)
  const onErrorRef = useRef(onError)
  const isTerminalCloseRef = useRef(isTerminalClose)

  useEffect(() => {
    isTerminalCloseRef.current = isTerminalClose
  }, [isTerminalClose])

  useEffect(() => {
    onOpenRef.current = onOpen
  }, [onOpen])

  useEffect(() => {
    onMessageRef.current = onMessage
  }, [onMessage])

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current !== null) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
  }, [])

  const disconnect = useCallback(() => {
    manualCloseRef.current = true
    clearReconnectTimeout()
    if (socketRef.current) {
      try {
        socketRef.current.close()
      } catch {
        // ignore close errors
      }
      socketRef.current = null
    }
  }, [clearReconnectTimeout])

  const connect = useCallback(() => {
    const url = resolveWebSocketUrl(buildUrl)
    if (!url) {
      return null
    }

    manualCloseRef.current = false
    clearReconnectTimeout()

    const ws = new WebSocket(url)

    if (socketRef.current && socketRef.current !== ws) {
      replacedSocketsRef.current.add(socketRef.current)
      try {
        socketRef.current.close()
      } catch {
        // ignore close errors
      }
    }
    socketRef.current = ws

    if (attachSessionEndedHandler) {
      attachSessionEndedHandler(ws)
    }

    ws.onopen = (event) => {
      if (socketRef.current !== ws) {
        try {
          ws.close()
        } catch {
          // Ignore a stale socket that has already closed.
        }
        return
      }
      reconnectAttemptsRef.current = 0
      onOpenRef.current?.(event, ws)
    }

    ws.onmessage = (event) => {
      if (socketRef.current !== ws) {
        return
      }
      onMessageRef.current?.(event, ws)
    }

    ws.onerror = (event) => {
      if (socketRef.current !== ws) {
        return
      }
      onErrorRef.current?.(event, ws)
    }

    ws.onclose = (event) => {
      // Suppress only a socket a newer connect() abandoned. A `disconnect()`
      // nulls socketRef synchronously, so an intentional close also arrives as
      // "not the latest socket" - but consumers still need it (e.g. WwwSim
      // clears its heartbeat/keepalive intervals only in onClose). Keying on a
      // per-socket replaced set instead of the hook-wide manualCloseRef means a
      // stale replaced socket stays suppressed even if a disconnect() lands
      // between its replacement and its delayed close.
      if (replacedSocketsRef.current.has(ws)) {
        return
      }
      const isLatestSocket = socketRef.current === ws
      onCloseRef.current?.(event, ws)
      if (isLatestSocket) {
        socketRef.current = null
      }
      if (!manualCloseRef.current && shouldReconnect && isLatestSocket && !isTerminalCloseRef.current?.(event)) {
        const delay = getReconnectDelay(
          reconnectAttemptsRef.current,
          reconnectDelayBase,
          reconnectDelayMax,
        )
        reconnectAttemptsRef.current += 1

        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectFnRef.current()
        }, delay)
      }
    }

    return ws
  }, [
    buildUrl,
    shouldReconnect,
    attachSessionEndedHandler,
    reconnectDelayBase,
    reconnectDelayMax,
    clearReconnectTimeout,
  ])

  useEffect(() => {
    reconnectFnRef.current = connect
  }, [connect])

  useEffect(() => {
    if (!connectOnMount) return undefined
    connect()
    return () => disconnect()
  }, [connectOnMount, connect, disconnect])

  useEffect(() => () => clearReconnectTimeout(), [clearReconnectTimeout])

  return { connect, disconnect, socketRef }
}
