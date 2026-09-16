import assert from 'node:assert/strict'
import test from 'node:test'
import { payloadMatchesResolvedRunToken, resolveRunToken, runIdentitiesMatch, snapshotsIdentifySameRun, type RunIdentitySource } from './runIdentity.js'

void test('resolveRunToken prefers revision over the legacy start timestamp', () => {
  assert.equal(resolveRunToken({ activeQuestionRunRevision: 3, activeQuestionRunStartedAt: 999 }), 3)
  assert.equal(resolveRunToken({ activeQuestionRunStartedAt: 999 }), 999)
  assert.equal(resolveRunToken({}), null)
  assert.equal(resolveRunToken({ activeQuestionRunRevision: null, activeQuestionRunStartedAt: null }), null)
})

// `current` is a session/snapshot and `candidate` is an incoming
// payload/response/other snapshot. Unlike a `candidate`, a server-side
// ResonanceSessionData's revision and start timestamp are always assigned
// together (see setStagedActiveQuestion / normalizeSessionData) — but a
// client-side StudentSessionSnapshot is not: the server can send a
// genuinely pre-rollout snapshot with a null revision and a real start
// timestamp, since normalizeStudentSessionSnapshot just parses whatever
// arrived without re-deriving that invariant. runIdentitiesMatch has to
// handle current in either shape.

void test('runIdentitiesMatch: a numeric candidate revision must equal the current revision', () => {
  assert.equal(
    runIdentitiesMatch({ activeQuestionRunRevision: 2, activeQuestionRunStartedAt: 555 }, { activeQuestionRunRevision: 2 }),
    true,
  )
  assert.equal(
    runIdentitiesMatch({ activeQuestionRunRevision: 2, activeQuestionRunStartedAt: 555 }, { activeQuestionRunRevision: 3 }),
    false,
  )
})

void test('runIdentitiesMatch: an empty candidate matches only a current with no active run', () => {
  assert.equal(runIdentitiesMatch({}, {}), true)
  assert.equal(
    runIdentitiesMatch(
      { activeQuestionRunRevision: null, activeQuestionRunStartedAt: null },
      {},
    ),
    true,
  )
  assert.equal(
    runIdentitiesMatch({ activeQuestionRunRevision: 2, activeQuestionRunStartedAt: 555 }, {}),
    false,
  )
})

void test('runIdentitiesMatch rejects a present-but-malformed run field instead of treating it as absent', () => {
  // A non-integer revision fails hasRevision's Number.isSafeInteger check
  // and falls through to hasStartedAt, which also fails (no timestamp
  // field at all here) — resolveRunToken returns null for this candidate,
  // the same null a current with no active run at all resolves to. Without
  // the malformed-field guard, those two nulls would compare equal and this
  // would wrongly return true.
  assert.equal(
    runIdentitiesMatch(
      { activeQuestionRunRevision: null, activeQuestionRunStartedAt: null },
      { activeQuestionRunRevision: 1.5 },
    ),
    false,
  )
  // Same shape, but the malformed field is on `current` instead.
  assert.equal(
    runIdentitiesMatch(
      { activeQuestionRunRevision: 1.5 },
      { activeQuestionRunRevision: null, activeQuestionRunStartedAt: null },
    ),
    false,
  )
  // A non-finite start timestamp is malformed the same way a non-integer
  // revision is.
  assert.equal(
    runIdentitiesMatch(
      { activeQuestionRunRevision: null, activeQuestionRunStartedAt: null },
      { activeQuestionRunStartedAt: Number.NaN },
    ),
    false,
  )
  // A well-formed null/undefined field must still be treated as absent, not
  // rejected — the guard only fires on a field that is present and invalid.
  assert.equal(runIdentitiesMatch({ activeQuestionRunRevision: null }, {}), true)
})

