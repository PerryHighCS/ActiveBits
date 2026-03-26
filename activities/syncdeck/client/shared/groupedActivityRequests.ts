export interface SyncDeckGroupedActivityRequest {
  activityId: string
  instanceKey: string
  activityOptions?: Record<string, unknown>
}

interface RevealActivityRequestPayload {
  activityId?: unknown
  instanceKey?: unknown
  indices?: unknown
  stackRequests?: unknown
  activityOptions?: unknown
}

interface RevealActivityPreloadRequestPayload {
  requests?: unknown
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeIndices(value: unknown): { h: number; v: number; f: number } | null {
  if (!isPlainObject(value)) {
    return null
  }

  const h = value.h
  const v = value.v
  const f = value.f

  if (typeof h !== 'number' || !Number.isFinite(h)) {
    return null
  }

  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return null
  }

  return {
    h,
    v,
    f: typeof f === 'number' && Number.isFinite(f) ? f : 0,
  }
}

function normalizeActivityId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeActivityOptions(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined
}

function buildAnchoredInstanceKey(activityId: string, indices: { h: number; v: number; f: number }): string {
  return `${activityId}:${indices.h}:${indices.v}`
}

export function resolveGroupedActivityRequestStartInput(
  rawPayload: unknown,
  fallbackIndices: { h: number; v: number; f: number } | null,
): SyncDeckGroupedActivityRequest | null {
  if (!isPlainObject(rawPayload)) {
    return null
  }

  const payload = rawPayload as RevealActivityRequestPayload
  const activityId = normalizeActivityId(payload.activityId)
  if (!activityId) {
    return null
  }

  const activityOptions = normalizeActivityOptions(payload.activityOptions)
  const requestedInstanceKey = typeof payload.instanceKey === 'string' ? payload.instanceKey.trim() : ''
  if (requestedInstanceKey.length > 0) {
    return {
      activityId,
      instanceKey: requestedInstanceKey,
      ...(activityOptions ? { activityOptions } : {}),
    }
  }

  const requestedIndices = normalizeIndices(payload.indices)
  const resolvedIndices = requestedIndices ?? fallbackIndices
  if (!resolvedIndices) {
    return {
      activityId,
      instanceKey: `${activityId}:global`,
      ...(activityOptions ? { activityOptions } : {}),
    }
  }

  return {
    activityId,
    instanceKey: buildAnchoredInstanceKey(activityId, resolvedIndices),
    ...(activityOptions ? { activityOptions } : {}),
  }
}

export function resolveGroupedActivityRequestBatchInputs(
  rawPayload: unknown,
  fallbackIndices: { h: number; v: number; f: number } | null,
): SyncDeckGroupedActivityRequest[] {
  if (!isPlainObject(rawPayload)) {
    return []
  }

  const payload = rawPayload as RevealActivityRequestPayload
  const primary = resolveGroupedActivityRequestStartInput(payload, fallbackIndices)
  const parsedStackRequests = Array.isArray(payload.stackRequests)
    ? payload.stackRequests
      .map((entry) => resolveGroupedActivityRequestStartInput(entry, fallbackIndices))
      .filter((entry): entry is SyncDeckGroupedActivityRequest => entry != null)
    : []

  const byInstanceKey = new Map<string, SyncDeckGroupedActivityRequest>()
  if (primary) {
    byInstanceKey.set(primary.instanceKey, primary)
  }
  for (const request of parsedStackRequests) {
    byInstanceKey.set(request.instanceKey, request)
  }

  return [...byInstanceKey.values()]
}

export function resolveGroupedPreloadRequestBatchInputs(
  rawPayload: unknown,
  fallbackIndices: { h: number; v: number; f: number } | null,
): SyncDeckGroupedActivityRequest[] {
  if (!isPlainObject(rawPayload)) {
    return []
  }

  const payload = rawPayload as RevealActivityPreloadRequestPayload
  if (!Array.isArray(payload.requests)) {
    return []
  }

  const byInstanceKey = new Map<string, SyncDeckGroupedActivityRequest>()
  for (const request of payload.requests) {
    const groupedRequests = resolveGroupedActivityRequestBatchInputs(request, fallbackIndices)
    for (const groupedRequest of groupedRequests) {
      byInstanceKey.set(groupedRequest.instanceKey, groupedRequest)
    }
  }

  return [...byInstanceKey.values()]
}

export function resolveGroupedActivityIds(requests: readonly SyncDeckGroupedActivityRequest[]): string[] {
  return [...new Set(requests.map((request) => request.activityId))]
}
