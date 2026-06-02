# SyncDeck Embedded Resonance Prediction Gating Plan

## Status

- [x] Confirm current repo state and branch off `main`
- [x] Capture implementation plan before code changes
- [ ] Extend embedded launch data contract for Resonance prediction gating
- [ ] Add embedded child-to-parent navigation capability messaging
- [ ] Teach SyncDeck student overlay controls to honor embedded child capabilities
- [ ] Teach embedded Resonance student runtime to compute and publish prediction locks
- [ ] Add/update tests for contract parsing, SyncDeck enforcement, and Resonance unlock behavior
- [ ] Record durable contract notes in `.agent/knowledge/data-contracts.md`
- [ ] Run required validation (`npm test`, plus follow-up checks if scope expands)

## Goal

Allow embedded Resonance activities inside SyncDeck to block specific SyncDeck-supplied
student overlay navigation directions until students have locked in their prediction answers.

Initial target launch option:

```ts
prediction?: {
  block?: Array<'forward' | 'down'>
}
```

## Agreed Responsibility Split

- SyncDeck owns the embedded overlay controls and the final allow/deny behavior for navigation.
- Resonance owns interpreting prediction-related launch options and deciding when the block should
  be active or released.
- The host/child boundary should stay generic so future embedded activities can report navigation
  capabilities without SyncDeck learning activity-specific rules.

## Proposed Contract Direction

### 1. Embedded launch selected options

Resonance should accept embedded launch options that may include:

```ts
{
  prediction?: {
    block?: Array<'forward' | 'down'>
  }
}
```

Normalization rules:

- Missing or malformed `prediction` means no special gating.
- Unsupported directions are dropped during normalization.
- Empty `block` means no gating.

### 2. Embedded child capability message

Add a generic postMessage surface from embedded activity iframe to SyncDeck host:

```ts
{
  type: 'activebits-embedded',
  action: 'navigationCapabilities',
  payload: {
    canGoForward?: boolean,
    canGoDown?: boolean
  }
}
```

Direction:

- Child iframe -> SyncDeck host page
- Student path first; manager path only if later needed

Host behavior:

- SyncDeck should treat the message as best-effort, scoped to the active embedded child iframe.
- Missing capability fields should leave existing behavior unchanged.
- Reported capabilities should only apply to the active slide anchor / active embedded instance.

## Resonance Unlock Rule

Initial unlock rule for prediction mode:

- If `prediction.block` includes one or more directions, keep those directions disabled until the
  student has submitted answers for all currently active Resonance questions in that embedded run.

Notes:

- This fits the current Resonance self-paced / multi-question submission model better than
  unlocking on only the current question.
- If future product needs differ, add an explicit `unlockWhen` option instead of overloading
  SyncDeck logic.

## Implementation Checklist

### Phase 1: Contract plumbing

- [ ] Add/normalize Resonance embedded prediction options from `embeddedLaunch.selectedOptions`
- [ ] Add a small shared helper/type for `activebits-embedded` navigation capability messages if
      a shared helper improves consistency
- [ ] Document the new child-to-host message and Resonance selected option shape

### Phase 2: SyncDeck host enforcement

- [ ] Update SyncDeck student embedded iframe message handling to accept navigation capability
      messages from the active embedded child iframe
- [ ] Merge child-reported capability locks into existing overlay navigation decisions for
      `forward` and `down`
- [ ] Ensure capability state resets when the embedded child iframe changes, ends, or the student
      leaves the embedded slide

### Phase 3: Resonance child reporting

- [ ] Detect embedded SyncDeck context in Resonance student view
- [ ] Read and normalize prediction options from embedded launch bootstrap/session state
- [ ] Compute whether prediction gating is still active from current snapshot/submission state
- [ ] Post updated navigation capabilities to the parent host on mount and whenever submission
      completion changes

### Phase 4: Verification

- [ ] Add unit tests for option normalization / malformed payload handling
- [ ] Add SyncDeck tests that verify child-reported capabilities disable the correct overlay
      controls and clear correctly
- [ ] Add Resonance tests that verify prediction gating remains active until all active questions
      are submitted
- [ ] Run `npm test`

## Risks / Watchouts

- SyncDeck currently owns overlay navigation state, so stale child capability state must be cleared
  when the active embedded iframe changes.
- Embedded child messages should be source-checked against the active embedded iframe window so an
  unrelated iframe cannot affect navigation.
- Resonance should not assume all embedded contexts are SyncDeck prediction contexts; missing or
  invalid launch options must degrade cleanly to current behavior.
- If manager overlay controls should also honor prediction locking later, add that deliberately
  after the student path is working rather than coupling both paths up front.

## Validation Target

Because this change crosses activity boundaries:

- Primary gate: `npm test`
- Add `npm run test:e2e` only if the change grows into browser-level routing/iframe interaction
  behavior that unit tests do not cover well in this environment
