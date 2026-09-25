import { createHash } from 'node:crypto'

/**
 * Binding between a SyncDeck parent session and the student-owned solo child
 * sessions it created. Owned by SyncDeck's `solo-activity/start` route; see
 * "Solo child binding" in `.agent/plans/shared-activity-runtime-authentication.md`.
 */
export interface SyncDeckSoloChildRecord {
  studentId: string
  activityId: string
  instanceKey: string
  optionsKey: string
  createdAt: number
}

export type SyncDeckSoloChildrenMap = Record<string, SyncDeckSoloChildRecord>

export const MAX_SOLO_CHILDREN_PER_STUDENT = 25
export const MAX_SOLO_CHILDREN_PER_SESSION = 1000

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function normalizeSoloChildren(value: unknown): SyncDeckSoloChildrenMap {
  const normalized: SyncDeckSoloChildrenMap = {}
  if (!isPlainObject(value)) {
    return normalized
  }

  for (const [childSessionId, entry] of Object.entries(value)) {
    if (!isPlainObject(entry) || childSessionId.trim().length === 0) {
      continue
    }
    const studentId = readNonEmptyString(entry.studentId)
    const activityId = readNonEmptyString(entry.activityId)
    const instanceKey = readNonEmptyString(entry.instanceKey)
    const optionsKey = readNonEmptyString(entry.optionsKey)
    const createdAt = typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt) ? entry.createdAt : null
    if (!studentId || !activityId || !instanceKey || !optionsKey || createdAt === null) {
      continue
    }
    normalized[childSessionId.trim()] = { studentId, activityId, instanceKey, optionsKey, createdAt }
  }
  return normalized
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`
}

/** Key-order-independent fingerprint of sanitized selected options. */
export function buildSoloChildOptionsKey(selectedOptions: Record<string, unknown>): string {
  return createHash('sha256').update(stableJson(selectedOptions), 'utf8').digest('hex')
}

/**
 * Returns the child bound to this student for the same activity slide and
 * options, if any. Callers must still confirm the child session exists.
 */
export function findBoundSoloChild(
  soloChildren: SyncDeckSoloChildrenMap,
  match: { studentId: string; activityId: string; instanceKey: string; optionsKey: string },
): string | null {
  for (const [childSessionId, record] of Object.entries(soloChildren)) {
    if (
      record.studentId === match.studentId
      && record.activityId === match.activityId
      && record.instanceKey === match.instanceKey
      && record.optionsKey === match.optionsKey
    ) {
      return childSessionId
    }
  }
  return null
}

function evictOldest(soloChildren: SyncDeckSoloChildrenMap, childSessionIds: string[], keep: number): string[] {
  if (childSessionIds.length <= keep) return []
  const ordered = [...childSessionIds].sort((left, right) => soloChildren[left]!.createdAt - soloChildren[right]!.createdAt)
  const evicted = ordered.slice(0, ordered.length - keep)
  for (const childSessionId of evicted) {
    delete soloChildren[childSessionId]
  }
  return evicted
}

/**
 * Records a new binding, evicting the oldest records past the per-student and
 * per-session caps. Returns the evicted child session IDs; the caller must
 * delete those sessions, because an unbound child can no longer be revoked.
 */
export function recordSoloChild(
  soloChildren: SyncDeckSoloChildrenMap,
  childSessionId: string,
  record: SyncDeckSoloChildRecord,
): string[] {
  soloChildren[childSessionId] = record
  return [
    ...evictOldest(
      soloChildren,
      Object.keys(soloChildren).filter((id) => soloChildren[id]!.studentId === record.studentId),
      MAX_SOLO_CHILDREN_PER_STUDENT,
    ),
    ...evictOldest(soloChildren, Object.keys(soloChildren), MAX_SOLO_CHILDREN_PER_SESSION),
  ]
}

/** Deletes every binding owned by the student and returns the affected child session IDs. */
export function removeStudentSoloChildren(soloChildren: SyncDeckSoloChildrenMap, studentId: string): string[] {
  const removed: string[] = []
  for (const [childSessionId, record] of Object.entries(soloChildren)) {
    if (record.studentId === studentId) {
      delete soloChildren[childSessionId]
      removed.push(childSessionId)
    }
  }
  return removed
}
