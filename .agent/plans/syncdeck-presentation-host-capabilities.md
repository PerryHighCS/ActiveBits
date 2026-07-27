# SyncDeck Presentation–Host Capabilities Plan

## Status

- [x] Discovery: mapped the current presentation iframe boundary, SyncDeck student roster, and aggregate-report system.
- [x] Design the initial capability contract and trust boundary.
- [ ] Confirm the deck-author API with the reveal-iframe-sync maintainer/consumers.
- [ ] Implement the versioned request/response relay and roster capability.
- [ ] Implement validated presentation report contributions and parent-report rendering.
- [ ] Add unit, route, and browser coverage.
- [ ] Update the SyncDeck skill, durable protocol/payload documentation, and shared skill subtree.
- [ ] Run required validation.

## Goal

Let a trusted SyncDeck presentation iframe ask its ActiveBits host for narrowly scoped
instructor capabilities, starting with a participant roster for deck-authored random
selection. Let SyncDeck own a generic, validated session-event channel for announcements
and student-view emotes, with the presentation as one producer, and submit structured
report contributions which become part of the canonical self-contained SyncDeck session
report.

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
- A parent-owned SyncDeck session-event service for targeted/all-audience announcements
  and emotes, with trusted producer adapters for SyncDeck UI, the presentation, and
  embedded activities.
- Manager-presentation upsert/removal of deck-authored structured report contributions.
- Persistence, report rendering, validation, logging, and documentation for those two
  capabilities.
- Clear deck-author examples for random selection and report checkpoints.

### Out of scope for the first slice

- Student-presentation access to classmates' names or a roster.
- Exposing instructor passcodes, cookies, session records, accepted-entry tokens, child
  manager tokens, or arbitrary ActiveBits API access to a deck.
- An arbitrary browser message bus or arbitrary JSON broadcast. Every producer adapter,
  command, and event kind is versioned, allowlisted, and schema-validated by the host.
- Arbitrary HTML, script, URLs, or unbounded blobs in reports.
- Child-activity telemetry, grading, or the proposed SyncDeck gamification ledger; those
  use separate, server-authoritative contracts.
- A request channel from arbitrary nested iframes. The trusted presentation iframe is
  the only requester in this phase.
- Replacing embedded activities' existing WebSocket/runtime channels with SyncDeck
  session events.

## Realtime Channel Ownership

Embedded activities retain ownership of their own WebSocket channels and server state.
Those channels remain authoritative for activity-specific, frequent, or interactive
runtime updates: live responses, collaborative work, timers, moderation, code edits,
activity-local reconnect behavior, and any activity state needed to render correctly.

The parent SyncDeck session-event service is deliberately a low-volume cross-cutting
channel. It is appropriate for effects that belong to the shared presentation experience,
such as a completion announcement, a correct-answer celebration, a checkpoint reached,
or an emote. It must not become a proxy for activity state synchronization or telemetry.

| Need | Authoritative channel |
| --- | --- |
| Live quiz response, shared code, timer, or activity-local state | The embedded activity's own WebSocket/server runtime |
| Completion/checkpoint notification or celebration effect | One server-authorized SyncDeck session event |
| Student/instructor reaction originating in the SyncDeck UI | SyncDeck session-event service directly |
| High-frequency telemetry or progress stream | Activity runtime; aggregate into a report or parent event only when a durable low-volume summary is needed |

An embedded activity's server decides when a parent event is warranted, then calls the
server-authorized SyncDeck parent-event adapter using the child session's persisted
parent linkage. Do not treat a raw child-iframe `postMessage` or a browser-claimed
activity identity as authorization to publish into the parent session.

## Delivery Phases

Each phase is independently deployable and preserves the existing presentation,
SyncDeck, and embedded-activity behavior when its new capability is unused. Later phases
must build on the same server-authoritative session-event service rather than introduce
parallel message paths.

### Phase 0 — Contract foundation

**Purpose:** Establish the shared types, validation limits, and versioned protocol before
any new behavior is available to decks.

- [ ] Decide and document the reveal-sync protocol compatibility/version strategy.
- [ ] Define the host-capability request/response, participant-reference, session-event,
  error, and bounded JSON/report schemas.
