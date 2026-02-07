export interface Session<TData = Record<string, unknown>> {
  id: string
  type?: string
  created: number
  lastActivity?: number
  data: TData
  [key: string]: unknown
}

export interface SessionStore<TData = Record<string, unknown>> {
  get(id: string): Promise<Session<TData> | null>
  set(id: string, session: Session<TData>, ttl?: number | null): Promise<void>
  delete(id: string): Promise<boolean | void>
  touch(id: string): Promise<boolean | void>
  getAll(): Promise<Array<Session<TData>>>
  close(): Promise<void>
  getAllIds?(): Promise<string[]>
  cleanup?(): void
  subscribeToBroadcast?(channel: string, handler: (message: unknown) => void): void
  initializePubSub?(): void
  publishBroadcast?(channel: string, message: Record<string, unknown>): Promise<void>
  flushCache?(): Promise<void>
  ttlMs?: number
}
