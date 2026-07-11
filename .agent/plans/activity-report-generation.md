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
- [ ] Register Resonance as a structured report builder for SyncDeck aggregation.
- [ ] Include embedded activities without report builders in SyncDeck aggregate reports with a clear unsupported/unavailable state.
- [ ] Remove the SyncDeck per-child embedded report download path in favor of one self-contained parent report that embeds child activity report data.
- [ ] Add activity-level reports for the main activities that capture meaningful student work.

## Design Principles

- [ ] Keep activity internals activity-owned. SyncDeck should aggregate generic report sections, not inspect child session schemas directly.
- [ ] Keep exports self-contained HTML with inline data, CSS, and JavaScript.
- [ ] Use one report file per session as the primary product surface; embedded child activities should contribute data/sections to that file rather than separate required downloads.
- [ ] Preserve student privacy boundaries and never export instructor passcodes, entry tokens, or secrets.
- [ ] Use parent SyncDeck student identity as the cross-activity identity when activities are launched embedded.
- [ ] Make unsupported report states visible in SyncDeck reports instead of silently dropping activities.
- [ ] Add focused tests for each report builder and route touched.

## Phase 1: Harden The Shared Report Contract

- [ ] Add report-section validation or normalization helpers for `ActivityStructuredReportSection`.
- [ ] Add a structured representation for unsupported or unavailable embedded reports.
- [ ] Decide whether `payload` is archival raw data, diagnostic-only data, or part of the renderable contract.
- [ ] Document required report builder behavior in `ADDING_ACTIVITIES.md`.
- [ ] Record durable report contract notes in `.agent/knowledge/data-contracts.md`.

## Phase 2: Make SyncDeck Aggregation Complete

- [ ] Update SyncDeck manifest generation so every embedded activity appears in the aggregate, including unsupported or expired child sessions.
- [ ] Preserve useful ordering, ideally by embedded activity `startedAt` and/or slide `location`.
- [ ] Add visible aggregate report sections for:
  - [ ] session summary
  - [ ] per-activity drill-down
  - [ ] per-student drill-down
  - [ ] unsupported or unavailable reports
- [ ] Add route tests for supported, unsupported, missing, and expired child sessions.
- [ ] Add report HTML tests for mixed report availability.

## Phase 3: Make One Session Report The Primary Export

- [ ] Treat `GET /api/syncdeck/:sessionId/report` as the canonical SyncDeck export.
- [ ] Embed all child activity report data needed for summary, activity drill-down, and student drill-down inside the parent HTML.
- [ ] Stop relying on child activity report downloads for SyncDeck aggregate reporting.
- [ ] Remove `GET /api/syncdeck/:sessionId/embedded-activity/report/:instanceKey` after the parent report contains child activity report data.
- [ ] Preserve direct activity `reportEndpoint` behavior for standalone activity sessions.
- [ ] Add tests proving the SyncDeck session report can be opened offline and viewed without follow-up child report requests.
- [ ] Add user-visible failure feedback in the SyncDeck manager when the single session report download fails.

## Phase 4: Add Structured Builders For Priority Activities

### Resonance

- [ ] Add `buildResonanceStructuredReportSection(...)`.
- [ ] Register `registerActivityReportBuilder('resonance', ...)`.
- [ ] Include per-question summary blocks.
- [ ] Include per-student answer blocks.
- [ ] Include multiple-choice correctness and poll counts.
- [ ] Include free-response annotations, shared responses, and instructor emoji where appropriate.
- [ ] Add server tests for standalone report compatibility and SyncDeck aggregation.

### Postboard

- [ ] Add a self-contained HTML report endpoint.
- [ ] Add a structured builder with prompt, approved posts, pending/rejected counts, per-student contributions, and reactions.
- [ ] Decide how moderation state should appear in instructor-only exports.

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

## Phase 5: Improve Instructor And Student UX

- [ ] Add clear report contribution indicators in the SyncDeck running activities panel, focused on whether each activity will appear in the single session report.
- [ ] Add error/status copy for failed report downloads.
- [ ] Consider an instructor report preview route or modal before download.
- [ ] Add activity-manager report buttons for standalone activity session reports.
- [ ] Decide whether students need access to their own report views from live sessions, exported files only, or a later authenticated route.

## Phase 6: Persistence, Lifecycle, And Privacy

- [ ] Audit each reportable activity for state that is currently only transient.
- [ ] Add end-of-activity or session-end report snapshots where needed.
- [ ] Ensure child sessions remain available long enough for SyncDeck report generation.
- [ ] Exclude secrets, passcodes, entry tokens, and unsafe hidden state from exported payloads.
- [ ] Add tests for report generation after embedded activity end and parent session continuation.

## Phase 7: Verification

- [ ] Run scoped tests for each modified activity.
- [ ] Run SyncDeck server and manager tests after aggregation changes.
- [ ] Run `npm test` before merge.
- [ ] Add `npm run test:e2e` if browser-visible report flows, downloads, routing, or SyncDeck manager surfaces change.
- [ ] If sandbox port binding blocks e2e tests, document the limitation and run the strongest available scoped checks.

## Recommended First Implementation Slice

- [ ] Add Resonance structured report aggregation into the single SyncDeck parent report.
- [ ] Make SyncDeck aggregate reports include unsupported child activities visibly.
- [ ] Remove SyncDeck's child report redirect path so the normal workflow never depends on separate child report files.
- [ ] Add user-visible SyncDeck manager download failure feedback.
- [ ] Update docs and knowledge notes for the finalized report contract.

## Open Questions

- [ ] Should the single SyncDeck report include raw activity payloads for archival fidelity, or should exports contain only generic renderable sections plus minimal metadata?
- [ ] Should standalone report endpoints require instructor auth for every activity, including Gallery Walk, or should some reports remain open by possession of session id?
- [ ] How long after a class should temporary child session report data remain available?
- [ ] Do students need direct access to their own report view, or is an instructor-generated export with per-student filtering enough for the first release?
- [ ] Should report generation happen live from session state every time, or should activities snapshot report data when ended?
