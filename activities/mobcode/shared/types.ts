export interface MobCodeGroupState {
  files: Record<string, string>
  activeFile: string
}

export interface MobCodeSessionData extends Record<string, unknown> {
  groups: Record<string, MobCodeGroupState>
  instructorPasscode?: string
}

export type MobCodeStatePayload = MobCodeGroupState

export type MobCodeThemeId = 'light' | 'one-dark' | 'github-light' | 'github-dark'

export type MobCodeMessageType =
  | 'state-sync'
  | 'manager-auth'
  | 'file-content-update'
  | 'active-file-changed'
  | 'file-tree-changed'

export interface MobCodeMessage {
  type: MobCodeMessageType
  sessionId?: string
  timestamp?: number
  payload: unknown
}
