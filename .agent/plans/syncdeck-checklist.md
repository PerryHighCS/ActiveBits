# SyncDeck Plan Checklist

Use this checklist to track implementation progress for SyncDeck. Update this file as tasks are completed.

## Future work
- [ ] Student position
    - [ ] Student panel shows behind/synced/ahead indicator
    - [ ] Instructor header indicates # Students connected / # Students behind

- [ ] Embedded activities — see `.agent/plans/syncdeck-embedded-activities.md` for full design
    - Architecture decision: host-overlay model (activity iframe managed by ActiveBits host page,
      overlaid on presentation iframe — NOT nested inside the deck iframe)
    - Multiple concurrent child sessions supported (no one-at-a-time limit)
      - Instance key (`{activityId}:{h}:{v}` or `{activityId}:global`) scopes deduplication per slide
      - Student-choice vertical stacks: each student sees the overlay matching their own slide position
    - Instructor moves off per-instance via running-activities panel in SyncDeck header
    - Student sync context: host sends `activebits-embedded`/`syncContext` postMessage
      (`solo | synchronized | behind | ahead | vertical`) to each activity iframe after
      mount and on each position change; activities consume or ignore independently
    - Solo mode path: slide-triggered activities launch in activity solo mode when no
      instructor is present; no child session / claim flow; local-only `soloOverlays` map
    - Phase 0 — Design confirmation
        - [ ] Resolve open questions in the plan (11 questions, see plan doc)
        - [ ] Update `reveal-iframe-sync-message-schema.md` with `activityRequest` action
        - [ ] Define claim token schema and `embeddedActivities` map shape in `data-contracts.md`
                - [ ] Document embedded-activity transport boundaries and whether multiplexing is supported
                - [ ] If multiplexing is supported, define the activity/session routing envelope explicitly
                - [ ] If multiplexing is not supported, document separate websocket requirements per activity/session
                - [ ] Finalize activation and claim flow for already-connected parent-session users
                - [ ] Finalize multi-instructor create/retry/cancel ownership rules
    - Phase 1 — Server foundation
        - [ ] Child session ID shape (`CHILD:{parentId}:{childId}:{activityId}`)
        - [ ] `POST /api/syncdeck/:sessionId/embedded-activity/start` (instanceKey-keyed, idempotent)
        - [ ] `POST /api/syncdeck/:sessionId/embedded-activity/end` (ends one instance by instanceKey)
        - [ ] `GET /api/syncdeck/:childSessionId/claim` (claim token → session data)
        - [ ] `embeddedActivities` map in session state snapshot for late-joining students
        - [ ] Server tests: concurrent instances, per-key dedup, parent-cull cascades all children
    - Phase 2 — Manager host overlay
        - [ ] `embeddedActivities` map state + WebSocket message handling (keyed by instanceKey)
        - [ ] Activity iframe overlay(s) rendered over presentation iframe
        - [ ] Running-activities panel in header (per-instance name, status dot, end control)
        - [ ] Host-rendered navigation chevrons (z:20, above overlay) sending postMessage
              prev/next/slide commands to presentation iframe; hidden when no overlay active
        - [ ] Manager tests: multi-instance panel, individual end control, overlay lifecycle,
              navigation commands reach presentation iframe while overlay is active
    - Phase 3 — Student host overlay
        - [ ] `embeddedActivities` map state + WebSocket message handling
        - [ ] Overlay selection: match instanceKey anchor `h:v` to student's current slide position;
              re-evaluate on every incoming presentation state message
        - [ ] Host-rendered navigation chevrons driven by canGo* capability flags from presentation
              iframe state; disabled chevrons set disabled + aria-disabled
        - [ ] Sync state computation (solo/synchronized/behind/ahead/vertical) from student
              vs. instructor indices; `syncContext` postMessage sent to activity iframe on
              mount and each change
        - [ ] Solo overlay path: soloMode check → solo session URL or informational notice;
              local `soloOverlays` map separate from `embeddedActivities`
        - [ ] Late-join path from `session.data.embeddedActivities` map
        - [ ] Student tests: position-based selection, stack transitions, capability-driven
              chevron enable/disable, overlay changes on nav, sync context postMessage
              for each sync state, solo activation path, late-join hydration
    - Phase 4 — Slide-event activation
        - [ ] Deck slide metadata format (`data-activity-id` attribute)
        - [ ] `reveal-iframe-sync` plugin emits `activityRequest` on slide-enter
        - [ ] Manager handles `activityRequest` → "Launch Activity?" prompt
    - Phase 5 — Activity picker (manual trigger from header)
        - [ ] "Activities" header button + picker panel
        - [ ] Wire to same start flow as slide-event trigger
    - Phase 6 — Reporting
        - [ ] `reportEndpoint` in `ActivityConfig` schema
        - [ ] Report download in "End Activity" confirmation step
        - [ ] Per-activity report endpoints

- [ ] Chalkboard
    - [ ] Combine chalkboard button and pen button into one unified control
    - [ ] Add a blank-screen tool that is available when chalkboard is active
    - [ ] See if current plugin is extendable with tool switching back and forth
    - [ ] Create new version? With color picker, tool swap, erase all
    - [ ] Transmit drawings to students
    - [ ] Keep on slide after progressing?
