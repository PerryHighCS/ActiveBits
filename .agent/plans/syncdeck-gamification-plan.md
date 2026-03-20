# SyncDeck Gamification Plan

## Status

- [x] Discovery pass complete
- [ ] Contract design approved
- [ ] Phase 1 implemented
- [ ] Phase 2 implemented
- [ ] Phase 3 implemented
- [ ] Phase 4 implemented

## Goals

- Add a parent-owned points model to SyncDeck that accumulates student progress across the full deck.
- Award points for host-observable presentation progress such as slide views.
- Let embedded child activities contribute points back to the parent SyncDeck session.
- Show accumulated points in the SyncDeck experience, starting with the header and a class leaderboard.
- Support lightweight badges and achievements, including simple emoji-style badges.
- Show student progress visually over time with milestone markers tied to slide views and activity achievements.
- Include points, badges, and achievements in exported reports both per activity and in the whole-session summary.
- Preserve activity containment by keeping SyncDeck generic and making child activity reporting additive.

## Current State

- SyncDeck already owns embedded child session lifecycle and persists child launch metadata under `session.data.embeddedLaunch.selectedOptions`.
- SyncDeck already hydrates `session.data.embeddedActivities` for manager and student overlay state.
- SyncDeck already has a one-way host-to-activity postMessage contract for `activebits-embedded` `syncContext`.
- There is not yet a generic reverse child-to-parent telemetry contract for embedded activities to send score/progress deltas back to SyncDeck.
- SyncDeck already has a manager header surface, a students panel, and a session report manifest flow that can be extended without breaking activity containment.

## Proposed Model

### 1. Parent-owned score ledger

Keep the authoritative score ledger on the SyncDeck parent session, not inside child sessions.

Additive parent session shape:

- `session.data.gamification.enabled`
- `session.data.gamification.pointsByStudentId`
- `session.data.gamification.events`
- `session.data.gamification.eventsByInstanceKey`
- `session.data.gamification.leaderboard`
- `session.data.gamification.badgesByStudentId`
- `session.data.gamification.achievementTimelineByStudentId`
- `session.data.gamification.deckAchievementDefinitions`

Recommended event shape:

- `eventId`
- `studentId`
- `displayName`
- `sourceType`: `slide-view | embedded-activity | manual-adjustment`
- `sourceId`: slide key or `instanceKey`
- `activityId`
- `instanceKey`
- `slideKey`
- `scoreKey`
- `mode`
- `pointsDelta`
- `pointsValue`
- `awardedAt`
- `metadata`
- `activityData`

Recommended badge/achievement shape:

- `achievementId`
- `badge`
- `label`
- `description`
- `sourceType`: `deck | slide-view | embedded-activity | manual-award`
- `sourceId`
- `awardedAt`
- `milestoneType`: `slide-view | activity-achievement | badge`
- `pointsAfterAward`

Recommended reporting additions:

- per-activity points earned
- per-activity badges/achievements earned
- whole-session points summary
- whole-session badge/achievement summary
- per-student timeline of major milestones

Why:

- SyncDeck can aggregate across activities without understanding each child session schema.
- Embedded activities can remain self-contained and only emit a small generic score payload.
- Parent-owned state makes header totals, student totals, and end-of-session reporting straightforward.
- The parent ledger can support repeated-play policies like `accumulate`, `replace`, and `max` without hard-coding activity-specific logic in SyncDeck.
- A parent-owned achievement timeline gives the leaderboard a stable way to render left-to-right progress lines with meaningful mileposts.
- The same parent-owned ledger and timeline also provide the raw material for both per-activity report sections and an end-of-session summary report.

### 2. Two scoring channels

#### Channel A: host-observable points

Award points directly in SyncDeck when the host can observe the action itself.

Initial candidates:

- First student view of a slide or slide key
- Optional bonus for reaching embedded-activity anchor slides
- Deck-defined slide achievements such as "Finished warmup" or "Reached checkpoint 3"

Guardrails:

