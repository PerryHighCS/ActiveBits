# SyncDeck Plan Checklist

Use this checklist to track implementation progress for SyncDeck. Update this file as tasks are completed.

## Execution Framework

- Owner model: assign one phase owner before moving a phase to in-progress.
- PR scope model: keep each phase split into small, reviewable PR slices (contracts, server, manager UI, student UI, tests).
- Exit model: a phase is complete only when all checklist items, phase exit criteria, and listed validation commands pass.
- Validation baseline (all phases):
  - `npm run lint`
  - `npm run typecheck`
  - `npm test`
- Environment fallback: if sandbox port-binding limits block standard tests, run `npm run test:codex` and record the limitation in PR notes.

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
    - Embedded child entry reuses shared waiting-room entry/handoff contracts and SyncDeck's
      parent `embedded-context` proof route instead of a parallel claim API
    - Child sessions with `join-live` and zero waiting-room fields pass through immediately
      (no waiting-room pause in overlay)
    - Synchronous child activities remain instructor-gated after pass-through launch
    - Solo mode path follows `standaloneEntry`; direct `/solo/:activityId` launch only when
      the child activity already supports it; otherwise show a live-session-required notice
    - Phase 0 — Design confirmation
      - Owner: Embedded contracts lead (assign before start)
      - PR scope: docs + shared type/schema contract only
      - Exit criteria: contract docs updated, schema/type additions agreed, open-question list reduced to implementation-only items
      - Validation: `npm run lint` + `npm run typecheck`
        - [x] Resolve open questions in the plan (all 13 resolved, see plan doc)
        - [x] Update `reveal-iframe-sync-message-schema.md` with `activityRequest` action
        - [x] Define embedded entry-token, parent-context proof, and `embeddedActivities` map shapes in `data-contracts.md`
        - [x] Document pass-through rule for `join-live` + zero waiting-room fields
        - [x] Add `ActivityConfig.embeddedRuntime.instructorGated?: 'runtime' | 'waiting-room'` in shared type/schema (omitted = open)
        - [x] Document embedded-activity transport boundaries and whether multiplexing is supported
        - [x] If multiplexing is supported, define the activity/session routing envelope explicitly (N/A: multiplexing is not supported)
        - [x] If multiplexing is not supported, document separate websocket requirements per activity/session
        - [x] Finalize inherited child-entry flow for already-connected parent-session users
        - [x] Finalize multi-instructor create/retry/cancel ownership rules
    - Phase 1 — Server foundation
        - Owner: Embedded server lead (assign before start)
        - PR scope: SyncDeck server routes/state + shared entry-handoff integration + server tests
        - Exit criteria: start/end/late-join issuance flows implemented, child pass-through decision enforced, server tests green
        - Validation: `npm test --workspace server` then full `npm test`
        - [x] Child session ID shape (`CHILD:{parentId}:{childId}:{activityId}`)
        - [x] `POST /api/syncdeck/:sessionId/embedded-activity/start` (instanceKey-keyed, idempotent)
        - [x] `POST /api/syncdeck/:sessionId/embedded-activity/end` (ends one instance by instanceKey)
        - [x] Parent-context-validated embedded child entry issuance for late join/reconnect
        - [x] Child sessions reuse shared `/api/session/:sessionId/entry` and entry-participant consume flow
        - [x] Child entry pass-through for `join-live` + zero waiting-room fields
        - [x] Add dev-only `embedded-test` activity for generic embedded contract validation
        - [x] `embeddedActivities` map in session state snapshot for late-joining students
        - [x] Server tests: concurrent instances, per-key dedup, parent-cull cascades all children
    - Phase 2 — Manager host overlay
        - Owner: SyncDeck manager UI lead (assign before start)
        - PR scope: manager overlay rendering + running activities panel + manager-side WS wiring + manager tests
        - Exit criteria: manager can launch/view/end per-instance overlays with working nav controls and tests
        - Validation: `npm test --workspace activities -- syncdeck` then full `npm test`
          - [x] `embeddedActivities` map state + WebSocket message handling (keyed by instanceKey)
          - [x] Activity iframe overlay(s) rendered over presentation iframe
          - [x] Running-activities panel in header (per-instance name, status dot, end control;
              lists all instances regardless of instructor's current slide)
          - [x] Manager overlay selection follows instructor's current slide position
              (same position-based rule as student; renders ManagerComponent)
          - [x] Host-rendered navigation chevrons (z:20, above overlay) sending postMessage
              prev/next/slide commands to presentation iframe; hidden when no overlay active
          - [x] Manager tests: multi-instance panel, individual end control, overlay lifecycle,
              navigation commands reach presentation iframe while overlay is active
    - Phase 3 — Student host overlay
        - Owner: SyncDeck student UI lead (assign before start)
        - PR scope: student overlay selection + student WS wiring + sync-context messaging + student tests
        - Exit criteria: student overlay routing works for anchored/global instances, late-join hydration works, tests cover nav/sync behavior
        - Validation: `npm test --workspace activities -- syncdeck` then full `npm test`
          - [x] `embeddedActivities` map state + WebSocket message handling
          - [x] Overlay selection: match instanceKey anchor `h:v` to student's current slide position;
              re-evaluate on every incoming presentation state message
          - [x] Host-rendered navigation chevrons driven by canGo* capability flags from presentation
              iframe state; disabled chevrons set disabled + aria-disabled
          - [x] Sync state computation (solo/synchronized/behind/ahead/vertical) from student
              vs. instructor indices; `syncContext` postMessage sent to activity iframe on
              mount and each change
          - [ ] Solo overlay path: `standaloneEntry` check → direct standalone URL or informational notice;
            local `soloOverlays` map separate from `embeddedActivities`
        - [x] Late-join path from `session.data.embeddedActivities` map
        - [ ] Student tests: position-based selection, stack transitions, capability-driven
              chevron enable/disable, overlay changes on nav, sync context postMessage
              for each sync state, solo activation path, late-join hydration
      - Phase 3.5 — Synchronous control hardening
        - Owner: Activity integration lead (start with Video Sync)
        - PR scope: shared capability read path + first activity rollout + gating tests
        - Exit criteria: capability-driven gating works end-to-end and first activity rollout is production-safe
        - Validation: `npm test --workspace activities -- video-sync` and `npm test --workspace activities -- syncdeck` then full `npm test`
        - [ ] Read `activityConfig.embeddedRuntime.instructorGated` in embedded launch/runtime path
        - [ ] Initial rollout uses Video Sync first (`activities/video-sync/activity.config.ts` sets `embeddedRuntime.instructorGated: 'runtime'`)
        - [ ] Sync-required activities start in instructor-owned control state even with pass-through
        - [ ] Tests prove no waiting-room pause for zero-field children and preserved instructor gating
    - Phase 4 — Slide-event activation
        - Owner: Reveal integration lead (assign before start)
        - PR scope: reveal plugin emission + manager prompt handling + integration tests
        - Exit criteria: slide-enter activity request triggers a guarded launch flow with tests
        - Validation: `npm test --workspace activities -- syncdeck` then full `npm test`
        - [ ] Deck slide metadata format (`data-activity-id` attribute)
        - [ ] `reveal-iframe-sync` plugin emits `activityRequest` on slide-enter
        - [x] Manager handles `activityRequest` → "Launch Activity?" prompt
    - Phase 5 — Activity picker (manual trigger from header)
        - Owner: SyncDeck manager UI lead (assign before start)
        - PR scope: picker UI + metadata-driven launch wiring + picker tests
        - Exit criteria: manual launch path works without slide metadata and remains activity-agnostic
        - Validation: `npm test --workspace activities -- syncdeck` then full `npm test`
        - [ ] "Activities" header button + picker panel
        - [ ] Wire to same start flow as slide-event trigger
    - Phase 6 — Reporting
        - Owner: Reporting integration lead (assign before start)
        - PR scope: shared config/schema update + SyncDeck proxy + one reference activity report endpoint + tests
        - Exit criteria: report download works from end-flow and schema/docs are updated
        - Validation: `npm test --workspace server` + `npm test --workspace activities` then full `npm test`
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
