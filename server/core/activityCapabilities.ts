import { createHash, randomBytes } from 'node:crypto'
import type { Session } from '../../types/session.js'

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

export interface ActivityCapabilityCookieResponse {
  cookie(name: string, value: string, options: Record<string, unknown>): void
}

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
  // `cap_` namespaces these so a `participant` capability cookie can never
  // collide with the accepted-entry participant cookie
  // (`activebits_participant_<scope>`), whose token is backed by a different map.
  return `activebits_cap_${kind}_${cookieScope(sessionId)}`
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
    expiresAt: now + (Number.isFinite(ttlMs) ? Math.max(0, ttlMs) : DEFAULT_ACTIVITY_CAPABILITY_TTL_MS),
  }

  const entries = Object.values(container.activityCapabilities).sort((left, right) => left.issuedAt - right.issuedAt)
  for (const entry of entries.slice(0, Math.max(0, entries.length - MAX_CAPABILITIES_PER_SESSION))) {
    delete container.activityCapabilities[entry.id]
  }
  return { id, token }
}

/**
 * Outcome of {@link issueManagerCapabilityAtomically}. `token` is set only for
 * `issued`. A caller maps `incarnation-mismatch` / `not-committed` to a 404 (a
 * reused session id or a session that ended mid-request) and, for a store with
 * no `updateAtomic`, handles `no-atomic-store` with its own read+set fallback.
 */
export type ManagerCapabilityAtomicOutcome =
  | { status: 'issued'; token: string }
  | { status: 'incarnation-mismatch' | 'not-committed' | 'no-atomic-store'; token: null }

class ManagerCapabilityIncarnationMismatchError extends Error {
  constructor() {
    super('session incarnation changed during the atomic manager-capability write')
    this.name = 'ManagerCapabilityIncarnationMismatchError'
  }
}

function isAuthorizedCapabilityIncarnation(
  record: unknown,
  expectedType: string,
  expectedCreated: number | null,
): record is Session {
  if (!isRecord(record) || record.type !== expectedType) {
    return false
  }
  return expectedCreated == null || record.created === expectedCreated
}

/**
 * Issue a manager capability into one session through a single compare-and-set,
 * bound to the incarnation the request authorized (`expectedType`, and
 * `expectedCreated` when the authorizing snapshot carried a `created`).
 *
 * On a type/incarnation mismatch the CAS is *aborted* (a sentinel is thrown from
 * the callback, not the draft returned) so the replacement session is never
 * committed a no-op revision bump / TTL refresh. The token is reset at the top
 * of every callback invocation because `updateAtomic` re-runs it on a CAS retry.
 *
 * Shared by `persistentSessionRoutes` (`teacher-authenticate`,
 * `persistent-manager-capability`) and SyncDeck `embedded-manager-capability` so
 * the guard cannot drift between routes.
 */
export interface AtomicManagerCapabilityStore {
  updateAtomic?(id: string, mutate: (session: Session) => Session): Promise<Session | null>
}

export async function issueManagerCapabilityAtomically(
  sessions: AtomicManagerCapabilityStore,
  sessionId: string,
  incarnation: { expectedType: string; expectedCreated: number | null },
): Promise<ManagerCapabilityAtomicOutcome> {
  if (typeof sessions.updateAtomic !== 'function') {
    return { status: 'no-atomic-store', token: null }
  }

  const { expectedType, expectedCreated } = incarnation
  let token: string | null = null
  let updated: Session | null
  try {
    updated = await sessions.updateAtomic(sessionId, (draft) => {
      token = null
      if (!isAuthorizedCapabilityIncarnation(draft, expectedType, expectedCreated)) {
        throw new ManagerCapabilityIncarnationMismatchError()
      }
      token = issueActivityCapability(draft as ActivityCapabilitySessionLike, 'manager').token
      return draft
    })
  } catch (error) {
    if (error instanceof ManagerCapabilityIncarnationMismatchError) {
      return { status: 'incarnation-mismatch', token: null }
    }
    throw error
  }

  if (updated == null || token == null) {
    return { status: 'not-committed', token: null }
  }
  if (!isAuthorizedCapabilityIncarnation(updated, expectedType, expectedCreated)) {
    return { status: 'incarnation-mismatch', token: null }
  }
  return { status: 'issued', token }
}

/** Delivers an already-persisted opaque capability as an httpOnly cookie. */
export function writeActivityCapabilityCookie(
  res: ActivityCapabilityCookieResponse,
  sessionId: string,
  principalKind: ActivityPrincipalKind,
  token: string,
): void {
  res.cookie(getActivityCapabilityCookieName(principalKind, sessionId), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: DEFAULT_ACTIVITY_CAPABILITY_TTL_MS,
  })
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
    // A capability without a finite, unreached expiry is not a valid principal.
    if (typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt) || value.expiresAt <= now) return null
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