- [ ] Add parsing/validation unit tests and source/origin/schema reject-path tests.
- [ ] Update `skills/syncdeck/references/IFRAME_SYNC_PROTOCOL.md` and
  `skills/syncdeck/SKILL.md` with draft deck-side request, response, and event-listener
  examples that a presentation author can use without direct ActiveBits API access.
- [ ] Update `skills/syncdeck/references/ACTIVITY_PAYLOADS.md` with explicit role,
  privacy, compatibility, and capability-limit rules; link it to the protocol reference
  instead of duplicating the canonical envelope schema.

**Exit criteria:** No runtime capability is enabled, but all new messages have a single
documented TypeScript contract with explicit limits and errors, and the SyncDeck skill
can guide a presentation author through the planned contract.

### Phase 1 — Instructor roster and host selection

**Purpose:** Deliver a useful deck-author feature with the smallest new runtime surface:
an instructor presentation can request a roster and have the server choose a student.

- [ ] Implement `participants.list` and `participants.pickRandom` over the authenticated
  manager WebSocket bridge.
- [ ] Generate server-only, parent-session-scoped participant refs; return names, refs,
  and documented presence state without internal student IDs.
- [ ] Add idempotent selection results, empty-roster handling, bounded pending requests,
  logging, and manager iframe source/origin checks.
- [ ] Add a same-origin fixture deck and browser coverage for roster retrieval/random
  selection, plus student/untrusted-iframe denial.

**Exit criteria:** An instructor deck can run a reliable random chooser. It does not yet
broadcast the selection, publish events, or write report data.

### Phase 2 — Shared all-audience session events

**Purpose:** Establish the parent-owned event service and make visible shared effects
available without the extra complexity of private delivery or child producers.

- [ ] Implement normalized bounded session-event persistence, idempotency, expiry, and
  all-audience websocket delivery.
- [ ] Add `announcement` and a small allowlisted `emote` vocabulary.
- [ ] Allow bounded Markdown in announcement/prompt message fields through the same
  report/session-event-safe renderer; keep emotes as structured allowlisted tokens.
- [ ] Add the instructor-presentation `sessionEvents.publish` adapter.
- [ ] Add the SyncDeck UI adapter for instructor/enrolled-student emotes, with rate
  limits, accessibility text equivalents, reduced-motion support, and instructor
  disable/moderation controls.
- [ ] Deliver `sessionEvent` envelopes to ready student presentation iframes and the
  manager; test reconnect replay for stateful events and non-replay for ephemeral emotes.

**Exit criteria:** SyncDeck UI and instructor decks can publish safe all-class
announcements/emotes through one service. Targeted events and activity producers are not
yet enabled.

### Phase 3 — Private delivery and embedded-activity producers

**Purpose:** Add participant-targeted effects and safely let activities contribute
low-volume shared-presentation events without displacing their own runtime sockets.

- [ ] Add server-side private audience resolution from opaque participant refs and ensure
  non-target browsers receive neither target metadata nor event payload.
- [ ] Add bounded stateful-event replay only for eligible reconnecting recipients.
- [ ] Add a server-authorized child-to-parent adapter based on persisted child-parent
  linkage; reject raw child-browser/iframe event publication.
- [ ] Add activity/server, websocket, and multi-student browser tests for targeting,
  expiry, provenance, rate limits, and reconnect behavior.

**Exit criteria:** A selected student can receive a private prompt/emote, and an embedded
activity can emit an authorized completion/celebration event. Activity WebSockets remain
authoritative for activity state and high-frequency traffic.

### Phase 4 — Presentation report contributions

**Purpose:** Let instructor decks provide validated class-level report sections using the
existing self-contained SyncDeck report shell.

- [ ] Add normalized `report.upsert`/`report.remove` persistence and byte/count limits.
- [ ] Render presentation-provided summary cards and generic blocks in the report
  manifest and offline HTML with clear provenance, including bounded deck-authored
  Markdown blocks.
- [ ] Reuse or extract `activities/resonance/client/components/FormattedMarkdown.tsx`
  with a SyncDeck report-safe configuration: GFM and raw-HTML escaping retained; remote
  images blocked; embedded data images allowed only if bounded and explicitly approved.
