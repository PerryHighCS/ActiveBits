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
- Provide a safe, reusable extension point for instructor-authorized participant actions, beginning with returning a student to the waiting room so they can choose a new display name.
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
- Parent-owned row actions may include an instructor-confirmed **Return to waiting room** control. The shared component only renders and exposes the action; the activity owns the authorization, request, lifecycle update, and error handling.
- Parent can use either entry-level badges or custom badge renderer for status/communication markers.
- Parent can apply per-student style/class overrides while preserving base layout and accessibility semantics.
- Keep panel closed state width transition configurable by host layout.

### Instructor Participant Action: Return to Waiting Room

The first reusable row action is a moderation/re-entry flow for an instructor who needs a
student to choose a replacement display name.

- The action must be explicitly labeled (for example, `Return to waiting room`) and identify
  the affected student in its accessible confirmation text.
- The hosting activity supplies the action through `renderRowActions`; the shared component
  must not assume an endpoint, websocket event, or credential format.
- The activity's server endpoint must authenticate instructor authority, validate the target
  participant belongs to that live session, revoke that participant's accepted-entry/token
  state, and close their active session sockets. Client-provided participant or display-name
  values must never be treated as authority.
- The target student's active client receives a dedicated, non-sensitive lifecycle event and
  navigates to the normal waiting room for the same session. A reconnect using the revoked
  participant token must also be rejected server-side, so closing a socket alone cannot be
  bypassed by refresh or a second tab.
- Re-entry follows the existing waiting-room validation and creates a fresh opaque participant
  identity/token. The remembered display-name cookie may prefill the form, but it must remain
  editable so the student can replace an inappropriate name.
- The row action should show a pending/disabled state while the request is in flight, surface a
  host-provided error on failure, and disappear or update once the participant is removed from
  presence state.

## Migration Strategy

### Phase 1: Shared foundation

- Add shared types + normalization helper under `client/src/components/common/`.
- Add shared toggle + panel components under `client/src/components/common/`.
- Add focused unit tests for helper and UI component behavior.

### Phase 2: SyncDeck adoption

- Replace inline student button/list markup in `SyncDeckManager` with shared components.
- Keep SyncDeck websocket parsing and newly-connected side effect logic local.
- Ensure visual behavior parity (count, open/close, empty state, connected-only default).

### Phase 3: Cross-activity proof

- Integrate in one additional manager surface to validate generality.
- Use optional row metadata/actions to confirm flexibility.
- Use the row-action extension point for the return-to-waiting-room flow, including its
  activity-owned authorization and websocket lifecycle handling.

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

## Risks and Mitigations

- Risk: Overfitting to SyncDeck payload shape.
  - Mitigation: Keep normalization helper payload-agnostic and type-safe.
- Risk: Behavior regression in SyncDeck panel UX.
  - Mitigation: Snapshot/component tests around current expected states before migration.
- Risk: Shared component creeps into activity-specific logic.
  - Mitigation: Keep side effects and transport parsing in activity manager code.
- Risk: A client-only "boot" lets a student refresh or reuse a second tab to bypass moderation.
  - Mitigation: Require server-side revocation of accepted-entry identity/token state and enforce it on every reconnect.
- Risk: A generic shared action API obscures authorization boundaries.
  - Mitigation: Limit the shared API to rendering callbacks; each activity owns its authenticated endpoint and protocol.

## Deliverables

- Shared student presence type and normalization helper.
- Shared `StudentPresenceToggleButton` and `StudentPresencePanel` components.
- Shared extension points for parent-provided row content, badges, and per-row style customization.
- Documented activity-owned return-to-waiting-room action contract with server-side revocation and reconnection protection.
- SyncDeck migrated to shared components.
- Test coverage for shared and SyncDeck integration points.
