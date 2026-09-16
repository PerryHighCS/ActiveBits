# Resonance Draft/Submission State Consolidation

## Status

- [x] Root-cause catalog reviewed and agreed
- [x] Shared `runIdentity` module added, unit-tested against reference copies of all four original comparators, and wired into the server
- [x] Server: `matchesActiveQuestionRun` now delegates to the shared `runIdentitiesMatch`. `responseMatchesActiveRun` stays a small standalone function rather than delegating — see note below
- [x] Server: legacy-response `activeQuestionRunRevision` backfill investigated — decided against it (kept the existing explicit-`undefined` special case instead; see note below)
- [x] Client: `payloadMatchesRunToken`/`resolvePayloadRunToken` (component) and `isPayloadForSnapshotRun` (hook) now delegate to the shared module — see note below on the two real divergences the equivalence matrix caught along the way
- [x] Client: shared draft-attempt helpers (`draftAttempt.ts`) added and wired into both the hook and the component; `asRunIdentitySource` also deduplicated into `runIdentity.ts` (it was independently copy-pasted into both files during steps 2-3)
- [x] Client: per-question state collapsed into a single `QuestionDraftState` map in `ResonanceStudent.tsx`, using the read-time-validated design (see section 4's "Update" note). All 6 original structures (`submittedAnswerRunRef`, `editSequenceByKeyRef`, `submittedEditSequenceByKeyRef`, `draftGenerationByKeyRef`, `acknowledgedDraftGenerationByKeyRef`, `unconfirmedDraftsRef`) now live as fields on one `Map<questionId, QuestionDraftState>`
- [x] `legacyDraftKeyAliasRef` and its migration-copy code deleted — `useResonanceSession.ts`'s `retryDraftSavesRef` now carries the retry's own `questionId` and full `RunIdentitySource`, passed through `onDraftReplayAcknowledged`; `acknowledgeQuestionDraftGeneration` uses `payloadMatchesResolvedRunToken` (not raw `===`) to recognize a late ack for a legacy-form run against an already-canonicalized record, so no alias table is needed
- [x] Full existing test suite green with **no behavioral test edits** (only renames/moves — the one hook test asserting the ack callback's shape changed signature, not behavior, since the callback itself now carries richer data)
- [x] Comment/reference sanity pass: re-checked `ResonanceStudent.tsx`, `useResonanceSession.ts`, and the test files for stale references to the deleted structures/functions — found and fixed two (a stale function name in a test comment, and a "being migrated incrementally" doc comment now that the migration is done). No stale line-number or old-identifier references found elsewhere in the activity.
- [x] `DEPLOYMENT.md` / `ARCHITECTURE.md` updated — fixed two DEPLOYMENT.md passages describing implementation details that no longer exist (the `onDraftReplayAcknowledged` callback signature; the "aliased permanently" legacy-key mechanism, now `payloadMatchesResolvedRunToken`-based identity matching instead), and updated ARCHITECTURE.md's description of the retained-draft structure from "keyed by question + run" to the consolidated `Map<questionId, QuestionDraftState>`, plus a pointer to the new shared `runIdentity.ts`. The rest of DEPLOYMENT.md item 15's behavioral description was left as-is: this consolidation is a refactor, not a behavior change, so the *contract* it documents is still accurate — only the specific implementation-detail sentences needed correcting.
- [x] Branch squashed/rebased into a small number of logical commits for final review — 11 unpushed local commits condensed into 5 (plan doc; shared run-identity comparator; shared draft-attempt helpers; the full `QuestionDraftState` collapse; doc/comment cleanup), built via `git read-tree --reset` at each group boundary and verified with a full `git diff --stat` against the pre-squash tip (empty — byte-for-byte identical final tree) before the branch pointer was moved. A `backup-before-squash` local branch still points at the original 11-commit history as a safety net.

## Consolidation complete

All items above are done. `ResonanceStudent.tsx`'s ref count for this
subsystem dropped from 9 (plus a hook-level 7 and two server-side
comparators) to one `Map<questionId, QuestionDraftState>`. Full `npm test`
green throughout, verified via repeated full-suite reruns to rule out
concurrent-test-runner flakiness as a real regression at each step.

## Why this exists

PR #375 started as a fix for one bug (students lose in-progress drafts when a
question's timer expires and the instructor reactivates it) and grew to 46
commits / +3641 / -111 across 13 files. Most of that growth is legitimate
regression tests (~2600 lines), but production code also grew by ~940 net
lines, and `ResonanceStudent.tsx` alone grew by +617/-19 — larger than the
entire original fix.

Every review round has been finding a new scenario where two independently
maintained pieces of ordering/staleness state disagree, and every fix has
patched that one disagreement rather than removing the redundancy. This is
whack-a-mole against an architecture with no canonical ordering primitive,
not against a shrinking set of genuine bugs. This plan replaces the
piecemeal patches with one consolidated model, verified against the test
suite the piecemeal rounds already built (that suite is the safety net that
makes this safe to do in place, without rolling back or reopening the PR).

## Current state: the catalog

Ordering/staleness is currently tracked by at least 18 independent,
overlapping mechanisms across three layers:

### `ResonanceStudent.tsx` (parent component, survives `QuestionView` remounts)

| Ref/state | Purpose |
|---|---|
| `editSequenceByKeyRef` | local "attempt N of answering this question in this run" counter |
| `submittedEditSequenceByKeyRef` | watermark: the edit sequence that was actually confirmed |
| `draftGenerationByKeyRef` | local autosave-attempt counter (bumped every debounced save) |
| `unconfirmedDraftsRef` | retained failed-save payloads, replayed on a 1s interval |
| `acknowledgedDraftGenerationByKeyRef` | highest generation the server has ever acknowledged |
| `legacyDraftKeyAliasRef` | maps a legacy (timestamp-keyed) retained draft to its canonicalized (revision-keyed) replacement after migration |
| `submittedAnswerRunRef` | which run a `submittedAnswers` entry was written under |
| `previousActiveQuestionIdsRef` / `RunRevisionRef` / `RunStartedAtRef` | previous-snapshot values, diffed to detect a run restart/reactivation |
| `snapshotRef` | escape hatch so callbacks can read current snapshot instead of a stale closure |

Six of these (`editSequenceByKeyRef`, `submittedEditSequenceByKeyRef`,
`draftGenerationByKeyRef`, `acknowledgedDraftGenerationByKeyRef`,
`unconfirmedDraftsRef`, `submittedAnswerRunRef`) are all keyed by
`questionId:runToken` and must be kept in sync by hand whenever a run
transitions — see the migration block at
[ResonanceStudent.tsx:660-711](../../activities/resonance/client/student/ResonanceStudent.tsx#L660-L711),
which manually copies values across five of them one field at a time. This
is the single most convoluted block in the file and exists only because
there are five separate maps instead of one record.

### `useResonanceSession.ts` (WebSocket transport hook)

| Ref | Purpose |
|---|---|
| `latestActiveQuestionRunRevisionRef` | client's own watermark for accepting/rejecting a delayed snapshot |
| `pendingDraftSavesRef` | in-flight direct sends awaiting ack, each entry carrying its own `.generation` |
| `queuedDraftRetriesRef` | payloads queued for replay on reconnect |
| `latestDraftGenerationByKeyRef` | highest generation *attempted* so far, per key (hook's own memory) |
| `cancelledUpToGenerationByKeyRef` | highest generation explicitly cancelled by the parent, per key |
| `retryDraftSavesRef` | in-flight reconnect-replay sends awaiting ack, each with its own `.generation` |

`getDraftGeneration()` here is a byte-for-byte duplicate of
`resolveDraftGeneration()` in `ResonanceStudent.tsx`, and
`isPayloadForSnapshotRun()` here duplicates the run-matching logic in
`payloadMatchesRunToken()` there — each independently re-deriving
`activeQuestionRunRevision ?? activeQuestionRunStartedAt` plus the legacy
revision-1 special case.

### `routes.ts` (server)

- Session-level: `activeQuestionRunRevision` (monotonic, via
  `nextActiveQuestionRunRevision`) and `lastActiveQuestionRunRevision`
  (watermark that survives self-paced/idle transitions).
- Per-response: `activeQuestionRunRevision`, `editSequence`.
- Per-draft: `responseDrafts[draftKey]` carries `activeQuestionRunRevision`,
  `editSequence`, `draftGeneration` — and a **separate** parallel map,
  `responseDraftGenerations[draftKey]`, tracks the same generation again so
  it survives after `responseDrafts[draftKey]` is deleted on submission.
- Two near-identical comparators: `matchesActiveQuestionRun` (for an
  incoming payload) and `responseMatchesActiveRun` (for a stored
  `Response`) — the latter exists only because `normalizeSessionData`
  always backfills the session's own `activeQuestionRunRevision` to at
  least 1, but `normalizeStoredResponses` does **not** do the equivalent
  backfill for individual stored responses, leaving legacy responses with
  `activeQuestionRunRevision: undefined` forever ([routes.ts:544-556](../../activities/resonance/server/routes.ts#L544-L556)).

### `QuestionView.tsx` (child, remounted every stack-tab switch)

Its own local refs (`submissionAttemptRef`, `activeQuestionRunRevisionRef`,
`sessionIdRef`, `studentIdRef`, `draftAnswerRunRevisionRef`, …) are a
different, legitimate category — a stale-closure guard for a callback that
resolves after *this instance* may have gone stale, not cross-remount
persistence — so they are lower priority here. They're listed for
completeness because they duplicate the same run-matching arithmetic a
fourth time, and the shared `runIdentity` module below should absorb them
too, but restructuring `QuestionView`'s own lifecycle is out of scope for
this pass.

**Net effect**: "generation" is tracked independently in four places
(component, hook, hook's per-entry fields, server), and "does this run
identity match" is implemented independently in four functions
(`payloadMatchesRunToken`, `isPayloadForSnapshotRun`,
`matchesActiveQuestionRun`, `responseMatchesActiveRun`) — each a slightly
different rederivation of the same fallback logic. Every review round that
finds two of these disagreeing has been "fixed" by adding a disambiguating
check to one call site rather than removing a redundant tracker.

## Proposed design

### 1. Shared `runIdentity` module (new: `activities/resonance/shared/runIdentity.ts`)

One pure, dependency-free module used identically by the client component,
the client hook, and the server:

```ts
export interface RunIdentitySource {
  activeQuestionRunRevision?: number | null
  activeQuestionRunStartedAt?: number | null
}

export function resolveRunToken(source: RunIdentitySource): number | null

// Handles the legacy revision-1/timestamp cross-form equivalence in one
// place instead of four.
export function runIdentitiesMatch(a: RunIdentitySource, b: RunIdentitySource): boolean
```

This directly replaces `resolvePayloadRunToken` + `payloadMatchesRunToken`
(component), `isPayloadForSnapshotRun` (hook), and `matchesActiveQuestionRun`
(server). Unit-test this module in isolation, covering every legacy-form
case currently spread across the four originals.

### 2. Fix the server-side asymmetry at the root, not with a second comparator

**Update (implemented):** Investigated backfilling `activeQuestionRunRevision`
on legacy stored responses inside `normalizeStoredResponses`. Decided
against it for this pass — the risk flagged below (conflating "legacy,
revision system didn't exist yet" with "explicitly self-paced/no run")
would need its own dedicated verification, and the existing explicit
`undefined`-check in `responseMatchesActiveRun` is small, already correct,
and now has direct equivalence-test coverage. Revisit only if a future
finding specifically motivates it.

**Also discovered during implementation:** `responseMatchesActiveRun` does
**not** delegate to `runIdentitiesMatch`, unlike `matchesActiveQuestionRun`.
A stored `Response` carries no timestamp field at all, so routing it
through `runIdentitiesMatch`'s legacy-timestamp branch (branch 3) would
treat a response's *absent* timestamp as matching a session whose own
start timestamp also happens to be `null` — a real, reachable shape (see
the note on `runIdentitiesMatch` below) — producing a false positive. This
was caught by the equivalence test, not by hand-reasoning; two earlier
attempts at a "cleaner" delegating version both introduced regressions
that the full test suite caught before merge. `responseMatchesActiveRun`
remains its own small function; only `matchesActiveQuestionRun` and the
(not yet wired in) client call sites share `runIdentitiesMatch`.

**Also discovered:** a session's `activeQuestionRunRevision` and
`activeQuestionRunStartedAt` are not always assigned together — the
non-staged normalization backfill path
(`normalizeSessionData`, ~line 1081-1087) can default revision to `1`
while leaving `activeQuestionRunStartedAt` as `null`, if the raw stored
session had no valid source timestamp. `runIdentitiesMatch` has to
preserve the original's exact (slightly quirky) null-handling for this
case rather than a "more elegant" symmetric reinterpretation — see the
comment on `runIdentitiesMatch` in `runIdentity.ts`.

**Update (implemented):** wiring the client hook's `isPayloadForSnapshotRun`
into `runIdentitiesMatch` surfaced two more real divergences, both caught by
the equivalence matrix (not by hand-reasoning — two intermediate designs
each looked correct on paper and broke a real test):

- A client-side `StudentSessionSnapshot`, unlike server-side
  `ResonanceSessionData`, *can* have a null revision alongside a real start
  timestamp (`normalizeStudentSessionSnapshot` just parses whatever the
  server sent; it doesn't re-derive the server's own "revision null implies
  startedAt null too" invariant). `runIdentitiesMatch` now compares
  resolved tokens directly first (`resolveRunToken(current) ===
  resolveRunToken(candidate)`), which handles this case for free, before
  falling back to the legacy revision-1 bridge.
- That bridge (`crossFormMatch`) is intentionally **one-directional**: it
  only lets a `candidate` lacking its own revision inherit a `current` that
  explicitly asserts revision 1 — never the reverse. A symmetric version
  (tried first) let a candidate that explicitly asserts revision 1 match a
  `current` with no active run at all, since both sides' missing
  information resolved the same way once the direction was ignored.

`runIdentity.test.ts` now keeps two separate realistic-shape sample sets
(`SESSION_DATA_SAMPLES` for the server-only invariant,
`SNAPSHOT_SAMPLES` for the client's looser one) rather than one shared
`CANONICAL_SAMPLES`, since testing `matchesActiveQuestionRun` against a
session shape that can't actually occur server-side was measuring
undefined behavior, not a real regression risk.

### 3. Shared draft-attempt helpers (new: `activities/resonance/client/draftAttempt.ts`)

Centralize `resolveDraftGeneration`/`getDraftGeneration` (currently
byte-for-byte duplicated) and the key-building functions
(`buildEditSequenceKey`, `buildUnconfirmedDraftKey`, `getDraftRetryKey` —
also near-duplicates) into one module imported by both
`ResonanceStudent.tsx` and `useResonanceSession.ts`. `editSequence` (domain
revisit counter) and `draftGeneration` (autosave delivery-ordering counter)
stay two distinct numbers — they represent genuinely different concepts —
but get one shared definition of how each is read/compared instead of two.

### 4. Collapse the six per-question-per-run maps into one record

**Update (design revised during implementation — read this before touching
more code):** the original sketch below (a flat `QuestionDraftState` with
plain fields, reset "when the run changes") turned out to be unsafe as
written. Keeping it here struck through, followed by what's actually
correct and why.

<del>

Replace `editSequenceByKeyRef`, `submittedEditSequenceByKeyRef`,
`draftGenerationByKeyRef`, `acknowledgedDraftGenerationByKeyRef`,
`unconfirmedDraftsRef`, and `submittedAnswerRunRef` in
`ResonanceStudent.tsx` with a single ref:

```ts
interface QuestionDraftState {
  runToken: number | null              // was submittedAnswerRunRef
  editSequence: number                 // was editSequenceByKeyRef
  submittedEditSequence: number | null // was submittedEditSequenceByKeyRef
  attemptedGeneration: number          // was draftGenerationByKeyRef
  acknowledgedGeneration: number       // was acknowledgedDraftGenerationByKeyRef
  unconfirmedDraft: UnconfirmedDraft | null
}

const questionDraftStateRef = useRef(new Map<string /* questionId */, QuestionDraftState>())
```

Keyed by **`questionId` alone**, not `questionId:runToken`. A run
transition updates the `runToken` field (and resets the fields that don't
survive a run boundary) on the existing record, instead of requiring values
to be copied across five separately-keyed maps into new keys.

</del>

**Why this was unsafe**: none of the five fields being merged in have any
*explicit* reset-on-new-run logic today. The composite key resets them
*implicitly* — a new run is a new key string, so a missing map entry (or
`?? 1` / `?? 0` default) naturally reads as "fresh." Collapsing to one
record per `questionId` removes that free reset, and "reset the field when
the run changes" is ambiguous about *when*:

- **Reset-on-write is too late.** `editSequence` is read on every render
  (`QuestionView`'s `editSequence` prop), not gated by any event. A record
  whose `runToken` hasn't been explicitly updated yet (nothing has *written*
  to it since the run changed) would still hand back the previous run's
  stale number to a read that happens first.
- **A blind write-time reset is also wrong**, because not every write
  represents a new run. `canonicalizeLegacyRevisionOneDraft` updates
  `runToken` for the *same real run* (legacy timestamp form → canonical
  revision-1 form) and must *not* clear anything — that's the "same run,
  different representation" case the whole legacy-alias mechanism exists
  to handle correctly, as opposed to `onDraftChanged`/`onSubmitted`, where a
  changed `runToken` really is a new run.
- **A stale ack must not resurrect a dead record.** `clearRetainedDraftIfSuperseded`
  is called with a composite key like `q1:7` (the run it was originally sent
  under) — possibly long after the local record has moved on to `q1:8`. It
  must never create or overwrite a `q1` record on run 8's behalf, and,
  because of legacy canonicalization, "does this ack's run match the
  record's run" is a `runIdentitiesMatch`-style equivalence check, not a
  strict `===` (an ack for legacy timestamp `1000` must still be recognized
  against a record already canonicalized to revision `1`, if they're the
  same real run).

**The actual design**: every run-scoped field is validated for its run at
**read** time, not reset at write time. A field is only trusted when
`state.runToken` matches the run being asked about (via
`runIdentitiesMatch`/`resolveRunToken`, not raw `===`, for the legacy-form
case); otherwise the read returns the baseline, exactly as a missing
composite-key entry would have. Writes always go through one shared
"ensure this record represents this run" step that resets every field
*except* `runToken` **only when the record's current `runToken` doesn't
already match** the run being written for — so a same-run write (the
overwhelmingly common case: typing, an ack, a retry tick) is a plain
in-place mutation, and only a genuine transition (or first use) starts
fresh:

```ts
interface QuestionDraftState {
  runToken: number | null
  editSequence: number
  submittedEditSequence: number | null
  attemptedGeneration: number
  acknowledgedGeneration: number
  unconfirmedDraft: UnconfirmedDraft | null
}

function ensureQuestionDraftStateForRun(
  questionDraftStateByQuestionId: Map<string, QuestionDraftState>,
  questionId: string,
  runToken: number | null,
): QuestionDraftState {
  const existing = questionDraftStateByQuestionId.get(questionId)
  if (existing !== undefined && existing.runToken === runToken) return existing
  const fresh: QuestionDraftState = {
    runToken, editSequence: 1, submittedEditSequence: null,
    attemptedGeneration: 0, acknowledgedGeneration: 0, unconfirmedDraft: null,
  }
  questionDraftStateByQuestionId.set(questionId, fresh)
  return fresh
}
```

Every writer (`setQuestionRunToken`, `advanceQuestionEditSequenceForRevisit`,
`seedQuestionEditSequenceFromConfirmedResponse`, `recordQuestionSubmission`,
`nextQuestionDraftGeneration`, `setQuestionUnconfirmedDraft`) calls
`ensureQuestionDraftStateForRun` first, then mutates its one field. Every
reader (`resolveQuestionEditSequence`, etc.) checks `state.runToken ===
runToken` (or the `runIdentitiesMatch` equivalent where legacy timestamps
are in play) before trusting the stored value, falling back to the same
baseline `ensureQuestionDraftStateForRun` would have started from.

`canonicalizeLegacyRevisionOneDraft`'s call site is the one exception: it
needs a **non-resetting** update — `canonicalizeQuestionRunToken(map,
questionId, runToken)` — that only overwrites `.runToken` in place on an
existing record, preserving every other field, since it represents the
same real run.

**The stale-ack problem and `legacyDraftKeyAliasRef`**: `clearRetainedDraftIfSuperseded`
only has a composite key string (`q1:7`) to work from when called from the
hook's `onDraftReplayAcknowledged` — not the original payload. Rather than
parsing a run token back out of a string (lossy, easy to get subtly wrong),
extend what `useResonanceSession.ts`'s `retryDraftSavesRef` tracks to carry
the retry's own run-identity fields (it already tracks `key` and
`generation`; add the resolved `runToken`) and pass that through to
`onDraftReplayAcknowledged` alongside the key. Then
`acknowledgeQuestionDraftGenerationForKey(map, questionId, runToken,
generation)` can do the real check — `existing !== undefined &&
runIdentitiesMatch(existing, { activeQuestionRunRevision: runToken })` (or
equivalent) — and no-op otherwise, rather than creating or resetting
anything. This is what makes `legacyDraftKeyAliasRef` unnecessary: a late
ack for either form of the same real run resolves correctly by identity,
not by a separately-maintained alias table.

**Revised migration order for the remaining fields**, each its own
commit, full suite after each:
1. ~~`unconfirmedDraft` (needs the read/write pattern above, but no other
   field depends on it — self-contained).~~ **Done — combined with 2
   below**, once implementation showed they're not actually separable:
   the retry loop's legacy-canonicalization block reads/writes
   `unconfirmedDraft`, `attemptedGeneration`, and `acknowledgedGeneration`
   together in the same few lines (see `retryUnconfirmedDrafts` in
   `ResonanceStudent.tsx`), so splitting them into separate commits would
   have meant a transitional state where that block straddled the old
   Record/Map structures and the new collapsed record for no real safety
   benefit.
2. ~~`attemptedGeneration` + `acknowledgedGeneration` together~~ **Done**,
   together with `unconfirmedDraft` above (`draftGenerationByKeyRef`,
   `acknowledgedDraftGenerationByKeyRef`, and `unconfirmedDraftsRef` all
   deleted in the same commit). This also collapsed most of the ~50-line
   legacy-canonicalization block: since all three fields now live on one
   record, canonicalizing `runToken` in place (`canonicalizeQuestionRunToken`)
   carries the other two along for free — no more copying values across a
   second key namespace, and no more "does an entry already exist at the
   canonical key" conflict to resolve (there's only ever one record per
   question now, so that scenario is structurally impossible). What's left
   of the block is the alias bookkeeping for `legacyDraftKeyAliasRef`
   (still needed — see below) and the hook-level `cancelDraftRetries` calls
   (unrelated to local storage, still required).

   `legacyDraftKeyAliasRef` was **not** deleted in this step, contrary to
   the original plan — see the checklist note at the time. It was fully
   deleted in step 4 below, once `retryDraftSavesRef` was extended to carry
   the retry's own full `RunIdentitySource` instead of a bare key string —
   see step 4's note for how that made the alias table unnecessary.
3. ~~`editSequence` + `submittedEditSequence` together~~ **Done** —
   `resolveCurrentEditSequence`/`advanceEditSequenceForRevisit`/
   `seedEditSequenceFromConfirmedResponse` renamed to their `Question*`
   equivalents on the collapsed map; new `recordQuestionSubmittedEditSequence`/
   `getQuestionSubmittedEditSequence` for the watermark. `QuestionDraftState`
   exported so tests can type their own map instances directly.
4. ~~Extend `useResonanceSession.ts`'s `retryDraftSavesRef` with a resolved
   `runToken`, then delete `legacyDraftKeyAliasRef`~~ **Done, but ended up
   carrying more than a bare `runToken`.** A resolved scalar alone can't
   distinguish "this ack is for a legacy timestamp form that's since been
   canonicalized" from "this ack is for a genuinely different run" — that
   distinction needs the *original* revision/startedAt fields, not just
   whichever one `resolveRunToken` picked. `retryDraftSavesRef` entries now
   carry `questionId` and the full `RunIdentitySource` (renamed `parseDraftRetryKey`
   away entirely, since the hook no longer needs to hand back a bare key for
   this purpose); `acknowledgeQuestionDraftGeneration`'s match check uses
   `payloadMatchesResolvedRunToken` (already built and tested in step 1)
   instead of raw `===`, since it's exactly the "compare a payload's run
   identity against an already-resolved scalar from elsewhere" case that
   function exists for.

### 5. Hook stays, but stops re-deriving generation independently

`useResonanceSession.ts` keeps its own structures — raw WebSocket
delivery/ack tracking is a genuinely different concern from domain draft
state, and collapsing the two layers together would recreate the same
"one giant object doing two jobs" problem this plan is trying to remove.
The change here is narrower: read/compare generations through the shared
`draftAttempt.ts` helpers from (3) instead of the hook's own copy of that
logic.

## Migration strategy

Do this as a sequence of small, independently-verified steps, each run
against the **full existing test suite unmodified**. A test needing a
behavioral (not just import/rename) edit to stay green is a stop-and-
investigate signal, not something to "fix" by updating the assertion — the
test suite is the spec here, not an obstacle.

1. Add `runIdentity.ts`, unit-tested in isolation. Not wired in yet.
2. Swap server call sites (`matchesActiveQuestionRun` → `runIdentitiesMatch`).
   Run server suite. Investigate the `normalizeStoredResponses` backfill;
   if it checks out, add it and delete `responseMatchesActiveRun`. Run
   server suite again.
3. Swap hook and component call sites (`payloadMatchesRunToken`,
   `isPayloadForSnapshotRun` → `runIdentitiesMatch`). Run client suite.
4. Add `draftAttempt.ts`, swap both files' generation/key helpers to use
   it. Run client suite.
5. Introduce `QuestionDraftState` in the component, starting with just
   `runToken` (was `submittedAnswerRunRef`, already questionId-keyed —
   the lowest-risk, a plain Record→Map swap). **Done.**
6. Migrate the remaining fields using the read-time-validated design in
   section 4 above (not the original write-time-reset sketch, which turned
   out to be unsafe) — `unconfirmedDraft` alone, then
   `attemptedGeneration`+`acknowledgedGeneration` together, then
   `editSequence`+`submittedEditSequence` together, each its own commit,
   full suite after each. Extend `useResonanceSession.ts`'s
   `retryDraftSavesRef` to carry a resolved `runToken` alongside its
   existing `key`/`generation` tracking, so late-ack handling can check
   real run identity instead of a string-parsed guess.
7. Delete `legacyDraftKeyAliasRef` and the manual cross-map migration block
   once the consolidated record makes it structurally unreachable.
8. Re-read the whole file against the 46 commits' worth of `// ...`
   explanatory comments accumulated along the way. For each: confirm it's
   still accurate against the new structure, or that the concern it
   describes is now structurally impossible (and can be deleted) rather
   than just no-longer-mentioned.
9. Update `ARCHITECTURE.md` / `DEPLOYMENT.md` to describe the consolidated
   contract (single run-identity resolver, single per-question state
   record) in place of the current piecemeal notes.
10. Squash/rebase the branch into a small number of logical commits (e.g.
   one per migration step above) for final review, once everything is
   green.

## Testing plan

- No new test *behavior* should be needed — this is a refactor of the
  mechanism underneath already-tested behavior, not a change in behavior.
- New unit tests are warranted only for the new pure modules in isolation
  (`runIdentity.ts`, `draftAttempt.ts`) covering the legacy-form cases each
  absorbs.
- Full `npm test` (client + server + activities, lint, typecheck) after
  every migration step, not just at the end — regressions should be caught
  one small step at a time, not in one large diff.
- Explicitly re-run the tests added in the last three review rounds (run
  restart, same-run replacement edit, stale generation-1 failure, legacy
  pre-rollout response) since those are exactly the scenarios this
  consolidation must not regress.

## Risks and mitigations

- **Risk**: This touches the most bug-prone code in the repo; regression
  risk is real by definition.
  **Mitigation**: one structure migrated at a time behind the full existing
  suite; never batch multiple structural changes into one unverified
  commit.
- **Risk**: Keying `QuestionDraftState` by `questionId` alone (not
  `questionId:runToken`) changes run-transition semantics in a way that's
  easy to get subtly wrong, especially for self-paced mode (`runToken` is
  always `null`) and mid-run revisits (same run, same question, answered
  twice).
  **Mitigation**: the existing self-paced and revisit tests already exercise
  both; treat any of them going red as a design problem to resolve before
  proceeding, not a test to adjust.
- **Risk**: Backfilling `activeQuestionRunRevision` in
  `normalizeStoredResponses` could conflate "legacy response, revision
  system didn't exist yet" with "explicitly self-paced, no run" if the
  `undefined` vs `null` distinction isn't preserved correctly.
  **Mitigation**: this needs explicit investigation (with a test asserting
  the self-paced case specifically) before implementation, not an assumed
  answer in this plan — flagged as its own checklist item above rather than
  bundled into the general server swap.
- **Risk**: `responseDraftGenerations` being separate from `responseDrafts`
  on the server is deliberate (the generation watermark must survive after
  a draft is deleted on submission) — a naive "just merge these two maps"
  would lose that.
  **Mitigation**: keep them separate; only rename for clarity if a clearer
  name doesn't itself add risk. Not a required part of this pass.

## Deliverables

- `activities/resonance/shared/runIdentity.ts` with unit tests.
- `activities/resonance/client/draftAttempt.ts` with unit tests.
- `ResonanceStudent.tsx` reduced from 9 overlapping refs to a single
  `QuestionDraftState` map (plus the snapshot-diffing refs, which are a
  different concern and stay).
- `useResonanceSession.ts` unchanged in structure, generation/key logic
  delegated to the shared helper.
- `routes.ts`: one run-identity comparator instead of two; legacy-response
  backfill if the investigation confirms it's safe.
- Full test suite green throughout, no behavioral test edits.
- `ARCHITECTURE.md` / `DEPLOYMENT.md` updated to describe the consolidated
  contract.
- Branch squashed to a small number of logical commits before final review.
