# SyncDeck Future Plan

This document now tracks **post-v1 work only** and is intentionally aligned with:
- `.agent/plans/syncdeck-checklist.md`

v1 implementation details, delivered behavior, and completed checkpoints are out of scope for this plan.

## Scope

Future planning is currently organized into three tracks:
1. Student position enhancements
2. Embedded activities
3. Chalkboard evolution

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

### Notes
- This section represents enhancements targeted for future iterations.

---

## 2) Embedded Activities

### Goals
- Let presentations launch embedded ActiveBits activities by slide events.
- Keep embedded sessions linked to the parent SyncDeck session.
- Support reporting and instructor workflows around embedded runs.

### Planned Work
- Presentations can start activity by slide events.
- Embedded activities have their own session linked to parent session.
  - Candidate ID shape: `CHILD:parentid:childid`.
  - Parent/child IDs are session IDs.
  - Server does not cull children until parent is culled.
  - Student identities/names sync from parent session.
- Instructor can download a report.
  - Activities may need to generate HTML for reporting.
- Add an activity picker that can issue codes for presentation use.

### Notes
- Session-linking, lifecycle, and reporting contracts should be specified before implementation.

---

## 3) Chalkboard Evolution

### Goals
- Move from basic controls to richer collaborative chalkboard behavior.

### Planned Work
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

## Source of Truth

Checklist status and execution order should be maintained in:
- `.agent/plans/syncdeck-checklist.md`
