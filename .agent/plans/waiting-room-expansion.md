# Waiting Room Expansion Plan

## Status: Partial Implementation

Implemented so far:

- Phase 0 contract baseline: shared waiting-room types, config schema validation, and
  persistent entry-policy normalization/defaulting are in place.
- Phase 2 baseline: shared waiting-room rendering supports declarative built-in fields,
  custom field registries loaded from the owning activity client bundle, session
  storage persistence for preflight values while a participant waits, and outcome-aware
  waiting-room presentation for wait, live-join preflight, and solo-preflight
  permalink states.

Remaining work is centered on policy resolution, server-side enforcement, and carrying
collected participant data into downstream join/solo flows.

This document outlines a standalone planning track for expanding the waiting room
experience. The goal is to make waiting-room behavior flexible enough to support:

- teacher-led classroom entry
- asynchronous permalink use
- solo fallback when no instructor is present
- activity-specific preflight data collection before entry

This plan is intentionally separate from SyncDeck embedded activities, but it should
remain compatible with that work.

---

## Problem Statement

The current waiting room behavior is primarily a blocking gate: students arrive at a
session entry point and wait until an instructor is present. That model works for live
classroom use, but it does not fully support:

1. Asynchronous student review or make-up work from a persistent/permalink session
2. Activities that want to collect participant information before entry
3. Solo-mode continuation when a teacher is absent
4. Future presentation-driven launches that need a consistent "entry policy" decision

Because ActiveBits intentionally does not provide durable permanent session data, the
permalink itself is the durable entry point. The waiting room should therefore become
 the universal entry gateway where ActiveBits resolves how a student enters *right now*. In some cases it will render UI; in others it
will immediately pass through once policy and context are resolved:

- join a live instructor-managed session
- continue in solo mode
- remain blocked and wait
- pass through directly when no additional input or waiting state is required

---

## Goals

- Expand the waiting room from a blocking screen into a universal entry/preflight gateway.
- Support persistent links that can explicitly allow or disallow solo continuation when
  no instructor is present.
- Allow activities to declare waiting-room data requirements such as display name and
  custom chooser fields.
- Keep activity-specific rules contained in activity code/config rather than hard-coding
  one-off behavior in shared waiting-room components.
- Preserve current teacher-led behavior unless a session/activity explicitly opts into
  different entry policy.
- Leave room for later integration with SyncDeck-hosted and standalone presentation flows.

## Non-Goals

- Implement embedded activity launch behavior in this track
- Redesign the entire join page visual system
- Introduce durable historical storage for solo session data

---

## Core Idea

Treat the waiting room as **entry policy resolution + preflight data collection**, not
just "wait until teacher appears."

Every session entry attempt should answer two questions:

1. What is this entrant allowed to do right now?
2. What information must we collect before they can do it?

The important shift is that the waiting room becomes the universal entry gateway for
activity access. It may render UI, or it may immediately pass through when no user input
or blocking state is needed.

That suggests a generic shared flow:

1. Student opens permalink, join-code, or equivalent activity entry URL.
2. System resolves session metadata and entry policy.
3. Waiting room resolves role and current session/instructor context.
4. Waiting room determines destination and whether any UI is needed.
5. If needed, waiting room renders required preflight fields, role-entry UI, and/or blocking state.
   When both preflight and waiting apply, required preflight fields should be completed
   during the waiting state and carried forward once entry can proceed.
6. Student is routed to one of:
   - live managed session
   - solo continuation
   - blocked waiting state
   - immediate pass-through when nothing else is required

The more precise ordering and terminology in **Entry Resolution Model** below is
authoritative when this summary is too high-level.

---

## Proposed Permalink Entry Policy

### Recommendation

Add an explicit entry-policy field to persistent/permalink creation so behavior is chosen
at link-creation time instead of inferred later.

Recommended policy values:

| Policy | Meaning |
|---|---|
| `instructor-required` | Student must wait until an instructor is present |
| `solo-allowed` | Student joins live session when instructor is present; otherwise may continue in solo mode |
| `solo-only` | Permalink always launches solo mode and never waits for an instructor |

This is more future-proof than a single boolean because it avoids collapsing distinct
behaviors into `true/false`.

### Why this should live in permalink creation