void test('runIdentitiesMatch: a legacy timestamp-only candidate matches current revision 1 (including when current has no timestamp of its own)', () => {
  assert.equal(
    runIdentitiesMatch(
      { activeQuestionRunRevision: 1, activeQuestionRunStartedAt: 555 },
      { activeQuestionRunStartedAt: 555 },
    ),
    true,
  )
  // The real backfill quirk this module exists to preserve: a session can
  // have its revision defaulted to 1 while activeQuestionRunStartedAt stays
  // null (normalizeSessionData backfills them independently when the raw
  // source had no valid startedAt). A legacy candidate with a null
  // timestamp still matches by raw equality (null === null), same as the
  // original inline check did.
  assert.equal(
    runIdentitiesMatch(
      { activeQuestionRunRevision: 1, activeQuestionRunStartedAt: null },
      { activeQuestionRunStartedAt: null },
    ),
    true,
  )
})

void test('runIdentitiesMatch: a legacy timestamp-only candidate must agree with a current that does carry its own timestamp', () => {
  assert.equal(
    runIdentitiesMatch(
      { activeQuestionRunRevision: 1, activeQuestionRunStartedAt: 999 },
      { activeQuestionRunStartedAt: 555 },
    ),
    false,
  )
})

void test('runIdentitiesMatch: a legacy timestamp never matches a current revision other than 1', () => {
  assert.equal(
    runIdentitiesMatch(
      { activeQuestionRunRevision: 2, activeQuestionRunStartedAt: 555 },
      { activeQuestionRunStartedAt: 555 },
    ),
    false,
  )
})

void test('runIdentitiesMatch: a current that is itself still in legacy (null revision, real timestamp) form matches by timestamp directly', () => {
  // A client-side StudentSessionSnapshot, unlike server-side session data,
  // can legitimately have a null revision alongside a real start timestamp
  // (a genuinely pre-rollout snapshot from the server). No revision-1
  // bridging is needed here — both sides resolve to the same raw token.
  assert.equal(
    runIdentitiesMatch(
      { activeQuestionRunRevision: null, activeQuestionRunStartedAt: 1_000 },
      { activeQuestionRunStartedAt: 1_000 },
    ),
    true,
  )
  assert.equal(
    runIdentitiesMatch(
      { activeQuestionRunRevision: null, activeQuestionRunStartedAt: 1_000 },
      { activeQuestionRunStartedAt: 2_000 },
    ),
    false,
  )
})

void test('snapshotsIdentifySameRun does not treat a genuinely idle previous snapshot as the same run as a freshly-started one', () => {
  // Copilot's finding: hasActiveQuestionRunRestart used to delegate this
  // exact comparison to runIdentitiesMatch, which is designed to treat a
  // candidate that provides no run information at all as compatible with a
  // current run whose own startedAt also happens to be null (a real,
  // legitimate backfill quirk for its actual contract — see
  // runIdentitiesMatch's own tests above). Reused for two full snapshots
  // instead, that same leniency let a previous snapshot with no active run
  // at all ({revision: null, startedAt: null} — genuinely idle) match a
  // current snapshot for a run that has just started ({revision: 1,
  // startedAt: null} — before any timestamp backfill), silently treating a
  // real activation as "not a restart."
  assert.equal(
    snapshotsIdentifySameRun(
      { activeQuestionRunRevision: null, activeQuestionRunStartedAt: null },
      { activeQuestionRunRevision: 1, activeQuestionRunStartedAt: null },
    ),
    false,
  )
  // The reverse direction (a run ending) must also not be masked.
  assert.equal(
    snapshotsIdentifySameRun(
      { activeQuestionRunRevision: 1, activeQuestionRunStartedAt: null },
      { activeQuestionRunRevision: null, activeQuestionRunStartedAt: null },
    ),
    false,
  )
})

void test('snapshotsIdentifySameRun still recognizes a genuine legacy-to-canonical migration of the same run, in both directions', () => {
  assert.equal(
    snapshotsIdentifySameRun(
      { activeQuestionRunRevision: null, activeQuestionRunStartedAt: 1_000 },
      { activeQuestionRunRevision: 1, activeQuestionRunStartedAt: 1_000 },
    ),
    true,
  )
  assert.equal(
    snapshotsIdentifySameRun(
      { activeQuestionRunRevision: 1, activeQuestionRunStartedAt: 1_000 },
      { activeQuestionRunRevision: null, activeQuestionRunStartedAt: 1_000 },
    ),
    true,
  )
  // A migration claim without a genuine shared timestamp is not the same
  // run — the legacy side must carry a real timestamp, not just an absent
  // one, exactly like the idle case above.
  assert.equal(
    snapshotsIdentifySameRun(
      { activeQuestionRunRevision: null, activeQuestionRunStartedAt: 1_000 },
      { activeQuestionRunRevision: 1, activeQuestionRunStartedAt: 2_000 },
    ),
    false,
  )
})

