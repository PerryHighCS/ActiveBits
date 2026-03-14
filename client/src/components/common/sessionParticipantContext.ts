import type { EntryParticipantStorageLike } from './entryParticipantStorage'

export interface SessionParticipantContext {
  studentName: string | null
  studentId: string | null
}

interface RawSessionParticipantContext {
  studentName?: unknown
  studentId?: unknown
}

function normalizeStoredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeSessionParticipantContext(value: RawSessionParticipantContext | null): SessionParticipantContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const studentName = normalizeStoredString(value.studentName)
  const studentId = normalizeStoredString(value.studentId)
  if (!studentName && !studentId) {
    return null
  }

  return {
    studentName,
    studentId,
  }
}

export function buildSessionParticipantContextStorageKey(sessionId: string): string {
  return `session-participant:${sessionId}`
}

export function readSessionParticipantContext(
  storage: EntryParticipantStorageLike,
  sessionId: string,
  onWarn: (message: string, error: unknown) => void = console.warn,
): SessionParticipantContext | null {
  const storageKey = buildSessionParticipantContextStorageKey(sessionId)
  const raw = storage.getItem(storageKey)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as RawSessionParticipantContext
    const normalized = normalizeSessionParticipantContext(parsed)
    if (!normalized) {
      storage.removeItem(storageKey)
    }
    return normalized
  } catch (error) {
    storage.removeItem(storageKey)
    onWarn('[SessionParticipantContext] Failed to parse session participant context:', error)
    return null
  }
}

export function persistSessionParticipantContext(
  storage: EntryParticipantStorageLike,
  sessionId: string,
  updates: SessionParticipantContext,
  onWarn: (message: string, error: unknown) => void = console.warn,
): void {
  const storageKey = buildSessionParticipantContextStorageKey(sessionId)
  const previous = readSessionParticipantContext(storage, sessionId, onWarn)
  const next: SessionParticipantContext = {
    studentName: updates.studentName ?? previous?.studentName ?? null,
    studentId: updates.studentId ?? previous?.studentId ?? null,
  }

  if (!next.studentName && !next.studentId) {
    storage.removeItem(storageKey)
    return
  }

  try {
    storage.setItem(storageKey, JSON.stringify(next))
  } catch (error) {
    onWarn('[SessionParticipantContext] Failed to persist session participant context:', error)
  }
}
