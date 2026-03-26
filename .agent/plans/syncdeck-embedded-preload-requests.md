# SyncDeck Embedded Preload Requests Plan

## Status

- [x] Confirm repo state and branch from `main`
- [x] Read the updated reveal iframe sync schema for preload requests
- [x] Align SyncDeck host handling with the split iframe preload request contracts
- [x] Add client-side activity bundle preloading for requested embedded activities
- [x] Add near-term embedded child-session prestart for requested instances
- [x] Ensure preload/prestart behavior is idempotent and does not regress current launch flow
- [x] Add and update tests for request parsing, preload behavior, and start deduplication
- [x] Record durable protocol notes in `.agent/knowledge/data-contracts.md`
- [x] Run required validation for the final implementation

## Goal

Reduce visible flashing when SyncDeck moves onto embedded activity slides by letting the
presentation iframe proactively tell the SyncDeck host which embedded activities are likely to be
needed soon, so the host can:

- preload the relevant activity client bundles in the background
- prestart nearby embedded child sessions before the instructor lands on those slides

## Source Contract

Implementation should follow the updated reveal iframe message schema in
`.agent/knowledge/reveal-iframe-sync-message-schema.md`, especially the new preload request flow
that includes:

- `action: "activityPreloadRequest"` for non-student roles that may prestart sessions
- `action: "activityBundlePreloadRequest"` for any hosted role, including students
- `indices`
- `lookaheadSlides`
- `requests`
- per-request `stackRequests` that mirror the existing `activityRequest` batching pattern

## Responsibility Split

- The presentation iframe remains the source of truth for deck structure and upcoming embedded
  activity anchors.
- SyncDeck host remains the owner of:
  - activity bundle preloading
  - embedded child-session creation
  - deduplication/idempotency
  - deciding when an already-started session should simply be reused
- Child activities remain unaware of preloading beyond benefiting from earlier bundle/session
  availability.

## Proposed Implementation Shape

### 1. Message handling

- Add a host-side handler for `reveal-sync` `activityPreloadRequest` messages alongside existing
  `activityRequest` handling in `SyncDeckManager`.
- Add a host-side handler for `reveal-sync` `activityBundlePreloadRequest` anywhere the host
  receives Reveal iframe messages and can safely warm activity bundles.
- Reuse the same request normalization shape already used for launch requests so `requests` and
  nested `stackRequests` resolve into a deduplicated list of anchored embedded activity start
  inputs.

### 2. Bundle preload

- Extend the activity registry/client loader path with an explicit preload helper so SyncDeck can
  warm the chunk for an activity id without mounting the route.
- Treat bundle preloading as best-effort only:
  - ignore missing activities
  - avoid surfacing preload-only failures to the user
  - dedupe repeated preload attempts per activity id
- Bundle preloading should be allowed from both:
  - instructor/standalone `activityPreloadRequest`
  - student/instructor/standalone `activityBundlePreloadRequest`

### 3. Session prestart

- Prestart child sessions only for the near-term requested embedded instances, using the existing
  SyncDeck embedded start endpoint and idempotent instance-key semantics.
- Reuse the current `embedded-activity/start` flow rather than creating a separate “reserve” API.
- Avoid broad eager startup of whole-deck activities that may never be visited.
- Session prestart must only happen from `activityPreloadRequest`, never from
  `activityBundlePreloadRequest`.

### 4. Interaction with current launch flow

- If a later real `activityRequest` arrives for an already-prestarted instance, SyncDeck should
  reuse the existing child session and continue with current behavior.
- Existing current-slide `activityRequest` behavior must remain authoritative and should still work
  even if no preload request was ever sent.

## Checklist

### Phase 1: Request normalization

- [x] Add parser/normalizer for grouped preload request payloads
- [x] Reuse existing `stackRequests` batching semantics where possible
- [x] Deduplicate requests by `instanceKey`
- [x] Ignore malformed entries without breaking valid siblings
- [x] Distinguish session-capable preload requests from bundle-only preload requests

### Phase 2: Bundle preload plumbing

- [x] Add an activity-loader helper that can preload a client bundle by activity id
- [x] Wire `activityPreloadRequest` handling to call that helper for requested activity ids
- [x] Wire `activityBundlePreloadRequest` handling to call that helper for requested activity ids
- [x] Add memoization/state so repeated preload requests do not hammer the same bundle loads

### Phase 3: Child-session prestart

- [x] Decide and encode the host rule for which preload requests should actually start sessions
      versus bundle-preload only
- [x] Call the existing embedded start flow only for selected `activityPreloadRequest` entries
- [x] Preserve manager bootstrap storage for prestarted child sessions when returned
- [x] Ensure prestart requests do not clobber an existing child session for the same `instanceKey`

### Phase 4: UX stability

- [x] Keep preload work off the critical path for current slide rendering
- [x] Ensure failed preload/prestart work degrades cleanly to the current on-demand launch path
- [x] Review whether the visible overlay should wait for iframe `onLoad` separately from this
      protocol work, and keep that as a distinct follow-up if needed

### Phase 5: Tests and docs

- [x] Add tests for both preload message types, parsing, and deduplication
- [x] Add tests covering bundle-only student preload request parsing
- [ ] Add tests proving repeated preload requests do not create duplicate child sessions
- [ ] Add tests proving a later launch request reuses the prestarted child session
- [x] Update durable knowledge docs for the new host/preload contract

## Open Decisions

- Exact prestart window:
  - initial recommendation: current preload request’s immediate lookahead only, not unbounded deck
    warming
- Session-start threshold:
  - start every request in the incoming preload message
  - or start only the first request per future anchor while bundle-preloading the rest
- Lifecycle cleanup:
  - initially rely on existing child-session lifecycle and parent-session teardown
  - avoid introducing speculative cleanup logic unless stale prestarts become a measurable problem

## Risks / Watchouts

- Preload requests can arrive repeatedly during navigation, so host-side deduplication is
  important for both bundle loads and network/session creation.
- Student-follow views now have a separate bundle-only request path, so the host must not
  accidentally treat every preload hint as permission to create child sessions.
- The request parser should stay resilient to presentation-side schema drift and malformed entries.
- Session prestart can add background store writes and websocket-visible embedded activity records,
  so tests should verify that already-started instances still behave correctly when the instructor
  actually reaches the slide.
- Keep SyncDeck activity-specific logic out of shared layers; the feature belongs in
  `activities/syncdeck/...` and generic loader helpers only.

## Validation Target

Because this affects cross-workspace runtime behavior:

- Primary gate: `npm test`
- Add `npm run test:e2e` only if the implementation grows into browser-level behavior that is not
  adequately covered by the existing unit/integration tests in this environment
