# Student Join Setup Plan

## Objective

Create a shared student pre-activity setup experience for both entry paths:
- persistent-link entry (current waiting room)
- join-code entry (`/{sessionId}`)

The shared flow should remove duplicated per-activity name prompts while still allowing activities to provide custom setup UI (for example avatar selection) through a standardized export.

## Non-Goals

- Do not change teacher authentication/start semantics for persistent sessions.
- Do not hardcode activity-specific setup logic in shared modules.

## Implementation Checklist

- [x] Align on extensibility direction:
  - Activity can provide a custom student setup component via standardized client export.
- [ ] Add shared activity config contract for student join setup customization:
  - `ActivityConfig.studentJoinSetup?.customComponent?: boolean`.
- [ ] Add shared activity client export contract:
  - `StudentJoinSetupComponent` from activity `client/index.ts` (or `.tsx`).
- [ ] Extend client activity loader and registry typing:
  - Load and expose `StudentJoinSetupComponent` in `ActivityRegistryEntry`.
- [ ] Add contract test coverage for custom component declarations:
  - If `ActivityConfig.studentJoinSetup.customComponent === true`, activity client module must export `StudentJoinSetupComponent`.
  - `npm test` should fail when config/export contract is violated.
- [ ] Add shared student join setup shell strategy:
  - If `customComponent` is `true` and component exists, host activity component in shared shell.
  - Otherwise render shared generic metadata-driven form.
- [ ] Route both entry paths through shared setup shell when activity requires setup:
  - Persistent-link students.
  - Join-code students.
- [ ] Add pre-join payload persistence contract:
  - Capture validated student inputs and persist through session handoff to activity student view.
- [ ] Add source-awareness contract for future authoritative identity flows:
  - Include source metadata (`persistent-link`, `join-code`, `parent-embedded`, `lti`, `google-classroom`, `unknown`) and optional authoritative profile in setup props.
- [ ] Preserve teacher-start flow behavior:
  - Teacher code auth/start remains in shared persistent waiting-room controls.
- [ ] Add regression tests:
  - Custom component render path.
  - Generic fallback path.
  - Existing teacher flow unaffected.
  - Invalid/incomplete setup blocks continue.
- [ ] Pilot in at least one current simple-name activity.
- [ ] Document extended-options activity adoption as a future follow-up once such an activity exists.
- [ ] Update docs and durable knowledge logs after implementation.

## Tentative Interface Definition

Target file: `types/activity.ts`

```ts
import type { ComponentType, LazyExoticComponent, ReactNode } from 'react'

export type StudentJoinSource =
  | 'persistent-link'
  | 'join-code'
  | 'parent-embedded'
  | 'lti'
  | 'google-classroom'
  | 'unknown'

export interface ActivityAuthoritativeStudentProfile {
  name?: string
  [key: string]: unknown
}

export interface ActivityStudentJoinSetupContext {
  activityName: string
  sessionId?: string
  hash?: string
  source: StudentJoinSource
  authoritativeProfile?: ActivityAuthoritativeStudentProfile
}

export interface ActivityStudentJoinSetupProps {
  activityId: string
  context: ActivityStudentJoinSetupContext
  initialValues: Record<string, unknown>
  onChange(values: Record<string, unknown>): void
  onValidityChange(valid: boolean): void
}

export interface ActivityConfig {
  // existing fields...
  studentJoinSetup?: {
    customComponent?: boolean
    required?: boolean
    fields?: Record<
      string,
      {
        label?: string
        type?: 'text' | 'select'
        options?: Array<{ value: string; label: string }>
        validator?: 'name' | 'url'
      }
    >
    authoritative?: {
      name?: {
        lockWhenProvided?: boolean
      }
    }
  }
}

export interface ActivityClientModule {
  // existing fields...
  StudentJoinSetupComponent?: ComponentType<ActivityStudentJoinSetupProps>
}

export interface ActivityRegistryEntry extends ActivityConfig {
  // existing fields...
  StudentJoinSetupComponent?: ActivityRenderableComponent | null
}
```

## Activity Export Shape

Target file: `activities/<activity-id>/client/index.ts(x)`

