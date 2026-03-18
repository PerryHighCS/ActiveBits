# SyncDeck Embedded Activities Plan

## Status: Design / Pre-Implementation

This document is the primary design reference for SyncDeck embedded activities.
Companion checklist items live in `syncdeck-checklist.md` under "Embedded activities".

---

## Problem Statement

Instructors want to embed live ActiveBits activities (polls, practice sets, raffles, etc.)
directly into a SyncDeck presentation so that the activity launches in-context mid-lecture
without students navigating away or the instructor losing control of the deck.

Key design questions that must be resolved before implementation:

1. **Where does the activity iframe live?** (nested inside deck iframe vs. host-overlaid)
2. **How does the instructor move off the activity back to the presentation?**
3. **How are students pulled into the child session atomically?**
4. **How is multi-instructor arbitration handled to prevent duplicate child sessions?**
5. **How many child sessions can be active concurrently?** (see "Multiple Concurrent Child Sessions" below)

---

## Decision: Host-Overlay Architecture

### Options considered

| Option | Description | Problems |
|---|---|---|
| A – Nested | Activity iframe inside the presentation iframe | Two-hop postMessage relay; 3rd-party deck origin controls lifecycle; deck JS must be modified; no direct access to ActiveBits WebSocket/session from inside deck |
| B – Host overlay | Activity iframe rendered by the SyncDeck host page (ActiveBits), absolutely positioned over the presentation iframe | Host already owns header, WebSocket, and session; single postMessage boundary; "End Activity" lives in the always-visible header |
| C – Sibling layout | Activity and presentation iframes side by side | Requires layout changes to both manager and student shells; presentation content is partially hidden; more disruptive for students |

**Chosen: Option B (host overlay).**

### Why host overlay wins

- The ActiveBits host page already manages the presentation iframe via `postMessage`.
  Adding an activity iframe at the same host-page level keeps the architecture symmetric.
- The SyncDeck header is rendered by the host page and is always visible above both iframes.
  "End Activity" can live there with guaranteed accessibility — no deck cooperation needed.
- The child activity session uses the normal ActiveBits session system
  (WebSocket, session API, `useResilientWebSocket`), so the activity code itself requires
  no embedded-mode awareness beyond receiving a `sessionId`.
- The completed waiting-room expansion already provides shared entry-status and
  entry-participant handoff paths. Embedded child entry should build on those
  contracts instead of introducing a separate child-session join protocol.
- The presentation iframe stays mounted underneath the activity overlay, so dismissal is
  instant (no reload needed when the instructor moves off).
- Origin isolation is trivially correct: host page talks to its own origin for the child
  session; no cross-origin parent/child iframe relay is required.

---

## Layering Model

### Navigation while an overlay is active

When the activity iframe covers the presentation, two things break:

1. **Cross-origin keyboard isolation**: key events inside the activity iframe do not
   propagate to the parent page and cannot reach the presentation iframe. There is no
   forwarding path.
2. **Deck-native controls are covered**: clicks on deck navigation elements (arrows,
   storyboard, etc.) are blocked by the activity iframe on top.

The existing SyncDeck model — "navigation uses presentation-native controls inside the deck"
— does not apply when the deck is overlaid. The host must provide its own navigation
affordances, rendered as floating host-page elements above the activity iframe.

These controls post `prev` / `next` / `slide` / `up` / `down` commands to the presentation
iframe via the existing `reveal-sync` command channel — the same mechanism SyncDeck already
uses for `setState`, `setRole`, etc. The presentation iframe's boundary enforcement and
navigation policy remain in effect regardless of whether the command originates from a
key press inside the iframe or a host-rendered button.

For students, the `canGoBack` / `canGoForward` / `canGoUp` / `canGoDown` fields in the
`reveal-sync` `state` / `ready` payloads (already tracked in `SyncDeckStudent`) drive
which navigation controls are enabled. No new state source is needed.

### Manager view (instructor)

```
┌─────────────────────────────────────────────────────────┐
│  SyncDeck Header  [sync] [chalk] [Activities panel ▾]   │  host page  z:30
├─────────────────────────────────────────────────────────┤
│                                                         │
│   ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  │
│     Presentation iframe (stays mounted, dimmed)         │           z:1
│   └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘  │
│   ┌─────────────────────────────────────────────────┐   │
│   │  Activity iframe (ManagerComponent)             │   │           z:10
│   └─────────────────────────────────────────────────┘   │
│  [◄] [▲]                                       [▼] [►]  │  host page  z:20
└─────────────────────────────────────────────────────────┘
```

- Host-rendered navigation chevrons float at the edges of the activity iframe at z:20,
  above the activity but below the header.
- Manager gets free h and v navigation (no boundary restrictions); all four chevrons are
  always enabled.
- The active manager overlay shows the `ManagerComponent` for the instance anchored to the
  instructor's current slide position (same position-based selection as student overlays).
  The running-activities panel lists all instances for end-control regardless of position.
- Chevrons send `prev` / `next` / navigation `slide` commands to the presentation iframe.
- The presentation iframe stays mounted underneath (pointer-events: none) for instant
  return once the overlay is removed.

### Student view

```
┌─────────────────────────────────────────────────────────┐
│   Presentation iframe (full viewport, dimmed)           │           z:1
│   ┌─────────────────────────────────────────────────┐   │
│   │  Activity iframe (StudentComponent)             │   │           z:10
│   └─────────────────────────────────────────────────┘   │
│  [◄] [▲]                                       [▼] [►]  │  host page  z:20
└─────────────────────────────────────────────────────────┘
```