- Deduplicate per student per slide key
- Use first view as the v1 slide-award rule
- Keep the rule simple at first: one award for first visit, no repeat farming

#### Channel B: child activity contribution

Let embedded child activities publish score deltas to the parent session through a new generic contract.

Recommended first contract:

- Parent route: `POST /api/syncdeck/:sessionId/embedded-activity/score`
- Authentication: child session must prove parent linkage using stored `embeddedParentSessionId` and child session id; do not trust raw browser-supplied parent ids alone
- Payload:
  - `childSessionId`
  - `instanceKey`
  - `studentId`
  - `displayName`
  - `scoreKey`
  - `mode`: `accumulate | replace | max`
  - `pointsDelta`
  - `pointsValue`
  - `achievements`
  - `reason`
  - `metadata`

Design note:

- Start with server-to-server style REST from child activity backend to SyncDeck backend, or child activity client -> child activity backend -> SyncDeck route.
- Avoid making arbitrary `postMessage` from embedded iframes the authoritative score path.
- If we later want live browser-only score previews, treat them as non-authoritative UI hints.

Scoring semantics:

- `accumulate`: add to the student's running total, useful for XP on every play
- `replace`: replace the current value for a score bucket, useful when the latest attempt should be authoritative
- `max`: keep the best value seen for a score bucket, useful for highest-score replay loops

Achievement semantics:

- Child activities may optionally emit achievement awards alongside score updates.
- Achievement awards should be additive and append-only in the parent timeline.
- Duplicate suppression should key off `achievementId` per student unless the activity explicitly declares an achievement repeatable.
- SyncDeck should also support instructor-issued manual badge awards for ad hoc recognition during live teaching.

Parent-rollup recommendation:

- Keep the parent ledger event-based for auditability.
- Group events primarily by `instanceKey`, with slide metadata kept on each event for reporting and display.
- Also maintain per-student per-`scoreKey` rollups so `replace` and `max` can recalculate totals deterministically.
- Treat `scoreKey` as activity-owned and opaque to SyncDeck, for example `quiz-1`, `round-2`, or `practice-set-a`.
- Maintain a separate per-student ordered achievement timeline that stores deck milestones, activity achievements, and badge awards for progress-graph rendering.
- Store enough source metadata on score and achievement events to group report output by both `instanceKey` and activity id.
- Allow optional `activityData` on events so activities can attach their own shaped metadata while SyncDeck keeps the core contract generic.
- On rerun, SyncDeck should be able to clear or archive the event bucket for that `instanceKey` and rebuild totals from the new run.

### 3. Deck-authored achievements and badge definitions

Recommended capability:

- Let a deck define optional achievement and badge metadata that SyncDeck can ingest at session start or from slide metadata.
- Let instructors manually award one of the configured badges during a session.
- Let slides provide badge-award prompts that suggest a badge moment and open an instructor selection panel.

Recommended authoring split:

- Per-slide metadata should hold slide-specific triggers, prompts, and checkpoint markers.
- Deck-level data should hold shared badge and achievement definitions reused across slides.

Examples:

- slide milestone: `Completed intro`
- badge: `🧠 Debugger`
- badge: `🚀 Fast Finisher`
- badge: `🏅 Perfect Round`

Recommended deck-owned definition fields:

- `achievementId`
- `label`
- `description`
- `badge`
- `triggerType`: `slide-view | embedded-activity-event | points-threshold`
- `triggerSource`
- `pointsAward`
- `repeatable`

Recommended slide prompt fields:

- `promptId`
- `badgeId`
- `label`
- `description`
- `triggerSlide`
- `autoOpenForInstructor`
- `allowSkip`

Prompt authoring recommendation:

- Reusable or cross-slide badge prompts should be defined in deck-level data.
- Per-slide metadata should reference those deck-level prompts by id when possible.
- Use slide-local prompt definitions only when a prompt is truly specific to one slide and not worth sharing.

Why:

