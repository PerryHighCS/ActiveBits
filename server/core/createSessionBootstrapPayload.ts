import { getActivityConfig } from '../activities/activityRegistry.js'

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function getStringArrayField(value: unknown, key: string): string[] {
  if (!isObjectRecord(value)) {
    return []
  }

  const field = value[key]
  return Array.isArray(field)
    ? field.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
}

export function buildCreateSessionBootstrapPayload(
  activityName: string,
  sessionData: Record<string, unknown>,
): Record<string, unknown> | null {
  const activityConfig = getActivityConfig(activityName)
  const createSessionBootstrap = isObjectRecord(activityConfig?.createSessionBootstrap)
    ? activityConfig.createSessionBootstrap
    : null

  if (!createSessionBootstrap) {
    return null
  }

  const responseFields = new Set<string>()
  for (const field of getStringArrayField(createSessionBootstrap, 'historyState')) {
    responseFields.add(field.trim())
  }

  const sessionStorageEntries = Array.isArray(createSessionBootstrap.sessionStorage)
    ? createSessionBootstrap.sessionStorage
    : []
  for (const entry of sessionStorageEntries) {
    if (!isObjectRecord(entry)) {
      continue
    }
    const responseField = entry.responseField
    if (typeof responseField === 'string' && responseField.trim().length > 0) {
      responseFields.add(responseField.trim())
    }
  }

  const payload: Record<string, unknown> = {}
  for (const field of responseFields) {
    if (Object.hasOwn(sessionData, field)) {
      payload[field] = sessionData[field]
    }
  }

  return Object.keys(payload).length > 0 ? payload : null
}
