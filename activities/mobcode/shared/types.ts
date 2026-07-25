export interface MobCodeGroupState {
  files: Record<string, string>
  activeFile: string
}

/** A live participant's private, durable MobCode workspace. */
export interface MobCodeStudentWorkspace extends MobCodeGroupState {
  participantId: string
  displayName: string
  createdAt: number
  updatedAt: number
}

export interface MobCodeSharedExample {
  sourceParticipantId: string
  workspace: MobCodeGroupState
  sharedAt: number
}

/**
 * Collaboration state is intentionally MobCode-owned. `groups.default` remains the
 * instructor workspace so existing live and solo sessions retain their contract.
 */
export interface MobCodeStudentCodeState {
  tryItEnabled: boolean
  starterVersion: MobCodeGroupState | null
  studentWorkspaces: Record<string, MobCodeStudentWorkspace>
  sharedExample: MobCodeSharedExample | null
}

export interface MobCodeSessionData extends Record<string, unknown> {
  groups: Record<string, MobCodeGroupState>
  instructorPasscode?: string
  /** Opaque, per-session credential for a self-paced student workspace. */
  soloEditToken?: string
  soloMode?: boolean
  studentCode?: MobCodeStudentCodeState
}

export type MobCodeStatePayload = MobCodeGroupState

export type MobCodeThemeId = 'light' | 'one-dark' | 'github-light' | 'github-dark'

export const MOB_CODE_RUNNER_IDS = ['brython-terminal'] as const

export type MobCodeRunnerId = typeof MOB_CODE_RUNNER_IDS[number]

export function isMobCodeRunnerId(value: unknown): value is MobCodeRunnerId {
  return typeof value === 'string' && (MOB_CODE_RUNNER_IDS as readonly string[]).includes(value)
}

export interface MobCodeSelectionRange {
  anchor: number
  head: number
}

export interface MobCodeEditorPresencePayload {
  path: string
  selections: MobCodeSelectionRange[]
}

export type MobCodeMessageType =
  | 'state-sync'
  | 'manager-auth'
  | 'file-content-update'
  | 'active-file-changed'
  | 'editor-presence-update'
  | 'file-tree-changed'
  | 'student-code-updated'
  | 'student-code-settings-changed'

export interface MobCodeMessage {
  type: MobCodeMessageType
  sessionId?: string
  timestamp?: number
  /** The logical workspace receiving this event; never trusts client authorization. */
  workspaceId?: string
  payload: unknown
}
