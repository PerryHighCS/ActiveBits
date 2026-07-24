# Learn–SyncDeck Session Integration Plan

## Status: Proposed

## Purpose

Let Learn launch SyncDeck presentations and control instructor-led ad-hoc sessions
without Learn storing or exposing ActiveBits instructor credentials. Learn owns the
course/resource identity and instructor controls; ActiveBits owns session creation,
live runtime state, and websocket delivery.

This document is the shared implementation reference for both systems.

---

## Goals

- Use a Learn-owned opaque resource identifier (for example, an LTI
  `resource_link_id`) as a short-lived index to a SyncDeck instructor-led entry flow:
  waiting before Start and active after Start.
- Let Learn servers query whether that resource currently has a live instructor-led
  session, start or reuse one, and stop it.
- Let Learn open an instructor manager in a new browser window without putting an
  ActiveBits instructor passcode in Learn, URLs, or browser storage.
- Let Learn choose whether each launch is solo or instructor-led. Solo launches use
  the existing per-student SyncDeck session flow; instructor-led launches use the
  shared temporary entry mapping.
- Reuse ActiveBits' session lifecycle where practical: the temporary resource entry
  state starts with the waiting room and points to one SyncDeck session once active.

## Non-Goals

- Do not accept an arbitrary client-supplied opaque ID as authority to start or stop
  a class.
- Do not expose instructor passcodes, recovery cookies, or raw ActiveBits session
  records to Learn.
- Do not require LTI 1.3. A signed, authenticated server-to-server contract is sufficient.
- Do not replace existing standalone SyncDeck launch or permanent-link flows.

## Confirmed Product Decisions

- Learn is the source of truth for whether a launch is solo or instructor-led. ActiveBits
  must not infer or override that policy from an inactive resource state.
- A solo launch creates an independent SyncDeck session for that student through the
  existing solo launch flow. Solo sessions are not participants in the instructor-led
  resource's `activeSessionId` lifecycle.
- Learn requests instructor session creation, reuse, and stop as necessary through the
  server-to-server integration.
- A resource's presentation URL is immutable while its instructor-led session is
  active. The instructor must stop that session before changing the presentation.
  Learn enforces this in its UI and ActiveBits enforces it in the API.
- Once Learn receives ActiveBits' successful Stop confirmation, Learn returns the
  resource to its ready-to-start state. It may then let the instructor start a new
  session, including with an updated presentation URL.
- Ending a session only removes it from the Learn resource's active lifecycle.
  ActiveBits retains and cleans up the old session using its normal session TTL;
  Learn must not attempt separate session deletion or cleanup.
- Learn may poll ActiveBits for resource state. ActiveBits status responses include
  live participant counts for active instructor-led sessions.
- The server-to-server integration uses a dedicated request-HMAC scheme. Its shared
  secret is configured independently in Learn and ActiveBits and is not an LTI 1.1
  consumer secret.
- Learn persists deck URL edits separately from Start/Stop. ActiveBits receives the
  selected URL when a new instructor session is requested and keeps that session's
  configured deck unchanged until Stop succeeds.
- ActiveBits reports current connections only; Learn owns attendance/history and sends
  any LMS grade or attendance notification when its student-connect workflow requires
  it. ActiveBits does not send LMS grade notifications.
- Learn selects student entry mode. For `solo`, it redirects immediately to the
  existing per-student solo flow. For `wait-for-instructor`, it redirects students to
  an ActiveBits waiting-room entry; ActiveBits transitions those waiters into the live
  session after Learn's server-to-server Start call.

---

## Existing Capabilities

- Student/solo launch already exists at
  `/util/syncdeck/launch-presentation?presentationUrl=<encoded URL>`.
- Adding `mode=instructor` creates a temporary hosted SyncDeck session and opens its
  manager flow.
- SyncDeck persistent-session metadata already tracks the relationship between a
  durable link and its currently active temporary session.
- ActiveBits already has short-lived, server-issued instructor recovery mechanisms.
  The Learn integration must use a dedicated one-time browser handoff based on that
  pattern rather than transport an instructor passcode.

The existing utility flow remains appropriate for a simple browser redirect. The API
below is needed when Learn needs reliable, server-owned start/stop/status controls.

