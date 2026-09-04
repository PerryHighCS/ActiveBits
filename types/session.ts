export const EMBEDDED_CHILD_SESSION_PREFIX = 'CHILD:'

export interface Session<TData = Record<string, unknown>> {
  id: string
  type?: string
  created: number
  lastActivity?: number
  mutationRevision?: number
  data: TData
  [key: string]: unknown
}

export interface SessionStore<TData = Record<string, unknown>> {
  get(id: string): Promise<Session<TData> | null>
  set(id: string, session: Session<TData>, ttl?: number | null): Promise<void>
  // `set()` does not bump `mutationRevision`. Once a session type adopts
  // `updateAtomic`/`compareAndSet` for any write, every writer for that type must
  // use it, or a plain `set()` will be silently lost against a concurrent
  // compare-and-set. See `SessionStore` in `server/core/sessions.ts`.
  compareAndSet?(
    id: string,
    expectedMutationRevision: number,
    session: Session<TData>,
    ttl?: number | null,
    expectedCreated?: number | null,
  ): Promise<Session<TData> | null>
  updateAtomic?(
    id: string,
    mutate: (session: Session<TData>) => Session<TData>,
    ttl?: number | null,
  ): Promise<Session<TData> | null>
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
