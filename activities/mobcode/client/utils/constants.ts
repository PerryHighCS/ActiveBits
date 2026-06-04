import type { MobCodeThemeId } from '../../shared/types'

export const DEFAULT_GROUP_ID = 'default'

export const MOB_CODE_MESSAGE_TYPES = {
  STATE_SYNC: 'state-sync',
  FILE_CONTENT_UPDATE: 'file-content-update',
  ACTIVE_FILE_CHANGED: 'active-file-changed',
  FILE_TREE_CHANGED: 'file-tree-changed',
} as const

export const MOB_CODE_THEMES: Array<{ id: MobCodeThemeId; label: string }> = [
  { id: 'light', label: 'Light' },
  { id: 'one-dark', label: 'One Dark' },
  { id: 'github-light', label: 'GitHub Light' },
  { id: 'github-dark', label: 'GitHub Dark' },
]

export const DEFAULT_MOB_CODE_THEME: MobCodeThemeId = 'light'
export const MOB_CODE_THEME_COOKIE = 'mobcode-theme'
export const MOB_CODE_INSTRUCTOR_STORAGE_PREFIX = 'mobcode_instructor_'
