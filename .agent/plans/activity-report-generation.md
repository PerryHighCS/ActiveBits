# Activity Report Generation Plan

## Purpose

Build complete activity reporting across ActiveBits, with special attention to SyncDeck sessions that embed multiple activities. Instructors should be able to generate one self-contained report download for a session. For SyncDeck, that single parent report must embed the report data for all child activities and provide internal drill-down views by activity and by student without requiring separate child report files.

## Current Status

- [x] Shared report types exist in `types/activity.ts`.
- [x] Activity-owned report endpoints are supported through `ActivityConfig.reportEndpoint`.
- [x] A server-side report builder registry exists in `server/activities/activityReportRegistry.ts`.
- [x] SyncDeck can build a report manifest from embedded child sessions that have registered builders.
- [x] SyncDeck exposes instructor-authenticated aggregate report routes:
  - `GET /api/syncdeck/:sessionId/report-manifest`
  - `GET /api/syncdeck/:sessionId/report`
- [x] SyncDeck's exported HTML report already has whole-session, activity, and student views.
- [x] Gallery Walk has a self-contained HTML report and a structured report builder.
- [x] Resonance has a self-contained standalone report endpoint.
- [x] Postboard has a self-contained standalone report endpoint and structured report builder.
- [x] Register Resonance as a structured report builder for SyncDeck aggregation.
- [x] Include embedded activities without report builders in SyncDeck aggregate reports with a clear unsupported/unavailable state.
- [x] Remove the SyncDeck per-child embedded report download path in favor of one self-contained parent report that embeds child activity report data.
- [ ] Add activity-level reports for the main activities that capture meaningful student work.

## Design Principles

- [ ] Keep activity internals activity-owned. SyncDeck should aggregate generic report sections, not inspect child session schemas directly.
- [ ] Keep exports self-contained HTML with inline data, CSS, and JavaScript.
- [ ] Use one report file per session as the primary product surface; embedded child activities should contribute data/sections to that file rather than separate required downloads.
- [ ] Preserve student privacy boundaries and never export instructor passcodes, entry tokens, or secrets.
- [ ] Use parent SyncDeck student identity as the cross-activity identity when activities are launched embedded.
- [ ] Make unsupported report states visible in SyncDeck reports instead of silently dropping activities.
- [ ] Add focused tests for each report builder and route touched.

## Implementation Notes

- 2026-07-11: Completed the first implementation slice. Resonance now contributes structured report data to SyncDeck aggregate reports. SyncDeck aggregate manifests include supported, unsupported, and unavailable embedded activity records in `startedAt` order. The per-child SyncDeck report redirect route and manager child download button were removed so the single parent session report is the canonical embedded export. The SyncDeck manager now shows user-visible report download failure feedback. Report contract docs were updated in `ADDING_ACTIVITIES.md` and `.agent/knowledge/data-contracts.md`.
- 2026-07-11: Added Postboard reporting. Postboard now has an instructor-authenticated standalone HTML report endpoint and a structured builder for SyncDeck aggregation. The report includes prompt/settings, moderation status counts, reactions, flags, hidden/deleted state, and per-student contribution drill-downs. Remaining activity report builders moved to Phase 8.

## Phase 1: Harden The Shared Report Contract

- [ ] Add report-section validation or normalization helpers for `ActivityStructuredReportSection`.
- [x] Add a structured representation for unsupported or unavailable embedded reports.
- [x] Treat embedded report payload data as part of the self-contained render contract when it is needed to render the offline report after download.
- [x] Document required report builder behavior in `ADDING_ACTIVITIES.md`.
- [x] Record durable report contract notes in `.agent/knowledge/data-contracts.md`.

## Phase 2: Make SyncDeck Aggregation Complete

- [x] Update SyncDeck manifest generation so every embedded activity appears in the aggregate, including unsupported or expired child sessions.
- [x] Preserve useful ordering, ideally by embedded activity `startedAt` and/or slide `location`.
- [x] Add visible aggregate report sections for:
  - [x] session summary
  - [x] per-activity drill-down
  - [x] per-student drill-down
  - [x] unsupported or unavailable reports
- [x] Add route tests for supported, unsupported, missing, and expired child sessions.
- [x] Add report HTML tests for mixed report availability.

## Phase 3: Make One Session Report The Primary Export

- [x] Treat `GET /api/syncdeck/:sessionId/report` as the canonical SyncDeck export.
- [x] Embed all child activity report data needed for summary, activity drill-down, and student drill-down inside the parent HTML.
- [ ] Generate the parent report while child session data is still available, because embedded child sessions should end with the parent session.
- [x] Stop relying on child activity report downloads for SyncDeck aggregate reporting.
- [x] Remove `GET /api/syncdeck/:sessionId/embedded-activity/report/:instanceKey` after the parent report contains child activity report data.
- [x] Preserve direct activity `reportEndpoint` behavior for standalone activity sessions.
- [x] Add tests proving the SyncDeck session report can be opened offline and viewed without follow-up child report requests.
- [x] Add user-visible failure feedback in the SyncDeck manager when the single session report download fails.