- It makes async access a deliberate teacher choice.
- It avoids guessing whether a missing instructor means "teacher is late" or
  "independent review is allowed."
- It gives future presentation/permalink flows a shared contract.

### API / UI implications

- Persistent link creation UI should expose entry policy selection.
- Persistent link metadata should store the selected policy.
- Waiting-room/session-entry APIs should return the resolved policy to the client.
- The existing default should remain `instructor-required` for safety unless explicitly changed.

### Migration rule for existing permalinks

Existing permalink records that do not yet have an entry-policy field should be treated as
`instructor-required` by default.

This should be an explicit compatibility rule in both server and client resolution paths,
not an implementation accident. Older permalinks should continue to behave as they do
now until a teacher explicitly updates or recreates them with a different policy.

---

## Waiting Room Data Collection

### Shared capability

The waiting room should support activity-declared preflight fields, with a small generic
shared contract and activity-owned field definitions.

Examples:

- display name
- preferred identifier
- custom chooser inputs
- section/team selector

### Containment approach

Shared waiting-room code should only understand generic field metadata and submission
handling. Activities should provide their own schema/config for:

- which fields are required
- validation rules
- labels/help text
- optional default values

This keeps the waiting room reusable while preserving activity containment.

### Recommended shape

Add an activity-config level declaration for waiting-room requirements, for example:

```ts
waitingRoom: {
  fields: [
    { id: 'displayName', type: 'text', required: true },
    { id: 'team', type: 'select', required: true, 
      options: [
        { value: 'red', label: 'Red' },
        { value: 'blue', label: 'Blue' }
      ]
    },
    {
      id: 'chooser',
      type: 'custom',
      component: 'ChooserField',
      required: false,
      props: {
        prompt: 'Pick your path'
      }
    }
  ]
}
```

Exact schema can be finalized during implementation. The important part is that shared
code consumes a generic contract rather than activity-specific components.

### Custom field components

Custom waiting-room fields should use a two-part contract:

- `activity.config.ts` declares a string component key in the field definition
- `client/index.tsx` exports a `waitingRoomFields` registry that maps those keys to
  React components

Recommended pattern:

```ts
// activity.config.ts
waitingRoom: {
  fields: [
    { id: 'displayName', type: 'text', required: true },
    {
      id: 'chooser',
      type: 'custom',
      component: 'ChooserField',
      required: true
    }
  ]
}
```

```tsx
// client/index.tsx
export const waitingRoomFields = {
  ChooserField,
};
```

This keeps config declarative and avoids embedding component references directly inside
`activity.config.ts`. Shared waiting-room code can render built-in field types itself and
resolve custom ones from the client entry export.

### Loading model for `waitingRoomFields`

The existing activity loader eagerly reads small config modules but lazy-loads each
activity's `client/index.tsx` bundle. The waiting room may need custom field components
before the main activity UI renders, so the plan should treat `waitingRoomFields` as part
of that same lazy-loaded client entry module.

Recommended loading rule:

- when waiting-room rendering sees a custom field for activity `X`, it should load
  activity `X`'s existing client entry bundle and read `waitingRoomFields` from that module
- do not introduce a separate custom-field bundle/registry path in v1 unless performance
  data later shows a need for finer-grained splitting
- built-in waiting-room fields should still render without loading any activity client code

This keeps the loading model aligned with the current activity registry and avoids a second
parallel component-discovery mechanism just for waiting-room fields.

Recommended shared contract:

- Config field shape includes `type`, `component?`, and serializable `props?`
- `props?` in `activity.config.ts` must remain data-only and serializable (no functions,
  class instances, component references, or callback-style behavior)
- Client entry may export `waitingRoomFields?: Record<string, WaitingRoomFieldComponent>`
- Missing custom component keys should fail safely with a clear fallback/error state

This is important because `activity.config.ts` should stay declarative. Activity authors
should pass configuration data such as labels, option lists, and flags through `props`,
while interactive behavior lives in the exported React component implementation.

Accessibility requirement:

- Built-in waiting-room fields, custom `WaitingRoomFieldComponent` implementations, and
  permalink entry-policy controls must follow the repository accessibility rules: prefer
  semantic HTML, provide accessible names, expose relevant state with native/ARIA
  attributes, and preserve keyboard interaction for custom controls.

Recommended custom component props:

