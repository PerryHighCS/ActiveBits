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
  // The exact socket the most recent disconnect() tore down, cleared as soon as
  // a new connect() runs. Lets onclose tell a standalone teardown (deliver
  // onClose so consumers can clean up) from a socket left behind by a
  // disconnect()+reconnect() or a bare supersede (stale - suppress).
  const manuallyDisconnectedSocketRef = useRef<WebSocket | null>(null)
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
      manuallyDisconnectedSocketRef.current = socketRef.current
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
    manuallyDisconnectedSocketRef.current = null
    clearReconnectTimeout()

    const ws = new WebSocket(url)

    if (socketRef.current && socketRef.current !== ws) {
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
      const currentSocket = socketRef.current
      const isLatestSocket = currentSocket === ws
      // Deliver this close only if it concerns the consumer's connection:
      //  - this socket is still the current one, or
      //  - this exact socket was torn down by a standalone disconnect() with
      //    nothing reconnected since (WwwSim relies on that to clear its
      //    heartbeat/keepalive intervals).
      // Suppress a socket that was merely superseded by a later connect(), or
      // one left behind after disconnect()+reconnect(): an empty slot is not
      // proof this socket was the one disconnect() closed, and a stale close
      // must never mark the live replacement disconnected.
      const wasStandaloneDisconnect = manuallyDisconnectedSocketRef.current === ws
      if (!isLatestSocket && !wasStandaloneDisconnect) {
        return
      }
      onCloseRef.current?.(event, ws)
      if (isLatestSocket) {
        socketRef.current = null
      }
      if (wasStandaloneDisconnect) {
        manuallyDisconnectedSocketRef.current = null
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
