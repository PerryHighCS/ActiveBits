# SyncDeck Presentation–Host Capabilities Plan

## Status

- [x] Discovery: mapped the current presentation iframe boundary, SyncDeck student roster, and aggregate-report system.
- [x] Design the initial capability contract and trust boundary.
- [ ] Confirm the deck-author API with the reveal-iframe-sync maintainer/consumers.
- [ ] Implement the versioned request/response relay and roster capability.
- [ ] Implement validated presentation report contributions and parent-report rendering.
- [ ] Add unit, route, and browser coverage.
- [ ] Update durable protocol and payload documentation.
- [ ] Run required validation.

## Goal

Let a trusted SyncDeck presentation iframe ask its ActiveBits host for narrowly scoped
instructor capabilities, starting with a participant roster for deck-authored random
selection. Let that same presentation submit structured, validated report contributions
which become part of the canonical self-contained SyncDeck session report.

The feature is intentionally a host capability API, not a general bridge to the
ActiveBits session object or server APIs.

## Current State

- The SyncDeck manager already accepts `reveal-sync` messages only when both
  `event.source` is its presentation iframe and `event.origin` equals the configured
  presentation origin. The host sends responses with that specific origin.
- SyncDeck already maintains `session.data.students`, with stable internal student IDs,
  display names, join/last-seen timestamps, and last presentation state. Accepted-entry
  identity is the source for embedded child sessions.
- The current reveal synchronization protocol is `2.1.0`; compatibility is major-version
  based in `activities/syncdeck/shared/revealSyncProtocol.ts`.
- SyncDeck's aggregate report is already the canonical parent export. Its generic
  structured section contract supports summary cards, scope blocks, student scope
  blocks, and JSON-serializable payloads, but currently gets them only from registered
  child activity report builders.

## Scope and Non-Goals

### In scope

- Manager-presentation requests for an instructor-only participant roster.
- Manager-presentation upsert/removal of deck-authored structured report contributions.
- Persistence, report rendering, validation, logging, and documentation for those two
  capabilities.
- Clear deck-author examples for random selection and report checkpoints.

### Out of scope for the first slice

- Student-presentation access to classmates' names or a roster.
- Exposing instructor passcodes, cookies, session records, accepted-entry tokens, child
  manager tokens, or arbitrary ActiveBits API access to a deck.
- Arbitrary HTML, script, URLs, or unbounded blobs in reports.
- Child-activity telemetry, grading, or the proposed SyncDeck gamification ledger; those
  use separate, server-authoritative contracts.
- A request channel from arbitrary nested iframes. The trusted presentation iframe is
  the only requester in this phase.

## Product and Privacy Decisions

1. **Roster requests are instructor-only.** The presentation shown in the manager iframe
   may request current names; student presentation iframes always receive a
   `forbidden` response. This avoids turning SyncDeck into a peer-directory API.
2. **Return display data, not credentials.** The roster reply carries a stable,
   presentation-scoped opaque `participantRef` plus `displayName`. Do not expose the
   internal `studentId`; it is still usable only inside the host/server. The opaque ref
   lets a deck avoid name-collision ambiguity while retaining no authority outside the
   active presentation session.
3. **Presence semantics must be explicit.** The initial roster returns all accepted
   SyncDeck students in join order, with a `connected` boolean derived from current
   parent-session connections. It does not silently treat a stale `lastSeenAt` as
   absence. A future filtered `connectedOnly` option can be added only after its
   classroom semantics are agreed.
4. **Report contribution writes are instructor-only and parent-owned.** A deck may
   contribute sanitized data to the parent SyncDeck report; it may not generate an
   independent report file or write a child activity's data.
5. **Report data is presentation-authored, not an audit record.** The final report must
   label contributed sections with their presentation title/slide location. The server
   records receive/update time and location, but does not represent arbitrary deck
   assertions as verified student work.
6. **No raw HTML.** The deck sends a constrained structured schema. SyncDeck's existing
   report renderer remains responsible for escaping and offline rendering.

## Proposed Protocol

Add a new, separate `reveal-sync` action family rather than overloading synchronization
state or `activebits-embedded` activity messages. It must be documented alongside the
existing reveal iframe schema before changing the protocol version.

### Request envelope (presentation → manager host)

```ts
interface SyncDeckHostCapabilityRequest {
  type: 'reveal-sync'
  version: string
  action: 'hostCapabilityRequest'
  source: 'reveal-iframe-sync'
  requestId: string                 // 1–128 safe characters; unique per deck runtime
  payload: {
    capability: 'participants.list' | 'report.upsert' | 'report.remove'
    input?: unknown
  }
}
```

### Response envelope (manager host → presentation)