---

## Ownership and Trust Boundary

| Concern | Owner |
| --- | --- |
| Course/resource identity, Learn user role, start/stop buttons | Learn |
| Validating Learn's request signature or launch assertion | ActiveBits |
| Temporary resource entry mapping, waiting room, and live-session state | ActiveBits |
| Presentation validation, live session creation, websocket state, session end | ActiveBits |
| Instructor browser handoff token issuance and consumption | ActiveBits |
| Instructor passcode and recovery cookie | ActiveBits only |

`resourceLinkId` is an identifier, not a credential. Every control request must be
authenticated as coming from Learn and authorized for the requested role/context.

---

## Proposed Temporary Resource Entry Mapping

Each entry mapping is namespaced by the integration provider so opaque IDs from two
Learn installations cannot collide. It is not a durable resource record: ActiveBits
does not retain Learn's deck configuration after the entry flow ends.

```ts
interface LearnSyncDeckEntryState {
  activityId: string               // currently "syncdeck"
  provider: string                 // e.g. "learn-production"
  resourceLinkId: string           // opaque Learn/LTI identifier
  state: 'waiting' | 'active'
  activeSessionId: string | null
  createdAt: number
  expiresAt: number
}
```

The mapping is created when the first authorized student enters the ActiveBits waiting
room, or when Learn starts an instructor-led session before any students arrive. While
waiting, it has a bounded inactivity TTL; while active, it has a TTL no longer than the
referenced temporary session. On Stop, expiry, or an ended session, ActiveBits deletes
the mapping. The old session record and any remaining cleanup are ActiveBits concerns
under the normal session TTL.

Suggested constraints:

- Treat `(activityId, provider, resourceLinkId)` as unique.
- Validate and bound all strings before storage; do not log raw signed assertions.
- Receive and validate `presentationUrl` only with a Start request. Learn is the
  durable owner of the URL, and ActiveBits applies it to the newly created session.
- While an active mapping exists, reject a Start request whose URL differs from that
  session's configured URL with `409 Conflict`; Learn must first stop the session.
- Transition a waiting mapping atomically to active when Learn starts the session, then
  notify its connected waiters with the new student session URL.
- Clear the mapping when an instructor stops or ActiveBits ends/expires the session.
- Use the production shared store (Valkey) for temporary mappings and idempotency state;
  an in-memory implementation is acceptable only for development/tests.

---

## Server-to-Server API Contract

All endpoints use a versioned namespace such as `/api/integrations/learn/v1`, require
TLS, and use a dedicated request-HMAC authentication scheme. Learn and ActiveBits each
hold the same per-environment integration secret. This secret is separate from any LTI
1.1 consumer secret and must not be exposed to browsers.

Learn signs this canonical request value with HMAC-SHA-256:

```text
HTTP_METHOD
REQUEST_PATH
TIMESTAMP
NONCE
PROVIDER
SHA256(request_body)
```

Headers carry a key ID, timestamp, nonce, and signature. ActiveBits verifies the
signature in constant time, enforces a short clock-skew window, and stores nonces for
the full acceptance window to reject replayed requests. The initial implementation
accepts one configured key ID/secret pair; rotate it through a coordinated Learn and
ActiveBits deployment. Add dual-key verification before requiring no-downtime rotation.

### Common Request Fields

```ts
interface LearnResourceRequest {
  activityId: string               // path segment; currently "syncdeck"
  provider: string
  resourceLinkId: string
  presentationUrl?: string          // required when registering/starting initially
  requestId: string                 // idempotency key, unique per logical action
}
```

The authenticated assertion/request metadata must also establish whether the caller
is authorized as an instructor. Do not trust a role field solely because it appears
in JSON request data.

### `GET /activities/:activityId/resources/:resourceLinkId/status`

Returns the authoritative state for Learn to render its controls.

When no temporary entry mapping exists:

```json
{
  "resourceLinkId": "opaque-resource-id",
  "state": "inactive",
  "activeSessionId": null,
  "studentLaunchUrl": null,
  "connectedParticipantCount": 0,
  "connectedInstructorCount": 0
}
```

