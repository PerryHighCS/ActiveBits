import { useCallback, useEffect, useRef } from 'react';

/**
 * useResilientWebSocket - Manages a WebSocket connection with automatic reconnects.
 *
 * @param {Object} options
 * @param {() => string|null} options.buildUrl - Function returning the WS URL (or null to skip connecting)
 * @param {boolean} [options.shouldReconnect=true] - Whether to automatically reconnect on close
 * @param {boolean} [options.connectOnMount=false] - Auto-connect when the hook mounts
 * @param {number} [options.reconnectDelayBase=1000] - Initial backoff delay in ms
 * @param {number} [options.reconnectDelayMax=30000] - Max backoff delay in ms
 * @param {(ws: WebSocket) => void} [options.attachSessionEndedHandler] - Optional helper to attach a listener
 * @param {(event: Event, ws: WebSocket) => void} [options.onOpen]
 * @param {(event: MessageEvent, ws: WebSocket) => void} [options.onMessage]
 * @param {(event: CloseEvent, ws: WebSocket) => void} [options.onClose]
 * @param {(event: Event, ws: WebSocket) => void} [options.onError]
 * @returns {{ connect: () => WebSocket|null, disconnect: () => void, socketRef: React.MutableRefObject<WebSocket|null> }}
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
} = {}) {
  const socketRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const manualCloseRef = useRef(false);
  const onOpenRef = useRef(onOpen);
  const onMessageRef = useRef(onMessage);
  const onCloseRef = useRef(onClose);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    manualCloseRef.current = true;
    clearReconnectTimeout();
    if (socketRef.current) {
      try {
        socketRef.current.close();
      } catch {
        // ignore close errors
      }
      socketRef.current = null;
    }
  }, [clearReconnectTimeout]);

  const connect = useCallback(() => {
    const url = typeof buildUrl === 'function' ? buildUrl() : buildUrl;
    if (!url) {
      return null;
    }

    manualCloseRef.current = false;
    clearReconnectTimeout();

    const ws = new WebSocket(url);

    if (socketRef.current && socketRef.current !== ws) {
      try {
        socketRef.current.close();
      } catch {
        // ignore close errors
      }
    }
    socketRef.current = ws;

    if (attachSessionEndedHandler) {
      attachSessionEndedHandler(ws);
    }

    ws.onopen = (event) => {
      reconnectAttemptsRef.current = 0;
      onOpenRef.current?.(event, ws);
    };

    ws.onmessage = (event) => {
      onMessageRef.current?.(event, ws);
    };

    ws.onerror = (event) => {
      onErrorRef.current?.(event, ws);
    };

    ws.onclose = (event) => {
      onCloseRef.current?.(event, ws);
      socketRef.current = null;
      if (!manualCloseRef.current && shouldReconnect) {
        const delay = Math.min(
          reconnectDelayMax,
          reconnectDelayBase * 2 ** reconnectAttemptsRef.current++
        );
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      }
    };

    return ws;
  }, [
    buildUrl,
    shouldReconnect,
    attachSessionEndedHandler,
    reconnectDelayBase,
    reconnectDelayMax,
    clearReconnectTimeout,
  ]);

  useEffect(() => {
    if (!connectOnMount) return undefined;
    connect();
    return () => disconnect();
  }, [connectOnMount, connect, disconnect]);

  useEffect(() => () => {
    clearReconnectTimeout();
  }, [clearReconnectTimeout]);

  return { connect, disconnect, socketRef };
}