void test('snapshotsIdentifySameRun rejects a present-but-malformed field on either snapshot', () => {
  assert.equal(
    snapshotsIdentifySameRun(
      { activeQuestionRunRevision: null, activeQuestionRunStartedAt: null },
      { activeQuestionRunRevision: 1.5, activeQuestionRunStartedAt: null },
    ),
    false,
  )
})

// ── Equivalence against the original call sites ────────────────────────────
//
// Direct copies of the logic previously duplicated in ResonanceStudent.tsx,
// useResonanceSession.ts, and routes.ts (server), kept here only to prove
// the shared module reproduces every one of them exactly across a
// representative input matrix, before any call site is switched over.

function referencePayloadMatchesRunToken(payload: RunIdentitySource, runToken: number | null): boolean {
  const payloadToken = resolveRunToken(payload)
  return payloadToken === runToken || (
    runToken === 1 &&
    typeof payload.activeQuestionRunRevision !== 'number' &&
    typeof payload.activeQuestionRunStartedAt === 'number'
  ) || (
    payload.activeQuestionRunRevision === 1 &&
    typeof payload.activeQuestionRunStartedAt === 'number' &&
    payload.activeQuestionRunStartedAt === runToken
  )
}

function referenceIsPayloadForSnapshotRun(payload: RunIdentitySource, snapshot: RunIdentitySource): boolean {
  const payloadHasRevision = typeof payload.activeQuestionRunRevision === 'number'
  const payloadRunToken = payloadHasRevision
    ? (payload.activeQuestionRunRevision as number)
    : typeof payload.activeQuestionRunStartedAt === 'number'
      ? payload.activeQuestionRunStartedAt
      : null
  const activeRunToken = snapshot.activeQuestionRunRevision ?? snapshot.activeQuestionRunStartedAt ?? null
  return payloadRunToken === activeRunToken || (
    !payloadHasRevision &&
    snapshot.activeQuestionRunRevision === 1 &&
    payloadRunToken === snapshot.activeQuestionRunStartedAt
  )
}

function referenceMatchesActiveQuestionRun(
  sessionData: RunIdentitySource,
  revision: unknown,
  legacyStartedAt: unknown,
): boolean {
  if (typeof revision === 'number' && Number.isSafeInteger(revision)) {
    return revision === sessionData.activeQuestionRunRevision
  }
  if (
    revision == null &&
    legacyStartedAt == null &&
    (sessionData.activeQuestionRunRevision ?? null) === null &&
    (sessionData.activeQuestionRunStartedAt ?? null) === null
  ) {
    return true
  }
  return sessionData.activeQuestionRunRevision === 1 && legacyStartedAt === sessionData.activeQuestionRunStartedAt
}

interface ReferenceResponse {
  activeQuestionRunRevision?: number | null
}

function referenceResponseMatchesActiveRun(response: ReferenceResponse, sessionData: RunIdentitySource): boolean {
  return response.activeQuestionRunRevision === sessionData.activeQuestionRunRevision ||
    (response.activeQuestionRunRevision === undefined && sessionData.activeQuestionRunRevision === 1)
}

// The actual routes.ts implementation (kept in sync by hand — see
// responseMatchesActiveRun in routes.ts). It deliberately does NOT
// delegate to runIdentitiesMatch: a stored Response has no timestamp field
// at all, so routing it through the legacy-timestamp branch would treat a
// response's absent timestamp as matching a session whose own start
// timestamp also happens to be null (a real, reachable shape) — a false
// positive. Only the explicit `undefined` ("legacy, unknown run") case
// needs special handling; every other case is plain revision equality.
function responseMatchesActiveRunUnderTest(response: ReferenceResponse, sessionData: RunIdentitySource): boolean {
  if (response.activeQuestionRunRevision === undefined) {
    return sessionData.activeQuestionRunRevision === 1
  }
  return response.activeQuestionRunRevision === sessionData.activeQuestionRunRevision
}