```ts
type WaitingRoomFieldComponentProps<T = unknown> = {
  field: WaitingRoomFieldConfig;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  error?: string;
};
```

---

## Entry Resolution Model

At runtime, the waiting room should resolve entry using:

- permalink/session policy
- current instructor presence
- activity solo capability (`activityConfig.soloMode`)
- completion of required preflight fields
- role resolution needs for this entry surface
- whether this entry can immediately pass through without showing waiting-room UI

The model is clearer if it is treated as three separate decisions:

1. **Role resolution**: who is entering?
2. **Destination resolution**: where should they go?
3. **Presentation mode**: does the waiting-room UI need to be shown?

The client may render the waiting-room UX, but policy enforcement must not rely on the
client alone. Server-side entry/session APIs should enforce the same resolved policy so a
student cannot bypass `instructor-required` or similar restrictions by hitting the API
 directly.

### Role resolution

Role resolution determines whether the entrant is acting as a student or instructor.

Standalone/permalink/join-code entry may need to resolve role by using:

- existing instructor authentication cookie
- instructor code entry when the user intends to join as instructor but does not already
  have the cookie
- default student role when no instructor authentication is present

For `solo-only` permalinks, instructor authentication should not change the destination.
An instructor arriving on a `solo-only` link should open the activity as a solo
participant for demo/use, not as a managed instructor session.

Embedded activity entry should not re-resolve role locally. Instead, it should inherit
role from the parent session context.

- Parent instructor -> embedded instructor
- Parent student -> embedded student
- Embedded flows should not prompt for instructor code unless the parent role context is
  missing or invalid

### Destination outcomes

| Outcome | Condition |
|---|---|
| `wait` | Policy requires instructor and managed entry is not yet available |
| `join-live` | The resolved role is entering a managed session path and the policy allows managed entry |
| `continue-solo` | The policy resolves this entrant to solo mode and the activity supports solo mode |
| `solo-unavailable` | The policy resolves this entrant to solo mode but the activity does not support solo mode |

Additional clarification:

- `instructor-required` links resolve students to `wait` until instructor presence is available; valid instructor auth resolves to managed instructor entry
- `solo-allowed` links resolve to managed entry when instructor presence/managed access is available, otherwise to solo when allowed
- authenticated instructor entry on a `solo-allowed` link should resolve to `join-live`, not `continue-solo`
- `solo-only` links always resolve to `continue-solo` / `solo-unavailable` and never to `join-live`, even if instructor auth is present

#### `wait` UX

For v1, `wait` should remain a stable waiting-room state with no automatic timeout into a
different destination. If the student is waiting for an instructor-required session, the
UI should continue to show that they are waiting until instructor presence changes or the
user explicitly retries, refreshes, or leaves.

#### `solo-unavailable` UX

`solo-unavailable` should be an informational waiting-room screen, not a dead-end redirect.
The student should see a clear message that this activity requires a live instructor-led
session, along with any useful next action the entry surface can offer, such as staying on
that screen to wait, retrying, or returning to a prior join/home surface if one exists.

### Preflight plus waiting sequencing

When an entrant both:

- must wait before managed entry can proceed, and
- has required preflight fields

the v1 rule should be: collect required preflight fields during the waiting-room state,
not after the instructor appears. The entered data should be retained and carried forward
when the destination later changes from `wait` to `join-live`.

Why this is the preferred sequence:

- it reduces friction at the moment entry becomes available
- it lets the waiting-room framework build one stable form/state path instead of a second
  post-wait preflight step
- it makes collected participant context available earlier for downstream resolution and
  later inheritance

### Presentation mode

`pass-through` is not a separate destination. It describes whether waiting-room UI is
shown before the resolved destination is entered.

| Mode | Condition |
|---|---|
| `render-ui` | Waiting-room UI is needed for role entry, preflight fields, or blocked/waiting state |
| `pass-through` | Destination is already known and no waiting-room UI is needed before launch |

Examples:

- Instructor present + managed session allowed + no required preflight -> destination `join-live`, mode `pass-through`
- Instructor absent + solo allowed + no required preflight -> destination `continue-solo`, mode `pass-through`
- Instructor absent + instructor-required policy -> destination `wait`, mode `render-ui`
- No instructor cookie + user wants instructor access via permalink -> resolve role through waiting-room UI before destination selection completes
- Authenticated instructor opens a `solo-allowed` permalink -> destination `join-live`, mode `pass-through`
- Instructor opens a `solo-only` permalink -> destination `continue-solo`, mode `pass-through` (solo demo participant)

