# Activity Runtime Audit

## Purpose

Durable inventory of ActiveBits activity trust boundaries, session-entry modes, HTTP routes, WebSocket messages, projections, and recovery behavior. This audit supports the migration plan in `.agent/plans/shared-activity-runtime-authentication.md`.

Treat entries as observations, not desired behavior. Update each activity section only after verifying current code and tests.

## Audit Legend

- `public`: callable without a server-authenticated student or manager principal by design.
- `student`: requires a server-issued participant principal.
- `manager`: requires a server-issued instructor/manager principal.
- `specialized`: requires an activity-specific authenticated role such as reviewer, display, runner, embedded manager, or integration service.
- `unknown`: role requirement still needs code-level classification.

## Repository Baseline

- Registered activities: 15.
- Activities with an activity WebSocket namespace: 14; Postboard is REST/polling based.
- Every activity has server-owned session state or participates in shared session creation.
- Shared entry modes include temporary dashboard sessions, waiting-room entry, standalone/solo entry, persistent links, SyncDeck embedded children, and Learn-backed SyncDeck launches.
- Current activity code commonly combines domain behavior with request authentication, projection, broadcast audience, and recovery decisions.

## Route Inventory Summary

| Activity | HTTP routes | Activity WebSocket | Initial role shapes | Audit status |
| --- | ---: | --- | --- | --- |
| `algorithm-demo` | 5 | `/ws/algorithm-demo` | public/student/manager unknown | Inventory captured |
| `binary-breach` | 8 | `/ws/binary-breach` | student + manager | Inventory captured |
| `embedded-test` | 2 | `/ws/embedded-test` | student + embedded manager | Inventory captured |
| `gallery-walk` | 10 | `/ws/gallery-walk` | manager + reviewer/reviewee | Inventory captured |
| `java-format-practice` | 6 | `/ws/java-format-practice` | student + manager | Inventory captured |
| `java-string-practice` | 6 | `/ws/java-string-practice` | student + manager | Inventory captured |
| `mobcode` | 10 | `/ws/mobcode` | student + manager + solo | Inventory captured |
| `postboard` | 15 | none | student + manager | Inventory captured |
| `python-list-practice` | 5 | `/ws/python-list-practice` | student + manager | Inventory captured |
| `raffle` | 3 | `/ws/raffle` | entrant + manager/display unknown | Inventory captured |
| `resonance` | 18 | `/ws/resonance` | student + manager | Inventory captured |
| `syncdeck` | 16 activity routes plus integration routes | `/ws/syncdeck` | student + manager + embedded + integration | Inventory captured |
| `traveling-salesman` | 15 | `/ws/traveling-salesman` | student + manager | Inventory captured |
| `video-sync` | 6 | `/ws/video-sync` | student + instructor + embedded | Inventory captured |
| `www-sim` | 9 | `/ws/www-sim` | student/simulation host + manager | Inventory captured |

Counts are structural aids, not security assertions. Route registration wrappers and parameterized actions must be inspected individually.

## Per-Activity Audit Checklist

Each activity must document:

- [ ] Session creation and all alternate factories.
- [ ] Public HTTP routes and exact projection.
- [ ] Student HTTP routes and principal source.
- [ ] Manager HTTP routes and principal source.
- [ ] Specialized HTTP roles.
- [ ] WebSocket admission and principal source.
- [ ] Inbound message authorization.
- [ ] Outbound message/broadcast audiences.
- [ ] Sensitive session fields and normalization behavior.
- [ ] Browser-persisted state and credentials.
- [ ] Student and manager reload/recovery behavior.
- [ ] Solo, persistent, embedded, and integration differences.
- [ ] Existing boundary tests and missing cases.

## Activities

### algorithm-demo

- HTTP: create; session read; select; state; event.
- WebSocket: `/ws/algorithm-demo`.
- Initial concern: determine whether state is intentionally public presentation data, whether control mutations are manager-only, and how the socket distinguishes controller from observers.
- [ ] Complete classification.

### binary-breach

- HTTP: create; state; settings; new mission; student register/answer/retry/hint.
- WebSocket: `/ws/binary-breach` shared by student and manager clients.
- Sensitive state: named roster, per-student progress, current challenge/mission state.
- Initial concern: student attribution and manager authority are activity-local; manager REST and socket access must migrate together.
- [ ] Complete classification.

### embedded-test

- HTTP: create; session read.
- WebSocket: `/ws/embedded-test`.
- Initial concern: accepted-entry student identity and embedded-parent manager trust must use explicit platform adapters even though this activity is development-facing.
- [ ] Complete classification.

### gallery-walk

- HTTP: create; stage; reviewee; reviewer; feedback submit/read; export/report; title.
- WebSocket: `/ws/gallery-walk`.
- Specialized roles: reviewer and reviewee may not map cleanly to a single generic student role.
- Sensitive state: attributed feedback, QR/reviewer assignment, report/export data.
- Initial concern: model scoped reviewer/reviewee authority without leaking peer feedback or treating IDs as credentials.
- [ ] Complete classification.

### java-format-practice

- HTTP: create; session read; difficulty; theme; stats; students.
- WebSocket: `/ws/java-format-practice` shared by student and manager clients.
- Sensitive state: named roster and attributed progress.
- Initial concern: representative pilot for automatic manager capability plus student principal enforcement across both transports.
- [ ] Complete classification.

