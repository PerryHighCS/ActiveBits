export interface SyncDeckEmbeddedActivityLocation {
  h: number
  v: number
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeCoordinate(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  return Math.trunc(value)
}

export function normalizeEmbeddedActivityLocation(value: unknown): SyncDeckEmbeddedActivityLocation | null {
  if (!isPlainObject(value)) {
    return null
  }

  const h = normalizeCoordinate(value.h)
  const v = normalizeCoordinate(value.v)
  if (h == null || v == null) {
    return null
  }

  return { h, v }
}

export function toEmbeddedActivityLocation(
  indices: { h: number; v: number } | null | undefined,
): SyncDeckEmbeddedActivityLocation | null {
  if (!indices) {
    return null
  }

  const h = normalizeCoordinate(indices.h)
  const v = normalizeCoordinate(indices.v)
  if (h == null || v == null) {
    return null
  }

  return { h, v }
}

export function buildGeneratedEmbeddedActivityInstanceKey(
  activityId: string,
  location: SyncDeckEmbeddedActivityLocation | null,
): string {
  if (!location) {
    return `${activityId}:global`
  }

  return `${activityId}:${location.h}:${location.v}`
}

export function parseEmbeddedActivityLocationFromInstanceKey(
  instanceKey: string | null | undefined,
): SyncDeckEmbeddedActivityLocation | null {
  if (!instanceKey) {
    return null
  }

  const segments = instanceKey.split(':')
  if (segments.length < 3) {
    return null
  }

  const h = Number.parseInt(segments[1] ?? '', 10)
  const v = Number.parseInt(segments[2] ?? '', 10)
  if (!Number.isFinite(h) || !Number.isFinite(v)) {
    return null
  }

  return { h, v }
}

export function resolveEmbeddedActivityLocation(params: {
  location?: unknown
  instanceKey?: string | null
}): SyncDeckEmbeddedActivityLocation | null {
  return normalizeEmbeddedActivityLocation(params.location)
    ?? parseEmbeddedActivityLocationFromInstanceKey(params.instanceKey)
}