- [ ] Test replacement/removal, Markdown rendering, raw-HTML escaping, safe-link
  filtering, report-safe image policy, self-contained export, and reload/deploy
  normalization.
- [ ] Defer presentation-provided per-student report blocks unless a concrete,
  privacy-reviewed use case is approved.

**Exit criteria:** Deck-authored, bounded class-level report data survives session reloads
and appears in the downloaded report. It is clearly distinct from activity-generated
student work.

### Phase 5 — Hardening, documentation, and expansion decisions

**Purpose:** Complete cross-boundary documentation, operational validation, and decide
which optional capabilities should expand next.

- [ ] Update `ARCHITECTURE.md`, `DEPLOYMENT.md` as warranted, the SyncDeck payload
  reference, deck/activity author guidance, and durable data/security contract notes.
- [ ] Run the full unit/typecheck/lint gate and browser suite; record sandbox port-binding
  limitations if applicable.
- [ ] Review event rates, stored payload size, classroom UX, and accessibility feedback
  before adding more emotes, event kinds, selection policies, or per-student reporting.

**Exit criteria:** The deployed behavior, trust boundaries, operational limits, and
authoring API are documented and tested. Any expanded event type begins as a new planned
increment rather than bypassing validation.

## SyncDeck Skill Maintenance

The checked-in `skills/syncdeck/` subtree is the deck-authoring product surface for this
protocol. It must be updated in the same implementation phase as any deck-facing
capability change, not retroactively after code ships.

For each implemented capability, update:

- `skills/syncdeck/SKILL.md` with when to use the capability, role restrictions, and a
  link to the canonical reference;
- `skills/syncdeck/references/IFRAME_SYNC_PROTOCOL.md` with the exact versioned request,
  response, and host-delivered event envelopes; correlation, timeout, and error handling;
- `skills/syncdeck/references/ACTIVITY_PAYLOADS.md` with the interaction between deck
  capabilities and embedded activity payloads/channel ownership;
- a minimal copyable deck-side helper/example that sends requests to the parent, verifies
  `event.origin`/message shape on responses, handles `sessionEvent`, and never calls an
  ActiveBits API or treats browser data as authority.

Documentation must state the compatibility story for decks that do not implement the
new capability, the instructor-only roster restriction, opaque participant-reference
handling, session-event privacy/expiry behavior, and the rule that embedded activities'
own WebSockets remain authoritative for their runtime state.

Because `skills/syncdeck` is intended for sharing across repositories, push the updated
subtree back to `syncdeck-agent-skills` as part of the completion flow, following the
repository rule to perform subtree synchronization only from a non-`main` branch.

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
6. **No raw HTML; constrained Markdown is allowed for presentation-authored reports.**
   The deck sends a constrained structured schema. A generic report block may carry
   bounded Markdown for deck-authored explanations, outcomes, links, and formatted
   summaries, but it never carries HTML. The offline SyncDeck report renderer owns
   Markdown parsing, escapes raw HTML, restricts links to an explicit safe protocol
   allowlist, and does not load remote images/assets. Student-entered text remains
   escaped plain text unless a later activity-owned contract explicitly permits Markdown.
   Reuse or extract Resonance's existing `FormattedMarkdown` renderer and its tested GFM,
   raw-HTML, and URL-filtering behavior; add a SyncDeck report-safe policy rather than
   creating a second Markdown implementation. The report profile must reject remote
   image URLs and may allow only bounded, non-SVG `data:image/...;base64` assets if a
   self-contained report use case requires them.
   The same renderer profile applies to human-readable `announcement`/prompt messages
   delivered to SyncDeck and presentation views. Emotes remain structured allowlisted
   tokens, not Markdown or arbitrary emoji/animation payloads.
7. **Selection and delivery are host-authoritative.** Deck-local `Math.random()` is not
   adequate when a selection needs to be visible to every student, survive a reconnect,
   or appear in a report. The host selects from the server roster and assigns the event
   identity, timestamp, delivery audience, and expiry.