const RUN_TOKEN_SAMPLES: Array<number | null> = [null, 1, 2, 555]

// The full freeform shape space — used for the "payload"/"candidate" role,
// which legitimately can be timestamp-only (legacy form) with no revision.
const PAYLOAD_SAMPLES: RunIdentitySource[] = [
  {},
  { activeQuestionRunRevision: null, activeQuestionRunStartedAt: null },
  { activeQuestionRunRevision: 1 },
  { activeQuestionRunRevision: 1, activeQuestionRunStartedAt: 555 },
  { activeQuestionRunRevision: 1, activeQuestionRunStartedAt: 999 },
  { activeQuestionRunRevision: 2 },
  { activeQuestionRunRevision: 2, activeQuestionRunStartedAt: 555 },
  { activeQuestionRunStartedAt: 555 },
  { activeQuestionRunStartedAt: 999 },
]

// A session/snapshot's revision and start timestamp are usually written
// together, but normalizeSessionData backfills them *independently*
// (revision defaults to 1 whenever there's an active run and no valid
// source revision; startedAt only becomes a real timestamp if the raw
// source had one) — so "revision 1, startedAt still null" is a real,
// reachable shape for BOTH a server session and a client snapshot, not
// just a theoretical one. Both fields are always at least explicitly null
// (never genuinely absent/undefined) on a normalized session or snapshot
// object, so — unlike PAYLOAD_SAMPLES — this list intentionally has no
// fully-empty `{}` entry.
const SESSION_DATA_SAMPLES: RunIdentitySource[] = [
  { activeQuestionRunRevision: null, activeQuestionRunStartedAt: null },
  { activeQuestionRunRevision: 1, activeQuestionRunStartedAt: null },
  { activeQuestionRunRevision: 1, activeQuestionRunStartedAt: 555 },
  { activeQuestionRunRevision: 1, activeQuestionRunStartedAt: 999 },
  { activeQuestionRunRevision: 2, activeQuestionRunStartedAt: null },
  { activeQuestionRunRevision: 2, activeQuestionRunStartedAt: 555 },
]

// A client-side StudentSessionSnapshot additionally can have a null
// revision alongside a *real* (non-null) start timestamp: the server can
// send it a genuinely pre-rollout snapshot, and normalizeStudentSessionSnapshot
// just parses whatever numeric/null fields arrived without re-deriving the
// server-side invariant that SESSION_DATA_SAMPLES relies on above. This
// shape is unreachable for real ResonanceSessionData (see
// normalizeSessionData), so it's kept out of SESSION_DATA_SAMPLES — testing
// matchesActiveQuestionRun against an impossible session shape would only
// measure a difference in behavior neither implementation was ever
// designed to define, not a real regression risk.
const SNAPSHOT_SAMPLES: RunIdentitySource[] = [
  ...SESSION_DATA_SAMPLES,
  { activeQuestionRunRevision: null, activeQuestionRunStartedAt: 555 },
]

const RESPONSE_REVISION_SAMPLES: Array<number | null | undefined> = [undefined, null, 1, 2]

const RESOLVED_TOKEN_STARTED_AT_SAMPLES: Array<number | null> = [null, 555, 999]