- Same host-rendered navigation chevrons, but driven by `canGo*` capabilities from the
  presentation iframe's `state` payloads (already tracked in `SyncDeckStudent`).
- A student navigating off the current slide (h or v) may change which overlay is visible
  or remove the overlay entirely — this is intentional and expected.
- Chevrons that are not permitted (boundary lock, no further slides) are rendered
  `disabled` and `aria-disabled="true"`.
- No header chrome on the student view otherwise.

---

## Student Sync Context

The host page already knows, at all times:
- The student's current slide position (`h`, `v`, `f`) from the presentation iframe's `state` messages.
- The instructor's current slide position from the SyncDeck WebSocket state.
- Whether an instructor is present at all (solo session vs. managed session).

This gives the host a **sync state** for the student at any moment:

| Sync state | Condition |
|---|---|
| `solo` | No instructor present (solo session or persistent link without teacher) |
| `synchronized` | Student's `h` matches instructor's `h` (and `v` within normal stack tolerance) |
| `behind` | Student's `h` < instructor's `h` |
| `ahead` | Student's `h` > instructor's `h` (released boundary) |
| `vertical` | Student's `h` matches instructor's but `v` diverges (student-choice stack) |

Activities may need to respond differently to these states. A synchronized-video activity
needs to know where to seek. A quiz activity might mark late submissions differently.
A raffle is indifferent. The host communicates sync context to each mounted activity
iframe via postMessage, using a standard envelope — activities consume it or ignore it.

### Sync context postMessage (host → activity iframe)

Sent once after the activity iframe is mounted and ready, and re-sent whenever the
student's sync state changes while the iframe is visible.

```json
{
  "type": "activebits-embedded",
  "action": "syncContext",
  "payload": {
    "syncState": "synchronized",
    "studentIndices": { "h": 5, "v": 0, "f": -1 },
    "instructorIndices": { "h": 5, "v": 0, "f": 2 },
    "role": "student"
  }
}
```

- `syncState`: one of `solo | synchronized | behind | ahead | vertical`
- `studentIndices`: the student's current position in the deck
- `instructorIndices`: the instructor's last-known position (`null` in solo mode)
- `role`: always `student` for student iframes; `instructor` for manager iframes

The `activebits-embedded` type is distinct from `reveal-sync` to avoid collision with
deck postMessage traffic. Activities that do not care about sync context ignore the message.

This is a **one-way host→iframe notification only**. Activities do not reply to it.
No SyncDeck-specific handling is required inside activity code — activities simply
check the `syncState` value if relevant to their behavior.

### Solo mode: separate activation path

When the student is in `solo` sync state (no instructor), slide-triggered activities
cannot use the managed child-session handoff flow — there is no instructor to have started
the child session, and no parent-managed child entry to inherit.

Solo activation path:
1. Student enters a slide with embedded activity metadata.
2. The SyncDeck host detects `syncState === 'solo'`.
3. Instead of waiting for `embedded-activity-start` from the server, the host:
  a. Checks the activity's existing `standaloneEntry` contract.
  b. If `standaloneEntry.enabled === true` and `supportsDirectPath === true`: mounts the
    activity iframe at the direct standalone URL (`/solo/{activityId}`), passing no
    embedded entry token. The activity initializes exactly as it would from the join page.
  c. If standalone support exists only through permalink or other activity-specific entry
    surfaces, defer automatic slide-triggered solo launch until that launcher contract is
    defined; for now show an informational message rather than inventing a SyncDeck-only
    `soloMode` flag.
  d. If standalone entry is not supported: shows an informational message
    ("This activity requires a live session").
4. Solo activity iframes are local to the student browser and create no server child session.
5. The host sends `syncContext` with `syncState: 'solo'` after mount.

Solo activity state is local (no cross-student session), so there is no `embedded-activity-start`
broadcast and no embedded entry-token flow.

---

## Activation Triggers

Activities can be launched two ways in managed sessions:

### A. Slide-event trigger (presentation-driven)

1. A slide in the reveal.js deck includes embedded activity metadata in its
   data attributes or speaker notes, read by the `reveal-iframe-sync` plugin.
2. When the instructor navigates to that slide, the plugin emits a new upward
   `postMessage` to the SyncDeck host:
   ```json
   {
     "type": "reveal-sync",
     "action": "activityRequest",
     "source": "reveal-iframe-sync",
     "payload": {
       "activityId": "raffle",
       "activityOptions": {},
       "trigger": "slide-enter"
     }
   }
   ```
3. The SyncDeck manager host receives this and shows an instructor prompt:
   **"Launch [Activity Name]?"** — instructor must confirm to prevent accidental launches.

### B. Manual trigger (manager header)

The SyncDeck header gains an "Activities" button that opens an activity-picker panel.
Instructor selects an activity, configures options, and clicks Launch.
This path does not require any deck modification.

Both paths converge on the same child-session creation and broadcast flow.

In solo mode, slide-event triggers use the solo activation path described above — no
instructor prompt, no child session.

---

## Multiple Concurrent Child Sessions

### Decision: no limit on concurrent child sessions

The one-at-a-time restriction was dropped. Multiple child sessions must be able to run
concurrently for two concrete reasons:

1. **Synchronized video** is effectively a persistent, always-running child session for
   the duration of a slide or the entire presentation. It should not block a poll, raffle,
   or practice set from launching on a different slide simultaneously.

2. **Student-choice vertical stacks** mean different students can be on different `v`
   positions at the same time, each with its own embedded activity. The host has no
   single "current slide" that all students share — the activity a student sees must be
   determined by their own slide position, not the instructor's.

