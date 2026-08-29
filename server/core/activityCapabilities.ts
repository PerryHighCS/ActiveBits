import { createHash, randomBytes } from 'node:crypto'

export type ActivityPrincipalKind = 'manager' | 'participant'

export interface ActivityCapabilityRecord {
  id: string
  tokenHash: string
  principalKind: ActivityPrincipalKind
  subjectId?: string
  issuedAt: number
  expiresAt: number
}

interface ActivityCapabilityContainer {
  activityCapabilities?: Record<string, ActivityCapabilityRecord>
}

export interface ActivityCapabilitySessionLike {
  data: unknown
}

export interface ActivityPrincipal {
  kind: ActivityPrincipalKind
  sessionId: string
  capabilityId: string
  subjectId?: string
}

const MAX_CAPABILITIES_PER_SESSION = 200
/** Bounded capability lifetime; a captured token cannot be replayed past this. */
export const DEFAULT_ACTIVITY_CAPABILITY_TTL_MS = 7 * 24 * 60 * 60 * 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function getContainer(session: ActivityCapabilitySessionLike): ActivityCapabilityContainer {
  if (!isRecord(session.data)) session.data = {}
  const data = session.data as Record<string, unknown>
  if (!isRecord(data.activityCapabilities)) data.activityCapabilities = {}
  return data as ActivityCapabilityContainer
}

function hashCapability(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

function cookieScope(sessionId: string): string {
  return Buffer.from(sessionId, 'utf8').toString('base64url')
}

export function getActivityCapabilityCookieName(kind: ActivityPrincipalKind, sessionId: string): string {
  return `activebits_${kind}_${cookieScope(sessionId)}`
}

/** Issue an opaque capability. Only its SHA-256 digest is retained in session data. */
export function issueActivityCapability(
  session: ActivityCapabilitySessionLike,
  principalKind: ActivityPrincipalKind,
  subjectId?: string,
  now = Date.now(),
  ttlMs: number = DEFAULT_ACTIVITY_CAPABILITY_TTL_MS,
): { id: string; token: string } {
  const container = getContainer(session)
  const id = randomBytes(12).toString('base64url')
  const token = randomBytes(32).toString('base64url')
  container.activityCapabilities ??= {}
  container.activityCapabilities[id] = {
    id,
    tokenHash: hashCapability(token),
    principalKind,
    ...(subjectId ? { subjectId } : {}),
    issuedAt: now,
    expiresAt: now + Math.max(0, ttlMs),
  }

  const entries = Object.values(container.activityCapabilities).sort((left, right) => left.issuedAt - right.issuedAt)
  for (const entry of entries.slice(0, Math.max(0, entries.length - MAX_CAPABILITIES_PER_SESSION))) {
    delete container.activityCapabilities[entry.id]
  }
  return { id, token }
}

export function resolveActivityCapability(
  session: ActivityCapabilitySessionLike,
  sessionId: string,
  principalKind: ActivityPrincipalKind,
  token: unknown,
  now = Date.now(),
): ActivityPrincipal | null {
  if (typeof token !== 'string' || !isRecord(session.data)) return null
  const capabilities = (session.data as ActivityCapabilityContainer).activityCapabilities
  if (!isRecord(capabilities)) return null
  const tokenHash = hashCapability(token)
  for (const value of Object.values(capabilities)) {
    if (!isRecord(value) || value.tokenHash !== tokenHash || value.principalKind !== principalKind || typeof value.id !== 'string') continue
    if (typeof value.expiresAt === 'number' && value.expiresAt <= now) return null
    return {
      kind: principalKind,
      sessionId,
      capabilityId: value.id,
      ...(typeof value.subjectId === 'string' ? { subjectId: value.subjectId } : {}),
    }
  }
  return null
}

export function readCookieValue(cookieHeader: unknown, name: string): string | null {
  if (typeof cookieHeader !== 'string') return null
  for (const segment of cookieHeader.split(';')) {
    const separator = segment.indexOf('=')
    if (separator < 1) continue
    if (segment.slice(0, separator).trim() !== name) continue
    const value = segment.slice(separator + 1).trim()
    return value.length > 0 ? value : null
  }
  return null
}

export function resolveActivityPrincipalFromCookies(
  session: ActivityCapabilitySessionLike,
  sessionId: string,
  principalKind: ActivityPrincipalKind,
  cookies: Record<string, unknown> | undefined,
): ActivityPrincipal | null {
  return resolveActivityCapability(session, sessionId, principalKind, cookies?.[getActivityCapabilityCookieName(principalKind, sessionId)])
}
