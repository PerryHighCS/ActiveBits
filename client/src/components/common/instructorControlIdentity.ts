export interface InstructorControlIdentityStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface InstructorControlIdentityStorageSet {
  localStorage: InstructorControlIdentityStorageLike
  sessionStorage: InstructorControlIdentityStorageLike
}

const BROWSER_ID_STORAGE_KEY = 'activebits:instructor-control:browser-id'
const TAB_ID_STORAGE_KEY = 'activebits:instructor-control:tab-id'

function normalizeStoredId(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function buildInstructorControlInstanceId(browserId: string, tabId: string): string {
  return `${browserId}:${tabId}`
}

export function createDefaultInstructorControlId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function resolveOrCreateInstructorControlInstanceId(
  storage: InstructorControlIdentityStorageSet,
  createId: () => string,
): string {
  let browserId = normalizeStoredId(storage.localStorage.getItem(BROWSER_ID_STORAGE_KEY))
  if (!browserId) {
    browserId = createId().trim()
    storage.localStorage.setItem(BROWSER_ID_STORAGE_KEY, browserId)
  }

  let tabId = normalizeStoredId(storage.sessionStorage.getItem(TAB_ID_STORAGE_KEY))
  if (!tabId) {
    tabId = createId().trim()
    storage.sessionStorage.setItem(TAB_ID_STORAGE_KEY, tabId)
  }

  return buildInstructorControlInstanceId(browserId, tabId)
}

export function resolveBrowserInstructorControlId(
  localStorage: InstructorControlIdentityStorageLike,
): string | null {
  return normalizeStoredId(localStorage.getItem(BROWSER_ID_STORAGE_KEY))
}

export function resolveTabInstructorControlId(
  sessionStorage: InstructorControlIdentityStorageLike,
): string | null {
  return normalizeStoredId(sessionStorage.getItem(TAB_ID_STORAGE_KEY))
}
