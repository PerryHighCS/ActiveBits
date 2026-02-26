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
}: UseResilientWebSocketOptions = {}): UseResilientWebSocketResult {
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectFnRef = useRef<() => WebSocket | null>(() => null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectConnectRef = useRef<(() => WebSocket | null) | null>(null)
  const manualCloseRef = useRef(false)
  const onOpenRef = useRef(onOpen)
  const onMessageRef = useRef(onMessage)
  const onCloseRef = useRef(onClose)
  const onErrorRef = useRef(onError)

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
      reconnectAttemptsRef.current = 0
      onOpenRef.current?.(event, ws)
    }

    ws.onmessage = (event) => {
      onMessageRef.current?.(event, ws)
    }

    ws.onerror = (event) => {
      onErrorRef.current?.(event, ws)
    }

    ws.onclose = (event) => {
      const isLatestSocket = socketRef.current === ws
      onCloseRef.current?.(event, ws)
      if (isLatestSocket) {
        socketRef.current = null
      }
      if (!manualCloseRef.current && shouldReconnect && isLatestSocket) {
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
