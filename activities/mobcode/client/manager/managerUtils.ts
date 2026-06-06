import type { MobCodeEditorPresencePayload, MobCodeMessage, MobCodeSelectionRange, MobCodeStatePayload } from '../../shared/types'

export interface LiveContentSyncPlan {
  sendImmediately: boolean
  delayMs: number
}

interface PendingMobCodeCleanupWorkOptions {
  hasPendingContent: boolean
  hasPendingPresence: boolean
  hasPendingPersist: boolean
  flushContent: () => void
  flushPresence: () => void
  flushPersist: () => void
}

export function parseMobCodeMessage(rawData: unknown): MobCodeMessage | null {
  if (typeof rawData !== 'string') return null
  try {
    const parsed = JSON.parse(rawData) as MobCodeMessage
    return parsed != null && typeof parsed === 'object' && typeof parsed.type === 'string' ? parsed : null
  } catch {
    return null
  }
}

export function isStatePayload(value: unknown): value is MobCodeStatePayload {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as Partial<MobCodeStatePayload>
  return (
    payload.files != null &&
    typeof payload.files === 'object' &&
    !Array.isArray(payload.files) &&
    typeof payload.activeFile === 'string'
  )
}

export function createStateSnapshot(files: Record<string, string>, activeFile: string): MobCodeStatePayload {
  return { files, activeFile }
}

export function applyContentChange(
  current: MobCodeStatePayload,
  path: string,
  content: string,
): MobCodeStatePayload {
  return {
    files: { ...current.files, [path]: content },
    activeFile: current.activeFile,
  }
}

export function applyActiveFileChange(current: MobCodeStatePayload, activeFile: string): MobCodeStatePayload {
  return {
    files: current.files,
    activeFile,
  }
}

export function shouldApplyRemoteStateMessage(type: MobCodeMessage['type'], canEdit: boolean): boolean {
  if (!canEdit) return true
  return type !== 'state-sync' && type !== 'file-tree-changed'
}

export function createEditorPresencePayload(
  path: string,
  selections: readonly MobCodeSelectionRange[],
): MobCodeEditorPresencePayload {
  return {
    path,
    selections: selections.map(({ anchor, head }) => ({ anchor, head })),
  }
}

export function createLiveContentSyncPlan(
  now: number,
  lastSentAt: number,
  intervalMs: number,
): LiveContentSyncPlan {
  if (lastSentAt <= 0) {
    return { sendImmediately: true, delayMs: 0 }
  }

  const elapsedMs = now - lastSentAt
  if (elapsedMs >= intervalMs) {
    return { sendImmediately: true, delayMs: 0 }
  }

  return {
    sendImmediately: false,
    delayMs: intervalMs - elapsedMs,
  }
}

export function flushPendingMobCodeCleanupWork({
  hasPendingContent,
  hasPendingPresence,
  hasPendingPersist,
  flushContent,
  flushPresence,
  flushPersist,
}: PendingMobCodeCleanupWorkOptions): void {
  if (hasPendingContent) {
    flushContent()
  } else if (hasPendingPresence) {
    flushPresence()
  }

  if (hasPendingPersist) {
    flushPersist()
  }
}

export function sendMobCodeWsMessage(
  ws: Pick<WebSocket, 'readyState' | 'send'> | null | undefined,
  message: MobCodeMessage,
): boolean {
  if (!ws || ws.readyState !== 1) return false
  try {
    ws.send(JSON.stringify(message))
    return true
  } catch {
    return false
  }
}
