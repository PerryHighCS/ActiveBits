import assert from 'node:assert/strict'
import test from 'node:test'
import { payloadMatchesResolvedRunToken, resolveRunToken, runIdentitiesMatch, type RunIdentitySource } from './runIdentity.js'

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

void test('payloadMatchesResolvedRunToken matches payloadMatchesRunToken across a scalar-runToken matrix', () => {
  for (const payload of PAYLOAD_SAMPLES) {
    for (const runToken of RUN_TOKEN_SAMPLES) {
      const expected = referencePayloadMatchesRunToken(payload, runToken)
      const actual = payloadMatchesResolvedRunToken(payload, runToken)
      assert.equal(
        actual,
        expected,
        `payload=${JSON.stringify(payload)} runToken=${runToken}: expected ${expected}, got ${actual}`,
      )
    }
  }
})

void test('runIdentitiesMatch matches isPayloadForSnapshotRun for every realistic snapshot shape', () => {
  for (const snapshot of SNAPSHOT_SAMPLES) {
    for (const payload of PAYLOAD_SAMPLES) {
      const expected = referenceIsPayloadForSnapshotRun(payload, snapshot)
      const actual = runIdentitiesMatch(snapshot, payload)
      assert.equal(
        actual,
        expected,
        `snapshot=${JSON.stringify(snapshot)} payload=${JSON.stringify(payload)}: expected ${expected}, got ${actual}`,
      )
    }
  }
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
