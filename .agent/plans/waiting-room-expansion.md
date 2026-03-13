# Waiting Room Expansion Plan

## Status: Design / Pre-Implementation

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
3. Waiting room checks whether preflight fields or a waiting state are needed.
4. If needed, waiting room renders required preflight fields and/or blocking state.
5. Waiting room determines current instructor presence / session state.
6. Student is routed to one of:
   - live managed session
   - solo continuation
   - blocked waiting state
   - immediate pass-through when nothing else is required

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

Recommended shared contract:

- Config field shape includes `type`, `component?`, and serializable `props?`
- Client entry may export `waitingRoomFields?: Record<string, WaitingRoomFieldComponent>`
- Missing custom component keys should fail safely with a clear fallback/error state

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
- whether this entry can immediately pass through without showing waiting-room UI

### Proposed state outcomes

| Outcome | Condition |
|---|---|
| `wait` | Policy requires instructor and none is present |
| `join-live` | Instructor is present and normal managed entry is allowed |
| `continue-solo` | No instructor is present and policy allows solo fallback and activity supports solo mode |
| `solo-unavailable` | Policy allows solo fallback but activity does not support solo mode |
| `pass-through` | No blocking state or additional fields are required before launch |

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
   as a fast preflight/pass-through step rather than a visible waiting screen.
2. If a student starts in solo mode and an instructor later appears, the student should
   remain solo by default; do not auto-switch in v1.
3. Waiting-room data should live primarily in session/runtime context, with local
   storage used for solo continuity in v1; avoid URL/query transport for participant
   identity data.
4. Day-one shared participant fields should be limited to `displayName` and
   `participantId`; additional values such as team should be modeled as reusable
   participant attributes with explicit inheritance/write-back rules rather than universal
   parent fields.
5. Reusable participant attributes written back from a flow should become available to
   future launches only, not currently running activities.
6. Any allowed write-back should happen at a defined boundary such as waiting-room exit or
   equivalent handoff, not as unrestricted live two-way synchronization.
7. Persistent link dashboards should visibly label entry mode, including live-only,
   async-capable, and solo-only.

## Deferred Future Work

1. Define a broader activity-originated participant-attribute commit mechanism if a later
   workflow needs to persist attributes outside waiting-room-style handoff points.
2. Revisit server-backed solo continuity only if a concrete cross-device or cross-browser
   resume requirement appears.

---

## Suggested Phases

### Phase 0 - Design and contract

- [ ] Confirm permalink entry-policy vocabulary
- [ ] Decide default behavior for existing permalinks
- [ ] Define shared waiting-room field schema contract
- [ ] Decide server/client ownership for validation and temporary storage
- [ ] Document transition rules for `wait`, `join-live`, `continue-solo`, `solo-unavailable`, and `pass-through`
- [ ] Define how permalink and ad-hoc join-code entry both route through the same waiting-room gateway

### Phase 1 - Persistent link creation flow

- [ ] Add entry-policy control to permalink creation UI
- [ ] Persist selected entry policy in permalink metadata
- [ ] Expose entry policy in session-entry/waiting-room API payloads
- [ ] Add visible entry-mode labeling in persistent link listings/details
- [ ] Add tests for default and non-default permalink policies

### Phase 2 - Waiting room preflight framework

- [ ] Build generic waiting-room field renderer from shared field metadata
- [ ] Support required text/select-style field validation
- [ ] Submit/store preflight data for later entry flow use
- [ ] Add clear [TEST] logging for expected error-path tests
- [ ] Add tests for required-field blocking and validation behavior

### Phase 3 - Entry resolution behavior

- [ ] Implement instructor-required blocking flow
- [ ] Implement solo-allowed fallback flow
- [ ] Implement solo-unavailable informational state
- [ ] Implement direct pass-through when no waiting-room UI is needed
- [ ] Preserve existing live-session behavior when instructor is present
- [ ] Add tests for live join, wait, solo fallback, pass-through, and unsupported-solo cases

### Phase 4 - Downstream integration

- [ ] Verify activity code can consume waiting-room-collected participant data
- [ ] Align policy naming with future SyncDeck/presentation embedding work
- [ ] Update related planning docs once embedded-activity decisions are finalized

---

## Initial Recommendation

Start with the smallest shared abstraction that solves the current need while aiming at
one common entry pipeline:

- a universal waiting-room gateway for permalink and join-code entry
- a permalink entry policy field
- a generic waiting-room field schema
- a runtime resolver that chooses `wait`, `join-live`, `continue-solo`, `solo-unavailable`, or `pass-through`

That should let waiting-room work move first without forcing premature decisions about
embedded activity architecture, while still simplifying activity startup into one flow.