### Important rule

Solo fallback must not be inferred from missing instructor presence alone. It should
require both:

- permalink/session policy allows it
- activity supports solo mode

## Preflight Data Inheritance

Waiting-room-collected data should be designed for reuse by downstream activity flows,
including embedded child activities, instead of being treated as one-time form state.

### Recommendation

Distinguish between two categories of preflight data:

- **Shared participant fields**: reusable values such as display name and `participantId`
- **Reusable participant attributes**: values such as team or section that may be collected
  by one flow/activity and reused later, but are not required universal parent fields
- **Activity-local fields**: values only meaningful to one activity instance, such as a
  custom chooser or mode-specific option

Shared participant fields should be eligible for inheritance by downstream activities.
That means a child or embedded activity can use already-collected parent data instead of
re-prompting for it.

### `participantId` provenance

`participantId` should be assigned by shared server-side entry/session functionality, not
by individual activities and not by the client.

Recommended provenance rule:

- server generates `participantId` at the point where entry is accepted
- waiting-room/session-entry response returns the resolved `participantId`
- downstream activity launches inherit that `participantId` from shared participant context
- clients may persist the assigned value for reconnect/solo continuity, but should not be
  treated as the authority that creates it

This matters because current activity code appears to generate student IDs inside
activity-specific server routes. That should be migrated toward shared entry handling so
participant identity is stable across waiting-room, activity, and embedded-child flows.

### Proposed inheritance rules

- Waiting-room field definitions may declare whether a field is `inheritable`
- Fields may separately declare whether they can be persisted as shared participant
  attributes for later reuse
- Downstream activities may declare that a field should `use inherited if available`
- If an inheritable field is missing, the downstream activity may prompt locally or fall
  back according to its own requirements
- Activity-local fields should not be inherited unless explicitly designed for reuse
- Upward write-back should be limited to explicit participant attributes, not arbitrary
  child activity state

### Why this matters

- Avoids asking students for shared identity fields repeatedly
- Lets parent activities or entry flows provide a stable participant context for embedded
  child activities
- Leaves room for reusable participant attributes like team to be collected once and used
  by later activities without making them universal parent-session fields
- Makes waiting-room work a foundation for future embedded activity launches rather than a
  parallel one-off system

### Contract direction

The plan should leave room for a small shared participant-context contract that can be
passed through the relevant runtime boundary:

- live join flow
- solo launch flow
- parent session to embedded child session flow

Day-one shared participant fields should stay narrow:

- `displayName`
- `participantId`

Additional participant attributes such as team should be allowed to emerge through
explicit field contracts and scoped write-back rather than being treated as universal
parent-session fields from the start.

This does not require finalizing the transport yet, but the data model should assume that
shared participant fields may be carried forward beyond the initial waiting-room screen,
and that selected participant attributes may later be written back in a controlled way
at explicit handoff boundaries.

---

## Relationship To Embedded Activities

This plan should be implemented so embedded/presentation work can reuse the same policy
language later. It should also align permalink and ad-hoc join-code entry behind the same
waiting-room gateway even if their backing lookup logic differs.

Examples:

- A SyncDeck persistent link without a teacher could resolve to `continue-solo`.
- A standalone presentation launcher could use the same policy semantics for solo review.
- Waiting-room-collected display name / chooser data could later seed embedded child
  sessions or local solo launches.

The waiting room should therefore define generic entry-policy language now, even if only
permalink sessions use it first.

---

## Recommended Decisions

1. `solo-only` permalinks should still route through the waiting-room gateway, but usually
   as a fast preflight/pass-through step rather than a visible waiting screen. Instructor
   auth does not convert a `solo-only` link into managed entry; instructors open it as solo
   participants for demo/use.
2. If a student starts in solo mode and an instructor later appears, the student should
   remain solo by default; do not auto-switch in v1.
3. If a student is in `wait`, v1 should not auto-timeout them into solo or any other
   destination; they remain waiting until instructor presence changes or they explicitly
   retry/leave.