- Presentation authors can theme the experience without adding SyncDeck-specific code.
- SyncDeck remains generic and only evaluates definitions plus incoming events.
- Emoji badges are easy to render in headers, lists, reports, and celebration slides.
- Manual award support lets instructors use the same badge catalog for classroom moments that are not captured automatically.
- Slide-driven prompts let the deck guide instructors toward good recognition moments without forcing automatic awards.
- Separating deck-level definitions from per-slide triggers keeps slide metadata lighter and avoids duplicating badge definitions across the deck.
- The same pattern should apply to badge prompts so decks can reuse prompt definitions without copying them onto many slides.

### 4. Header and leaderboard surfaces

Recommended rollout:

- Manager header: show class total points and a quick student-score entry point
- Student view: show the current student's total points in a compact header/status chip
- Student leaderboard/activity: may show richer celebration visuals outside the manager panel
- End of deck: support a leaderboard celebration slide/activity
- Manager controls: allow manual badge awarding from the student list panel or a lightweight badge action menu
- Slide prompts: when a configured slide is reached, optionally open a badge selection panel for the instructor

Leaderboard options:

- Phase 1: extend the existing SyncDeck student list panel to include points and sorting
- Phase 2: dedicated `leaderboard` activity embeddable at the end of a deck for celebration and richer presentation

Progress display recommendation:

- Keep the instructor's student list panel simple in v1.
- Show points totals inline for each student.
- Add button(s) to assign deck-level badges.
- Add a lightweight milestones list popup rather than an inline graph or chart.
- If richer visualization is still wanted later, prefer putting it in the dedicated leaderboard activity instead of crowding the manager panel.

### 5. Reporting expectations

Gamification data should appear in two reporting scopes:

- per-activity report sections
- whole-session summary report

Per-activity reporting should include:

- points earned in that activity
- activity-scoped badges/achievements earned
- student breakdowns for activity results
- optional milestone extracts for that activity instance

Whole-session summary reporting should include:

- total points per student
- total points by source type
- per-activity and per-score-key breakdowns
- earned badges/achievements across the whole deck
- end-of-session leaderboard summary
- cross-activity milestone timeline for each student
- summarized milestone blocks as the primary storytelling/reporting surface

Implementation recommendation:

- Extend child activity structured reports so they can optionally contribute score and achievement blocks.
- Let SyncDeck add host-owned slide-view points and deck-authored achievements on top of child activity report sections.
- Keep the final SyncDeck report self-contained HTML, consistent with the existing report architecture.
- Default to summary-first report rendering.
- Include selective raw event detail only for meaningful events such as activity score changes, reruns, manual badge awards, and major achievement awards.
- Omit full raw slide-view event dumps from v1 reports unless later debugging needs prove they add value.

Recommendation:

- Reuse the existing manager-side student list panel first instead of creating a second score panel.
- Build the generic parent score ledger and leaderboard data first.
- Keep the reused student list panel intentionally simple: points, badge actions, and milestone popup first.
- Use a dedicated embeddable leaderboard activity for the end-of-deck celebration rather than building a separate built-in SyncDeck celebration screen.
- Use one global points policy for v1 core scoring.
- Surface one combined points total in the live v1 UI.
- Put the richer per-activity and per-score-key breakdowns in exported reports.
- Make exported reports summary-first, not audit-log-first.
- Treat deck-authored achievements, badges, and slide prompts as the first customization layer.
- Limit manual badge awards to deck-defined badges in v1.
- Treat ad hoc live-session badges as an early follow-up enhancement, not a v1 requirement.
- Use a mixed authoring model: deck-level data for shared definitions, per-slide metadata for local triggers/prompts.
- For badge prompts specifically, prefer deck-level prompt definitions plus per-slide references to avoid duplication.
- Defer full per-session point-rule customization until the base scoring/reporting model is stable.
- Use event-style updates as the primary child-activity scoring contract.
- Group those events by slide/activity instance so reruns can clear one bucket cleanly without disturbing the rest of the session.

## Rollout Phases

### Phase 0: Contract and scoring rules

