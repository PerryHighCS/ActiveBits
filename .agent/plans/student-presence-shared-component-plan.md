# Shared Student Presence Component Plan

## Status

- [x] Discovery pass complete
- [ ] API contract approved
- [ ] Shared component implemented
- [ ] SyncDeck migrated to shared component
- [ ] One additional activity integrated
- [ ] Tests and docs complete

## Goals

- Extract SyncDeck's student count button + connected student list into reusable shared UI.
- Keep activity-specific websocket/state logic inside each activity while sharing presentation/UI logic.
- Add useful cross-activity enhancements (search, optional disconnected visibility, optional row metadata/actions).
- Allow parent managers to inject custom per-student row content/components for wide-open extensibility.
- Support per-student badges for quick visual identification (issues, communication flags, statuses).
- Support per-student style overrides/hooks for future highlighting and workflow cues.
- Provide a shared, secure return-to-waiting-room process that activities can opt into, beginning with students who need to choose a replacement display name.
- Preserve accessibility and existing SyncDeck behavior during migration.

## Current Behavior To Preserve

- SyncDeck manager receives `syncdeck-students` payloads and updates `connectedCount` plus student entries.
- SyncDeck header has a `Students: {connectedCount}` toggle button.
- Side panel shows only connected students and an empty state when none are connected.
- Newly connected students can trigger activity-specific side effects (for SyncDeck: chalkboard sync request).

## Proposed Shared Contract

### Types

```ts
export interface StudentPresenceEntry {
  participantId: string
  displayName: string
  connected: boolean
  groupLabel?: string
  secondaryLabel?: string
  sortKey?: string
  badges?: Array<{
    id: string
    label: string
    tone?: 'neutral' | 'info' | 'warning' | 'danger' | 'success'
  }>
  rowClassName?: string
  rowStyle?: React.CSSProperties
}

export interface StudentPresenceState {
  connectedCount: number
  entries: StudentPresenceEntry[]
}
```

### Normalization Helper

Create a shared helper that safely converts unknown payloads into `StudentPresenceState`:

- Accept unknown `connectedCount`; derive from entries if missing/invalid.
- Normalize missing id/name values to safe defaults.
- Trim names and remove invalid entries.
- Keep deterministic ordering to avoid UI jitter.

## Component Design

### 1) `StudentPresenceToggleButton`

Props:

- `connectedCount: number`
- `isOpen: boolean`
- `onToggle: () => void`
- `disabled?: boolean`
- `label?: string` (default `Students`)
- `controlsId: string`

Accessibility:

- `aria-expanded`
- `aria-controls`
- clear button label (for screen readers)

### 2) `StudentPresencePanel`

Props:

- `isOpen: boolean`
- `onClose: () => void`
- `entries: StudentPresenceEntry[]`
- `connectedCount: number`
- `title?: string` (default `Connected Students`)
- `showDisconnected?: boolean` (default `false`)
- `enableSearch?: boolean` (default `true`)
- `renderRowActions?: (entry: StudentPresenceEntry) => ReactNode`
- `renderRowContent?: (entry: StudentPresenceEntry) => ReactNode`
- `renderBadges?: (entry: StudentPresenceEntry) => ReactNode`
- `getRowClassName?: (entry: StudentPresenceEntry) => string | undefined`
- `getRowStyle?: (entry: StudentPresenceEntry) => React.CSSProperties | undefined`
- `emptyConnectedMessage?: string`
- `emptyAllMessage?: string`

Behavior:

- Default view is connected-only (to match SyncDeck).
- Optional search filter by name/id.
- Sort connected first, then display name.
- Parent can mount custom row content container per student to host command buttons or any arbitrary UI.
- The shared panel exposes an optional instructor-confirmed **Return to waiting room** control. Hosts opt in by supplying the shared action configuration; they do not need to reimplement the request, revocation, socket closure, or student redirect flow.
- Parent can use either entry-level badges or custom badge renderer for status/communication markers.
- Parent can apply per-student style/class overrides while preserving base layout and accessibility semantics.
- Keep panel closed state width transition configurable by host layout.

### Instructor Participant Action: Return to Waiting Room

The first shared row action is a moderation/re-entry flow for an instructor who needs a
student to choose a replacement display name. It is intentionally a shared process rather
than a separate protocol for every activity.

#### Shared process contract

- Add a generic server-side participant-action handler/factory in shared core code. It accepts
  a session id and target participant id, authenticates the request through an activity-provided
  instructor-auth adapter, then performs the common return-to-waiting-room transition.
- The common transition validates that the target is an accepted participant in that exact live
  session; removes its accepted-entry record; revokes every opaque participant token mapped to
  that id; broadcasts a versioned, non-sensitive `participant-returned-to-waiting-room`
  lifecycle event; and closes all matching participant sockets. Client-provided participant or
  display-name values must never be treated as authority.
- Expose a shared client action/controller that renders the explicit `Return to waiting room`
  control, includes the affected student's name in its accessible confirmation text, manages
  pending/disabled and error states, and calls the standard handler route.
