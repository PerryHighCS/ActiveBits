import type { MobCodeRunnerId } from '../../shared/types'

export interface MobCodeRunnerDefinition {
  id: MobCodeRunnerId
  label: string
  description: string
}

export interface MobCodeRunnerLaunchRequest {
  files: Record<string, string>
  activeFile: string
  sessionId?: string
  runnerId: MobCodeRunnerId
}

export interface MobCodeRunnerLaunchResult {
  opened: boolean
  reason?: 'missing-entry' | 'popup-blocked' | 'unknown-runner'
}

export interface MobCodeRunnerPopup {
  focus: () => void
  close?: () => void
  location?: { href?: string }
}

export interface MobCodeRunnerWindow {
  open: (url?: string | URL, target?: string, features?: string) => MobCodeRunnerPopup | null
  location?: { origin?: string }
}
