# SyncDeck Second Instructor + Embedded Student View Plan

## Status

Design / discovery complete. Implementation should start on a non-`main` branch.

## Goal

Allow a second instructor device to control or accompany a live SyncDeck session while the smartboard shows a student-safe presentation, especially for embedded activities where the current manager view can expose PII.

## Current-State Findings

- Fresh second-device instructor entry is currently blocked in the shared persistent-link waiting-room flow before SyncDeck-specific logic runs. `GET /api/persistent-session/:hash/entry` only resolves `resolvedRole: 'teacher'` when the browser already has a remembered teacher cookie, so an already-started permalink opened on a new device is presented as student entry first.
- SyncDeck already allows more than one instructor-authenticated websocket client for the same session, but every authenticated instructor socket is currently a write-capable authority for `syncdeck-state-update` payloads.
- SyncDeck manager auth recovery is tied to the parent persistent-session cookie and the session instructor passcode, so a second instructor-capable device can already recover access if it has the teacher cookie.
- Embedded child sessions currently support two parent-resolved roles only: `teacher` and `student`.
- Embedded child manager bootstrap passes the child instructor passcode down to the embedded manager, which is correct for the normal instructor overlay path but not for a smartboard-safe student-facing overlay.
- The activity registry currently exposes `ManagerComponent` and `StudentComponent`, but there is no generic “student-safe observer/presenter” contract for embedded activities that should look like student view without registering a real student identity.
- Student embedded entry recovery is built around a real `studentId` plus an entry participant token. That is good for actual students, but it is the wrong primitive for a smartboard display that should not create fake student participants or reveal roster-linked data.

## Recommendation

Treat this as two related but separate deliverables:

1. Parent-level second-instructor / presenter mode in SyncDeck.
2. Child-level embedded student-safe display support.

Do not solve this by simply opening a second full manager view on the smartboard. That would still expose manager-only UI and would let the board device become another write-capable instructor authority.

Recommended product direction:

- Fix second-device teacher entry through persistent permalinks first so a fresh browser can intentionally choose teacher auth on an already-started live session.
- Keep one normal instructor-control surface.
- Add a second-device SyncDeck “presenter” mode that is read-only by default at the parent layer and renders the deck in student-safe form.
- Add an explicit embedded activity display mode contract so child activities can opt into a student-safe view without pretending to be a real student.

## Proposed Design

### Phase 0 Decision

- [ ] Treat fresh-device teacher entry as a prerequisite slice.
  - Recommended: add an explicit teacher-intent path at persistent-link entry so a started live session can still present “enter teacher code / open manage dashboard” on browsers without a remembered teacher cookie.
- [ ] Confirm the board device UX:
  - Recommended: a dedicated SyncDeck presenter route or query mode on `/manage/syncdeck/:sessionId` that authenticates as instructor-owner but renders read-only/student-safe UI.
- [ ] Confirm control scope for the second device:
  - Recommended: deck navigation control allowed, embedded child instructor controls disallowed by default.
- [ ] Confirm first-wave embedded activities that must support student-safe display:
  - Recommended: `video-sync` and `resonance` first, because they have the clearest PII risk and classroom value.

### Phase 1 Parent SyncDeck Contract

- [ ] Fix persistent-link second-device teacher entry before or alongside presenter mode.
  - Candidate repo seam: shared persistent entry status / waiting-room flow, not SyncDeck websocket auth.
  - Relevant files: `server/routes/persistentSessionRoutes.ts`, `client/src/components/common/SessionRouter.tsx`, `client/src/components/common/WaitingRoom.tsx`, `client/src/components/common/persistentSessionEntryPolicyUtils.ts`.
- [ ] Add regression tests for the fresh-device case:
  - started live permalink
  - no remembered teacher cookie
  - teacher intentionally enters code
  - browser reaches manage route instead of being funneled into student-name-first entry
- [ ] Define a SyncDeck parent view mode model.
  - Recommended shape: `control`, `presenter`, and existing real `student`.
- [ ] Decide route shape for presenter mode.
  - Recommended: either `/manage/syncdeck/:sessionId?view=presenter` or a dedicated `/present/syncdeck/:sessionId`.
- [ ] Ensure presenter authentication reuses existing teacher-cookie/passcode recovery without adding a second credential system.
- [ ] Make presenter sessions read-only for outbound `syncdeck-state-update` by default unless a later explicit “take control” action is added.
- [ ] Document how presenter mode should recover presentation URL, persistent-link metadata, and current instructor state.

### Phase 2 Embedded Activity Contract

- [ ] Add a generic embedded display contract in shared activity types instead of hard-coding SyncDeck-specific conditionals into shared modules.
- [ ] Decide the activity-facing API:
  - Recommended: let activities opt into one of `manager`, `student`, or `observer-student` style embedded display modes.
