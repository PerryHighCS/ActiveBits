import type {
  WaitingRoomFieldConfig,
  WaitingRoomSerializableValue,
} from '../../../../types/waitingRoom.js'

export interface WaitingRoomStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface WaitingRoomCookieDocumentLike {
  cookie: string
}

export type WaitingRoomFieldValueMap = Record<string, WaitingRoomSerializableValue>
export type WaitingRoomFieldErrorMap = Record<string, string>

export const REMEMBERED_STUDENT_DISPLAY_NAME_COOKIE = 'activebits_student_display_name'
const REMEMBERED_STUDENT_DISPLAY_NAME_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isSerializableValue(value: unknown): value is WaitingRoomSerializableValue {
  if (value == null) {
    return true
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isSerializableValue(entry))
  }
  if (!isRecord(value)) {
    return false
  }
  return Object.values(value).every((entry) => isSerializableValue(entry))
}

function getDefaultFieldValue(field: WaitingRoomFieldConfig): WaitingRoomSerializableValue {
  if (field.defaultValue !== undefined) {
    return field.defaultValue
  }

  if (field.type === 'text' || field.type === 'select') {
    return ''
  }

  return null
}

function normalizeFieldValue(field: WaitingRoomFieldConfig, value: unknown): WaitingRoomSerializableValue {
  if (field.type === 'text' || field.type === 'select') {
    return typeof value === 'string' ? value : getDefaultFieldValue(field)
  }

  return isSerializableValue(value) ? value : getDefaultFieldValue(field)
}

function getFieldLabel(field: WaitingRoomFieldConfig): string {
  return field.label?.trim() || field.id
}

function isEmptyValue(value: WaitingRoomSerializableValue): boolean {
  if (value == null) {
    return true
  }
  if (typeof value === 'string') {
    return value.trim().length === 0
  }
  if (Array.isArray(value)) {
    return value.length === 0
  }
  return false
}

export function buildWaitingRoomStorageKey(activityName: string, hash: string): string {
  return `waiting-room:${activityName}:${hash}`
}

export function readRememberedStudentDisplayName(
  cookieDocument: Pick<WaitingRoomCookieDocumentLike, 'cookie'>,
): string | null {
  const cookiePrefix = `${REMEMBERED_STUDENT_DISPLAY_NAME_COOKIE}=`
  const encodedValue = cookieDocument.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(cookiePrefix))
    ?.slice(cookiePrefix.length)

  if (!encodedValue) {
    return null
  }

  try {
    const displayName = decodeURIComponent(encodedValue).trim()
    return displayName.length > 0 ? displayName : null
  } catch {
    return null
  }
}

export function persistRememberedStudentDisplayName(
  cookieDocument: WaitingRoomCookieDocumentLike,
  displayName: string,
  options: { isSecure?: boolean } = {},
): void {
  const normalizedDisplayName = displayName.trim()
  const attributes = [
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${normalizedDisplayName.length > 0 ? REMEMBERED_STUDENT_DISPLAY_NAME_COOKIE_MAX_AGE_SEC : 0}`,
    ...(options.isSecure ? ['Secure'] : []),
  ]
  cookieDocument.cookie = `${REMEMBERED_STUDENT_DISPLAY_NAME_COOKIE}=${encodeURIComponent(normalizedDisplayName)}; ${attributes.join('; ')}`
}

export function getWaitingRoomInitialValues(
  fields: readonly WaitingRoomFieldConfig[],
  storedValues: Record<string, unknown> | null = null,
): WaitingRoomFieldValueMap {
  const values: WaitingRoomFieldValueMap = {}

  for (const field of fields) {
    const storedValue = storedValues?.[field.id]
    values[field.id] = normalizeFieldValue(field, storedValue)
  }

  return values
}

export function readWaitingRoomValues(
  storage: WaitingRoomStorageLike,
  storageKey: string,
  fields: readonly WaitingRoomFieldConfig[],
  onWarn: (message: string, error: unknown) => void = console.warn,
): WaitingRoomFieldValueMap | null {
  const raw = storage.getItem(storageKey)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) {
      storage.removeItem(storageKey)
      return null
    }

    return getWaitingRoomInitialValues(fields, parsed)
  } catch (error) {
    storage.removeItem(storageKey)
    onWarn('[WaitingRoom] Failed to parse waiting-room state from storage:', error)
    return null
  }
}

export function persistWaitingRoomValues(
  storage: WaitingRoomStorageLike,
  storageKey: string,
  fields: readonly WaitingRoomFieldConfig[],
  values: WaitingRoomFieldValueMap,
  onWarn: (message: string, error: unknown) => void = console.warn,
): void {
  try {
    const payload = getWaitingRoomInitialValues(fields, values)
    storage.setItem(storageKey, JSON.stringify(payload))
  } catch (error) {
    onWarn('[WaitingRoom] Failed to persist waiting-room state to storage:', error)
  }
}

export function validateWaitingRoomValues(
  fields: readonly WaitingRoomFieldConfig[],
  values: WaitingRoomFieldValueMap,
): WaitingRoomFieldErrorMap {
  const errors: WaitingRoomFieldErrorMap = {}

  for (const field of fields) {
    const value = values[field.id] ?? getDefaultFieldValue(field)

    if (field.required && isEmptyValue(value)) {
      errors[field.id] = `${getFieldLabel(field)} is required.`
      continue
    }

    if (field.type === 'select' && typeof value === 'string' && value.trim().length > 0) {
      const isKnownOption = field.options.some((option) => option.value === value)
      if (!isKnownOption) {
        errors[field.id] = `${getFieldLabel(field)} has an invalid selection.`
      }
    }
  }

  return errors
}