8. **Use typed SyncDeck session events for future messages.** Announcements, emotes, and
   later presentation effects share one parent-owned event service. SyncDeck UI should
   use it directly and is expected to be the primary emote producer; the presentation
   and embedded activities use tightly scoped adapters. Adding a new kind requires a
   shared schema, validation, rendering decision, and tests; it is not an invitation to
   relay arbitrary payloads.

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
    capability:
      | 'participants.list'
      | 'participants.pickRandom'
      | 'sessionEvents.publish'
      | 'report.upsert'
      | 'report.remove'
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
    | { ok: true; capability: 'participants.pickRandom'; result: ParticipantPickResult }
    | { ok: true; capability: 'sessionEvents.publish'; result: SessionEventPublishResult }
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

### `participants.pickRandom`

`participants.pickRandom` is the preferred path whenever a selected participant will be
announced, targeted, reported, or otherwise become shared session state.

```ts
interface ParticipantPickResult {
  selectionId: string
  participant: {
    participantRef: string
    displayName: string
    connected: boolean
  }
  selectedAt: number
}
```

- In v1 it selects uniformly from the current accepted participant roster; if the roster
  is empty it returns `no-participants`.
- The request includes an idempotency key so a transport retry returns the same result
  rather than selecting a second student.
- Exclusion, weighted selection, history avoidance, and audit/fairness rules are later
  capabilities, not implicit behavior in v1.
- The deck may then publish an announcement/emote using the returned opaque
  `participantRef`; it cannot name an arbitrary internal student ID.

### Parent-owned session events

`sessionEvents.publish` is the presentation adapter to the parent-owned SyncDeck session
event service. The service validates an allowlisted event, assigns trusted provenance,
resolves the audience, persists it when needed, and delivers it to SyncDeck UI and the
appropriate student presentation iframe(s).

Producer paths:

| Producer | Entry path | Authorization and provenance |
| --- | --- | --- |
| SyncDeck UI | Typed SyncDeck client/WebSocket command | Server authenticates instructor or enrolled student and assigns `source: 'syncdeck-ui'`. This is the expected primary emote path. |
| Presentation iframe | `reveal-sync` `hostCapabilityRequest` with `sessionEvents.publish` | Manager bridge verifies iframe source/origin, then the authenticated instructor websocket assigns `source: 'presentation'`. |
| Embedded activity | Child activity server → parent SyncDeck server contract | Parent verifies stored child-parent linkage and assigns `source: 'embedded-activity'`; a child browser must not claim this source directly. |

All three paths call the same server-side service. SyncDeck UI and presentation code must
not each invent audience, expiry, persistence, or broadcast logic.

```ts
type PresentationEventInput =
  | {
      kind: 'announcement'
      eventKey: string
      audience: { type: 'all' } | { type: 'participant'; participantRef: string }
      title?: string
      messageMarkdown: string
      expiresAt?: number
    }
  | {
      kind: 'emote'
      eventKey: string
      audience: { type: 'all' } | { type: 'participant'; participantRef: string }
      emote: 'celebrate' | 'confetti' | 'thumbs-up' | 'drumroll'
      expiresAt?: number
    }

interface SyncDeckSessionEvent {
  eventId: string
  kind: 'announcement' | 'emote'
  source: 'syncdeck-ui' | 'presentation' | 'embedded-activity'
  audience: { type: 'all' } | { type: 'participant' }
  // Contains no participantRef in a recipient's browser event.
  payload: { title?: string; messageMarkdown?: string; emote?: string }
  createdAt: number
  expiresAt: number | null
}
```

The host sends a delivery envelope to presentation iframes after websocket filtering.
SyncDeck UI consumes the same server event directly, without a browser `postMessage`
round-trip:

```ts
{
  type: 'reveal-sync',
  version: '…',
  action: 'sessionEvent',
  source: 'activebits-syncdeck-host',
  payload: SyncDeckSessionEvent
}
```

Audience filtering is server-side. A private event reaches only the selected student's
SyncDeck UI/presentation (plus the instructor manager view when appropriate for control
feedback); other student browsers do not receive the event or its target reference.
Event keys are idempotent per parent session and producer scope, while server-generated
event IDs identify individual deliveries.

Delivery lifecycle:

- **Ephemeral events** (for example, a two-second emote) are broadcast once and are not
  replayed after reconnect.
