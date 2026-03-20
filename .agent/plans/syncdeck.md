# SyncDeck Future Plan

This document now tracks and is intentionally aligned with:
- `.agent/plans/syncdeck-checklist.md`
Checklist status and execution order should be maintained in in this file and 
this checklist should be modified as plans change with new or updated goals.

## Scope

Future planning is currently organized into three tracks:
1. Student position enhancements
2. Embedded activities
3. Gamification
4. Chalkboard evolution

---

## 1) Student Position Enhancements

### Goals
- Improve instructor visibility into student progress.
- Make student/instructor relative position status more actionable.

### Planned Work
- Student panel shows behind/synced/ahead indicator.
- Instructor header indicates:
  - `# Students connected`
  - `# Students behind`

---

## 2) Embedded Activities

Full design: `.agent/plans/syncdeck-embedded-activities.md`

### Architecture Decision (recorded here for reference)

**Host-overlay model chosen.** The activity iframe is rendered by the ActiveBits host page
and absolutely positioned over the presentation iframe. It is NOT nested inside the deck iframe.

Key reasons:
- Host page already manages the presentation iframe; adding an activity iframe at the same
  level keeps the architecture symmetric.
- The SyncDeck header (on the host page) is always visible — "End Activity" lives there
  with guaranteed accessibility regardless of deck content.
- Activity code uses the normal ActiveBits session system with no embedded-mode awareness.
- Presentation iframe stays mounted underneath the overlay for instant dismissal.

### How instructor moves off

Instructor clicks **"End Activity"** in the SyncDeck header. The button:
- Appears only while an activity is active.
- Shows an inline confirmation (not a blocking modal).
- Calls `POST /api/syncdeck/:sessionId/embedded-activity/end`.
- Server broadcasts `embedded-activity-end` to all students.
- Both manager and student hosts unmount the activity overlay instantly;
  the presentation resumes without any reload.

### Goals
- Let presentations launch embedded ActiveBits activities via slide events or a header picker.
- Keep embedded sessions linked to the parent SyncDeck session (child session lifecycle tied to parent).
- Reuse the waiting-room entry gateway and accepted-entry handoff for child entry so
  students inherit parent identity without a second teacher-code prompt or a parallel
  child join protocol.
- Prevent duplicate child sessions when multiple instructors are connected (first-caller ownership).
- Support instructor reporting after embedded sessions.

### Planned Work (phases)
Tracked in `syncdeck-checklist.md` under "Embedded activities".

### Notes
- Session-linking, lifecycle, and reporting contracts must be finalized in Phase 0 before
  any server implementation begins.
- Embedded-activity protocol documentation is a required prerequisite, not optional implementation cleanup.
- The documented protocol must explicitly cover transport boundaries, message envelope shape,
  activity/session routing, and whether multiplexing is supported.
- Embedded child entry must build on the existing waiting-room entry/handoff contracts and the
  SyncDeck parent `embedded-context` proof route; any parent-WebSocket token broadcast is only
  a transport detail layered on top of those existing contracts.
- Solo embedded launches must follow the existing `standaloneEntry` capability contract rather
  than introducing a SyncDeck-specific solo-mode flag.
- Multi-instructor arbitration uses first-caller ownership (server `embeddedActivityOwner` field);
  subsequent instructor calls receive `409 Conflict` with `alreadyStarted: true`.
- Activity Containment Policy must be preserved: SyncDeck code uses only `activityConfig`
  metadata and must not import activity-specific implementation files.

---

## 3) Gamification

Detailed plan: `.agent/plans/syncdeck-gamification-plan.md`

### Goals
- Add a parent-owned point ledger for SyncDeck sessions.
- Accumulate points across slides and embedded child activities.
- Show point progress in SyncDeck UI and celebrate class progress with a leaderboard.

### Planned Work
- Parent-owned gamification state in SyncDeck session data.
- Host-observable scoring for slide views with duplicate suppression.
- Generic child-activity score contribution contract back to SyncDeck.
- Header score display and reuse of the existing manager student list panel for score UI.
- Optional leaderboard end-slide/activity after the shared contract is proven.

### Notes
- SyncDeck already has host-to-activity `syncContext`, but there is no generic reverse child-to-parent score telemetry contract yet.
- The authoritative points ledger should stay on the parent SyncDeck session, not in child activity sessions.
- Build the parent score ledger first, then add one reference embedded activity as the first score publisher.

---

## 4) Chalkboard Evolution

### Goals
- Move from basic controls to richer collaborative chalkboard behavior.

### Planned Work
- Combine chalkboard + pen overlay controls into a single unified chalkboard tool button.
- When chalkboard mode is active, provide a dedicated screen-blank tool.
- Evaluate whether current plugin is extensible for tool switching.
- If needed, create a new version with:
  - Color picker
  - Tool swap
  - Erase all
- Transmit drawings to students.
- Decide whether drawings persist when progressing slides.

### Notes
- Protocol additions for stroke/state sync should be designed before UI expansion.

---

## Delivery Approach

For each track:
1. Define data/protocol contract first.
2. Add focused server + client tests.
3. Implement behind small, reviewable commits.
4. Validate with activity-scope tests, then full repo tests.