```ts
import type { ActivityStudentJoinSetupProps } from '../../../types/activity.js'

function MyStudentJoinSetup(_props: ActivityStudentJoinSetupProps) {
  return null
}

export default {
  ManagerComponent,
  StudentComponent,
  StudentJoinSetupComponent: MyStudentJoinSetup,
}
```

## Decision Log

Status key:
- `Proposed`: recommended, pending explicit confirmation.
- `Confirmed`: agreed and ready to implement.

| Date | Decision | Status | Owner | Notes |
| --- | --- | --- | --- | --- |
| 2026-02-27 | Shared student join setup should apply to both persistent-link and join-code entry paths. | Confirmed | Codex + user | Replaces the earlier join-code no-change constraint. |
| 2026-02-27 | Custom activity setup UI is exposed as `StudentJoinSetupComponent` from activity client `index.ts(x)` and hosted by a shared join shell. | Confirmed | Codex + user | Keeps activity customization without shared conditionals. |
| 2026-02-27 | Keep naming as `studentJoinSetup` + `StudentJoinSetupComponent`. | Confirmed | Codex + user | Naming is no longer tied to waiting-room-only behavior. |
| 2026-02-27 | Add `ActivityConfig.studentJoinSetup.customComponent?: boolean` as explicit opt-in capability flag. | Confirmed | Codex + user | Keeps intent explicit and avoids accidental mounting. |
| 2026-02-27 | Include generic metadata under `ActivityConfig.studentJoinSetup` for non-custom flows (`required`, `fields`, `authoritative`). | Confirmed | Codex + user | Shared UI covers common cases; custom component reserved for extended UX/styling. |
| 2026-02-27 | Shared parent owns route/navigation submit gating; setup component reports `onChange` + `onValidityChange` only (no custom `onSubmit` hook). | Confirmed | Codex + user | Single owner for flow control and simpler testability. |
| 2026-02-27 | Initial handoff storage path is browser `sessionStorage` keyed by runtime session id, no server contract change required for phase 1. | Proposed | Codex | Lowest-risk path for first rollout. |
| 2026-02-27 | Set client handoff TTL to 2 hours. | Confirmed | Codex + user | Covers longer class sessions while remaining bounded. |
| 2026-02-27 | Include `parent-embedded` as a first-class join source where student identity is inherited from parent activity session context (initial producer expected: SyncDeck). | Confirmed | Codex + user | Keeps the contract activity-agnostic while supporting embedded-activity roadmap. |

## Data Contract (Proposed)

### Student Join Profile Payload

```ts
export type StudentJoinProfileSource =
  | 'persistent-link'
  | 'join-code'
  | 'parent-embedded'
  | 'lti'
  | 'google-classroom'
  | 'unknown'

export interface StudentJoinProfilePayload {
  version: 1
  source: StudentJoinProfileSource
  activityId: string
  sessionId: string
  persistentHash?: string
  values: Record<string, unknown>
  authoritativeProfile?: {
    name?: string
    [key: string]: unknown
  }
  createdAtMs: number
}
```

### Client Storage and TTL

- Storage target (phase 1): `window.sessionStorage`
- Key format: `student-join-profile:<sessionId>`
- Write time:
  - join-code flow: before rendering activity student view
  - persistent flow: when session starts and student continues
- Read time: activity student bootstrap before showing internal name/avatar prompt
- TTL policy: 2 hours, with lazy cleanup on read
- Removal policy: delete on successful consume, or when expired

## Flow Matrix

| Flow | Setup UI | Data Source | Expected Prompt Behavior |
| --- | --- | --- | --- |
| Persistent link student join | Shared generic form or activity custom component | Join setup values (+ optional authoritative profile later) | Activity can prefill/skip internal prompt if payload is sufficient. |
| Persistent link teacher join | No student setup required | Teacher code auth | Existing teacher auth/start flow unchanged. |
| Join code student join (`/{sessionId}`) | Shared generic form or activity custom component when required | Join setup values | Replaces duplicated name/avatar prompts in migrated activities. |
| Embedded activity launched from parent activity (future) | Shared shell; typically prefilled from parent session identity | Authoritative parent activity student identity + optional extra fields | Name should be inherited by default; activity can still request additional fields if required. |
| Future LTI/Classroom student join | Shared shell; activity custom setup if enabled | Authoritative identity + extra fields | Authoritative name may prefill/lock; extra fields still collected. |

