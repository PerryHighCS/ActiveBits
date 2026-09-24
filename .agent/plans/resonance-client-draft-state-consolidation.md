# Consolidate Resonance client-side draft-ordering state

## Status

- [x] Step 1: Add `QuestionDraftState` + accessor, and migrate the 4 draft-tracking fields in the same step; delete the 4 old trackers
- [x] Step 2: Re-read the file against its own accumulated comments; update/delete stale docstrings; record the 5-trackers-to-2 reduction
- [x] Full verification after every step (`npm run test:codex` after Step 1; `npm test` with port binding after Step 2)
- [x] Full contract re-read, PR description update, and an explicit documented decision on the server's concurrent-write gap (#313) before resuming ad hoc review responses
- [x] `ARCHITECTURE.md` / `.agent/knowledge/data-contracts.md` updated to describe the consolidated contract

## Implementation record

- Step 1: Activities typecheck and the mounted `ResonanceStudent.test.ts` suite passed. The full `npm run test:codex` gate passed (156 activity test files); the initial `npm test` run reached its final server check but could not bind port 4010 (`EPERM`) in the default sandbox.
- Step 2 measurement, scoped to the five named trackers: 5 structures became 2 (`questionDraftStateRef` and the independent `editSequenceByKeyRef`). `clearDraftTracking`'s signature fell from 7 to 4 lines; its four calls fell from 7 to 4 lines each (28 to 16 combined). The tracker-declaration comment block fell from 37 to 4 lines. `ResonanceStudent.tsx` fell from 1,278 to 1,245 lines at this checkpoint. This measures this client-side refactor only, not the PR as a whole.
- Final gate: `npm test` passed with local port binding enabled, including the server health check on port 4010. The consolidated client, the independent edit-sequence map, server draft/watermark ordering, and their tests were re-read together. PR #381's title and description were updated to state the current contract and the remaining concurrent-write limit.
- Server concurrency scope: The client consolidation leaves whole-session `sessions.set()` races unresolved, including races possible within one instance. Migrating only the draft handler to `updateAtomic` would leave mixed writers, so this PR will not claim atomic draft persistence. Issue #313 remains the owner for an all-writer migration; the single-instance deployment limit remains in force.

## Context

This branch (`resonance/simplify-draft-saving`) exists to replace PR #375,
which grew to 76 commits because every review round found a new edge case
in student draft-saving and got a narrowly-scoped patch, without removing
the redundant state that produced the disagreement
(`.agent/plans/resonance-draft-state-consolidation.md` on the abandoned
`fix/resonance-unconfirmed-stack-drafts` branch documents that failure mode
in detail — retrievable via `git show a28435cc:.agent/plans/resonance-draft-state-consolidation.md`,
since that file doesn't exist on this branch).

Phase 1 of this branch's original plan (delete the legacy run-identity
bridge) is done. Phase 2 (replace the generation/retry-queue model with
something simpler) was never executed as originally envisioned — instead,
real review rounds kept finding genuine edge cases in the ordering/
staleness contract governing `resonance:update-draft`, each correctly
fixed, but no round asked whether the growing pile of tracking state
itself was the problem. By this session's Follow-up 19, the client side
had regrown to 5 separate ref/Map/Set structures in `ResonanceStudent.tsx`,
4 of which are kept in sync by hand via a `clearDraftTracking` helper whose
signature grew a new required field almost every round. That manual-sync
burden — not the mere existence of 5 structures — is the actual instance of
the #375 failure pattern this plan targets.

**A first draft of this plan proposed merging all 5 trackers, including
`editSequenceByKeyRef`, into one record.** That was reviewed and rejected
before implementation started, for three reasons: its migration steps
didn't survive scrutiny (an unused-variable step that wouldn't pass
`noUnusedLocals`, and a regression test scheduled before the code path it
exercises existed); its stopping condition just resumed ad hoc review
responses silently, repeating this exact PR's own pattern; and its
justification for the keying decision cited a data-loss risk that,
once checked against reachability rather than structure alone, turned out
not to be exercisable through any current code path (see below) — a
reminder that "structurally plausible" and "verified" are not the same
standard this plan holds itself to. This revision fixes all three
problems, including relabeling the `editSequenceByKeyRef` justification
honestly rather than overclaiming a bug that isn't there.

