export interface Session<TData = Record<string, unknown>> {
  id: string
  type?: string
  created: number
  lastActivity?: number
  data: TData
}

export interface SessionStore<TData = Record<string, unknown>> {
  get(id: string): Promise<Session<TData> | null>
  set(id: string, session: Session<TData>): Promise<void>
  delete?(id: string): Promise<void>
  getAll?(): Promise<Array<Session<TData>>>
  touch?(id: string): Promise<void>
  close?(): Promise<void>
}
