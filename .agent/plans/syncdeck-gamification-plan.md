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
- `scoreKey`
- `mode`
- `pointsDelta`
- `pointsValue`
- `awardedAt`
- `metadata`

Recommended badge/achievement shape:

- `achievementId`
- `badge`
- `label`
- `description`
- `sourceType`: `deck | slide-view | embedded-activity`
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

Parent-rollup recommendation:

- Keep the parent ledger event-based for auditability.
- Also maintain per-student per-`scoreKey` rollups so `replace` and `max` can recalculate totals deterministically.
- Treat `scoreKey` as activity-owned and opaque to SyncDeck, for example `quiz-1`, `round-2`, or `practice-set-a`.
- Maintain a separate per-student ordered achievement timeline that stores deck milestones, activity achievements, and badge awards for progress-graph rendering.
- Store enough source metadata on score and achievement events to group report output by both `instanceKey` and activity id.

### 3. Deck-authored achievements and badge definitions

Recommended capability:

- Let a deck define optional achievement and badge metadata that SyncDeck can ingest at session start or from slide metadata.

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

Why:

- Presentation authors can theme the experience without adding SyncDeck-specific code.
- SyncDeck remains generic and only evaluates definitions plus incoming events.
- Emoji badges are easy to render in headers, lists, reports, and celebration slides.

### 4. Header and leaderboard surfaces

Recommended rollout:

- Manager header: show class total points and a quick student-score entry point
- Student view: show the current student's total points in a compact header/status chip
- Student leaderboard: show badges and a compact progress display that grows left-to-right
- End of deck: support a leaderboard celebration slide/activity

Leaderboard options:

- Phase 1: extend the existing SyncDeck student list panel to include points and sorting
- Phase 2: dedicated `leaderboard` activity embeddable at the end of a deck for celebration and richer presentation

Progress display recommendation:

- Add a compact sparkline-style or segmented progress line per student row.
- Plot timeline growth from left to right.
- Render milestone markers for:
  - slide-view milestones
  - embedded activity achievements
  - badge awards
- Keep v1 visual and simple rather than building a full charting system.

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
- earned badges/achievements across the whole deck
- end-of-session leaderboard summary
- cross-activity milestone timeline for each student

Implementation recommendation:

- Extend child activity structured reports so they can optionally contribute score and achievement blocks.
- Let SyncDeck add host-owned slide-view points and deck-authored achievements on top of child activity report sections.
- Keep the final SyncDeck report self-contained HTML, consistent with the existing report architecture.

Recommendation:

- Reuse the existing manager-side student list panel first instead of creating a second score panel.
- Build the generic parent score ledger and leaderboard data first.
- Add achievement markers to the reused student list panel only after the underlying timeline contract exists.
- Delay a standalone leaderboard activity until the shared data contract is proven.

## Rollout Phases

### Phase 0: Contract and scoring rules

- [ ] Define SyncDeck parent gamification state shape
- [ ] Define score event schema and dedupe rules
- [ ] Define embedded child-to-parent score contribution contract
- [ ] Define per-score-key rollup semantics for `accumulate`, `replace`, and `max`
- [ ] Define badge, achievement, and milestone timeline shapes
- [ ] Define deck-authored achievement and badge definition format
- [ ] Define report grouping rules for points, badges, and achievements at activity and session-summary scope
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
- [ ] Add tests for dedupe and reconnect/late-join hydration

Why first:

- It delivers visible progress quickly.
- It does not depend on any embedded activity changes.

### Phase 2: Embedded score contribution contract

- [ ] Add parent score-ingest route with validation and structured logging
- [ ] Add shared helper/types for child activities to report point deltas
- [ ] Support activity-owned repeated-play score policies (`accumulate`, `replace`, `max`)
- [ ] Support child activity achievement/badge publication into the parent timeline
- [ ] Update one reference embedded activity to emit points
- [ ] Extend SyncDeck report manifest to include gamification summary blocks and per-activity score/achievement sections
- [ ] Add tests for validation, duplicate suppression, and aggregation

Reference activity recommendation:

- Start with a low-risk embedded activity that already tracks clear per-student completion events.

### Phase 3: Leaderboard and celebration UX

- [ ] Decide whether the upgraded manager student list panel is sufficient or whether a separate leaderboard surface still adds value
- [ ] Add student-facing personal score indicator
- [ ] Add badge chips or emoji badges to manager/student leaderboard surfaces
- [ ] Add per-student left-to-right progress line with milestone markers
- [ ] Add optional end-of-session leaderboard view in SyncDeck
- [ ] Decide whether a dedicated embeddable leaderboard activity is still needed

### Phase 4: Optional controls and richer rules

- [ ] Teacher-configurable point rules per deck or session
- [ ] Bonus point triggers for completion streaks or perfect accuracy
- [ ] Manual point adjustments
- [ ] Badge packs, deck themes, or richer achievement taxonomies if still useful
- [ ] Cross-activity badges or achievements if still desired after points rollout

## Open Questions

- Should slide-view points award when the student first reaches a slide, when they stay on it for a threshold, or only when an instructor marks it complete?
- Do we want one global points policy for all SyncDeck sessions first, or per-session point-rule configuration?
- Should child activities send only event-style updates, or also publish summary snapshots for recovery/reconciliation?
- Is the end-of-deck celebration best served by a built-in SyncDeck screen, an embeddable leaderboard activity, or both?
- Which existing embedded activity is the safest first consumer of the score contribution contract?
- Do we want to expose only one combined points total in v1, or also surface per-activity/per-score-key breakdowns?
- Should deck-authored achievement definitions live in slide metadata, a deck-level manifest, or both?
- What is the minimum viable progress visualization for the student list panel: sparkline, segmented bar, or simple milestone dots?
- How much raw event detail should appear in exported reports versus summarized milestone blocks?

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