- [ ] Define how SyncDeck tells a child activity which display mode to render.
  - Preferred: parent-owned bootstrap/session metadata for embedded launches, not ad hoc query params alone.
- [ ] Keep actual student entry token flows for real students only.
- [ ] Avoid creating fake student roster entries for presenter/smartboard views.
- [ ] Define fallback behavior when an activity has no student-safe embedded display implementation yet.
  - Recommended: show a neutral “student-safe view unavailable for this activity” shell instead of falling back to manager view.

### Phase 3 SyncDeck Server Work

- [ ] Add server-side support for resolving presenter-mode embedded context separately from real student entry.
- [ ] Extend embedded-context and/or embedded-launch contracts to distinguish:
  - real teacher control
  - real student participation
  - presenter/student-safe observer display
- [ ] Ensure embedded child bootstrap data can carry the chosen display mode safely across reloads/reconnects.
- [ ] Preserve current manager bootstrap passcode behavior for real instructor overlays.
- [ ] Add structured logging for presenter-mode resolution and embedded display-mode selection.
- [ ] Update server tests for websocket auth/behavior so presenter mode cannot unintentionally publish instructor state updates.

### Phase 4 SyncDeck Manager / Presenter UI

- [ ] Add an obvious way for instructors to open/copy the second-device presenter link.
- [ ] Render student-safe top-level SyncDeck chrome in presenter mode.
- [ ] Hide manager-only controls in presenter mode:
  - running-activities admin controls
  - end session
  - passcode/configure surfaces
  - student roster / any PII surfaces
- [ ] Decide whether presenter mode can request deck navigation actions.
  - Recommended: yes for deck navigation, no for embedded child session admin actions in v1.
- [ ] Make any control affordances accessible and clearly labeled with the current mode.

### Phase 5 Embedded Child Rendering

- [ ] Update SyncDeck embedded overlay selection/rendering so the parent can choose the child display mode per host view.
- [ ] For normal instructor control view, keep rendering embedded `ManagerComponent` where appropriate.
- [ ] For presenter mode, render the child activity’s student-safe display path instead of the manager path.
- [ ] Keep existing real-student embedded entry/recovery logic unchanged for actual student devices.
- [ ] Ensure child overlays still follow SyncDeck slide-position rules and late-join hydration behavior.

### Phase 6 Child Activity Rollout

- [ ] Audit `video-sync` for what must be hidden in presenter mode and what student-facing controls should remain visible.
- [ ] Audit `resonance` for private review surfaces, student names, and any manager-only annotations that must stay hidden.
- [ ] Implement the student-safe embedded display path in the first-wave activities.
- [ ] Add tests proving the presenter path does not expose names, passcodes, private annotations, or instructor-only controls.
- [ ] Create a follow-up checklist for remaining embedded activities after the first two are stable.

### Phase 7 Docs and Durable Notes

- [ ] Update `ARCHITECTURE.md` if a new presenter role or embedded display contract is added.
- [ ] Update `README.md` if new manage/presenter workflows or commands are introduced.
- [ ] Update `DEPLOYMENT.md` if presenter links, cookies, or embedded bootstrap behavior change operational assumptions.
- [ ] Record the final contract in `.agent/knowledge/data-contracts.md`.
- [ ] Record durable implementation discoveries in `.agent/knowledge/repo_discoveries.md`.

## Validation Plan

- [ ] Unit/integration coverage for new SyncDeck role/display-mode helpers.
- [ ] `activities/syncdeck/server/routes.test.ts` coverage for presenter auth/context/bootstrap behavior.
- [ ] `activities/syncdeck/client/manager/SyncDeckManager.test.tsx` coverage for presenter-mode UI and hidden controls.
- [ ] `activities/syncdeck/client/student/SyncDeckStudent.test.tsx` or new presenter-focused tests for embedded overlay display-mode routing.
- [ ] Child-activity tests for student-safe presenter rendering in `video-sync` and `resonance`.
- [ ] `npm test`
- [ ] `npm run test:e2e` if the new presenter flow changes browser-visible routing or embedded interaction seams.

## Suggested PR Slices

- [ ] PR 1: shared type/contract additions plus SyncDeck server auth/bootstrap changes
- [ ] PR 2: SyncDeck presenter route/mode and parent-shell UI
- [ ] PR 3: embedded child display-mode selection in SyncDeck
- [ ] PR 4: first-wave child activity implementations (`video-sync`, `resonance`)
- [ ] PR 5: browser coverage, docs, and knowledge-log updates

## Risks To Watch

- [ ] Accidentally allowing the smartboard device to publish instructor sync updates.
- [ ] Accidentally registering a fake “student” participant for presenter mode.
- [ ] Falling back to manager components for embedded activities that do not yet support student-safe display.
- [ ] Leaking roster names, free-response content, or private instructor annotations in presenter mode.
- [ ] Letting shared modules accumulate SyncDeck-specific conditionals instead of extending activity contracts cleanly.
