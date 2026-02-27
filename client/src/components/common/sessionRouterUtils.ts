import type { ActivityRegistryEntry } from '../../../../types/activity.js'
import { normalizeSelectedOptions } from './manageDashboardUtils'
import { isValidHttpUrl } from './urlValidationUtils'

export const CACHE_TTL = 1000 * 60 * 60 * 12

export interface SessionCacheStorage {
  length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface SessionCacheRecord extends Record<string, unknown> {
  timestamp?: number
}

function isExpiredTimestamp(timestamp: number, now: number, ttlMs: number): boolean {
  return now - timestamp >= ttlMs
}

function parseCacheEntry(value: string | null): SessionCacheRecord | null {
  if (!value) return null

  try {
    const parsed = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null ? (parsed as SessionCacheRecord) : null
  } catch {
    return null
  }
}

function getSessionStorageKeys(storage: SessionCacheStorage): string[] {
  const keys: string[] = []

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key && key.startsWith('session-')) {
      keys.push(key)
    }
  }

  return keys
}

export function cleanExpiredSessions(
  storage: SessionCacheStorage,
  now = Date.now(),
  ttlMs = CACHE_TTL,
  onLog: (message: string) => void = console.log,
): void {
  const keys = getSessionStorageKeys(storage)

  for (const key of keys) {
    const parsed = parseCacheEntry(storage.getItem(key))
    if (!parsed || typeof parsed.timestamp !== 'number' || isExpiredTimestamp(parsed.timestamp, now, ttlMs)) {
      storage.removeItem(key)
      onLog(parsed ? `Expiring ${key}` : `Removing invalid entry ${key}`)
    }
  }
}

export function readCachedSession(
  storage: SessionCacheStorage,
  storageKey: string,
  now = Date.now(),
  ttlMs = CACHE_TTL,
  onLog: (message: string) => void = console.log,
): SessionCacheRecord | null {
  const parsed = parseCacheEntry(storage.getItem(storageKey))

  if (!parsed || typeof parsed.timestamp !== 'number') {
    storage.removeItem(storageKey)
    onLog(`removing invalid ${storageKey}`)
    return null
  }

  if (isExpiredTimestamp(parsed.timestamp, now, ttlMs)) {
    storage.removeItem(storageKey)
    onLog(`removing ${storageKey}`)
    return null
  }

  return parsed
}

export function getPersistentQuerySuffix(search: string): string {
  const query = new URLSearchParams(search)
  return query.toString() ? `&${query.toString()}` : ''
}

export function buildPersistentSessionApiUrl(hash: string, activityName: string, search: string): string {
  const query = new URLSearchParams(search)
  query.set('activityName', activityName)
  return `/api/persistent-session/${encodeURIComponent(hash)}?${query.toString()}`
}

export function buildPersistentTeacherManagePath(activityName: string, sessionId: string, queryString: string): string {
  // SyncDeck should resume from live session state instead of reusing permalink bootstrap params.
  const search = activityName === 'syncdeck' ? '' : queryString
  return `/manage/${activityName}/${sessionId}${search}`
}

export function normalizePersistentPresentationUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  if (isValidHttpUrl(trimmed)) {
    return trimmed
  }

  let current = trimmed
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const decoded = decodeURIComponent(current)
      if (decoded === current) {
        return null
      }
      if (isValidHttpUrl(decoded)) {
        return decoded
      }
      current = decoded
    } catch {
      return null
    }
  }

  return null
}

function getObjectRecord(value: unknown): Record<string, unknown> | null {
  // Intentionally returns a nullable record (instead of a type guard like manageDashboardUtils)
  // so callers can safely chain nested lookups (`getObjectRecord(x)?.child`) while parsing
  // untrusted payloads without extra branching.
  return (value != null && typeof value === 'object') ? (value as Record<string, unknown>) : null
}

export function getSessionPresentationUrlForTeacherRedirect(sessionPayload: unknown): string | null {
  const session = getObjectRecord(sessionPayload)
  const data = getObjectRecord(session?.data)
  const presentationUrl = typeof data?.presentationUrl === 'string' ? data.presentationUrl.trim() : ''
  return isValidHttpUrl(presentationUrl) ? presentationUrl : null
}

export function buildTeacherManagePathFromSession(
  activityName: string,
  sessionId: string,
  queryString: string,
  sessionPresentationUrl: string | null,
): string {
  // [SYNCDECK-DEBUG] Remove after diagnosing URL-encoding bug
  console.log('[SYNCDECK-DEBUG] buildTeacherManagePathFromSession: sessionPresentationUrl =', JSON.stringify(sessionPresentationUrl))
  if (activityName !== 'syncdeck' || !sessionPresentationUrl) {
    return buildPersistentTeacherManagePath(activityName, sessionId, queryString)
  }

  const query = new URLSearchParams()
  query.set('presentationUrl', sessionPresentationUrl)
  const path = `/manage/${activityName}/${sessionId}?${query.toString()}`
  // [SYNCDECK-DEBUG] Remove after diagnosing URL-encoding bug
  console.log('[SYNCDECK-DEBUG] buildTeacherManagePathFromSession: built path =', path)
  return path
}

export function getPersistentSelectedOptionsFromSearch(search: string, rawDeepLinkOptions: unknown): Record<string, string> {
  return getPersistentSelectedOptionsFromSearchForActivity(search, rawDeepLinkOptions)
}

export function getPersistentSelectedOptionsFromSearchForActivity(
  search: string,
  rawDeepLinkOptions: unknown,
  activityName?: string,
): Record<string, string> {
  const params = new URLSearchParams(search)
  const rawSelectedOptions = Object.fromEntries(params.entries())
  const selectedOptions = normalizeSelectedOptions(rawDeepLinkOptions, rawSelectedOptions)

  if (activityName !== 'syncdeck') {
    return selectedOptions
  }

  const normalizedSelectedPresentationUrl = normalizePersistentPresentationUrl(selectedOptions.presentationUrl)
  if (normalizedSelectedPresentationUrl) {
    selectedOptions.presentationUrl = normalizedSelectedPresentationUrl
  } else {
    const fallbackPresentationUrl = normalizePersistentPresentationUrl(params.get('presentationUrl'))
    if (fallbackPresentationUrl) {
      selectedOptions.presentationUrl = fallbackPresentationUrl
    } else {
      delete selectedOptions.presentationUrl
    }
  }

  const candidateUrlHash = params.get('urlHash')?.trim() ?? ''
  if (candidateUrlHash && /^[a-f0-9]{16}$/i.test(candidateUrlHash)) {
    selectedOptions.urlHash = candidateUrlHash.toLowerCase()
  }

  return selectedOptions
}

export function isJoinSessionId(input: string): boolean {
  const value = input.trim()
  if (!/^[a-f0-9]+$/i.test(value)) {
    return false
  }

  // Keep prior behavior that treats all-zero IDs as invalid.
  return !/^0+$/i.test(value)
}

export function getSoloActivities(activityList: readonly ActivityRegistryEntry[]): ActivityRegistryEntry[] {
  return activityList.filter((activity) => activity.soloMode)
}