**Explicitly not in scope**: the server's `responseDrafts` /
`draftOrderingWatermarks` two-map split (deliberate — the watermark must
survive the draft record's own deletion; already validated as correct by
the #375 precedent for its own equivalent, `responseDraftGenerations`),
`useResonanceSession.ts`, and `QuestionView.tsx` (neither references any of
the trackers below).

## Current state: the 5 trackers (all in `ResonanceStudent.tsx`)

| Ref | Keyed by | Purpose |
|---|---|---|
| `editSequenceByKeyRef: Record<string, number>` | `` `${questionId}:${runToken}` `` via `buildEditSequenceKey` | domain "how many times revisited in this run" counter |
| `unconfirmedQuestionIdsRef: Set<string>` | `questionId` | "has a locally-typed answer the server hasn't confirmed" |
| `unconfirmedQuestionRunRevisionsRef: Map<string, number\|null>` | `questionId` | run revision in effect when the question became dirty (closes a React effect-timing race — Follow-up 15) |
| `inFlightDraftQuestionIdsRef: Map<string, number>` | `questionId` | attempt-token of the outstanding `saveDraft()` call, if any |
| `pendingRetryAfterInFlightQuestionIdsRef: Set<string>` | `questionId` | "a newer send was requested while one was still in flight" (Follow-up 18/19) |

Only the last 4 are kept in sync via the exported `clearDraftTracking(params)`
(~line 279), called from 4 sites: the live-run→idle cleanup (~line 646),
the run-restart/reactivation cleanup (~line 774), the deadline-
reconciliation success path (~line 975), and `onSubmitted` (~line 1190).
`editSequenceByKeyRef` is deliberately never touched by `clearDraftTracking`
— it's handled at its own 3 sites (the snapshot-merge seeding loop ~line
711, the tab-click revisit handler ~line 1130, read in the `QuestionView`
prop ~line 1166) because its lifecycle is fundamentally different, per the
next section.

## Why `editSequenceByKeyRef` stays out of the merged record

`buildEditSequenceKey` (`ResonanceStudent.tsx:68-74`) keys this `Record` by
`` `${questionId}:${runToken}` ``, and the only full reset of the ref is on
session/student identity change (`ResonanceStudent.tsx:566`) — never on a
run transition. In the abstract, that means a stale run token's entry
could outlive the run it belonged to, which reads as a risk for a
single-scalar collapse (one value can't hold two run tokens' history at
once).

**That risk was checked against reachability, not just structure, and
does not hold today.** Both write sites that could ever push a
`` `${questionId}:null` `` (self-paced) entry above its baseline are
explicitly gated to skip self-paced mode entirely:
- The revisit handler only calls `advanceEditSequenceForRevisit` when
  `isRevisit = !snapshot.selfPacedMode && submittedQuestionIds.has(...)`
  (`ResonanceStudent.tsx:1123`) — self-paced mode also routes submission
  state through `clearLiveQuestionSubmission`, which is a no-op whenever
  `selfPacedMode` is true, so there is no self-paced "revisit" concept to
  begin with.
- The snapshot-merge effect's seeding loop (`seedEditSequenceFromConfirmedResponse`)
  is only reached for the non-self-paced branch — the self-paced branch
  returns early (`ResonanceStudent.tsx:685-704`) before that loop exists.

So a self-paced question's edit-sequence entry never advances past the
baseline (`1`) through any currently reachable path, and a self-paced →
live → self-paced round trip would observe `1` on both sides under *either*
design — a test asserting that would not actually distinguish the
rejected single-scalar collapse from the kept-separate design; it has no
discriminating power and would be misleading coverage, not protection.

