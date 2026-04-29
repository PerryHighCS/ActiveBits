# Control Authority Plan

## Status: In Progress

This document is the working implementation plan for issue `#245`: replace fragile multi-instructor command races with an explicit server-owned control authority model that activities can opt into.

## Goal

Provide a shared, reusable control-authority framework so activities with manager-driven runtime commands can designate one instructor as authoritative at a time, while still supporting embedded parent/child inheritance and intentional local override when needed.

## Problem Summary

Some activities currently allow multiple instructor surfaces to emit authoritative runtime commands at the same time. In practice this can create feedback loops such as repeated play/pause churn when two instructor views are both trying to drive the same session.

This is already showing up across more than one activity surface:
- SyncDeck manager runtime control
- embedded Video Sync inside a SyncDeck session

The current pattern of local flags, echo suppression, and cooldowns is not a strong enough foundation. The fix should move authority into explicit shared session state enforced by the server.

## Resolved Product Decisions

- [x] First instructor connected to an authority-enabled session becomes the default owner.
- [x] Non-owning instructors should see disabled controls with clear feedback rather than silent failures.
- [x] `scope: 'inherited'` means parent authority is the default for embedded sessions, but an instructor may explicitly take control of the child session and override the inherited owner.
- [x] Activities need a way to decide which manager commands are authority-gated without forcing shared code to understand every activity protocol.
- [x] Ownership uses only stable instructor instance identity; no instructor display name is required.
- [x] There is no explicit release-control action. Any instructor may take control at any time.
- [x] If the current owner disconnects, ownership remains on that instance id until another instructor takes control. There is no auto-release or auto-claim behavior.
- [x] Simultaneous `take-control` attempts resolve as last-write-wins on the server.
- [x] `scope: 'inherited'` without a controlling parent falls back to local session authority.
- [x] Multiple embedded child sessions may each override inherited authority independently on a per-child-session basis.

## Proposed Shared Activity Config

Add a shared optional activity config section:

```ts
controlAuthority: {
  mode: 'single-instructor',
  scope: 'session' | 'inherited',
  gating: 'all' | 'none' | 'activity',
}
```

Interpretation:
- `mode: 'single-instructor'`: the activity uses explicit single-owner control authority
- `scope: 'session'`: the session owns its own authority state
- `scope: 'inherited'`: embedded sessions default to parent authority when a parent authority session exists, but may be locally overridden; without a controlling parent, this falls back to local session authority
- `gating: 'all'`: all manager runtime commands are authority-gated
- `gating: 'none'`: authority state may still exist for inheritance, UI state, or client-side-only coordination, but no shared server-side manager runtime filtering happens
- `gating: 'activity'`: the activity exports a classifier callback used by shared enforcement

Default behavior:
- no `controlAuthority` config means no shared authority enforcement
- `scope: 'inherited'` only inherits when the session is actually embedded under a controlling parent; otherwise the runtime falls back to local session authority

## Activity-Owned Hook

When `gating: 'activity'`, the activity should be able to export a callback from its server/runtime entry that shared enforcement can call:

```ts
export function isAuthorityGatedManagerMessage(message: unknown): boolean
```

Why callback over shared message schema:
- keeps activity protocol ownership inside the activity boundary
- avoids forcing all manager command traffic into one shared wire format before we actually need that
- lets shared code own enforcement while activities own command semantics

## Shared Runtime Model

### Resolved Authority

Shared code should compute runtime authority resolution separate from raw config:

```ts
interface ResolvedControlAuthority {
  configuredScope: 'session' | 'inherited'
  effectiveScope: 'session' | 'inherited'
  authoritySessionId: string
  inheritedFromSessionId: string | null
}
```

This lets the runtime distinguish:
- standalone activity using local session authority
- embedded activity currently following parent authority
- embedded activity that has taken local override

### Session Authority State

Authority-enabled sessions should persist an owner record similar to:

```ts
interface SessionControlAuthorityState {
  mode: 'single-instructor'
  ownerInstanceId: string | null
  ownerTakenAt: number | null
  overrideInherited: boolean
}
```