## Validation and Ownership Boundaries

- Shared join shell owns:
  - route/navigation lifecycle
  - submit gating (`Continue` disabled until valid)
  - baseline safety checks (payload shape, TTL, sanitize pass)
- Activity setup component owns:
  - activity-specific field rendering (avatar, team, role, etc.)
  - activity-specific validation rules
  - reporting validity via `onValidityChange`
  - reporting canonical values via `onChange`
- Activity student view owns:
  - deciding whether setup payload is sufficient to skip internal prompt
  - fallback prompt when payload missing/invalid/stale

## API / WebSocket Impact

Phase 1 target:
- No new server endpoints required.
- No required persistent-session REST schema changes.
- No required websocket protocol changes.

Optional phase 2 candidates (only if needed):
- Server bootstrap endpoint for authoritative identity hydration before setup render.
- WS metadata update message if identity can arrive asynchronously.

## Failure Modes and Handling

- Custom component configured but missing export:
  - Fallback to shared generic form.
  - Log non-fatal warning in client console.
- Invalid setup payload on consume:
  - Ignore payload, clear storage key, activity shows fallback prompt.
- Session start or join refresh with incomplete setup:
  - Shared setup shell still blocks continue until valid.
- WebSocket disconnect/reconnect in persistent flow:
  - Existing waiting-room reconnect behavior preserved.

## Security and Privacy Notes

- Treat student name/avatar as non-secret PII:
  - do not include in server logs by default
  - do not include in URL query params for handoff
- Use `sessionStorage` (tab-scoped) rather than `localStorage` for setup payload handoff.
- Never persist teacher codes in student setup payload.
- Keep payload minimal: only fields needed to bootstrap student identity/options.

## Test Matrix

Client unit/integration targets:
- `client/src/activities/index.test.ts`
  - loader exposes `StudentJoinSetupComponent` correctly.
  - contract assertion: activities declaring `studentJoinSetup.customComponent: true` must export `StudentJoinSetupComponent`.
- shared join shell tests (new component)
  - custom component render path when enabled.
  - generic fallback when missing/disabled.
  - continue disabled until validity true.
- `client/src/components/common/SessionRouter.tsx` tests
  - persistent flow still honors teacher start/auth behavior.
  - join-code flow routes into setup shell when activity requires setup.
- Activity student tests (pilot activities)
  - consumes valid setup payload and skips redundant prompt.
  - falls back to prompt when payload invalid/missing.

Server tests:
- None required for phase 1 (explicitly out of scope).

## Rollout Plan

- Phase A: Add shared contracts and generic join shell behind activity opt-in.
- Phase B: Integrate persistent-link student path with shared shell.
- Phase C: Integrate join-code student path with shared shell.
- Phase D: Pilot migration of one current simple-name activity.
- Phase E: Capture future follow-up for an extended-options activity once one exists.
- Phase F: Define authoritative-source integration for `parent-embedded` child activities (parent identity handoff contract; initial producer expected: SyncDeck).
- Phase G: Evaluate authoritative-source needs (LTI/Classroom) and decide on server bootstrap requirements.

Success criteria:
- Duplicated per-activity name prompt logic is reduced for migrated activities.
- Persistent teacher auth/start flow has no regressions.
- At least one current activity uses shared student join setup successfully.
- Custom `StudentJoinSetupComponent` adoption is tracked as future work when an extended-options activity is available.

## Documentation and Knowledge Updates Checklist

- [ ] Update `ARCHITECTURE.md` with shared student-join setup extension point and boundaries.
- [ ] Update `README.md` activity extension docs for new setup export contract.
- [ ] Update `ADDING_ACTIVITIES.md` with `StudentJoinSetupComponent` example.
- [ ] Add contract note to `.agent/knowledge/data-contracts.md`.
- [ ] Add discovery note to `.agent/knowledge/repo_discoveries.md`.

## Items to Confirm Next

- None currently.
