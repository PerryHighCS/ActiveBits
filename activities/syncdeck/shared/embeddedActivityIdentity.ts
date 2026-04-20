export interface SyncDeckEmbeddedActivityLocation {
  h: number
  v: number
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeCoordinate(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return null
  }

  return value
}

function parseIntegerSegment(value: string | undefined): number | null {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
    return null
  }

  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
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

  const h = parseIntegerSegment(segments[1])
  const v = parseIntegerSegment(segments[2])
  if (h == null || v == null) {
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