When students are waiting but no instructor-led session has started:

```json
{
  "resourceLinkId": "opaque-resource-id",
  "state": "waiting",
  "activeSessionId": null,
  "studentLaunchUrl": null,
  "connectedParticipantCount": 0,
  "connectedInstructorCount": 0
}
```

For an active session:

```json
{
  "resourceLinkId": "opaque-resource-id",
  "state": "active",
  "activeSessionId": "activebits-session-id",
  "studentLaunchUrl": "https://bits.example/<session-id>",
  "connectedParticipantCount": 24,
  "connectedInstructorCount": 1
}
```

`studentLaunchUrl` is a navigation URL, not an API credential. It may be omitted from
the status response if Learn instead asks ActiveBits for a redirect response at student
launch time. `connectedParticipantCount` is the number of unique, currently connected
student participants; `connectedInstructorCount` is the number of currently connected
instructors. These are live connection counts, not attendance or historical enrollment
totals.

Learn may poll status while rendering its activity. The first implementation should
poll at a modest interval (for example, every 15–30 seconds while the activity page is
visible) and refresh immediately after Start or Stop; it should stop polling when the
page is hidden or unmounted. ActiveBits should return `Cache-Control: no-store` and
rate-limit the endpoint by authenticated Learn client/resource without making normal
polling fail. ActiveBits does not retain or report historical attendance; Learn owns
that concern, including any LMS grade notification it sends when a student connects.

### `POST /activities/:activityId/resources/:resourceLinkId/start`

Instructor-authorized and idempotent on `(activityId, provider, resourceLinkId, requestId)`.

If the same `requestId` is retried while its first request is still creating the
instructor session, ActiveBits returns `202 Accepted` with `state: "starting"`.
Learn should retry that same request ID until it receives the active-session
response; a different request ID during that transition receives `409 Conflict`.

1. If the mapping is waiting (or absent), validate `presentationUrl`, create/configure
   the temporary session, and atomically write/transition the mapping to active with a
   matching bounded TTL.
2. If a valid active session already exists, return it unchanged.
3. Do not persist presentation configuration outside the newly created session.
4. Create an expiring, single-use instructor browser handoff token.
5. Return the active state plus an `instructorLaunchUrl`.

```json
{
  "state": "active",
  "activeSessionId": "activebits-session-id",
  "reused": false,
  "instructorLaunchUrl": "https://bits.example/integrations/learn/launch/<opaque-one-time-token>",
  "studentLaunchUrl": "https://bits.example/<session-id>"
}
```

If two instructor requests race, exactly one session must be created. The other
request returns that same active session. Use an atomic store operation or a
per-resource lock that works across server instances.

If a `start` request includes a `presentationUrl` that differs from the active session's
configured URL, reject it with `409 Conflict`. Never silently switch the presentation
of a live class. A changed URL is accepted only after a successful `stop` has cleared
the active mapping.

### `POST /activities/:activityId/resources/:resourceLinkId/stop`

Instructor-authorized and idempotent. End the active SyncDeck session using the normal
server lifecycle/broadcast path, delete the active mapping, and return `inactive`.

Stopping an already inactive resource returns success with `alreadyInactive: true`.
After Learn receives a successful stop response, it treats the resource as ready to
start again. The stopped ActiveBits session is left to the normal temporary-session TTL
and cleanup path.

### Student Launch

Learn makes the launch-mode decision before redirecting the browser:

- **Instructor-led:** Learn reads the active `studentLaunchUrl` from its
  server-to-server status response (or uses an agreed ActiveBits redirect endpoint)
  and sends the student to that shared live session.
- **Solo:** Learn redirects the student to the existing SyncDeck solo-launch utility
  with the presentation URL. That flow validates the deck and creates a new independent
  solo SyncDeck session for that student. Learn must not reuse the instructor resource's
  active-session mapping for this path.
- **Wait for instructor:** Learn's server first requests a short-lived, single-use
  student waiting-room launch URL from ActiveBits for the resource. It redirects the
  browser to that URL. ActiveBits consumes the token into an httpOnly browser handoff,
  creates or refreshes the temporary `waiting` mapping, and renders the waiting room.
  When Learn later starts the instructor-led session, ActiveBits atomically transitions
  the mapping to `active`, broadcasts the session URL to its waiting-room connections,
  and redirects them into the shared live session.