// The old reference's ambiguous branch (runToken === 1, payload is a bare
// legacy timestamp) accepted *any* startedAt — a session can accumulate
// legacy drafts/acks from more than one pre-rollout run, and only one of
// them is ever "the" run revision 1 actually identifies. The fixed
// implementation additionally requires the payload's own startedAt to
// match resolvedTokenStartedAt; every other branch is unchanged from the
// original, already-verified behavior.
void test('payloadMatchesResolvedRunToken matches the original scalar-runToken matrix everywhere except its one deliberately-fixed ambiguous branch', () => {
  for (const payload of PAYLOAD_SAMPLES) {
    for (const runToken of RUN_TOKEN_SAMPLES) {
      for (const resolvedTokenStartedAt of RESOLVED_TOKEN_STARTED_AT_SAMPLES) {
        const isAmbiguousLegacyBranch = runToken === 1 &&
          typeof payload.activeQuestionRunRevision !== 'number' &&
          typeof payload.activeQuestionRunStartedAt === 'number'
        const expected = isAmbiguousLegacyBranch
          ? payload.activeQuestionRunStartedAt === resolvedTokenStartedAt
          : referencePayloadMatchesRunToken(payload, runToken)
        const actual = payloadMatchesResolvedRunToken(payload, runToken, resolvedTokenStartedAt)
        assert.equal(
          actual,
          expected,
          `payload=${JSON.stringify(payload)} runToken=${runToken} resolvedTokenStartedAt=${resolvedTokenStartedAt}: expected ${expected}, got ${actual}`,
        )
      }
    }
  }
})

void test('payloadMatchesResolvedRunToken rejects a legacy payload from a different pre-rollout run than the one revision 1 identifies', () => {
  // Copilot's finding: a session can have more than one legacy (bare
  // timestamp) run predating the revision rollout. Only the run active at
  // the moment of the upgrade is ever backfilled to revision 1 — a delayed
  // reconnect-replay ack or draft-save failure from an *earlier* pre-rollout
  // run must not be mistaken for the one revision 1 now identifies just
  // because both happen to be legacy-form.
  const earlierRunPayload: RunIdentitySource = { activeQuestionRunStartedAt: 1_000 }
  assert.equal(payloadMatchesResolvedRunToken(earlierRunPayload, 1, 2_000), false)
  // The genuinely current pre-rollout run's own timestamp still matches.
  const currentRunPayload: RunIdentitySource = { activeQuestionRunStartedAt: 2_000 }
  assert.equal(payloadMatchesResolvedRunToken(currentRunPayload, 1, 2_000), true)
  // A caller that genuinely doesn't know revision 1's own startedAt (null)
  // must fail closed rather than accept any legacy payload.
  assert.equal(payloadMatchesResolvedRunToken(currentRunPayload, 1, null), false)
})

void test('payloadMatchesResolvedRunToken does not let a legacy timestamp numerically collide with resolvedToken === 1', () => {
  // Copilot's finding: the bare `resolveRunToken(payload) === resolvedToken`
  // fast path ran before the guarded bridge, so a timestamp-only payload
  // whose activeQuestionRunStartedAt happened to equal 1 (a delayed/crafted
  // legacy callback from an unrelated run, or simply a degenerate value)
  // matched resolvedToken === 1 outright, without ever checking whether 1
  // was really a legacy timestamp or a revision, or comparing against the
  // run's actual recorded start time.
  const degenerateLegacyPayload: RunIdentitySource = { activeQuestionRunStartedAt: 1 }
  assert.equal(payloadMatchesResolvedRunToken(degenerateLegacyPayload, 1, 999), false)
  // It still matches when its timestamp genuinely is the run's own start time.
  assert.equal(payloadMatchesResolvedRunToken(degenerateLegacyPayload, 1, 1), true)
})

void test('payloadMatchesResolvedRunToken rejects a present-but-malformed payload field, consistent with runIdentitiesMatch', () => {
  // Copilot's finding: this function started with a bare
  // `resolveRunToken(payload) === resolvedToken`, never calling
  // hasInvalidRunField the way runIdentitiesMatch does — so a malformed
  // payload like `{ activeQuestionRunStartedAt: NaN }` resolved to null the
  // same way a genuinely self-paced/no-run payload does, and could match a
  // cached `resolvedToken: null`, letting the parent treat an invalid
  // callback as a legitimate self-paced draft.
  assert.equal(payloadMatchesResolvedRunToken({ activeQuestionRunStartedAt: Number.NaN }, null, null), false)
  assert.equal(payloadMatchesResolvedRunToken({ activeQuestionRunRevision: 1.5 }, null, null), false)
  // A malformed field must also block a match against a non-null resolved
  // token, not just the null/self-paced case.
  assert.equal(payloadMatchesResolvedRunToken({ activeQuestionRunRevision: 1.5 }, 1, 555), false)
  // A genuinely absent/null field is still accepted.
  assert.equal(payloadMatchesResolvedRunToken({}, null, null), true)
})