The arbitration model changes accordingly: duplicate prevention is **per activity instance**,
not global. A second instructor cannot create a second child session for the *same* slide
and activity, but they can start a new child session for a different slide.

---

## Child Session Lifecycle

### Session ID shape

```
CHILD:{parentSessionId}:{childSessionId}:{activityId}
```

- `parentSessionId` links culling: server does not cull a child until its parent is culled.
- `childSessionId` is a normal session ID for all other purposes (API, WebSocket URL, etc.).
- `activityId` is the trailing readable label (see session ID ordering rationale above).

### Instance key

Each child session is identified for deduplication and overlay routing purposes by an
**instance key** — a stable, slide-addressable identifier that the deck or instructor
supplies when requesting a child session:

```
{activityId}:{h}:{v}
```

Examples:
- `synced-video:3:1` — a synchronized video anchored to slide (h=3, v=1)
- `raffle:5:0` — a raffle anchored to slide (h=5, v=0)
- `raffle:global` — a raffle not tied to any specific slide (manual trigger, no position)

The server stores active child sessions as a map `instanceKey → childSessionRecord` in
parent session data. This map is the source of truth for which activities are currently
running and which child session ID corresponds to each instance.

### Server constraints

- A parent session may have **N concurrent child sessions** (no hard limit for now; revisit
  if session memory or WebSocket fan-out becomes a concern).
- A given `instanceKey` may have at most one active child session. Requesting start for
  an `instanceKey` that already exists returns the existing `childSessionId` rather than
  creating a duplicate.
- Child sessions use the same TTL mechanism as normal sessions but their TTL heartbeat
  is driven by the parent's activity, not by child WebSocket traffic alone.