4. Waiting-room data should live primarily in session/runtime context, with local
   storage used for solo continuity in v1; avoid URL/query transport for participant
   identity data.
5. Day-one shared participant fields should be limited to `displayName` and
   `participantId`; additional values such as team should be modeled as reusable
   participant attributes with explicit inheritance/write-back rules rather than universal
   parent fields.
6. Reusable participant attributes written back from a flow should become available to
   future launches only, not currently running activities.
7. Any allowed write-back should happen at a defined boundary such as waiting-room exit or
   equivalent handoff, not as unrestricted live two-way synchronization.
8. Persistent link dashboards should visibly label entry mode, including live-only,
   async-capable, and solo-only.

## Deferred Future Work

1. Define a broader activity-originated participant-attribute commit mechanism if a later
   workflow needs to persist attributes outside waiting-room-style handoff points.
2. Revisit server-backed solo continuity only if a concrete cross-device or cross-browser
   resume requirement appears.
3. Some current special-case solo-link behaviors (for example `gallery-walk` feedback review)
   may eventually be replaced by session-report download/review flows. Do not remove those
   affordances until an equivalent report-based workflow exists.
4. Move session creation and participant registration toward a shared entry/session layer so
   activities receive a resolved session + participant context instead of each activity
   bootstrapping its own startup/session flow.

---

## Suggested Phases

Recommended dependency order: `Phase 0 -> Phase 2 -> (Phase 3 + Phase 1) -> Phase 4`

Rationale:

- Phase 0 defines the contract and rollout rules
- Phase 2 provides the waiting-room field/preflight framework that Phase 3 depends on
- Phase 3 resolves entry behavior, and Phase 1 should only be exposed alongside that
  resolver (or behind a feature flag)
- Phase 4 migrates concrete activities once the shared entry path is working

### Phase 0 - Design and contract

Phase 0 deliverables should be concrete artifacts, not just discussion:

- update this plan with the resolved decisions and rollout rules
- record the finalized waiting-room / participant-context contract in `.agent/knowledge/data-contracts.md`
- add or update shared schema/type definitions for the chosen contract before implementation work begins

An additional ADR should only be created if the waiting-room contract diverges enough from
this plan that a separate architecture record becomes useful.

- [x] Confirm permalink entry-policy vocabulary
- [x] Decide default behavior for existing permalinks
- [x] Define shared waiting-room field schema contract
- [ ] Decide and document sequencing when required preflight fields and waiting state both apply (v1: collect while waiting and carry forward)
- [ ] Decide server/client ownership for validation and temporary storage
- [ ] Define shared server-side `participantId` issuance and reconnect semantics
  Current status: shared server-side participant ID generation now starts in `server/core/participantIds.ts`, and `java-string-practice`, `java-format-practice`, `traveling-salesman`, and SyncDeck registration paths reuse it. Reconnect semantics and cross-activity participant context are still activity-specific.
  Update: `java-string-practice`, `java-format-practice`, and `traveling-salesman` now also share a generic session-backed reconnect/create helper in `server/core/sessionParticipants.ts`, but Python List Practice and SyncDeck still use activity-owned matching rules.
- [ ] Define server-side enforcement rules so entry/session APIs reject disallowed joins even if the client is bypassed
- [ ] Document role resolution rules for student, instructor-cookie, instructor-code, and embedded-role-inheritance paths
- [x] Document destination transitions for `wait`, `join-live`, `continue-solo`, and `solo-unavailable`
- [x] Document presentation-mode rules for `render-ui` vs `pass-through`
- [ ] Define how permalink and ad-hoc join-code entry both route through the same waiting-room gateway

### Phase 1 - Persistent link creation flow

Rollout dependency: do not expose entry-policy behavior to users before the waiting-room
resolver and preflight framework understand it. Either land Phase 1 alongside the
Phase 2 + Phase 3 entry path, or gate Phase 1 API/UI exposure behind a feature flag until
that path ships.

- [x] Add entry-policy control to permalink creation UI
- [x] Ensure entry-policy controls expose accessible names, state, and keyboard interaction
- [x] Persist selected entry policy in permalink metadata
- [x] Expose entry policy in session-entry/waiting-room API payloads
- [x] Define API error/response shape for server-enforced policy rejections
- [x] Gate Phase 1 UI/API exposure until Phase 3 resolver support exists, or land them together
- [x] Add visible entry-mode labeling in persistent link listings/details
- [x] Add tests for default and non-default permalink policies

