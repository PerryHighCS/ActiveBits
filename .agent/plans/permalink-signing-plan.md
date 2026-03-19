# Permalink Signing Refactor Plan

Purpose: plan the move from the current split/overloaded permalink hashing model toward a single canonical signed permalink state shared across create, edit, and launch.

## Goals

- Preserve activity-owned permalink generation where activities need custom validation or URL derivation.
- Replace ambiguous query-signing behavior with one canonical signed permalink state.
- Keep unsigned params like `utm_source` harmless by ensuring they never influence runtime behavior.
- Make create and edit produce equivalent permalink semantics.

## Proposed Direction

1. Define one canonical `permalinkState` object for all signed permalink meaning.
2. Have the shared permalink layer sign exactly that canonical state.
3. Let each activity provide a deterministic canonicalizer for its permalink-relevant state.
4. Treat any query params not represented in canonical state as unsigned and non-authoritative.

## Canonical State Shape

```ts
interface CanonicalPermalinkState {
  entryPolicy: PersistentSessionEntryPolicy
  selectedOptions: Record<string, string>
}
```

Notes:
- The signed hash should be derived from the canonical state, not from arbitrary raw query params.
- Canonicalizers must be pure and deterministic.
- Launch-time verification should rebuild canonical state from the URL using the same rules used at create/edit time.

## Shared Work Checklist

- [x] Add a shared activity contract for canonical permalink state normalization/serialization.
- [x] Update shared create flow to sign the final canonical permalink state instead of ad hoc query params.
- [x] Update shared edit flow to regenerate the same canonical signed state for an existing permalink hash.
- [x] Update waiting-room/auth verification to trust only canonical signed state.
- [x] Make unknown query params explicitly ignored for behavior unless copied into canonical state.
- [x] Add regression tests for extra unsigned params like `utm_source`.
- [x] Update docs for the new permalink contract after implementation lands.

## Activity Follow-up

### SyncDeck

- [x] Move SyncDeck permalink generation to return canonical state instead of relying on a second activity-specific signer.
- [x] Decide whether `presentationUrl` is fully represented inside canonical signed state or still needs activity-owned derivation before signing.
- [x] Keep SyncDeck preflight/verification UX in the activity-owned builder.
- [x] Ensure manager launch/recovery trusts canonical permalink state consistently for both create and edit.

### Video Sync

- [x] Define canonical permalink-selected options for standalone/video launch behavior.
- [x] Verify persistent solo and embedded launch paths rebuild the same canonical state on reload.
- [x] Confirm manager/student bootstrap does not depend on unsigned query params.

### Algorithm Demo

- [x] Define canonical permalink-selected options for algorithm choice and any manager bootstrap options.
- [x] Verify create/edit/launch all normalize the same selected options before signing.

## Likely Additional Audit Targets

These do not currently advertise activity-owned URL generation, but they use deep-link options and should be checked during the refactor:

- [ ] `java-string-practice`
- [ ] `video-sync`
- [ ] `algorithm-demo`
- [ ] `syncdeck`

Question to answer during implementation:
- Do any other activities consume permalink query params directly outside shared selected-option parsing?

## Validation Checklist

- [x] Shared permalink route tests cover create, edit, authenticate, and entry verification with canonical state.
- [x] SyncDeck tests cover create/edit parity and first-launch manager bootstrap.
- [x] Video Sync tests cover standalone permalink launch after edit.
- [x] Algorithm Demo tests cover signed option preservation across edit.
- [x] `npm test` or `npm run test:codex` passes in this environment.