An inactive resource has no implied ActiveBits behavior until Learn selects `solo` or
`wait-for-instructor`. Waiting-room state is short-lived and is not a durable Learn
resource record.

### `POST /activities/:activityId/resources/:resourceLinkId/student-entry`

This is an authenticated Learn-server request used only for the
`wait-for-instructor` path. It returns a short-lived, single-use browser URL such as:

```json
{
  "waitingLaunchUrl": "https://bits.example/integrations/learn/wait/<opaque-one-time-token>"
}
```

The token is not the Learn resource ID or an HMAC secret. ActiveBits consumes it
atomically, establishes a same-origin httpOnly browser handoff, removes it from the
final URL, and opens the waiting room. This prevents arbitrary browser clients from
claiming a resource ID or reusing a captured wait-room URL indefinitely.

---

## Instructor Browser Handoff

Learn's Start button calls the server-to-server `start` endpoint, then opens
`instructorLaunchUrl` in a new window. The launch URL contains a random opaque token
with a short expiration and one-time use.

On navigation, ActiveBits must:

1. Atomically validate and consume the token.
2. Bind it to the expected SyncDeck session and instructor role.
3. Establish the existing same-origin, httpOnly recovery mechanism or issue an
   equivalent short-lived recovery credential.
4. Redirect to `/manage/syncdeck/:sessionId` with no token in the final URL.

Never put the instructor passcode in:

- Learn's database or API responses
- a query parameter, fragment, or browser storage
- client logs or analytics events