// The one deliberate divergence from the original isPayloadForSnapshotRun
// (see reverseCrossFormMatch / runIdentitiesMatch's own doc comment): a
// snapshot still in legacy form with a genuine timestamp must match a
// payload that has already migrated to the explicit canonical revision 1
// for that same timestamp. The original inline logic never recognized this
// direction — a real gap this reverse bridge closes, not a preserved quirk.
function isDeliberateReverseBridgeDivergence(snapshot: RunIdentitySource, payload: RunIdentitySource): boolean {
  return snapshot.activeQuestionRunRevision === null &&
    snapshot.activeQuestionRunStartedAt === 555 &&
    payload.activeQuestionRunRevision === 1 &&
    payload.activeQuestionRunStartedAt === 555
}

// A second deliberate divergence (a later Copilot review round's finding):
// the original reference collapses a payload that omits every run field
// into the same "null" its own missing startedAt resolves to, and then
// matches that null against a snapshot's *explicit* null startedAt on a
// revision-1 run that has simply not been timestamped yet. A payload that
// genuinely says nothing about its run is not the same claim as a snapshot
// explicitly asserting "no timestamp yet on this active run" — the fixed
// forwardCrossFormMatch now requires the payload to actually provide a
// (possibly null) startedAt before treating it as a legacy/self-paced
// assertion, rather than accepting a fully absent field the same way.
function isDeliberateOmittedFieldDivergence(snapshot: RunIdentitySource, payload: RunIdentitySource): boolean {
  return snapshot.activeQuestionRunRevision === 1 &&
    snapshot.activeQuestionRunStartedAt === null &&
    payload.activeQuestionRunRevision === undefined &&
    payload.activeQuestionRunStartedAt === undefined
}

void test('runIdentitiesMatch matches isPayloadForSnapshotRun for every realistic snapshot shape, except the two deliberate fixes', () => {
  for (const snapshot of SNAPSHOT_SAMPLES) {
    for (const payload of PAYLOAD_SAMPLES) {
      const actual = runIdentitiesMatch(snapshot, payload)
      if (isDeliberateReverseBridgeDivergence(snapshot, payload)) {
        assert.equal(actual, true, `snapshot=${JSON.stringify(snapshot)} payload=${JSON.stringify(payload)}: expected the reverse bridge to match`)
        continue
      }
      if (isDeliberateOmittedFieldDivergence(snapshot, payload)) {
        assert.equal(actual, false, `snapshot=${JSON.stringify(snapshot)} payload=${JSON.stringify(payload)}: a payload that omits every run field must not match a not-yet-timestamped active run`)
        continue
      }
      const expected = referenceIsPayloadForSnapshotRun(payload, snapshot)
      assert.equal(
        actual,
        expected,
        `snapshot=${JSON.stringify(snapshot)} payload=${JSON.stringify(payload)}: expected ${expected}, got ${actual}`,
      )
    }
  }
})

void test('runIdentitiesMatch rejects a payload that omits every run field when the current run has started but has no timestamp yet', () => {
  // Copilot's finding: matchesActiveQuestionRun calls this directly on raw
  // request bodies, where a client that sends neither field at all (not
  // even an explicit null) is a malformed/incomplete request, not a
  // legitimate self-paced "no active run" assertion. Before this fix, the
  // fully-absent case collapsed to the same null as an explicit one and
  // could match a live run whose startedAt had not been backfilled yet.
  assert.equal(
    runIdentitiesMatch(
      { activeQuestionRunRevision: 1, activeQuestionRunStartedAt: null },
      {},
    ),
    false,
  )
  // An explicit null (a genuine legacy/self-paced assertion) still matches.
  assert.equal(
    runIdentitiesMatch(
      { activeQuestionRunRevision: 1, activeQuestionRunStartedAt: null },
      { activeQuestionRunStartedAt: null },
    ),
    true,
  )
})