- When the parent session is culled or ended, **all** child sessions are culled immediately
  (server broadcasts `session-ended` to each child's connections).
- Child sessions are NOT visible in the manage dashboard session list.

---

## Embedded Entry / Handoff Flow

Students are already connected to the parent SyncDeck session by WebSocket.
The waiting-room expansion already established two reusable entry seams:

- server-backed `entryParticipantToken` handoff for child session entry
- accepted-entry / server-issued participant identity for activities that opt into it

Embedded child entry should reuse those seams so students do not re-enter teacher codes,
and so child activities still flow through the normal entry gateway when they require
additional waiting-room fields.

### Finalized rule: pass-through vs waiting-room UI

For embedded child launch, keep one gateway path but branch presentation mode by the
existing shared entry contract:

- If `entryOutcome === 'join-live'` and `waitingRoomFieldCount === 0`, child launch is
  immediate pass-through (no waiting-room pause in the overlay).
- If `waitingRoomFieldCount > 0` or `entryOutcome === 'wait'`, render the shared
  waiting-room UI in the overlay.

This preserves fast launch for activities that need no extra preflight fields while still
allowing child activities with required waiting-room fields to collect inputs through the
same shared system.

### Finalized rule: instructor control for synchronous activities

Pass-through does not imply student autonomy. Activities that require synchronized
instructor control must still start in instructor-gated mode after entry:

- Student can enter the child session immediately when pass-through applies.
- Runtime interaction remains controlled by instructor-owned state transitions
  (for example: paused/locked until instructor starts).
- SyncDeck host navigation/boundary controls remain authoritative for deck progression
  while overlays are active.

This keeps waiting-room latency low without weakening synchronous classroom control.

### Finalized contract: activity capability shape

Use an explicit activity-level capability in `ActivityConfig`:

```ts
embeddedRuntime?: {
  instructorGated?: 'runtime' | 'waiting-room'
}
```

Contract semantics:

- Default when omitted: no gating — child passes through and activity starts immediately.
- `instructorGated: 'runtime'`: pass-through entry (no waiting-room UI pause), but student
  lands in an instructor-owned held state *inside* the activity. Interaction is blocked until
  the instructor explicitly starts or releases (e.g. presses play in Video Sync).
- `instructorGated: 'waiting-room'`: always force-show the waiting-room hold UI in the
  overlay, even when `waitingRoomFieldCount === 0`. Students are held at the waiting-room
  gate until the instructor releases them from there — the original SyncDeck hold-at-door
  behaviour.

The two modes are distinct and non-exclusive in purpose — `'runtime'` gates *inside* the
activity after entry; `'waiting-room'` gates *before* entry. Video Sync uses `'runtime'`.

Implementation notes:

- This field lives in `types/activity.ts` and is validated by `types/activityConfigSchema.ts`.
- Keep the field generic and activity-agnostic; no activity-specific conditionals in shared
  modules.
- Activities opt in by setting `embeddedRuntime.instructorGated` in their own
  `activity.config.ts`.

### Proposed flow

1. Instructor confirms activity launch.
2. Manager client sends `POST /api/syncdeck/{parentSessionId}/embedded-activity/start`
   with `{ activityId, activityOptions }`.
3. Server:
   a. Creates child session (`POST /api/{activityId}/create` internally).
   b. Adds entry to `session.data.embeddedActivities[instanceKey]`.
  c. Snapshots current parent-session identity for each connected student from the
    existing SyncDeck roster (`studentId`, `studentName`) and uses the shared
    waiting-room handoff store to mint a short-lived `entryParticipantToken` for
    the child session.
  d. Broadcasts to the parent session WebSocket (per-student, each with their own token):
      ```json
      {
        "type": "embedded-activity-start",
        "payload": {
          "instanceKey": "raffle:5:0",
          "activityId": "raffle",
          "childSessionId": "CHILD:...",
       "entryParticipantToken": "abc123"
        }
      }
      ```
    The instructor receives `entryParticipantToken: null` because manager launch uses
    parent teacher-context validation, not student handoff.
4. Student client receives the broadcast → adds entry to local `embeddedActivities` map →
   evaluates overlay visibility for their current slide position.
  If visible, renders the normal child session route and passes the handoff token through
  the same storage/query path used by the shared waiting-room code.
5. The child session uses the existing waiting-room gateway:
  a. `GET /api/session/{childSessionId}/entry` resolves whether the child can pass through
    or must render waiting-room UI in the overlay.
  b. When `entryOutcome === 'join-live'` and `waitingRoomFieldCount === 0`, the existing
    handoff consume path redeems the
    `entryParticipantToken` and the activity proceeds as a normal child session.
  c. If the child activity declares additional waiting-room fields not satisfied by the
    inherited parent context, the shared waiting-room UI renders inside the overlay and
    can prefill inherited values such as `displayName` when appropriate.
  d. For synchronous child activities, immediate pass-through still lands in
    instructor-gated runtime state (students connected, but control stays instructor-owned
    until explicit start/release).
6. New students who join the parent session after the activity starts receive the full
   `session.data.embeddedActivities` map in the initial session snapshot and hydrate
  their local map immediately — embedded entry tokens for late joiners are issued on demand
  through a parent-context-validated SyncDeck route rather than by reusing the original
  startup token (see open question 3).

---

## Multi-Instructor Arbitration

Duplicate prevention is **per instance key**, not global.

### Rules

- The server's `instanceKey → childSessionRecord` map includes an `owner` field
  (the connection ID of the instructor who called start for that instance).
- If a second instructor calls start for the **same `instanceKey`**, the server returns
  `409 Conflict` with `{ alreadyStarted: true, instanceKey, childSessionId }`.
  The second instructor's UI shows "Activity already running — join as co-instructor?" option.
- A second instructor calling start for a **different `instanceKey`** succeeds normally —
  this is a new activity instance, not a duplicate.
- If the owning instructor disconnects, ownership of that instance is released so any
  remaining instructor can end it.
- Any instructor can end any running instance; the end endpoint takes `instanceKey` as a
  parameter so multi-activity sessions can be individually dismissed.
- The "End Activity" call becomes `POST /api/syncdeck/{parentSessionId}/embedded-activity/end`
  with body `{ instanceKey, instructorPasscode }`.

---

## Instructor "Move Off" Flow (End Activity)

With multiple concurrent child sessions, "move off" means ending one specific instance,
not all running activities.

1. Instructor clicks the **end control for a specific activity** in the running-activities
   panel in the SyncDeck header (see "Changes to SyncDeck Header" below).
   - Each running activity has its own inline end control.
   - A brief inline confirmation prevents accidents.
2. Manager client calls `POST /api/syncdeck/{parentSessionId}/embedded-activity/end`
   with `{ instanceKey, instructorPasscode }`.
3. Server ends the child session for that `instanceKey`, removes the entry from the
   instance map, broadcasts `embedded-activity-end` with the `instanceKey`.
4. Manager host: removes the overlay for that `instanceKey`.
   If no child sessions remain, the presentation returns to full-focus mode.
5. Student hosts: receive `embedded-activity-end` with `instanceKey` → remove the
   matching overlay. If the student's current slide no longer has a running activity,
   the presentation is immediately visible again.

The presentation iframe never needs to reload.

---

## Protocol Additions

### New `reveal-iframe-sync` upward action: `activityRequest`

Added to the message schema doc. Emitted by the plugin when a slide's metadata
specifies an embedded activity and the slide is entered (or advanced to).

```json
{
  "type": "reveal-sync",
  "action": "activityRequest",
  "source": "reveal-iframe-sync",
  "version": "2.x.x",
  "payload": {
    "activityId": "raffle",
    "activityOptions": {},
    "trigger": "slide-enter"
  }
}
```

### New `reveal-iframe-sync` downward commands (optional, for deck awareness)

- `activityStarted` — host notifies deck that an activity is live
  (deck can dim itself, show an indicator, pause timers, etc.)
- `activityEnded` — host notifies deck that the activity is over
  (deck can restore normal state)

These are optional for the deck to handle; the host does not depend on a deck response.

### WebSocket connection model

Each embedded activity has its **own independent WebSocket connection**, separate from the
parent SyncDeck WebSocket. There is no relay between them.

```
Browser (student)
├── WS → /ws/syncdeck?sessionId={parentId}       ← deck sync, lifecycle signals
├── WS → /ws/raffle?sessionId={childId-raffle}   ← activity-specific data (when active)
└── WS → /ws/synced-video?sessionId={childId-v}  ← activity-specific data (when active)
```

This falls out naturally from the host-overlay architecture: the activity iframe loads as a
normal ActiveBits session, and the activity component sets up its own `useResilientWebSocket`
exactly as it would in a standalone session. The activity code has zero embedded-mode
awareness. When an activity iframe unmounts (activity ended), its WebSocket connections
are cleaned up automatically.

The SyncDeck server never sees or relays activity-specific messages. It only handles the
lifecycle coordination signals (`embedded-activity-start` / `embedded-activity-end`) over the
parent WebSocket. This is what keeps the Activity Containment Policy intact.

**Connection count:** a student on a slide with a synced-video and a simultaneously running
raffle holds 3 WebSocket connections (parent SyncDeck + video child + raffle child). This is
well within browser limits and typical for real-time apps. For slides with no active activity,
students hold only the single parent SyncDeck connection.

### New SyncDeck WebSocket message types

These travel over the **parent SyncDeck WebSocket only**. All messages include `instanceKey`
so clients can route to the correct overlay.

| Message type | Direction | Description |
|---|---|---|
| `embedded-activity-start` | server → clients | Announces a new child session; includes `instanceKey`, `activityId`, `childSessionId`, and per-student `entryParticipantToken` when immediately available |
| `embedded-activity-end` | server → clients | One instance ended; clients remove the overlay matching `instanceKey` |

Late-joining students receive the full `embeddedActivities` map in the initial session state
snapshot — one entry per currently running instance — and render overlays immediately.
Their activity-specific WebSocket connections are established by the activity iframes once mounted.

---

## Changes to SyncDeck Header

The manager header needs:

1. **Running-activities panel** — replaces the single "End Activity" button.
   Appears when one or more child sessions are active. Shows a compact list of running
   instances, each with its activity name and an individual end control.
   - Each end control: `aria-label="End {activityName}"`, inline confirmation before calling end.
   - If only one instance is running the panel can be condensed to a single-line chip.
   - The panel must not block access to other header controls (sync toggle, chalkboard, etc.).
   - Lists all instances regardless of the instructor's current slide position; navigating
     to an activity's anchored slide is how the instructor accesses its manager view.

2. **"Activities" button** (manual trigger path) — opens a slide-in picker panel.
   Lower priority than slide-event trigger; can be deferred to Phase 5.

3. **Per-instance status** — each running entry shows the activity name and a student
   join count sourced from the child session. Shares `ConnectionStatusDot` styling.

4. **Host-rendered navigation chevrons** — floating h/v navigation controls rendered by
   the host page at `z-index: 20` when an activity overlay is active.
   - Always enabled for the manager (no boundary restrictions).
   - Send `prev` / `next` / directional `slide` commands to the presentation iframe.
   - Required because deck-native keyboard navigation is inaccessible while the activity
     iframe has keyboard focus, and cross-origin key events cannot propagate to the parent.
   - Must have accessible names: `aria-label="Previous slide"`, `"Next slide"`, etc.
   - Chevrons are hidden when no activity overlay is active (deck-native controls resume).

---

## Changes to Student Shell

The student shell (`SyncDeckStudent.tsx`) needs:

1. State: `embeddedActivities: Map<instanceKey, { childSessionId, activityId, entryParticipantToken? }>`
2. On `embedded-activity-start`: add entry to the map → evaluate which overlay to show.
3. On `embedded-activity-end`: remove entry from the map by `instanceKey` → re-evaluate.
4. On initial session fetch: if `session.data.embeddedActivities` is populated, hydrate
   the map immediately (handles late-joining students).

### Overlay selection in student-choice stacks

Because students can be on different vertical slides simultaneously, the student host must
decide which overlay (if any) to show based on the **student's own current slide position**,
not the instructor's.

Mapping rule:
- An instance with a slide-anchored key (`{activityId}:{h}:{v}`) is shown when the
  student's current `h` and `v` match the instance's anchored position.
- An instance with key `{activityId}:global` is shown regardless of the student's position.
- If the student is on a slide with no matching running instance, no overlay is shown and
  the presentation is unobstructed.

The student's current slide position comes from the `reveal-sync` `state` messages already
being tracked in `SyncDeckStudent` — no new state source is needed.

### Overlay rendering

- Each visible overlay is an absolutely-positioned iframe over the presentation container.
- `position: absolute; inset: var(--embedded-overlay-gutter, 64px); z-index: 10`.
- Use responsive gutters so navigation controls always have breathing room
  (recommended: desktop `64px`, tablet `48px`, mobile `40px`).
- At most one overlay is visible at a time per the selection rule above (the map may have
  multiple entries, but only the matching one is rendered visible).

### Navigation controls while overlaid

- When any activity overlay is visible, the student host renders host-page navigation
  chevrons at `z-index: 20` (above the activity iframe).
- Enabled state is derived from the last `canGoBack` / `canGoForward` / `canGoUp` /
  `canGoDown` values received from the presentation iframe's `state` / `ready` payloads
  — the same values already tracked in `SyncDeckStudent` for other purposes.
- Clicking a chevron posts the appropriate `prev` / `next` / `slide` command to the
  presentation iframe via `postMessage`.
- A student navigating to a slide with a different (or no) matching activity instance
  causes the overlay selection to re-evaluate immediately on the next `state` message
  from the presentation iframe.
- Disabled chevrons must have `disabled` and `aria-disabled="true"` set.
  Arrow controls must have accessible names (`aria-label="Previous slide"`, etc.).

### Sync context delivery

- After mounting any activity iframe (managed or solo), the student host computes the
  current sync state and sends an `activebits-embedded` / `syncContext` postMessage.
- The host re-sends whenever the student's slide position or instructor's position changes
  while the activity iframe is visible.
- For solo overlays the sync state is always `solo`; `instructorIndices` is `null`.
- For managed overlays the sync state is derived from the student's vs. instructor's
  current indices at the time of each delivery.

### Solo activity overlays

- When `syncState === 'solo'` and the student enters a slide with activity metadata:
  - Host checks `activityConfig.standaloneEntry`.
  - If direct standalone entry is supported: mounts the activity iframe at the standalone
    session URL; no embedded entry token; no child session created on the server.
  - If standalone entry is unsupported or only available through permalink semantics that
    do not yet have an embedded launcher contract: shows a static "This activity requires a
    live session" notice in place of an overlay.
- Solo activity iframes are independent of the `embeddedActivities` server map.
  The student host tracks them in a separate local-only `soloOverlays` map keyed by
  `instanceKey`, so they can be mounted/unmounted on slide navigation without server
  coordination.

---

## Changes to Server Routes

New endpoints under `activities/syncdeck/server/routes.ts`:

```
POST /api/syncdeck/:sessionId/embedded-activity/start
  Body: { activityId, activityOptions, instanceKey, instructorPasscode }
  - If instanceKey already active: returns existing { childSessionId } (idempotent, no 409 for same caller)
  - If instanceKey already active with different owner: returns 409 { alreadyStarted, childSessionId }
  - Otherwise: creates child session, adds entry to embeddedActivities map,
    broadcasts embedded-activity-start with instanceKey.
  Returns: { childSessionId, instanceKey }

POST /api/syncdeck/:sessionId/embedded-activity/end
  Body: { instanceKey, instructorPasscode }
  Ends child session for instanceKey, removes from embeddedActivities map,
  broadcasts embedded-activity-end with instanceKey.

POST /api/syncdeck/:sessionId/embedded-activity/entry
  Body: { instanceKey, childSessionId?, studentId? }
  Validates parent identity using the existing SyncDeck embedded-context rules and issues
  a fresh child `entryParticipantToken` for late joiners/reconnects.

Child-session entry then reuses the existing shared routes:
- `GET /api/session/:childSessionId/entry`
- `POST /api/session/:childSessionId/entry-participant/consume`
```

Session state shape change:
```
// Before
session.data.embeddedActivity: { childSessionId, activityId } | null

// After
session.data.embeddedActivities: Record<instanceKey, {
  childSessionId: string,
  activityId: string,
  startedAt: number,
  owner: string, // connection ID of initiating instructor
}>
```

---

## Reporting

- Instructor can download a report after ending an activity.
- The "End Activity" confirmation step includes a "Download report first" link.
- Each activity must be able to generate an HTML report from its session data.
- The SyncDeck server calls `GET /api/{activityId}/report?sessionId={childSessionId}`
  and proxies or presents the result.
- This capability should be defined as an optional `ActivityConfig` field:
  `reportEndpoint: '/api/{id}/report'` — activities that support reporting declare it.

---

## Activity Picker (Manual Trigger)

- The manager header "Activities" button opens a panel listing registered activities.
- The panel is rendered by the SyncDeck manager component and respects
  `ActivityContainment` — it reads activity metadata from `activityConfig.id/name/description`
  but does not import activity-specific code.
- Each activity card shows name, description, and a "Launch" button.
- Selected activity options (if any) are configured inline before launch.
- The picker panel is dismissed when an activity is launched or when the instructor
  clicks away.

---

## Open Questions (resolve before each phase begins)

1. **Activity iframe URL shape (RESOLVED)**: Use the normal child session route
  `/{childSessionId}` for embedded overlays; do not introduce a dedicated embedded route.
  The host passes `entryParticipantToken` through the same storage/query path used by
  `WaitingRoom`, and child entry always goes through
  `GET /api/session/:childSessionId/entry` + shared consume flow.
  This keeps embedded behavior aligned with existing entry contracts and avoids parallel
  routing logic.

2. **Activity iframe sizing (RESOLVED)**: Use a full-coverage overlay model with
  reserved margin gutters for presentation-direction controls.
  Implementation guidance:
  - Overlay remains the primary full-screen interaction surface.
  - Apply responsive inset margins (desktop `64px`, tablet `48px`, mobile `40px`) so
    host-rendered chevrons stay visible/clickable without covering activity UI.
  - Keep the presentation subtly visible in those gutters to maintain orientation.

3. **Embedded entry token expiry / late join behavior (RESOLVED)**: Issue a fresh
  `entryParticipantToken` on demand through SyncDeck's parent-context proof route
  (`POST /api/syncdeck/:sessionId/embedded-activity/entry`). Late joiners always preserve
  inherited identity; there is no fallback to anonymous/manual entry for students who
  already have a parent-session identity.

4. **Activity manager in the child session (RESOLVED)**: The instructor always gets the
   `ManagerComponent` view inside the child overlay. The `embedded-activity/start` flow
   must issue a manager-role token or indicator alongside the per-student entry tokens so
   the instructor's overlay mounts `ManagerComponent` rather than `StudentComponent`.

5. **Student names and accepted-entry identity in child session (RESOLVED)**: Inherit
  student names/IDs from the parent SyncDeck session. When minting child
  `entryParticipantToken` values the server seeds the child session's accepted-entry path
  with the parent-session student identity (`studentId`, `displayName`) from the SyncDeck
  roster, so activity results can be correlated back to students without a separate
  identity-collection step.

6. **Deck metadata format (RESOLVED)**: Slide authors specify an embedded activity using
   a `data-activity-id="raffle"` attribute on the `<section>` element. Speaker-note JSON
   blocks are not used. Data attributes are the simplest authoring and parsing surface.

7. **Multiple activities on the same slide (RESOLVED)**: Only one activity is permitted
   per slide position. If a horizontal slide needs multiple activities they must be placed
   on separate vertical slides in a stack — each `<section>` with its own
   `data-activity-id` and its own anchored `instanceKey`. The server enforces one active
   instance per `instanceKey`; the design does not support concurrent overlays at the
   same `h:v` position.

8. **Instructor overlay selection (RESOLVED)**: The manager overlay follows the same
   position-based selection rule as the student overlay. Because manager activity views
   are full-screen, the instructor sees one `ManagerComponent` at a time — the one
   anchored to their current slide position. To manage a specific activity the instructor
   navigates to its anchored slide. The running-activities panel in the header lists all
   instances for end-control and awareness regardless of the instructor's position.

9. **Synchronized video — lightweight sessions (DEFERRED)**: A "broadcast-only" child
  session type that skips student identity tracking could reduce overhead for high-
  student-count video slides. The current implementation uses the standard child-session
  model for all activities including Video Sync. A future plan item should evaluate
  whether a lightweight session type is worth introducing once the standard path is
  proven at classroom scale.

10. **Overlay lifecycle on slide navigation (RESOLVED)**: Use position-based dismiss.
    Navigating away from a slide-anchored activity unmounts the overlay; navigating back
    remounts and reinitializes it — equivalent to a page reload. This is the accepted
    behavior: reinit on return is predictable and keeps state management simple.
    For `global` instances (manual trigger, no position anchor) the overlay persists
    across all slide positions until the instructor explicitly ends the activity.

11. **Solo mode — shared vs. isolated state (RESOLVED)**: Solo activity instances are
    fully isolated per student with no server coordination. Two solo students on the same
    slide each get their own independent local session. Synchronous shared solo experiences
    (e.g., a raffle seeded without an instructor) are not supported in the current design
    and are deferred to a future plan item.

12. **Child waiting-room fields beyond inherited parent data (RESOLVED)**: The shared
  waiting-room UI renders inside the overlay. Inherited parent values (e.g. `displayName`)
  are prefilled from the parent SyncDeck session. Name-field editing in the child overlay
  is permitted — the child `participantId` remains stable so activity results stay
  attributable, and the edited name scopes only to that child session (it is not
  back-propagated to the parent SyncDeck session). If a future need arises to sync name
  changes back to the parent roster, that should be designed as an explicit back-propagation
  step rather than implicit shared mutation.

13. **Synchronous child gating rollout (RESOLVED)**: `instructorGated` is an enum
  (`'runtime' | 'waiting-room'`, omitted = open) distinguishing two hold mechanisms.
  Initial rollout uses Video Sync with `instructorGated: 'runtime'`.

  Release criteria for `'runtime'` mode (applies to Video Sync and any activity where
  the hold happens *inside* the activity after entry):
  1. No waiting-room UI shown in the overlay before student entry (pass-through confirmed).
  2. Students land in instructor-owned held state and cannot interact until an explicit
     instructor start/release action (runtime gate enforced). Criteria 1 and 2 describe
     the same mode and are not exclusive — both must pass together.

  Release criteria for `'waiting-room'` mode (applies to activities where the hold
  should happen *before* entry, at the waiting-room gate):
  1. Waiting-room hold UI renders in the overlay regardless of field count.
  2. Students are held until the instructor releases them from the waiting-room control.

  Shared release criteria for both modes:
  3. **Non-gated regression clean**: omitted/open activities continue to pass through
     without any gating overhead.
  4. **Config-only change**: gating logic reads exclusively from
     `activityConfig.embeddedRuntime.instructorGated`; no activity-specific conditionals
     in shared SyncDeck modules.
  5. **Mode removal safe**: removing the field or changing its value does not strand or
     break students in sessions already in progress.
  6. **New activity opt-in requires no shared-module edits**: an activity adopts a mode
     by setting the field in its own `activity.config.ts` only.

---

## Delivery Phases

### Phase 0 — Design confirmation
- [x] Resolve all open questions above.
- [x] Update `reveal-iframe-sync-message-schema.md` with `activityRequest` action.
- [x] Define embedded entry-token / parent-context proof contracts and child session state fields in `data-contracts.md`.
- [x] Document pass-through rule explicitly: `join-live` + zero waiting-room fields skips waiting-room UI.
- [x] Add `ActivityConfig.embeddedRuntime.instructorGated?: 'runtime' | 'waiting-room'` to shared type/schema (omitted = open).

### Phase 1 — Server foundation
- [x] Add child session ID shape to `session` module.
- [x] Implement `POST .../embedded-activity/start` (instanceKey-keyed, idempotent per key,
  creates child session, adds to `embeddedActivities` map, broadcasts with instanceKey,
  generates per-student child entry handoff tokens).
- [x] Implement `POST .../embedded-activity/end` (ends one instance by instanceKey, broadcasts).
- [x] Implement parent-context-validated embedded entry issuance for late join/reconnect.
- [x] Reuse shared child-session `GET /entry` and `entry-participant/consume` routes instead of adding a parallel claim API.
- [x] Enforce immediate pass-through when child entry resolves to `join-live` with `waitingRoomFieldCount === 0`.
- [x] Add a dev-only `embedded-test` activity for contract/integration validation.
  - Student view: mostly static; shows passed `displayName` and `participantId`, plus a simple
    message surface from manager → student and student → manager.
  - Manager view: mostly static; shows connected students, participant IDs, and a lightweight
    console/chat feed to validate manager/student channel wiring without activity-specific logic.
  - Keep it intentionally thin and non-production (`isDev: true`); use it to exercise generic
    embedded contracts before validating the first real rollout activity (Video Sync).
- [x] Server tests: concurrent instance creation, per-key deduplication, parent-cull cascades
      to all child sessions, broadcast shape includes instanceKey.
- [x] Add `embeddedActivities` map to session state snapshot for late-joining students.

### Phase 2 — Manager host overlay
- [x] Add `embeddedActivities: Map<instanceKey, ...>` state to `SyncDeckManager`.
- [x] Handle `embedded-activity-start` / `embedded-activity-end` WebSocket messages
      (keyed by instanceKey).
- [x] Render activity iframe overlay(s) on top of presentation iframe.
- [x] Running-activities panel in header: per-instance name, status dot, end control
      with inline confirmation (lists all instances regardless of instructor's current slide).
- [x] Manager overlay selection follows instructor's current slide position (same
      position-based rule as student overlay); always renders ManagerComponent for the matched instance.
- [x] Host-rendered navigation chevrons (z:20, above activity iframe) active when overlay
      is shown; send prev/next/slide commands to presentation iframe via postMessage.
- [x] Chevrons hidden when no overlay is active.
- [x] Manager tests: multi-instance panel state, individual end control, overlay lifecycle,
      navigation commands reach presentation iframe while overlay is active.

### Phase 3 — Student host overlay
- [x] Add `embeddedActivities: Map<instanceKey, ...>` state to `SyncDeckStudent`.
- [x] Handle `embedded-activity-start` / `embedded-activity-end` WebSocket messages.
- [x] Overlay selection logic: match instance key's `h:v` anchor to student's current slide
      position; fall through to `global` instances when no position match.
- [x] Render only the matching overlay; unmount non-matching instances
      (navigate-away dismiss is equivalent to reload on return — accepted behavior).
- [x] Host-rendered navigation chevrons (z:20) active when overlay is shown, driven by
      `canGoBack`/`canGoForward`/`canGoUp`/`canGoDown` from presentation iframe state.
      Disabled chevrons set `disabled` + `aria-disabled="true"`.
- [x] Re-evaluate overlay selection on each incoming presentation `state` message
      (student navigating h/v while overlay is active changes which overlay is shown).
- [x] Compute sync state (`solo | synchronized | behind | ahead | vertical`) from student
      and instructor indices on every position update.
- [x] Send `activebits-embedded` / `syncContext` postMessage to activity iframe after mount
      and on each sync state change.
- [x] Solo overlay path: detect `syncState === 'solo'`, honor the existing
  `activityConfig.standaloneEntry` contract, mount direct standalone URL when supported,
  otherwise show informational notice.
- [x] Local `soloOverlays` map (separate from `embeddedActivities`) for solo instances.
- [x] Handle late-join path (hydrate from `session.data.embeddedActivities` map).
- [ ] Student tests: position-based overlay selection, stack transitions, late-join hydration,
      navigation controls enabled/disabled per capability flags, overlay changes on nav,
      sync context postMessage content for each sync state, solo activation path.
  - [x] Added unit coverage for solo activation request parsing, current-slide selection,
    and direct-path vs informational-notice behavior in `SyncDeckStudent.test.tsx`.
  - [x] Added unit coverage for pending-activity notice gating, `ready` navigation
    capability alias parsing (`canGoLeft`/`canGoRight`), solo sync-context payload,
    lifecycle no-op on malformed embedded-start payload, and solo request index fallback.

### Phase 3.5 — Synchronous activity control hardening
- [x] Embedded child sessions (`CHILD:*`) cannot be ended directly via shared
  `DELETE /api/session/:sessionId`; parent session remains the only owner of end flow.
- [x] Shared manager header auto-hides join code and end-session controls for embedded
  child sessions.
- [ ] Add parent-driven instructor lock control for embedded child sessions (future push).
- [ ] Read `activityConfig.embeddedRuntime.instructorGated` from embedded child metadata.
- [ ] For `instructorGated: 'runtime'`: pass-through entry, activity starts in instructor-owned
  held state; students cannot interact until instructor start/release.
- [ ] For `instructorGated: 'waiting-room'`: force-show waiting-room hold UI in overlay even
  when `waitingRoomFieldCount === 0`; hold until instructor releases from waiting-room control.
- [ ] Tests: `'runtime'` — no waiting-room UI + gated-state enforced together; `'waiting-room'`
  — hold UI renders with zero fields; open (omitted) — pass-through with no gating overhead.

### Phase 4 — Slide-event activation
- [ ] Define deck slide metadata format (`data-activity-id` attribute).
- [ ] Update `reveal-iframe-sync` plugin to emit `activityRequest` on slide-enter.
- [ ] Update `reveal-iframe-sync-message-schema.md`.
- [x] Manager: handle `activityRequest` and launch embedded start flow.
- [ ] Integration test: slide navigation → activityRequest → prompt → launch → overlay.

### Phase 5 — Activity picker (manual trigger)
- [ ] Add "Activities" button to SyncDeck header.
- [ ] Implement activity picker panel using registered `activityConfig` metadata only.
- [ ] Wire picker selection → same start flow as slide-event trigger.
- [ ] Picker tests.

### Phase 6 — Reporting
- [ ] Define `reportEndpoint` optional field in `ActivityConfig` and schema.
- [ ] Add report download to "End Activity" confirmation step.
- [ ] Implement `GET /api/syncdeck/.../report` proxy endpoint.
- [ ] Each activity that supports embedded reporting implements its own report endpoint.
- [ ] Tests.

---

## Notes

- Phases 2 and 3 can be developed in parallel after Phase 1 is complete.
- Phases 4 and 5 are independent of each other and can be developed in any order after Phase 3.
- Phase 6 is independent and can be deferred without blocking any other phase.
- The Activity Containment Policy must be respected throughout: SyncDeck server/client code
  must not import activity-specific implementation files. Use the shared `activityConfig`
  metadata contract only.
- The "End Activity" button placement and accessibility should be designed alongside
  Phase 2, not added as an afterthought after the overlay is working.