**Revised justification, honestly scoped**: `editSequenceByKeyRef` stays
separate not because of a demonstrated reachable data-loss bug, but
because (1) it has genuinely different reset semantics from the other 4
trackers — numeric floor/seed math (`seedEditSequenceFromConfirmedResponse`'s
`Math.max(confirmed + 1, draft)`) versus a plain boolean/optional clear —
so merging it would add representational complexity for no corresponding
reduction in the manual-sync burden this plan targets, and (2) it was
never part of that burden in the first place — `clearDraftTracking`'s
signature never grew because of it, and it was never touched in
Follow-ups 15/18/19. This is a scope boundary preserving a currently-
correct, independently-working mechanism unchanged, not a bug fix. No new
test is added for it — there is no current or introduced behavior change
to protect against.

## Design: `QuestionDraftState`, keyed by `questionId` alone

```ts
interface QuestionDraftState {
  unconfirmed: boolean
  dirtyRunRevision: number | null | undefined      // undefined = not recorded
  inFlightAttemptToken: number | undefined
  pendingRetryAfterInFlight: boolean
}

const questionDraftStateRef = useRef(new Map<string, QuestionDraftState>())
```

Every field maps 1:1 onto one of the 4 draft-tracking trackers' current
semantics — representation change only, no behavior change. All 4 are
already keyed by `questionId` alone today (plain `Set<string>`/
`Map<string, ...>`), so this merge has none of `editSequenceByKeyRef`'s
multi-run-history problem: none of these 4 need to remember a value across
a run-token cycle — they're always explicitly cleared on every run
transition via `clearDraftTracking`, never implicitly reset via a key miss.

### The one correctness-critical rule: mutate fields in place, never replace or delete the whole record

**Verified risk** (traced directly, still relevant even with
`editSequenceByKeyRef` out of scope): several call sites — the seeding loop,
`onDraftChanged`, `attemptDraftSend`'s settlement — could be written
carelessly as `map.set(questionId, {...fresh defaults, someField: x})`
(full replace) instead of mutating an existing record's one changed field
in place. Against a *merged* record, a careless replace at any one call
site would silently reset every *other* field on that record too — e.g. an
`onDraftChanged` write wiping a genuinely in-flight `inFlightAttemptToken`/
`pendingRetryAfterInFlight`, reintroducing the exact bug class Follow-up 18
fixed, via object replacement instead of a missing tracker.

**Rule**: every write site uses a single `getOrCreateQuestionDraftState(map, questionId)`
accessor and mutates specific fields on the returned record in place, never
`.set()` with a fresh object or `.delete()` outside `clearDraftTracking`
itself. `clearDraftTracking`'s new body only ever sets its 4 fields to
their cleared values on an *existing* record (no-op if the record doesn't
exist yet):

```ts
export function clearDraftTracking(params: {
  draftState: Map<string, QuestionDraftState>
  questionIds: readonly string[]
}): void {
  for (const questionId of params.questionIds) {
    const existing = params.draftState.get(questionId)
    if (existing === undefined) continue
    existing.unconfirmed = false
    existing.dirtyRunRevision = undefined
    existing.inFlightAttemptToken = undefined
    existing.pendingRetryAfterInFlight = false
  }
}
```

### `attemptDraftSend`'s token-ownership invariant must survive unchanged

"Only the settlement that still owns the current attempt token may act" —
every check must stay a fresh read at settlement time
(`questionDraftStateRef.current.get(questionId)?.inFlightAttemptToken === attemptToken`
inside the `.then()` callback), never a value or record reference captured
when the attempt started.

### `isDraftStillCurrentForRevision`

Currently takes a whole `ReadonlyMap<string, number | null>`. Simplify its
signature to take the already-resolved `dirtyRunRevision` value directly
(the one caller does the single map lookup itself) — it's only ever called
for one `questionId` at a time. Update its dedicated decision-table test to
pass bare values instead of constructing single-entry maps.

## Migration strategy

Two small, independently-verified steps. Run the **full existing test
suite unmodified** after each. A test needing a *behavioral* edit (not
just an import/rename/fixture-shape change) to stay green is a stop-and-
investigate signal, not something to patch.