### Phase 2 - Waiting room preflight framework

- [x] Build generic waiting-room field renderer from shared field metadata
- [x] Support required text/select-style field validation
- [x] Ensure built-in and custom waiting-room controls meet accessibility semantics and keyboard requirements
- [ ] Retain preflight form state across destination transitions (for example `wait -> join-live`) and carry collected data forward when entry proceeds
  Current status: started persistent sessions with waiting-room fields now stay inside the same `WaitingRoom` shell and reuse the stored preflight form state for `join-live`, but downstream join flow still does not submit/store that data beyond local sessionStorage.
- [ ] Submit/store preflight data for later entry flow use
  Current status: waiting-room `join-live` and `continue-solo` actions now copy collected values into a shared client-side entry handoff store keyed by destination, and `java-string-practice` consumes `displayName` from that handoff to skip its duplicate name gate. Server-backed participant storage and broader activity adoption are still outstanding.
  Update: `java-format-practice` now consumes the same `displayName` handoff, and `java-string-practice` also honors it on solo entry instead of always forcing `Solo Student`.
- [ ] Add clear [TEST] logging for expected error-path tests
- [ ] Add tests for required-field blocking, validation behavior, accessibility-critical control states, and wait-to-entry state carry-forward

### Phase 3 - Entry resolution behavior

- [ ] Implement instructor-required blocking flow
- [x] Implement solo-allowed fallback flow
- [x] Implement solo-unavailable informational state
- [x] Implement direct pass-through when no waiting-room UI is needed
- [ ] Implement instructor-cookie and instructor-code role resolution for standalone entry
- [ ] Route ad-hoc join-code entry through the same waiting-room gateway / resolver path as permalink entry
- [ ] Route ad-hoc join-code entry through the same waiting-room gateway / resolver path as permalink entry
  Current status: direct `/:sessionId` joins with activity-declared waiting-room fields now render the same `WaitingRoom` shell in `join-live` preflight mode before the student view mounts, but this is still a client-side preflight wrapper rather than a shared server-backed entry resolver contract.
- [x] Enforce entry policy server-side in entry/session APIs so disallowed joins are rejected even when the client is bypassed
- [x] Preserve existing live-session behavior when instructor is present
  Detail: when a persistent session is already started and the activity declares waiting-room fields, `SessionRouter` now renders `WaitingRoom` in a `join-live` preflight state instead of bypassing required field completion; activities without waiting-room fields keep the existing direct join card.
- [ ] Ensure embedded entry inherits role from parent context and does not prompt for instructor code
- [ ] Add tests for role resolution, live join, wait, solo fallback, pass-through, unsupported-solo cases, and direct-API bypass attempts
- [x] Add a test proving `solo-only` links with instructor auth resolve to `continue-solo`, not `join-live`

### Phase 4 - Downstream integration

Status note:

- Phase 4 is now explicitly deferred until the remaining Phase 0-3 waiting-room work is complete enough that activity migrations are not building on unstable entry/storage semantics.
- Existing activity migration notes below should be treated as prioritization guidance for later, not as the current implementation queue for this branch.

Reference integration target: `java-string-practice` should be the first activity migrated to
consume waiting-room-provided `displayName` / `participantId` instead of collecting its
own startup identity. This gives the phase a concrete exit condition before broader
activity adoption.

Direct solo-route migration note:

- the long-term target is for solo entry to flow through permalink / waiting-room-based
  entry rather than a separate direct `/solo/:activityId` launch path
- in the short term, direct `/solo/:activityId` should be treated as a compatibility path
  until permalink-based solo entry is working and activity migrations are complete
- not every current "Copy solo link" button means the same thing: `gallery-walk` uses its
  solo path as a feedback-review/upload tool, so it should not be removed as a generic
  cleanup step without a replacement flow

- [x] Migrate `java-string-practice` to consume waiting-room-collected participant data for student entry
- [x] Remove or bypass duplicate startup name collection in `java-string-practice` once waiting-room entry is authoritative
- [ ] Verify `java-string-practice` reconnect/progress flows still work with waiting-room-provided `participantId`
- [ ] Migrate activity-local student ID generation toward shared server-side `participantId` issuance where needed
  Current status: ID minting is now centralized, but activity-specific reconnect lookup and persistence rules still need a shared contract before this checkbox can close.
