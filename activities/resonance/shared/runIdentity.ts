/**
 * A live question run is identified primarily by a monotonic
 * `activeQuestionRunRevision`. Clients/data predating that counter's
 * rollout identify a run only by `activeQuestionRunStartedAt`, and that
 * legacy form can only ever refer to the original numbered run, which the
 * server always canonicalizes to revision 1 once a run is active. This
 * module is the single place that resolves and compares those two forms —
 * replacing four independent, slightly-diverged copies of the same logic
 * previously kept in the client component, the client session hook, and
 * two server-side comparators.
 */
export interface RunIdentitySource {
  activeQuestionRunRevision?: number | null
  activeQuestionRunStartedAt?: number | null
}

/**
 * Callers on the client hold an untyped `Record<string, unknown>` payload
 * (raw WebSocket/REST JSON) rather than a typed RunIdentitySource. Every
 * function in this module re-validates each field's type at runtime
 * regardless of what the caller claims, so this cast is safe: it exists
 * only to satisfy the type checker at the boundary, not to skip validation.
 */
export function asRunIdentitySource(payload: Record<string, unknown>): RunIdentitySource {
  return payload as unknown as RunIdentitySource
}

function hasRevision(source: RunIdentitySource): boolean {
  return typeof source.activeQuestionRunRevision === 'number' && Number.isSafeInteger(source.activeQuestionRunRevision)
}

function hasStartedAt(source: RunIdentitySource): boolean {
  return typeof source.activeQuestionRunStartedAt === 'number' && Number.isFinite(source.activeQuestionRunStartedAt)
}

/** The resolved run token: the revision when known, else the legacy start timestamp, else no run. */
export function resolveRunToken(source: RunIdentitySource): number | null {
  if (hasRevision(source)) return source.activeQuestionRunRevision as number
  if (hasStartedAt(source)) return source.activeQuestionRunStartedAt as number
  return null
}

// `current` explicitly identifies revision 1 by number, and `candidate`
// carries no revision of its own (a legacy timestamp-only form, or nothing
// at all). They still identify the same run if their (possibly absent)
// start timestamps agree — absent and explicit null both mean "no
// timestamp provided" here. One-directional only: a candidate that itself
// asserts a specific revision is never given this benefit-of-the-doubt
// treatment against a current that lacks one (that's not a legacy-form
// bridge, that's current genuinely being a different or absent run — see
// runIdentitiesMatch's doc comment).
function crossFormMatch(current: RunIdentitySource, candidate: RunIdentitySource): boolean {
  if (current.activeQuestionRunRevision !== 1) return false
  if (typeof candidate.activeQuestionRunRevision === 'number') return false
  return (current.activeQuestionRunStartedAt ?? null) === (candidate.activeQuestionRunStartedAt ?? null)
}

/**
 * Does `current` (a session or snapshot) identify the same run as
 * `candidate` (an incoming payload, response, or another snapshot — whose
 * fields may be partial, or entirely absent for a pre-revision-rollout
 * legacy form)?
 *
 * The two are compared by their resolved tokens first (resolveRunToken
 * already prefers a revision over a legacy timestamp on each side
 * independently — this alone is enough whenever both sides use the same
 * representation, including the case where a session/snapshot itself is
 * still in legacy form: revision null, a real start timestamp — see
 * normalizeSessionData, which can leave a session's revision defaulted
 * without a timestamp, and the server, which can send a client a
 * genuinely pre-rollout snapshot). The remaining case — one side has been
 * canonicalized to revision 1 while the other is still timestamp-only —
 * needs the explicit bridge in crossFormMatch, checked in both directions
 * since either side can be the canonicalized one.
 *
 * Verified against the original matchesActiveQuestionRun (server) and
 * isPayloadForSnapshotRun (client hook) implementations by reproducing
 * both as reference copies in runIdentity.test.ts and asserting exact
 * equivalence across a shape matrix — including shapes discovered only by
 * that matrix catching real divergences during this consolidation, not by
 * hand-reasoning alone. (One such divergence: a symmetric version of the
 * crossFormMatch bridge below — trying it in both directions — let a
 * candidate that explicitly asserts revision 1 match a current with no
 * active run at all, since both resolve their *other* side's missing
 * revision the same way. The bridge is intentionally one-directional.)
 */
export function runIdentitiesMatch(current: RunIdentitySource, candidate: RunIdentitySource): boolean {
  if (resolveRunToken(current) === resolveRunToken(candidate)) return true
  return crossFormMatch(current, candidate)
}

/**
 * Compare a payload's run identity against a scalar token already resolved
 * (via resolveRunToken) from some other source at an earlier point in time
 * — e.g. cached in a ref keyed off a prior snapshot. Unlike
 * runIdentitiesMatch, the scalar alone doesn't say whether it came from a
 * revision or a legacy start timestamp, so both possibilities have to be
 * tried; prefer runIdentitiesMatch whenever both sides are still full
 * identity objects.
 */
export function payloadMatchesResolvedRunToken(payload: RunIdentitySource, resolvedToken: number | null): boolean {
  if (resolveRunToken(payload) === resolvedToken) return true

  // The cached scalar might itself be a legacy timestamp that this
  // canonicalized revision-1 payload's own startedAt still remembers.
  if (
    payload.activeQuestionRunRevision === 1 &&
    hasStartedAt(payload) &&
    payload.activeQuestionRunStartedAt === resolvedToken
  ) {
    return true
  }

  // Or the cached scalar might already be revision 1, and this payload is
  // a timestamp-only legacy form — the only run such a payload could mean.
  if (resolvedToken === 1 && !hasRevision(payload) && hasStartedAt(payload)) {
    return true
  }

  return false
}