**Step 1: introduce `QuestionDraftState` and migrate all 4 fields to it in
one step**, not two. A separate "add the struct, unused" step was
considered and rejected: this repo's `tsconfig.base.json` sets
`noUnusedLocals: true`, so a `questionDraftStateRef` declared and never
read would fail `npm run typecheck` on its own — there is no such thing as
an "unused scaffolding, still green" intermediate state here. Instead:

- Add `QuestionDraftState`, `getOrCreateQuestionDraftState`, and
  `questionDraftStateRef`.
- Rewrite `clearDraftTracking` to the single-map, in-place-mutation form
  above. Update its test (`ResonanceStudent.test.ts:374-511`) to build one
  `Map` fixture per existing decision-table case instead of 4 separate
  Set/Map fixtures — same cases, same expected outcomes, structural edit
  only.
- Swap every remaining read/write site to the merged map, via
  `getOrCreateQuestionDraftState` for writes (exhaustive list, re-verified
  against the file — do not treat this as illustrative):
  - The session/student identity reset (`ResonanceStudent.tsx:567-570`) —
    4 separate `.current = new X()` resets become one
    `questionDraftStateRef.current = new Map()`.
  - The 4 `clearDraftTracking` call sites: `idsLeavingLiveContext` cleanup
    (~646), `restartedIds` cleanup (~774), deadline-reconciliation success
    path (~975), `onSubmitted` (~1190).
  - `attemptDraftSend`'s guard reads (~811, ~814), the in-flight check and
    `pendingRetryAfterInFlight` set (~822, ~828), the attempt-token set on
    send (~840), the token-ownership check and clear on settlement
    (~856-857), the pending-retry consult-and-clear (~864), and —
    **easy to miss because it's a bare `.delete()`, not a `clearDraftTracking`
    call** — the ack-success path's `unconfirmedQuestionIdsRef.current.delete(questionId)`
    (~891), which becomes `existing.unconfirmed = false` (and only that
    field — this is the ack-success case, not an abandonment, so it must
    not touch `inFlightAttemptToken`/`pendingRetryAfterInFlight`, which the
    surrounding token-ownership check at ~856-857 already handles
    separately).
  - The retry interval's `selectUnconfirmedDraftQuestionIds` call
    (`ResonanceStudent.tsx:932-936`) — currently passed
    `unconfirmedQuestionIds: unconfirmedQuestionIdsRef.current` (a
    `Set<string>`) directly. Either derive a `Set<string>` from the merged
    map at this call site (entries where `.unconfirmed === true`), or widen
    `selectUnconfirmedDraftQuestionIds`'s own parameter to accept the map —
    pick one and update its dedicated test accordingly; do not leave this
    site reading a now-deleted ref.
  - `onDraftChanged`'s writes (~1176-1177).
- Delete `unconfirmedQuestionIdsRef`, `unconfirmedQuestionRunRevisionsRef`,
  `inFlightDraftQuestionIdsRef`, `pendingRetryAfterInFlightQuestionIdsRef`.
  A successful `npm run typecheck` after this deletion is itself a partial
  completeness check — any missed read/write site fails to compile — but is
  not sufficient on its own (a site that was migrated to read/write the
  wrong field, or the ack-success case above losing its single-field
  scoping, would still compile).
- `npm test`. Pay particular attention to "a stale settlement from an
  abandoned attempt does not let a newer attempt for the same question be
  duplicated" and the in-flight/pending-retry tests (Follow-up 15/18/19's
  additions) — these exercise the token-ownership invariant directly.
- **New regression test, in this step** (not a later one — there is no
  later step for these 4 fields): an interleaving where
  `getOrCreateQuestionDraftState` is used to write `unconfirmed`/
  `dirtyRunRevision` (the `onDraftChanged` path) on a `questionId` that
  already has a non-default `inFlightAttemptToken`/
  `pendingRetryAfterInFlight`, asserting those two fields are unchanged
  afterward — and the mirror case (writing `inFlightAttemptToken` doesn't
  disturb an existing `unconfirmed`/`dirtyRunRevision`). This cross-field
  interaction is structurally impossible today (4 separate structures) and
  only becomes reachable once they share one record, so it needs its own
  coverage rather than relying on existing tests to catch it incidentally.