- [ ] Define the migration/deprecation path for direct `/solo/:activityId` entry once permalink-based solo entry is ready
- [ ] Keep or replace special-case solo entry actions (for example `gallery-walk` feedback review) before removing generic dashboard "Copy solo link" buttons
- [ ] Align policy naming with future SyncDeck/presentation embedding work
- [ ] Update related planning docs once embedded-activity decisions are finalized

## Activity Migration Checklist

Use this checklist when migrating an existing activity to waiting-room-based entry:

Deferral note:

- Do not treat this checklist as active branch scope until the remaining core waiting-room items in Phases 0-3 are closed or intentionally deferred.
- For now, keep these notes as migration prep so later work can resume without re-auditing the activity landscape.

- [ ] Identify whether the activity currently collects student name or ID during startup
- [ ] Move shared identity collection (`displayName`, `participantId`) to waiting-room / shared entry flow
- [ ] Remove or bypass duplicate startup prompts once waiting-room entry is authoritative
- [ ] Update activity client code to consume shared participant context instead of assuming local entry forms
- [ ] Preserve reconnect behavior using shared server-issued `participantId`
- [ ] Keep activity-specific fields local unless they are intentionally promoted to waiting-room fields
- [ ] Decide whether any activity-specific field should be inheritable or a reusable participant attribute
- [ ] Verify whether the activity's current direct `/solo/:activityId` entry should migrate to permalink-based entry or remain a special-case compatibility path
- [ ] Preserve or replace any activity-specific solo-link behavior that is not just "launch solo practice" (for example `gallery-walk` feedback review/upload)
- [ ] Verify solo mode still works with local-storage continuity and inherited participant context where applicable
- [ ] Add or update tests for the migrated startup path, reconnect behavior, and any expected error states

### Activity Audit Notes

- `java-string-practice`: active migration target and good fit for the shared waiting-room model. It already consumes waiting-room `displayName`, but still needs shared `participantId` carry-forward verification for reconnect/progress.
- `java-format-practice`: good fit for the shared waiting-room model. It now consumes waiting-room `displayName`, but still relies on activity-local reconnect/progress semantics.
- `traveling-salesman`: likely good follow-on migration target because it still prompts for student identity locally in the client, while its server reconnect logic now uses the shared participant helper. Waiting-room fields could replace the student-name gate later.
- `python-list-practice`: likely good migration target, but still uses its own local `studentName` / `studentId` lifecycle on both client and server. It should be considered one of the next activities for shared participant-entry convergence.
- `algorithm-demo`: lower priority for waiting-room identity migration. It does not currently collect student identity the same way, and its main entry-specific behavior is deep-link algorithm preselection plus solo-state persistence.
- `raffle`: defer for now. Student entry is effectively "claim a ticket for this session" and local storage mainly caches the assigned ticket payload; it does not currently need the same participant-name/preflight flow unless the product later wants named or sectioned ticket assignment.
- `gallery-walk`: defer with explicit caution. Its live flow has separate reviewee and reviewer identities plus kiosk/reviewer local-storage state, and its solo link is a special feedback-review/upload path rather than a generic solo practice entry.
- `syncdeck`: defer to the SyncDeck/presentation track. Student identity already uses REST registration plus websocket reconnect, and embedded/presentation concerns make it a broader participant-entry design problem than the current waiting-room branch should absorb.
- `www-sim`: defer with hostname-specific treatment. The student "identity" is the chosen hostname, and local storage persists hostname plus DNS/browser workspace state; if migrated later, hostname should likely be modeled as an activity-specific waiting-room field rather than forced into generic `displayName`.

---

## Initial Recommendation

Start with the smallest shared abstraction that solves the current need while aiming at
one common entry pipeline:

- a universal waiting-room gateway for permalink and join-code entry
- a permalink entry policy field
- a generic waiting-room field schema
- a runtime resolver that separates role resolution, destination resolution (`wait`, `join-live`, `continue-solo`, `solo-unavailable`), and presentation mode (`render-ui` vs `pass-through`)

That should let waiting-room work move first without forcing premature decisions about
embedded activity architecture, while still simplifying activity startup into one flow.