## Phase 4: Add Structured Builders For Priority Activities

### Resonance

- [x] Add `buildResonanceStructuredReportSection(...)`.
- [x] Register `registerActivityReportBuilder('resonance', ...)`.
- [x] Include per-question summary blocks.
- [x] Include per-student answer blocks.
- [x] Include multiple-choice correctness and poll counts.
- [x] Include free-response annotations, shared responses, and instructor emoji where appropriate.
- [x] Add server tests for standalone report compatibility and SyncDeck aggregation.

### Postboard

- [x] Add a self-contained HTML report endpoint.
- [x] Add a structured builder with prompt, approved posts, pending/rejected counts, per-student contributions, and reactions.
- [x] Decide how moderation state should appear in instructor-only exports.

## Phase 5: Improve Instructor And Student UX

- [ ] Add clear report contribution indicators in the SyncDeck running activities panel, focused on whether each activity will appear in the single session report.
- [x] Add error/status copy for failed report downloads.
- [ ] Consider an instructor report preview route or modal before download.
- [ ] Add activity-manager report buttons for standalone activity session reports.
- [ ] Keep instructor-generated reports as the first release workflow.
- [ ] Track a later solo-mode proof-of-work report flow where asynchronous students can generate their own report.
- [ ] Allow solo-mode student report generation for that student's own work, without requiring instructor auth.

## Phase 6: Persistence, Lifecycle, And Privacy

- [ ] Audit each reportable activity for state that is currently only transient.
- [ ] Generate reports from current session state; after a session ends, the ended-state snapshot is the current state used for reporting.
- [ ] Add end-of-activity or session-end report snapshots only where current state would otherwise be lost.
- [ ] Ensure child sessions remain available long enough for SyncDeck report generation.
- [ ] Require instructor/parent-session auth for report generation; session id alone is not sufficient authorization.
- [ ] For standalone activity reports, follow each activity's existing role/auth model: instructor-authenticated reports where instructor auth exists, and student-scoped reports for solo-mode student proof-of-work.
- [ ] Exclude secrets, passcodes, entry tokens, and unsafe hidden state from exported payloads.
- [ ] Add tests for report generation after embedded activity end and parent session continuation.

## Phase 7: Verification

- [x] Run scoped tests for each modified activity.
- [x] Run SyncDeck server and manager tests after aggregation changes.
- [ ] Run `npm test` before merge.
- [ ] Add `npm run test:e2e` if browser-visible report flows, downloads, routing, or SyncDeck manager surfaces change.
- [ ] If sandbox port binding blocks e2e tests, document the limitation and run the strongest available scoped checks.

## Phase 8: Add Remaining Activity Reports

### Binary Breach

- [ ] Add a report endpoint.
- [ ] Add a structured builder with mission settings, per-student progress, completion, accuracy, hints, and challenge history where available.
- [ ] Identify any missing state needed for a useful report and add persistence before report rendering.

### MobCode

- [ ] Add a report endpoint.
- [ ] Add a structured builder with final workspace state, selected runner, and student participation where available.
- [ ] Decide whether edit/run event history is needed; add event capture if current state is insufficient.

### Practice And Utility Activities

- [ ] Inventory student work state for `java-string-practice`, `java-format-practice`, `python-list-practice`, `traveling-salesman`, `www-sim`, `algorithm-demo`, `video-sync`, and `raffle`.
- [ ] Classify each as:
  - [ ] student-work report
  - [ ] engagement/state report
  - [ ] intentionally unsupported
- [ ] Add report endpoints/builders for activities with meaningful persisted student work.

## Recommended First Implementation Slice

- [x] Add Resonance structured report aggregation into the single SyncDeck parent report.
- [x] Make SyncDeck aggregate reports include unsupported child activities visibly.
- [x] Remove SyncDeck's child report redirect path so the normal workflow never depends on separate child report files.
- [x] Add user-visible SyncDeck manager download failure feedback.
- [x] Update docs and knowledge notes for the finalized report contract.

## Decisions

- [x] Use one self-contained SyncDeck parent report as the primary export; embedded child activity data needed for rendering must live inside that file.
- [x] Treat session id as insufficient authorization for report generation. Embedded report generation should flow from authenticated parent instructor access.
- [x] End embedded child sessions with the parent session, and embed child report data into the parent report instead of depending on child sessions/files afterward.
- [x] Start with instructor-generated reports for live sessions.
- [x] Defer student-generated proof-of-work reports to a later solo/asynchronous mode slice.
- [x] Generate reports from current session state. If the session has ended, the ended-state snapshot is the current state for reporting.
- [x] Standalone report auth should follow the activity's role model as reports are added: use instructor auth when the activity has it, and allow solo-mode students to generate reports scoped to their own work.