- [ ] Define SyncDeck parent gamification state shape
- [ ] Define score event schema and dedupe rules
- [ ] Define embedded child-to-parent score contribution contract
- [ ] Define per-score-key rollup semantics for `accumulate`, `replace`, and `max`
- [ ] Define badge, achievement, and milestone timeline shapes
- [ ] Define deck-authored achievement and badge definition format
- [ ] Define manual badge-award flow and duplicate/repeat rules
- [ ] Define slide-driven badge prompt format and instructor prompt behavior
- [ ] Define per-instance event-bucket storage and rerun-clearing behavior
- [ ] Define optional `activityData` metadata rules for child activity events
- [ ] Define report grouping rules for points, badges, and achievements at activity and session-summary scope
- [ ] Document the v1 global points policy and its default values
- [ ] Decide whether negative deltas/manual adjustments are supported in v1
- [ ] Document rollout-safe defaults for activities that do not emit scores

Exit criteria:

- Contract docs updated
- Open questions reduced to implementation details

### Phase 1: Host-only points in SyncDeck

- [ ] Track first-view slide points per student in parent session
- [ ] Broadcast parent point updates to manager and student SyncDeck clients
- [ ] Show current points in SyncDeck header/status UI
- [ ] Extend the existing manager student list panel with score columns/sorting
- [ ] Add simple badge display for students where data exists
- [ ] Add manual badge-award control for instructors
- [ ] Support slide-triggered instructor badge prompt panels
- [ ] Add tests for dedupe and reconnect/late-join hydration

Why first:

- It delivers visible progress quickly.
- It does not depend on any embedded activity changes.

### Phase 2: Embedded score contribution contract

- [ ] Add parent score-ingest route with validation and structured logging
- [ ] Add shared helper/types for child activities to report point deltas
- [ ] Support activity-owned repeated-play score policies (`accumulate`, `replace`, `max`)
- [ ] Support child activity achievement/badge publication into the parent timeline
- [ ] Store child activity score events by `instanceKey` and support rerun clearing/archive
- [ ] Update one reference embedded activity to emit points
- [ ] Extend SyncDeck report manifest to include gamification summary blocks and per-activity score/achievement sections
- [ ] Add tests for validation, duplicate suppression, and aggregation

Reference activity recommendation:

- Tentatively start with `resonance`, since it is already being developed in parallel and may be a natural early consumer of score and achievement events.
- Reconfirm branch readiness and contract fit before implementation begins so the gamification contract does not block or destabilize the parallel `resonance` work.

### Phase 3: Leaderboard and celebration UX

- [ ] Decide whether the upgraded manager student list panel is sufficient or whether a separate leaderboard surface still adds value
- [ ] Add student-facing personal score indicator
- [ ] Add badge chips or emoji badges to manager/student leaderboard surfaces
- [ ] Add milestones list popup from the manager student list panel
- [ ] Build dedicated embeddable leaderboard activity for end-of-deck celebration
- [ ] Feed leaderboard activity from parent SyncDeck gamification data

### Phase 4: Optional controls and richer rules

- [ ] Teacher-configurable point rules per deck or session
- [ ] Bonus point triggers for completion streaks or perfect accuracy
- [ ] Manual point adjustments
- [ ] Ad hoc one-off live-session badges created by instructors
- [ ] Badge packs, deck themes, or richer achievement taxonomies if still useful
- [ ] Cross-activity badges or achievements if still desired after points rollout

## Open Questions


## Validation Plan

- Contract/docs only:
  - `npm run lint`
  - `npm run typecheck`
- Workspace implementation touching activities + server:
  - `npm test`
- If sandbox port-binding limits block full server tests:
  - `npm run test:codex`
  - Record the limitation in validation notes

## Recommended First Slice

Build Phase 1 first:

- parent score ledger
- slide-view point awards
- manager/student point display
- score-aware student list panel

Then add one child activity score publisher in Phase 2.

That gets visible value on screen quickly while keeping the first contract small and reviewable.