### java-string-practice

- HTTP: create; session read; methods; progress; students.
- WebSocket: `/ws/java-string-practice` shared by student and manager clients.
- Sensitive state: named roster and attributed progress.
- Initial concern: close sibling of Java Format; use it to verify the shared contract generalizes without copy/paste auth.
- [ ] Complete classification.

### mobcode

- HTTP: create/create-solo; session; student workspace; manager session; workspace state/reset; student-code actions; shared workspace; manager state.
- WebSocket: `/ws/mobcode` with an explicit manager-auth message protocol.
- Sensitive state: private student source code, named workspaces, instructor state, shared workspace.
- Initial concern: preserve its stronger role model and use it as evidence for the shared principal contract rather than flattening its domain protocol.
- [ ] Complete classification.

### postboard

- HTTP: create; instructor/student state; report; setup; post creation; moderation; delete; reorder; flag; reactions.
- WebSocket: none; student state uses polling.
- Sensitive state: post ownership, rejected/pending content, flags, names, raw reactions, instructor settings.
- Initial concern: explicit public/student/manager projections and consistent manager authorization for all moderation/report routes.
- [ ] Complete classification.

### python-list-practice

- HTTP: create; session read; students; stats; question types.
- WebSocket: `/ws/python-list-practice` shared by student and manager clients.
- Sensitive state: named roster and attributed stats.
- Initial concern: manager/student socket admission and terminal auth-recovery behavior.
- [ ] Complete classification.

### raffle

- HTTP: create; generate ticket; list tickets.
- WebSocket: `/ws/raffle`.
- Initial concern: distinguish entrant, manager, and any public display/observer behavior; determine whether ticket lists are intentionally public to session members.
- [ ] Complete classification.

### resonance

- HTTP: create; link preparation; instructor recovery; registration; student state/submission; instructor responses and question controls; report.
- WebSocket: `/ws/resonance` shared across roles.
- Sensitive state: private answers/drafts, names, annotations, instructor controls, passcode/recovery data.
- Initial concern: issue #341 demonstrates required student isolation, but current activity-local implementation is evidence rather than the final shared API.
- [ ] Complete classification.

### syncdeck

- HTTP: create/configure; instructor recovery; student return; embedded context/start/end/entry/activation; reports; deletion; manager passcode exchange; Learn integration and browser handoffs.
- WebSocket: `/ws/syncdeck` with student, manager, and embedded orchestration behavior.
- Specialized roles: Learn service, substitute instructor, embedded manager, parent manager, student.
- Sensitive state: presentation configuration, child credentials/handoffs, instructor recovery, student mappings, reports.
- Initial concern: migrate last; define explicit adapters for each authority source and preserve child/parent lifecycle semantics.
- [ ] Complete classification.

### traveling-salesman

- HTTP: create/session; problem/reset/broadcast controls; algorithms; instructor route controls; leaderboard; student route submission.
- WebSocket: `/ws/traveling-salesman` shared by student and manager clients.
- Sensitive state: named routes, leaderboard, instructor controls, solution broadcasts.
- Initial concern: route modules need composable shared middleware so authorization is not repeated across files.
- [ ] Complete classification.

### video-sync

- HTTP: create; instructor recovery; session read/update; command; event.
- WebSocket: `/ws/video-sync` with normalized instructor/manager roles.
- Specialized modes: temporary, persistent, embedded, student.
- Sensitive state: instructor passcode/recovery, playback control authority, event telemetry.
- Initial concern: use as reference for instructor adapters and role normalization; verify that student identity remains telemetry-only where intended.
- [ ] Complete classification.

### www-sim

- HTTP: public passages; create/session; join; student update/delete; assignment create/update; per-host fragments.
- WebSocket: `/ws/www-sim`.
- Specialized roles: simulated host/student identity may require scoped resource authority beyond a generic participant ID.
- Sensitive state: host assignments, per-host fragments, topology/control mutations.
- Initial concern: distinguish simulation addressing from authentication identity and authorize per-host resources explicitly.
- [ ] Complete classification.

## Cross-Cutting Findings to Verify

- [ ] Which create routes are reachable only through the manager dashboard versus directly callable by any browser.
- [ ] Which create responses can establish automatic httpOnly manager capability without changing client UX.
- [ ] Which manager views are recoverable after reload and which rely only on URL/session ID possession.
- [ ] Which WebSocket broadcasts contain full session or roster objects.
- [ ] Which REST reads return raw activity session data.
- [ ] Which role query parameters are routing hints versus current authority.
- [ ] Which activities have intentional anonymous/public displays.
- [ ] Which normalizers spread unknown fields and which reconstruct data narrowly.
- [ ] Which persistent/embedded factories bypass normal activity create routes.
- [ ] Which clients persist participant IDs, names, passcodes, or manager context in browser storage.

## Next Audit Slice

- [ ] Fully audit `java-format-practice` as the representative simple shared student/manager WebSocket activity.
- [ ] Produce its exact route principal table, WebSocket message audience table, session fields, client persistence, and missing tests.
- [ ] Compare it with `mobcode` and `video-sync` before proposing the shared manager-capability contract.