```ts
interface SyncDeckHostCapabilityResponse {
  type: 'reveal-sync'
  version: string
  action: 'hostCapabilityResponse'
  source: 'activebits-syncdeck-host'
  requestId: string
  payload:
    | { ok: true; capability: 'participants.list'; result: ParticipantListResult }
    | { ok: true; capability: 'report.upsert' | 'report.remove'; result: ReportMutationResult }
    | { ok: false; capability: string; error: { code: CapabilityErrorCode; message: string } }
}
```

`requestId` is correlation only, never authentication. The host must always respond with
the configured `presentationOrigin`, and only to the current presentation iframe window.
Malformed, unsupported, incompatible-version, and unauthorized requests receive a
bounded error response where it is safe to reply; never echo untrusted input or secrets.

### `participants.list`

```ts
interface ParticipantListResult {
  participants: Array<{
    participantRef: string
    displayName: string
    connected: boolean
  }>
  generatedAt: number
}
```

- No input is needed in v1.
- Results are a snapshot, not a subscription. Decks requesting a refresh should make a
  new request after a deliberate UI action or a bounded timer.
- `participantRef` is derived by the server from the parent session ID and student ID
  using an HMAC or similarly non-reversible keyed mapping; it must be stable for one
  parent session and unusable as an entry/authentication token.
- The deck performs random selection locally from the returned snapshot. Do not pretend
  selection is cryptographically fair or persist a winner in the first slice.

### `report.upsert`

The deck provides one idempotent contribution under a deck-defined `reportKey`.

```ts
interface PresentationReportContributionInput {
  reportKey: string                 // 1–100 safe chars, unique within this parent session
  title: string                     // bounded plain text
  location?: { h: number; v: number; f: number }
  summaryCards?: Array<{ label: string; value: string; detail?: string }>
  scopeBlocks?: GenericReportBlock[]
  studentScopeBlocks?: GenericStudentReportBlock[]
  payload?: JsonValue               // bounded JSON, rendered only by a documented generic view
}
```

`report.upsert` replaces only the matching deck contribution (`reportKey`) rather than
append-on-every-message. This supports an instructor revisiting a slide without report
duplication. `report.remove` removes an identified contribution. The server stamps the
current presentation location when absent, and refuses a supplied location that is not
finite/bounded.

Reuse or extract the generic report-block vocabulary already consumed by
`ActivityStructuredReportSection`; do not invent a parallel free-form report renderer.
The implementation must first define explicit max counts, text lengths, nesting depth,
and serialized-byte limits. Validation failure must leave the previous contribution
unchanged.

## Server and Persistence Design

Add a normalized parent-owned field, for example:

```ts
session.data.presentationReportContributions: Record<string, {
  reportKey: string
  title: string
  location: { h: number; v: number; f: number } | null
  updatedAt: number
  summaryCards: GenericSummaryCard[]
  scopeBlocks: GenericReportBlock[]
  studentScopeBlocks: GenericStudentReportBlock[]
  payload: JsonValue | null
}>
```

- Normalize legacy/malformed values to an empty record and preserve only validated
  contribution entries.
- The authoritative write path is the authenticated SyncDeck instructor WebSocket:
  the manager receives the iframe request, sends a typed host-capability command, and
  the server checks `socket.isInstructor` before reading/writing the parent session.
  This keeps authorization at the existing server boundary and avoids passing an
  instructor credential into the deck.
- The server replies through a typed WebSocket result that the manager maps to the
  original iframe `requestId`. Include a client-side pending-request timeout and cleanup
  on iframe/session replacement. Do not use `postMessage` itself as proof of authority.
- Participant refs should be generated server-side. Keep any per-session derivation key
  server-only; never persist a key or a reversible mapping in report output.
- Add structured log events for accepted/rejected requests with capability, session ID,
  result/error code, request-size metadata, and count only. Never log display names,
  report payloads, passcodes, or tokens.
- Rate-limit requests per authenticated instructor socket (especially roster reads) and
  cap pending request IDs to prevent a deck from growing client/server memory.

## Report Integration

1. Extend the SyncDeck report manifest builder to include a presentation contribution
   section alongside embedded activity sections, ordered by slide location then update
   time.
2. Give each section a stable identity such as `presentation:<reportKey>` and a distinct
   source/status label (for example, `presentation-provided`), so the report can clearly
   distinguish it from activity-generated sections.
3. Reuse the current offline report HTML views:
   - session summary includes contribution counts and summary cards;
   - activity/section drill-down renders generic scope blocks;
   - student drill-down renders only contributions whose student blocks explicitly refer
     to a participant by safe presentation reference/display label.
4. Serialize validated contribution data in the existing inline report JSON. Apply the
   same secret/token exclusion audit as activity report builders.
5. Add clear unavailable/invalid status in the report only for persisted contributions
   that can no longer be rendered; do not silently omit valid data.

## Implementation Checklist

### Phase 1 — Contract and shared types

- [ ] Confirm whether this is a `2.x` additive protocol change or requires the next
  major reveal-sync protocol version; update version compatibility deliberately.
- [ ] Add shared TypeScript types, parsers, validators, safe limits, and error codes in
  `activities/syncdeck/shared/`.
