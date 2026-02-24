export interface ActiveBitsWebSocket {
  sessionId?: string | null
  isAlive?: boolean
  clientIp?: string
  upgradeHeaders?: Record<string, string | string[] | undefined>
  readyState: number
  send(data: string): void
  on(event: string, listener: (...args: unknown[]) => void): void
  once(event: string, listener: (...args: unknown[]) => void): void
  close(code?: number, reason?: string): void
  terminate(): void
  ping(data?: string | Buffer | ArrayBuffer | Buffer[], mask?: boolean, cb?: (err: Error) => void): void
}

export type WsConnectionHandler = (
  ws: ActiveBitsWebSocket,
  query: URLSearchParams,
  wss: WsRouter['wss'],
) => void

export interface WsRouter {
  wss: {
    clients: Set<ActiveBitsWebSocket>
    close(callback?: () => void): void
  }
  register(pathname: string, handler: WsConnectionHandler): void
}

export interface WebSocketMessage {
  type: string
  payload?: unknown
}
