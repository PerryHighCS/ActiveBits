import type { MobCodeMessage, MobCodeStatePayload } from '../../shared/types'

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
