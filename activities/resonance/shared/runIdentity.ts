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
// timestamp provided" here.
function forwardCrossFormMatch(current: RunIdentitySource, candidate: RunIdentitySource): boolean {
  if (current.activeQuestionRunRevision !== 1) return false
  if (typeof candidate.activeQuestionRunRevision === 'number') return false
  return (current.activeQuestionRunStartedAt ?? null) === (candidate.activeQuestionRunStartedAt ?? null)
}

// The mirror image: `current` is itself still in legacy form and
// `candidate` explicitly asserts canonical revision 1. Unlike
// forwardCrossFormMatch, this direction requires `current` to carry a REAL
// (non-null) start timestamp, not just an absent one — a `current` with no
// timestamp at all means "no active run" (or "no information"), which must
// never be treated as equivalent to a candidate's explicit revision-1
// assertion. (An earlier attempt made this bridge symmetric by re-running
// forwardCrossFormMatch with the arguments swapped, which allowed exactly
// that: `current: {revision: null, startedAt: null}` — no active run —
// wrongly matched `candidate: {revision: 1, startedAt: null}`. Requiring a
// genuine timestamp on `current` here closes that hole while still
// admitting the real case this exists for: a client-side snapshot that's
// still in legacy form when an incoming payload has already migrated,
// e.g. via out-of-order delivery during rollout.)
function reverseCrossFormMatch(current: RunIdentitySource, candidate: RunIdentitySource): boolean {
  if (typeof current.activeQuestionRunRevision === 'number') return false
  if (typeof current.activeQuestionRunStartedAt !== 'number') return false
  if (candidate.activeQuestionRunRevision !== 1) return false
  return current.activeQuestionRunStartedAt === (candidate.activeQuestionRunStartedAt ?? null)
}

function crossFormMatch(current: RunIdentitySource, candidate: RunIdentitySource): boolean {
  return forwardCrossFormMatch(current, candidate) || reverseCrossFormMatch(current, candidate)
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
 * hand-reasoning alone. The bridge started out one-directional (current
 * asserts revision 1, candidate is legacy-form) because a naive symmetric
 * version — re-running the same check with the arguments swapped — let a
 * candidate that explicitly asserts revision 1 match a current with no
 * active run at all, since both resolve their *other* side's missing
 * revision the same way. reverseCrossFormMatch below adds the missing
 * direction (current still legacy-form, candidate already canonical) back
 * deliberately, guarded by requiring current to carry a genuine timestamp —
 * closing that hole rather than reopening it. This makes runIdentitiesMatch
 * accept one shape isPayloadForSnapshotRun's original inline logic did not
 * (a legacy-form snapshot against an explicit revision-1 payload with the
 * same timestamp) — a real gap in that original logic, not a preserved
 * quirk, so the equivalence test for that one shape asserts the corrected
 * behavior instead of exact reproduction.
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
 *
 * `resolvedTokenStartedAt` is the start timestamp that `resolvedToken`
 * corresponds to when it's revision 1 — required (not optional) so a
 * caller can't silently keep accepting any legacy payload just by omitting
 * it. A session can accumulate legacy (timestamp-only) drafts/acks from
 * more than one pre-rollout run; only one of them is ever "the" run
 * `resolvedToken === 1` actually identifies, and a caller that genuinely
 * doesn't know which timestamp that is should pass `null` — which makes
 * the ambiguous branch below require an impossible match instead of
 * accepting every timestamp, the fail-closed default.
 */
export function payloadMatchesResolvedRunToken(
  payload: RunIdentitySource,
  resolvedToken: number | null,
  resolvedTokenStartedAt: number | null,
): boolean {
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
  // a timestamp-only legacy form. Its own startedAt must actually match
  // what revision 1 corresponds to — accepting any timestamp here would
  // let a delayed reconnect-replay/failure from a *different*, earlier
  // pre-rollout run masquerade as belonging to the current one.
  if (
    resolvedToken === 1 &&
    !hasRevision(payload) &&
    hasStartedAt(payload) &&
    payload.activeQuestionRunStartedAt === resolvedTokenStartedAt
  ) {
    return true
  }

  return false
}