**Step 2: re-read the file against its own accumulated comments.** Several
docstrings (~lines 65-71 for the group as a whole, 256-301, 409-426)
describe the *current* multi-tracker shape and the manual-sync burden by
name — update them to describe the merged map, or delete where the concern
is now structurally impossible. **Record the measured reduction** as part
of this step, not as an assumed outcome, scoped precisely to what this
pass actually touches: the 5 targeted trackers (`editSequenceByKeyRef`,
`unconfirmedQuestionIdsRef`, `unconfirmedQuestionRunRevisionsRef`,
`inFlightDraftQuestionIdsRef`, `pendingRetryAfterInFlightQuestionIdsRef`)
become 2 (the merged map, plus `editSequenceByKeyRef` staying separate),
and before/after line count of `clearDraftTracking`'s signature and its 4
call sites. Do not claim this shrinks the file, the component, or the PR
overall — `ResonanceStudent.tsx` has other draft-related refs and effects
outside this pass's scope (deadline reconciliation, submitted-answer
caching, snapshot-diffing refs) that are untouched and may grow
independently in future rounds. A green test suite alone is not the
success criterion — the measured reduction in these 5 specific trackers
is, and it should be reported as exactly that, not generalized.

## Verification

- `npm test` (typecheck, lint, client/server/activities suites) after
  Step 1 and after Step 2.
- No new test *behavior* expected beyond the Step 1 cross-field-interaction
  test — this is a refactor of representation underneath already-tested
  behavior for everything else.
- Explicitly re-run (already in the suite, must not regress): the
  run-restart/reactivation tests, the in-flight/pending-retry tests, the
  post-reload edit-sequence seeding tests, and the deadline-reconciliation
  tests.

## Before resuming ad hoc review responses

Once Step 1 and Step 2 are green, do **not** simply resume responding to
individual Copilot/CodeRabbit comments as they arrive — that resumption,
done silently, is itself a version of the pattern this plan exists to
break. Instead, as an explicit closing step:

1. **Re-read the complete consolidated contract end to end** — the merged
   `QuestionDraftState` map, `editSequenceByKeyRef` alongside it, and the
   server's `responseDrafts`/`draftOrderingWatermarks` split — as one
   document, checking it's internally consistent now, not just that each
   piece was individually correct when added.
2. **Update the PR description** to describe the actual final design
   (the merged record, why `editSequenceByKeyRef` stays separate, the
   server's two-map split) rather than leaving it describing the original
   per-Follow-up patch history.
3. **Make an explicit, documented decision about the server's concurrent-
   write gap** (`routes.ts` ~line 3320, the `sessions.set()` vs.
   `updateAtomic` mixed-writers race already tracked as issue #313): either
   confirm it's still correctly out of scope with a current, specific
   rationale (not just a repeated "see #313" disclaimer), or bring it into
   scope now. This must be a decision recorded once, here or in
   `data-contracts.md`, not re-litigated in every future review reply that
   happens to brush against it.

Only after those three are done should individual review comments resume
being handled one at a time, same as before.

## Post-consolidation review: absent-draft clear watermark

- [x] Check CodeRabbit's clear/write scenario against the existing ordering contract and the cloned session write limit.
- [x] Persist the ordering watermark for an accepted clear even when no draft was stored, and test that an older message handled afterward cannot create a draft.
- [x] Keep the separate #313 limit explicit: a handler that loaded a stale whole-session clone before the clear can still overwrite it, so this change must not claim full concurrency safety.

Owner: Resonance `resonance:update-draft` handler. The invariant is that an acknowledged clear has a durable ordering floor even when it deleted no draft. If persistence fails, no acknowledgement is sent and the client's retry state remains active. The focused route test, activities typecheck, and full `npm test` gate passed, including the server health check.