- [ ] Add examples for `participants.list` and `report.upsert` to
  `.agent/knowledge/reveal-iframe-sync-message-schema.md`.
- [ ] Update `skills/syncdeck/references/ACTIVITY_PAYLOADS.md` because this changes the
  SyncDeck presentation/host payload contract.

### Phase 2 — Server-authoritative capability service

- [ ] Add normalized contribution persistence to `SyncDeckSessionData` and the session
  normalizer in `activities/syncdeck/server/routes.ts`.
- [ ] Implement authenticated typed WebSocket commands for roster reads and report
  mutations, including source-session ownership checks and structured logging.
- [ ] Implement opaque per-session participant-reference derivation and roster snapshot
  construction from the parent student roster/connection state.
- [ ] Add bounded deduplication/replay behavior for mutation request IDs; an exact retry
  must return its stored result rather than write twice.

### Phase 3 — Manager iframe bridge

- [ ] Add source/origin/version/schema validation to the manager's existing presentation
  message handler before accepting capability requests.
- [ ] Relay accepted requests to the authenticated WebSocket command and correlate the
  server response to the iframe request ID.
- [ ] Post success/error responses only to the verified presentation window and origin.
- [ ] Add pending-request timeout, socket-disconnect failure, iframe reload cleanup, and
  bounded in-memory request tracking.
- [ ] Ensure request messages never fall through to the generic presentation-state relay.

### Phase 4 — Report aggregation

- [ ] Extend manifest/report types and `reportHtml.ts` for presentation-provided
  sections, summary cards, generic blocks, and per-student blocks.
- [ ] Preserve self-contained offline report behavior and clear provenance labels.
- [ ] Verify that removal/replacement changes the report exactly once and that session
  normalization survives reload/deploy.

### Phase 5 — Tests and browser coverage

- [ ] Unit-test valid/invalid capability envelope parsing, version compatibility,
  request ID limits, participant-reference stability, and report-data limits.
- [ ] Route/WebSocket-test instructor authorization, student denial, source role checks,
  rate/deduplication behavior, persistence, and no-secret responses.
- [ ] Manager-test exact iframe source/origin validation, response target origin,
  request correlation, timeout/disconnect behavior, and prevention of state-relay
  fallthrough.
- [ ] Report-test contribution ordering, rendering, escaping, offline JSON completeness,
  upsert/replacement/removal, and student-block isolation.
- [ ] Add a Playwright spec under `activities/syncdeck/playwright/` using a same-origin
  fixture deck: request roster, select a name, submit a report contribution, download
  the report, and assert the expected section appears. Also assert a student iframe
  cannot obtain names.

### Phase 6 — Documentation, evidence, and validation

- [ ] Update `ARCHITECTURE.md` for the new SyncDeck presentation-host trust boundary and
  `DEPLOYMENT.md` if rate limits or persisted report payload limits have operational
  impact.
- [ ] Record the final REST/WebSocket/iframe contract in
  `.agent/knowledge/data-contracts.md` and security boundary in
  `.agent/knowledge/security-notes.md`.
- [ ] Add a deck-author guide/example to SyncDeck documentation, including response
  errors and the rule that student decks cannot request rosters.
- [ ] Run scoped tests while iterating, then `npm test`; run `npm run test:e2e` for the
  real-browser boundary. If the sandbox cannot bind ports, use `npm run test:codex` and
  record the limitation as required by the repository verification matrix.

## Acceptance Criteria

- An instructor presentation can request a current participant-name snapshot and choose
  randomly without direct ActiveBits API access or exposure of internal student IDs.
- The same request from a student presentation or an untrusted/mismatched iframe is
  denied and does not leak roster data.
- A valid instructor presentation can upsert and remove a bounded structured report
  contribution; retries do not duplicate it.
- The contribution survives session reloads and appears with clear provenance in the
  downloaded, self-contained SyncDeck report.
- Invalid, oversized, or unsafe report data is rejected without corrupting the existing
  contribution or session.
- No capability path exposes passcodes, entry tokens, cookies, raw session data, or
  student names through logs.

## Open Decisions to Resolve Before Phase 1

1. Should a roster include all accepted students, only currently connected students, or
   expose both as proposed? The recommended v1 result includes all plus `connected`.
2. Does the reveal-iframe-sync producer own the protocol version bump and deck helper,
   or should ActiveBits publish a standalone deck-side helper package/snippet?
3. What generic report-block vocabulary is sufficient for v1? Prefer the existing report
   section shapes; introduce a new block type only if a real deck fixture needs it.
4. Should presentation-supplied per-student report blocks be allowed in v1, or should
   v1 accept class-level blocks only until we have a concrete privacy-reviewed use case?
   The recommended default is class-level plus optional safe refs only, never raw IDs.
5. What report payload byte/count ceilings work for the expected class/deck size? Set
   explicit conservative defaults and measure before widening them.