- Expose a shared student lifecycle helper that handles the event only when it targets the
  current participant, clears shared transient participant handoff/context state, and routes to
  the normal waiting room for the same session. Activities only wire this helper into their
  existing websocket dispatcher; they do not recreate redirect semantics.
- Activities opt in with a small adapter: their instructor authorization check, standard-route
  registration, presence refresh callback, and any activity-owned participant-state cleanup.
  Activity-specific data such as responses or workspaces is not deleted by the common process
  unless that activity explicitly registers cleanup behavior.
- A reconnect using the revoked participant token must be rejected server-side, so closing a
  socket alone cannot be bypassed by refresh or a second tab.
- Re-entry follows the existing waiting-room validation and creates a fresh opaque participant
  identity/token. The remembered display-name cookie may prefill the form, but it must remain
  editable so the student can replace an inappropriate name.

#### Shared API shape (proposed)

```ts
export interface ReturnParticipantToWaitingRoomAdapter {
  authorizeInstructor(request: Request, session: Session): Promise<boolean>
  onParticipantReturned?(params: { session: Session; participantId: string }): Promise<void>
}

export interface StudentPresenceReturnAction {
  endpoint: string
  sessionId: string
  requestHeaders?: Record<string, string>
}
```

The server factory owns the standard request/response shape and returns typed `401`, `403`,
`404`, and `409` failures. The activity adapter must not receive or trust a display name from
the request; it receives only the loaded server session and validated participant id.

## Migration Strategy

### Phase 1: Shared foundation

- Add shared types + normalization helper under `client/src/components/common/`.
- Add shared toggle + panel components under `client/src/components/common/`.
- Add shared return-to-waiting-room server transition, route factory, client action/controller,
  and student lifecycle helper.
- Add focused unit tests for helper and UI component behavior.

### Phase 2: SyncDeck adoption

- Replace inline student button/list markup in `SyncDeckManager` with shared components.
- Keep SyncDeck websocket parsing and newly-connected side effect logic local.
- Ensure visual behavior parity (count, open/close, empty state, connected-only default).

### Phase 3: Cross-activity proof

- Integrate in one additional manager surface to validate generality.
- Use optional row metadata/actions to confirm flexibility.
- Opt SyncDeck into the shared return-to-waiting-room process, with only its instructor-auth
  adapter and any SyncDeck-specific cleanup remaining local.

### Phase 4: Cleanup and docs

- Remove duplicated student-list UI patterns where replaced.
- Update any manager UI docs/tests referencing old markup.
- Add a short usage snippet in shared component comments or existing docs.

## Testing Plan

- Unit test normalization helper for malformed payloads and fallback count derivation.
- Component tests:
  - toggle button aria and count rendering
  - panel open/close behavior
  - connected-only default filtering
  - search filtering
  - custom row content container rendering
  - instructor action rendering, accessible name/confirmation wiring, and pending/disabled state
  - shared student lifecycle helper clears handoff state and routes only the targeted participant
  - badge rendering (entry-provided and custom renderer)
  - per-row class/style override application
  - empty states
- SyncDeck regression test:
  - connected count displays correctly
  - panel shows connected students only by default
  - existing side-effect trigger on newly connected students still fires
  - an authorized instructor can return a selected participant to the waiting room
  - the removed participant's current and reconnecting sockets cannot continue in the session
  - the student receives the re-entry lifecycle event and can submit a replacement display name
  - unauthorized, missing, and cross-session target requests fail without changing participant state
  - generic core transition revokes every target token, broadcasts the lifecycle event, and closes all target sockets
  - an opt-in activity adapter can reject an instructor request without duplicating common transition logic

## Risks and Mitigations

- Risk: Overfitting to SyncDeck payload shape.
  - Mitigation: Keep normalization helper payload-agnostic and type-safe.
- Risk: Behavior regression in SyncDeck panel UX.
  - Mitigation: Snapshot/component tests around current expected states before migration.
- Risk: Shared process creeps into activity-specific data cleanup.
  - Mitigation: The core transition only revokes entry authorization and connection state; optional activity cleanup is an explicit adapter callback.
- Risk: A client-only "boot" lets a student refresh or reuse a second tab to bypass moderation.
  - Mitigation: Require server-side revocation of accepted-entry identity/token state and enforce it on every reconnect.
- Risk: A generic shared action API obscures authorization boundaries.
  - Mitigation: The shared route factory always delegates instructor authentication to a required activity adapter before any participant state changes.

## Deliverables

- Shared student presence type and normalization helper.
- Shared `StudentPresenceToggleButton` and `StudentPresencePanel` components.
- Shared extension points for parent-provided row content, badges, and per-row style customization.
- Shared return-to-waiting-room server transition, standard route factory, client action/controller, and student lifecycle helper.
- Activity opt-in adapter contract for instructor authorization and optional activity-specific cleanup.
- SyncDeck migrated to shared components.
- Test coverage for shared and SyncDeck integration points.