- **Stateful events** (for example, an active announcement or selected-student prompt)
  have a bounded `expiresAt`, are stored on the parent session, and are replayed only to
  eligible recipients on websocket/iframe readiness until they expire.
- The server prunes expired events during normal session updates/normalization and caps
  the stored active-event count and total bytes.

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

session.data.sessionEvents: Record<string, {
  eventId: string
  eventKey: string
  kind: 'announcement' | 'emote'
  source: 'syncdeck-ui' | 'presentation' | 'embedded-activity'
  audience: { type: 'all' } | { type: 'participant'; studentId: string }
  payload: { title?: string; messageMarkdown?: string; emote?: string }
  createdAt: number
  expiresAt: number | null
  replayOnReconnect: boolean
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
- Persist private-event targets as internal student IDs only on the server. The event
  sent to any browser must omit both the student ID and opaque participant ref.
- The server chooses random participants and owns event idempotency. It must not accept
  a deck-provided winner, delivery audience resolution, or a fake event timestamp as
  authoritative.
- Keep the session-event service in `activities/syncdeck/server/` and expose generic
  adapters rather than putting SyncDeck-specific event conditionals in shared modules.
  Embedded activity use must authenticate through a parent-child server linkage, not a
  raw cross-origin `postMessage` from a child iframe.
- Preserve each embedded activity's own WebSocket/runtime as authoritative for activity
  state and high-frequency updates; use the parent adapter only for explicit,
  low-volume cross-cutting session events.
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

## Cross-Phase Implementation Workstreams

The delivery phases above determine release order. These workstreams track the technical
tasks that support one or more phases and should be completed only when their associated
delivery phase is active.

### Contract and shared types

- [ ] Confirm whether this is a `2.x` additive protocol change or requires the next
  major reveal-sync protocol version; update version compatibility deliberately.
- [ ] Add shared TypeScript types, parsers, validators, safe limits, and error codes in
  `activities/syncdeck/shared/`.
- [ ] Add examples for `participants.list` and `report.upsert` to
  `.agent/knowledge/reveal-iframe-sync-message-schema.md`.
- [ ] Update the SyncDeck skill (`SKILL.md`, `IFRAME_SYNC_PROTOCOL.md`, and
  `ACTIVITY_PAYLOADS.md`) with copyable deck-author examples and compatibility/security
  guidance as each protocol capability is implemented.

### Server-authoritative capability service

- [ ] Add normalized contribution persistence to `SyncDeckSessionData` and the session
  normalizer in `activities/syncdeck/server/routes.ts`.
- [ ] Implement authenticated typed WebSocket commands for roster reads and report
  mutations, including source-session ownership checks and structured logging.
- [ ] Implement opaque per-session participant-reference derivation and roster snapshot
  construction from the parent student roster/connection state.
- [ ] Implement server-side `participants.pickRandom` with empty-roster handling and
  idempotent selection results.
- [ ] Implement a normalized, bounded parent-session session-event service with
  server-side audience resolution, expiration pruning, and recipient-filtered websocket
  delivery/replay.
- [ ] Add a SyncDeck UI adapter for instructor/enrolled-student emotes, including
  participant-scoped rate limits and accessible/reduced-motion rendering behavior.
- [ ] Keep the presentation `sessionEvents.publish` adapter instructor-only and add a
  server-authorized embedded-activity adapter based on stored parent-child linkage.
- [ ] Preserve each embedded activity's own WebSocket/runtime as authoritative for
  activity state and high-frequency updates; use the parent adapter only for explicit,
  low-volume cross-cutting session events.
- [ ] Start with `announcement` and allowlisted `emote` event kinds; require an explicit
  schema/renderer/test change to add any future kind.
- [ ] Add bounded deduplication/replay behavior for mutation request IDs; an exact retry
  must return its stored result rather than write twice.

### Manager iframe bridge

- [ ] Add source/origin/version/schema validation to the manager's existing presentation
  message handler before accepting capability requests.
- [ ] Relay accepted requests to the authenticated WebSocket command and correlate the
  server response to the iframe request ID.
- [ ] Post success/error responses only to the verified presentation window and origin.
- [ ] Deliver server-authoritative `sessionEvent` envelopes to each eligible student
  presentation iframe after iframe-ready handling, without exposing private target
  references to other students; let SyncDeck UI consume the same session event directly.
- [ ] Add pending-request timeout, socket-disconnect failure, iframe reload cleanup, and
  bounded in-memory request tracking.
- [ ] Ensure request messages never fall through to the generic presentation-state relay.

### Report aggregation

- [ ] Extend manifest/report types and `reportHtml.ts` for presentation-provided
  sections, summary cards, generic blocks, and per-student blocks.
- [ ] Preserve self-contained offline report behavior and clear provenance labels.
- [ ] Verify that removal/replacement changes the report exactly once and that session
  normalization survives reload/deploy.

### Tests and browser coverage

- [ ] Unit-test valid/invalid capability envelope parsing, version compatibility,
  request ID limits, participant-reference stability, and report-data limits.
- [ ] Route/WebSocket-test instructor authorization, student denial, source role checks,
  rate/deduplication behavior, persistence, and no-secret responses.
- [ ] Test random-selection retries, empty rosters, UI/presentation/activity provenance,
  private versus all-audience delivery, expiry/pruning, reconnect replay for stateful
  events, Markdown announcement rendering/safety, and no replay for ephemeral emotes.
- [ ] Manager-test exact iframe source/origin validation, response target origin,
  request correlation, timeout/disconnect behavior, and prevention of state-relay
  fallthrough.
- [ ] Report-test contribution ordering, rendering, escaping, offline JSON completeness,
  upsert/replacement/removal, and student-block isolation.
- [ ] Add a Playwright spec under `activities/syncdeck/playwright/` using a same-origin
  fixture deck: request roster, select a name, publish an all-student announcement and
  a private emote, submit a report contribution, download the report, and assert the
  expected section appears. Add SyncDeck-UI emote coverage. Assert that a student iframe
  cannot obtain names and a non-target student does not receive the private event.

### Documentation, evidence, and validation

- [ ] Update `ARCHITECTURE.md` for the new SyncDeck presentation-host trust boundary and
  realtime channel-ownership boundary; update `DEPLOYMENT.md` if rate limits or
  persisted report payload limits have operational impact.
- [ ] Record the final REST/WebSocket/iframe contract in
  `.agent/knowledge/data-contracts.md` and security boundary in
  `.agent/knowledge/security-notes.md`.
- [ ] Add a deck-author guide/example to SyncDeck documentation, including response
  errors and the rule that student decks cannot request rosters.
- [ ] Document the embedded-activity channel split in
  `skills/syncdeck/references/ACTIVITY_PAYLOADS.md` and deck/activity author guidance:
  activity WebSockets own activity runtime; SyncDeck session events are only for
  server-authorized, low-volume cross-cutting effects.
- [ ] Push the changed `skills/syncdeck` subtree to `syncdeck-agent-skills` from this
  non-`main` implementation branch after the skill documentation is verified.
- [ ] Run scoped tests while iterating, then `npm test`; run `npm run test:e2e` for the
  real-browser boundary. If the sandbox cannot bind ports, use `npm run test:codex` and
  record the limitation as required by the repository verification matrix.

## Acceptance Criteria

- An instructor presentation can request a current participant-name snapshot and choose
  randomly without direct ActiveBits API access or exposure of internal student IDs.
- Host-selected participants and parent-owned session events remain consistent across
  manager reloads/retries; targeted events are delivered only to their eligible student
  view.
- An allowlisted emote can be broadcast to all students or targeted to one student;
  expired/ephemeral events do not incorrectly reappear after reconnect.
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
6. Which initial emotes are useful and accessible? The recommendation is a short
   allowlist plus text-equivalent rendering/announcement behavior, with a reduced-motion
   presentation option; arbitrary emoji strings and animation payloads should wait.
7. Should a selection automatically publish an announcement, or should the deck make the
   explicit follow-up `sessionEvents.publish` call? The recommendation is explicit
   publishing so a deck can reveal the chosen student privately, publicly, or not at all.
8. Which student-originated emotes should SyncDeck permit, and what classroom rate limit
   is appropriate? The initial recommendation is a small allowlist, a short per-student
   cooldown, and instructor-visible moderation/disable controls before expanding it.