Use `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, strict token length/TTL
bounds, and structured security logs that record only a token fingerprint or request
ID. Expired or consumed tokens must fail closed with a friendly re-launch instruction.

---

## Learn Implementation Checklist

- [ ] Configure the dedicated request-HMAC key ID and secret in Learn's server-only
  configuration; implement signing, retry-safe `requestId` generation, nonce
  generation, and key rotation.
- [ ] Generate or obtain a stable, opaque `resourceLinkId` per Learn activity/resource;
  include the Learn deployment/provider namespace in every request.
- [ ] Store no ActiveBits instructor credential. Treat returned launch URLs as
  short-lived and do not persist or render them after use.
- [ ] Render Start when the instructor-authorized status is inactive; call `start`
  server-to-server and open the returned `instructorLaunchUrl` in a new window.
- [ ] Render Stop when active; call `stop` server-to-server and refresh status.
- [ ] After a successful Stop confirmation, return the instructor UI to its ready-to-
  start state; do not wait for ActiveBits session TTL cleanup before allowing Start.
- [ ] Disable or hide presentation editing while status is active. Require a successful
  Stop and refreshed inactive status before submitting a changed presentation URL.
- [ ] Persist deck URL edits independently of Start/Stop controls. Send the saved URL
  with a new instructor Start request; do not expect ActiveBits to store drafts or
  history for Learn.
- [ ] For instructor-led student launches, redirect only to the active
  `studentLaunchUrl` or use the agreed ActiveBits student launch endpoint. Do not
  construct a session URL from an untrusted browser value.
- [ ] For solo student launches, redirect to the existing SyncDeck solo-launch flow;
  expect it to create a distinct session per student and do not call instructor
  `start`/`status` to select that session.
- [ ] For `wait-for-instructor`, call `student-entry` server-to-server and redirect
  the student to its returned, one-time ActiveBits waiting-room URL. Do not create a
  solo session or expose the resource ID as a browser credential.
- [ ] Poll authenticated status while the Learn activity UI is visible, display live
  participant/instructor counts, and stop polling when it is hidden or unmounted.
- [ ] Keep attendance/history and LMS grade notifications in Learn. Trigger the
  appropriate Learn/LMS notification from Learn's student-connect workflow, not from
  ActiveBits status polling.
- [ ] Handle `409` (resource configuration conflict or policy conflict), `401/403`
  (authentication/role failure), `429` (rate limiting), and retry-safe network errors.
- [ ] Use `requestId` consistently: retry the same logical action with the same value;
  generate a new value only for a new instructor click.
- [ ] Test concurrent instructor Start clicks, stale browser launch URLs, Stop after
  an external session end, and student launch during/after a start race.

---

## ActiveBits Implementation Checklist

- [ ] Define server-only configuration for the dedicated request-HMAC key IDs/secrets;
  fail closed when credentials are absent in production and document key rotation.
- [ ] Add an activity-agnostic integration authentication middleware with structured
  security logging; keep Learn-specific mapping logic outside shared activity UI code.
- [ ] Add a Valkey-backed temporary entry mapping and idempotency/replay store. It must
  have a bounded waiting TTL and, once active, must not outlive its temporary session;
  include tests for in-memory development mode.
- [x] Add the versioned status/start/stop/student-entry routes, strict schemas,
  explicit error responses, and structured server-side events.
- [ ] Add authenticated per-client/resource rate limiting that permits normal Learn
  status polling and rejects abusive API traffic.
- [x] Reuse SyncDeck session creation/configuration behavior; do not duplicate or
  weaken its presentation validation and instructor authorization rules.
- [ ] Verify and complete cross-instance atomic waiting-to-active transition/start-reuse
  behavior with the shared mapping/idempotency store. Waiting browsers already observe
  the active student session URL through no-store status polling.
- [x] Reject presentation URL updates and mismatched Start requests with `409 Conflict`
  while an instructor-led session is active, even if Learn's UI has already disabled
  the edit control.
- [x] Implement a one-time instructor browser handoff endpoint that consumes its token
  atomically and strips it before the manager route loads.
- [ ] Delete mappings when their sessions end through any existing ActiveBits instructor
  path, expiry, or deletion path; remove stale mappings on status reads and expire
  inactive waiting mappings after their bounded TTL.
- [x] Report unique live student and instructor connection counts through status without
  exposing participant identities or retaining historical attendance. Cover reconnect,
  duplicate socket, and disconnect behavior in tests.
- [ ] Return no-store status responses and rate-limit authenticated polling by Learn
  client/resource while supporting the documented polling interval.
- [x] Provide an instructor-led student launch/redirect response. Keep solo creation
  in the existing per-student SyncDeck launch flow; do not make untrusted opaque query
  parameters authoritative.
- [x] Implement one-time student waiting-room browser handoff tokens that establish
  same-origin httpOnly state, remove tokens from final URLs, and create/refresh only a
  bounded temporary waiting mapping.
- [ ] Add unit tests for idempotency, start races, stop idempotency, stale mappings, and
  student/instructor token single consumption. Authentication failures, replay,
  validation, stop broadcast, and instructor handoff are covered. Mark expected noisy
  failure-path logs with `[TEST]`.
- [ ] Add Playwright coverage for the Learn-style instructor new-window handoff. Student
  waiting-room polling and redirect are covered using the shared root harness.
- [x] Update `README.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`, data-contract notes, and
  any SyncDeck payload documentation affected by the final launch contract.

---

## Delivery Sequence

1. Implement the agreed request-HMAC authentication, resource identity, and
   Learn-owned launch-mode claims.
2. Implement the short-lived waiting/active mapping store plus authenticated `status`
   and `student-entry` endpoints.
3. Implement atomic waiting-to-active `start`/reuse, waiter broadcasts, and internal
   session-end synchronization.
4. Implement `stop`, ready-to-start confirmation semantics, and idempotency/replay
   protection.
5. Implement the one-time instructor browser handoff and new-window integration.
6. Implement and test the student redirect behavior.
7. Run workspace tests, typecheck, lint, and browser coverage; update deployment and
   contract documentation before enabling the integration in production.

## Closed Decisions

- Server-to-server authentication is a dedicated request-HMAC scheme.
- Learn owns deck URL persistence separately from Start/Stop. The URL supplied at
  instructor Start is immutable for that active session and may change only after Stop.
- Status provides current live connection counts only. Learn owns attendance/history
  and LMS grade notifications for student connections.

There are no remaining product-level open questions. Mapping cleanup follows the
active SyncDeck session lifecycle and TTL; deleted or archived Learn resources require
no separate ActiveBits cleanup.