void test('runIdentitiesMatch does not let a legacy timestamp coincide numerically with an unrelated revision number', () => {
  // Copilot's finding: resolveRunToken's scalar loses whether it came from
  // a revision or a legacy timestamp, so a bare numeric equality on the
  // resolved token let a candidate's tiny/crafted activeQuestionRunStartedAt
  // (e.g. 1) match a current session's unrelated activeQuestionRunRevision
  // of the same numeric value, without ever comparing real start times.
  assert.equal(
    runIdentitiesMatch(
      { activeQuestionRunRevision: 1, activeQuestionRunStartedAt: 999 },
      { activeQuestionRunStartedAt: 1 },
    ),
    false,
  )
  // The legitimate cross-form bridge (matching real timestamps) still works.
  assert.equal(
    runIdentitiesMatch(
      { activeQuestionRunRevision: 1, activeQuestionRunStartedAt: 999 },
      { activeQuestionRunStartedAt: 999 },
    ),
    true,
  )
})

void test('runIdentitiesMatch recognizes a legacy-form current against a canonical revision-1 candidate (the reverse migration direction)', () => {
  // Out-of-order delivery (or a rollout in progress) can mean the "current"
  // side of a comparison is still in legacy form while the incoming
  // candidate has already migrated to canonical revision 1 — the mirror
  // image of the original, already-supported direction.
  assert.equal(
    runIdentitiesMatch(
      { activeQuestionRunRevision: null, activeQuestionRunStartedAt: 5_000 },
      { activeQuestionRunRevision: 1, activeQuestionRunStartedAt: 5_000 },
    ),
    true,
  )
  // A different timestamp means a genuinely different run — must not match.
  assert.equal(
    runIdentitiesMatch(
      { activeQuestionRunRevision: null, activeQuestionRunStartedAt: 5_000 },
      { activeQuestionRunRevision: 1, activeQuestionRunStartedAt: 6_000 },
    ),
    false,
  )
  // The regression the prior symmetric attempt introduced: "no active run
  // at all" (no timestamp) must never match an explicit revision-1
  // assertion just because both sides resolve their missing field the same
  // way.
  assert.equal(
    runIdentitiesMatch(
      { activeQuestionRunRevision: null, activeQuestionRunStartedAt: null },
      { activeQuestionRunRevision: 1, activeQuestionRunStartedAt: null },
    ),
    false,
  )
})

void test('runIdentitiesMatch matches matchesActiveQuestionRun for every realistic session shape', () => {
  for (const sessionData of SESSION_DATA_SAMPLES) {
    for (const payload of PAYLOAD_SAMPLES) {
      const revision = payload.activeQuestionRunRevision ?? null
      const legacyStartedAt = payload.activeQuestionRunStartedAt ?? null
      const expected = referenceMatchesActiveQuestionRun(sessionData, revision, legacyStartedAt)
      const actual = runIdentitiesMatch(sessionData, { activeQuestionRunRevision: revision, activeQuestionRunStartedAt: legacyStartedAt })
      assert.equal(
        actual,
        expected,
        `sessionData=${JSON.stringify(sessionData)} revision=${revision} legacyStartedAt=${legacyStartedAt}: expected ${expected}, got ${actual}`,
      )
    }
  }
})

void test('the routes.ts responseMatchesActiveRun implementation matches the original for every realistic session shape', () => {
  for (const sessionData of SESSION_DATA_SAMPLES) {
    for (const responseRevision of RESPONSE_REVISION_SAMPLES) {
      const response: ReferenceResponse = { activeQuestionRunRevision: responseRevision }
      const expected = referenceResponseMatchesActiveRun(response, sessionData)
      const actual = responseMatchesActiveRunUnderTest(response, sessionData)
      assert.equal(
        actual,
        expected,
        `sessionData=${JSON.stringify(sessionData)} responseRevision=${responseRevision}: expected ${expected}, got ${actual}`,
      )
    }
  }
})