Notes:
- `ownerInstanceId` should represent a stable instructor browser/tab identity, not a websocket connection id
- first connected instructor auto-claims ownership when no owner exists
- `ownerTakenAt` is display/history metadata only and should not be load-bearing for lifecycle decisions
- inherited authority may be reflected in child status without immediately copying parent ownership into child state unless the child is explicitly overridden
- owner disconnect does not auto-release authority; another instructor may take control explicitly at any time
- on rollout or when normalizing older sessions, an empty authority state should remain valid until the first manager connection auto-claims ownership

### Instructor Identity Persistence

The control owner id should survive normal reloads so an instructor does not silently lose ownership on refresh.

Recommended direction:
- use a durable browser-scoped id stored in `localStorage`
- optionally combine it with a tab-scoped discriminator if the implementation needs distinct instructor identities per tab
- do not rely on `sessionStorage` alone for the owner identity

## UI Direction

Use a shared manager-facing control-authority status component that activities can place in their own UI.

Expected behavior:
- owner sees active status such as `You have control`
- non-owner sees status such as `Another instructor currently has control`
- authority-gated controls render disabled for non-owners
- disabled controls include clear feedback such as `Take control to use playback controls`
- `Take Control` button is available to instructors who do not currently own the effective authority surface
- inherited child sessions can show `Following parent instructor` until locally overridden
- sibling embedded child sessions may each override inherited authority independently

Placement guidance:
- full-width status card or toolbar section for top-level manager views
- compact banner/chip for embedded manager panels

## API / WebSocket Direction

Prefer websocket-first authority updates because this is live session runtime state.

Client identity:
- each instructor manager tab gets a stable `instructorInstanceId`
- persist it with a durable browser id plus a tab-scoped discriminator so normal reloads keep ownership while separate tabs remain distinct

Authority actions:
- client sends `take-control`
- server updates authority state on the resolved authority session
- server broadcasts authority updates to connected manager clients

Representative messages:

```ts
{ type: 'take-control', instructorInstanceId: 'inst_abc123' }
```

```ts
{
  type: 'control-authority-updated',
  payload: {
    mode: 'single-instructor',
    ownerInstanceId: 'inst_abc123',
    ownerTakenAt: 1777459200000,
    authoritySessionId: 'session-123',
    overrideInherited: false,
  }
}
```

Shared enforcement rule:
- if the activity is not authority-enabled, accept commands normally
- if authority is enabled and a manager command is authority-gated, only the effective owner may emit it
- when a non-owner attempts a gated command, server rejects or ignores it and can send explanatory feedback
- if two instructors issue `take-control` at effectively the same time, whichever request is processed last becomes the owner and the resulting authority update is broadcast to all connected instructors

## Implementation Checklist

### 1. Shared config and typing

- [x] Add `controlAuthority` to shared activity config types.
- [x] Add schema validation for `mode`, `scope`, and `gating`.
- [x] Document fallback semantics for `scope: 'inherited'` without a controlling parent.
- [x] Add runtime helpers to resolve effective authority scope and authority session id.

### 2. Shared session model

- [x] Define shared authority session-state shape.
- [ ] Add normalizer support so authority-enabled sessions recover safely after restart.
- [x] Define how embedded child sessions discover parent authority context.
- [x] Define local override semantics for inherited child sessions.
- [x] Define the persisted-empty-state behavior for older in-flight sessions so first manager connect auto-claims ownership intentionally.

### 3. Shared server enforcement

- [x] Add shared instructor instance identity handling for manager websocket/API traffic.
- [ ] Auto-assign first connected instructor as owner when no owner exists.
- [x] Add `take-control` server action and broadcast path.
- [ ] Add generic authority checks before processing manager runtime commands.
- [ ] Wire `gating: 'all' | 'none' | 'activity'` into enforcement.
- [ ] Add activity callback lookup/invocation for `gating: 'activity'`.
- [x] Return explicit non-owner feedback for gated command attempts while keeping the server state unchanged.
- [x] Document that owner disconnect does not auto-release authority and that explicit takeover is the only reassignment path.
- [x] Document last-write-wins behavior for concurrent `take-control` requests.

### 4. Shared client plumbing

- [x] Generate and persist stable `instructorInstanceId` values for manager tabs.
- [x] Subscribe authority-enabled manager views to live authority status updates.
- [x] Expose authority state to activity manager UIs through a shared hook/helper.
- [ ] Provide shared disabled-state helpers and feedback text for gated controls.

