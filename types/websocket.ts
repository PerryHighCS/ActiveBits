export interface ActiveBitsWebSocket {
  sessionId?: string | null
  isAlive?: boolean
  clientIp?: string
  readyState: number
  send(data: string): void
  on(event: string, listener: (...args: unknown[]) => void): void
  once(event: string, listener: (...args: unknown[]) => void): void
  close(code?: number, reason?: string): void
  terminate?: () => void
  ping?: (data?: string) => void
}

export interface WsRouter {
  wss: {
    clients: Set<ActiveBitsWebSocket>
  }
  register(pathname: string, handler: (ws: ActiveBitsWebSocket, query: URLSearchParams, wss: WsRouter['wss']) => void): void
}

export interface WebSocketMessage {
  type: string
  payload?: unknown
}
