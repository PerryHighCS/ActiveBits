# Resonance Draft/Submission State Consolidation

## Status

- [ ] Root-cause catalog reviewed and agreed
- [ ] Shared `runIdentity` module added (client+server) and wired in
- [ ] Server: `matchesActiveQuestionRun` / `responseMatchesActiveRun` collapsed into one comparator
- [ ] Server: legacy-response `activeQuestionRunRevision` backfill investigated and (if safe) added to `normalizeStoredResponses`
- [ ] Client: shared draft-attempt helpers (`draftAttempt.ts`) added and wired into both the hook and the component
- [ ] Client: per-question state collapsed into a single `QuestionDraftState` map in `ResonanceStudent.tsx`
- [ ] `legacyDraftKeyAliasRef` and its migration-copy code deleted
- [ ] Full existing test suite green with **no behavioral test edits** (only renames/moves)
- [ ] `DEPLOYMENT.md` / `ARCHITECTURE.md` updated to describe the new single-model contract
- [ ] Branch squashed/rebased into a small number of logical commits for final review

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

Investigate backfilling `activeQuestionRunRevision` on legacy stored
responses inside `normalizeStoredResponses`, the same way
`normalizeSessionData` already backfills the session's own field. If safe
(see Risks — this needs to distinguish "legacy, revision system didn't
exist yet" from "explicitly self-paced/no run," which the current
`undefined` vs `null` distinction encodes and a backfill must preserve
correctly), every stored response always has a concrete
`activeQuestionRunRevision` after normalization, and
`responseMatchesActiveRun` collapses to a plain call to
`runIdentitiesMatch(response, sessionData)` — deleting the function and its
permanent special-cased branch entirely, rather than keeping it as a
second, forever-parallel comparator.

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
to be copied across five separately-keyed maps into new keys. This is what
makes `legacyDraftKeyAliasRef` and the ~50-line manual migration block
([ResonanceStudent.tsx:660-711](../../activities/resonance/client/student/ResonanceStudent.tsx#L660-L711))
unnecessary — there's no second key namespace to alias between.

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
5. Introduce `QuestionDraftState` in the component. Migrate one field at a
   time (start with `submittedAnswerRunRef` → `.runToken`, the
   lowest-risk), running the full suite after each field before moving to
   the next. Delete each old ref only once nothing references it.
6. Delete `legacyDraftKeyAliasRef` and the manual cross-map migration block
   once the consolidated record makes it structurally unreachable.
7. Re-read the whole file against the 46 commits' worth of `// ...`
   explanatory comments accumulated along the way. For each: confirm it's
   still accurate against the new structure, or that the concern it
   describes is now structurally impossible (and can be deleted) rather
   than just no-longer-mentioned.
8. Update `ARCHITECTURE.md` / `DEPLOYMENT.md` to describe the consolidated
   contract (single run-identity resolver, single per-question state
   record) in place of the current piecemeal notes.
9. Squash/rebase the branch into a small number of logical commits (e.g.
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