### 5. Shared UI primitives

- [ ] Build a reusable control-authority status component.
- [ ] Support at least one compact variant for embedded manager surfaces.
- [ ] Include accessible disabled-state explanations and button labeling.
- [ ] Ensure live authority updates are announced appropriately for assistive tech where needed.

### 6. Activity adoption

- [ ] Add `controlAuthority` config to SyncDeck.
- [ ] Decide SyncDeck gating mode. Current expectation: `gating: 'activity'`.
- [ ] Add `controlAuthority` config to Video Sync.
- [x] Decide Video Sync gating mode. Current expectation: `gating: 'activity'` or `all`, depending on final command surface.
- [ ] Implement activity-owned command classifiers where `gating: 'activity'` is used.
- [x] Ensure embedded Video Sync defaults to inherited authority when launched under SyncDeck.
- [x] Ensure embedded Video Sync can be locally overridden by explicit `Take Control`.
- [x] Enforce Video Sync non-owner command rejection for config and playback command routes.
- [x] Disable Video Sync gated controls locally with explicit takeover feedback.

### 7. Validation

- [x] Add unit tests for config validation and authority resolution helpers.
- [ ] Add server tests for first-instructor auto-ownership.
- [x] Add server tests for `take-control` handoff.
- [x] Add server tests for inherited authority resolution and local child override.
- [x] Add server tests for non-owner gated-command rejection.
- [ ] Add server tests covering older sessions with empty authority state that auto-initialize on first manager connect.
- [x] Add client tests for disabled controls and authority status messaging.
- [ ] Add activity-specific tests for SyncDeck command classification.
- [x] Add activity-specific tests for Video Sync command classification helpers.
- [ ] Add browser-level E2E coverage for two instructor views on the same authority-enabled session: first instructor default owner, second instructor disabled, live takeover, and disabled-state flip after handoff.
- [ ] Add browser-level E2E coverage for embedded inherited authority plus local child override behavior.
- [x] Run scope-appropriate repo validation, likely `npm test`, and include `npm run test:e2e` for the multi-instructor manager and embedded authority scenarios when the harness can support them.

## Current Progress Snapshot

Implemented on this branch so far:
- shared `controlAuthority` activity config shape and schema validation
- shared authority state normalization, ownership helpers, and inherited/session resolution helpers
- durable browser-plus-tab instructor identity generation for manager clients
- Video Sync takeover endpoint and embedded-child local override handling
- Video Sync manager authority status plumbing and `Take Control` UI wiring
- Video Sync protocol/session payload support for `controlAuthority`
- Video Sync server-side owner checks for playback/config commands plus standalone first-owner auto-claim
- Video Sync manager disabled-state enforcement and takeover feedback for non-owners
- Video Sync unsynced-student prune timers now `unref()` so maintenance timers do not keep tests or Node processes alive unnecessarily

Still pending before this feature is complete:
- shared/generic first-instructor auto-ownership support beyond the current Video Sync adoption
- SyncDeck adoption and command classification
- websocket broadcast/update path for authority changes across instructor views
- browser-level E2E coverage for the multi-instructor handoff scenario

## Suggested Rollout Order

1. Land shared config/types/schema support.
2. Land shared authority session model and runtime resolution.
3. Land shared server enforcement with `gating: 'all' | 'none'`.
4. Add activity callback support for `gating: 'activity'`.
5. Land shared client identity/status plumbing and reusable UI.
6. Adopt in Video Sync and SyncDeck.
7. Add embedded inheritance and child override coverage.
8. Validate and update docs/knowledge notes with implementation discoveries.

## Risks To Watch

- Shared code accidentally becoming SyncDeck-specific instead of remaining generic.
- Embedded override semantics becoming confusing if parent and child ownership are not clearly labeled in UI.
- Reconnect behavior causing accidental ownership churn if instance identity is not stable across normal refreshes.
- Activity callback interfaces drifting across activities without a well-defined contract.
- Server/client disagreement about which commands are gated if any activity duplicates logic on both sides.

## Validation Notes

Because this feature changes live runtime coordination and embedded activity behavior, expect both server-level and browser-visible risk. If sandbox limits block full browser verification, keep `npm test` as the minimum merge gate, use `npm run test:codex` if port-binding is the blocker, and record any environment limitation in the implementation notes.
