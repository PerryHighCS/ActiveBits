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

- Configuration: standalone entry, direct path, permalink, home-card visibility, and a required waiting-room `displayName`. Solo clients use a synthetic `solo-*` session ID and do not call the activity server.
- Session creation: `POST /create` creates one activity session, initializes normalized defaults, and returns only `{ id }`. It issues no manager capability. The same endpoint is the activity factory used by the shared creation flow; no second activity-local factory was found.
- Stored activity fields: `students`, `selectedDifficulty`, and `selectedTheme`. The normalizer spreads unknown fields before replacing these fields, so platform-owned accepted-entry and participant-token metadata survives normalization.
- Browser state: students keep the display name and request-visible participant ID in `localStorage`; exercise statistics are also stored under the session and participant ID. Waiting-room handoff resolution reads `sessionStorage`. The manager stores no credential because none is issued.

#### HTTP principal table

| Route | Intended principal | Current principal source | Projection/mutation | Confirmed boundary |
| --- | --- | --- | --- | --- |
| `POST /api/java-format-practice/create` | public creation adapter | none | Creates session; returns ID | Creation is directly callable; automatic manager authority cannot currently be established. |
| `GET /api/java-format-practice/:sessionId` | public/session member | none beyond session ID | Returns ID, type, difficulty, theme | Narrow public projection; roster is excluded. |
| `POST /api/java-format-practice/:sessionId/difficulty` | manager | none beyond session ID | Mutates difficulty; broadcasts it | Anyone knowing the session ID can control it. |
| `POST /api/java-format-practice/:sessionId/theme` | manager | none beyond session ID | Mutates theme; broadcasts it | Anyone knowing the session ID can control it. |
| `POST /api/java-format-practice/:sessionId/stats` | student | body `studentId`, with optional body name fallback | Replaces one participant's attributed statistics; broadcasts the full roster | The route does not resolve the participant cookie and accepts a request-controlled participant ID. |
| `GET /api/java-format-practice/:sessionId/students` | manager | none beyond session ID | Returns names, connection state, timestamps, and statistics | The full roster is readable to anyone knowing the session ID. |

All six handlers lack a top-level error boundary and use a mix of unstructured console logging and no logging, so they also fall short of the shared route error/logging contract.

#### WebSocket principal and message table

The student and manager clients both connect to `/ws/java-format-practice`. Admission currently has one student-shaped path:

- The server reads `sessionId`, `studentId`, and `studentName` from the query string.
- It calls `connectAcceptedSessionParticipant`, but that helper uses an accepted entry only to recover a missing name. A supplied non-empty name is sufficient, and a supplied unknown participant ID is inserted as a new participant.
- The manager connects with only `sessionId`. It therefore has neither an accepted participant nor a fallback name; the helper returns `null` and the server sends `waiting-room-required` before closing with code 1008. The current manager socket cannot receive live roster updates.
- A successfully admitted socket receives `studentId`. Duplicate sockets are closed by participant ID, and close marks that participant disconnected.
- The server accepts no inbound domain messages. All mutations use HTTP.

| Outbound message | Current audience | Data | Intended audience |
| --- | --- | --- | --- |
| `studentId` | newly admitted socket | participant ID | authenticated student only |
| `studentsUpdate` | every open socket with matching session ID | full named roster and statistics | manager only |
| `difficultyUpdate` | every open socket with matching session ID | selected difficulty | authenticated student plus manager |
| `themeUpdate` | every open socket with matching session ID | selected theme | authenticated student plus manager |
| `error` / `waiting-room-required` | rejected socket | auth failure code/message | rejected socket only |
| shared `session-ended` | matching session sockets through platform behavior | termination signal | all admitted roles |

Pub/sub broadcast filtering is session-only, so the same missing audience boundary exists across instances.

#### Recovery and test coverage

- Student reload reconstructs request-visible identity from local storage and the shared handoff resolver, then reconnects with ID/name query claims. Cookie loss is not enforced by this activity socket or stats route.
- Manager reload has no credential to recover. The page can still call manager REST endpoints, but its socket is rejected as a student without a name.
- Existing activity tests cover domain formatting and validation utilities plus module exports. No activity route or socket boundary tests exist.
- Shared persistent-entry tests mention the activity only as a configuration fixture; they do not cover these handlers.

Missing boundary cases: manager capability issuance/reload, unauthorized manager REST reads and writes, cookie-derived student attribution, forged participant IDs/names, manager socket admission, unauthorized sockets receiving no snapshots or broadcasts, audience-filtered pub/sub, duplicate/reconnect behavior after cookie expiry, and structured handler failures.

- [x] Complete route, message, persistence, recovery, and test classification.

### java-string-practice

- Configuration and creation modes match Java Format: standalone/direct/permalink/home entry, required waiting-room display name, client-only synthetic solo sessions, and one unauthenticated activity create route returning only the session ID.
- Stored fields are `students` and `selectedMethods`. Its normalizer also spreads unknown session fields, preserving platform metadata.
- Browser state uses the shared participant identity/handoff helpers. Unlike Java Format, exercise stats are stored under `java-string-stats-${sessionId}` rather than a participant-scoped key, so two participants using the same browser/session can inherit one another's local stats.

| Route | Intended principal | Current principal source | Projection/mutation |
| --- | --- | --- | --- |
| `POST /api/java-string-practice/create` | public creation adapter | none | Creates session; returns ID; issues no manager capability. |
| `GET /api/java-string-practice/:sessionId` | public/session member | session ID only | Narrow projection of ID, type, and selected methods. |
| `POST /api/java-string-practice/:sessionId/methods` | manager | session ID only | Changes allowed methods and broadcasts them. |
| `POST /api/java-string-practice/:sessionId/progress` | student | body `studentId` and body `studentName` | Replaces attributed stats and broadcasts full roster. |
| `GET /api/java-string-practice/:sessionId/students` | manager | session ID only | Returns named roster, connection timestamps, and stats. |

The WebSocket implementation is structurally the same as Java Format:

- Student query claims are `sessionId`, `studentId`, and `studentName`; a supplied name bypasses the accepted-entry-name lookup and an unknown supplied ID can become a new participant.
- The manager supplies only `sessionId`, so student-shaped admission sends `waiting-room-required` and closes it. Live manager roster updates therefore do not work.
- `studentId` is socket-private, while `studentsUpdate` (full roster) and `methodsUpdate` are broadcast to every socket in the session, including through unfiltered pub/sub.
- There are no inbound domain socket messages. Duplicate-ID and disconnect behavior matches Java Format.

Recovery also matches Java Format: local request-visible student hints are replayed without activity-level cookie enforcement, while the manager has no credential or credential recovery. All five handlers lack top-level error handling and structured logs.

Existing activity tests cover route validators and client/domain utilities only. Shared entry and Playwright waiting-room tests exercise platform handoff behavior but do not test these activity routes, socket admission, role audiences, forged attribution, manager reload, or auth expiry.

- [x] Complete route, message, persistence, recovery, and test classification.

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

- Configuration/creation matches the other practice activities: standalone/direct/permalink/home entry, required display name, a synthetic client-only solo mode, and one unauthenticated create route that returns only `{ id }`.
- Stored activity fields are `students` and `selectedQuestionTypes`.
- Critical normalization difference: `normalizeSessionData` reconstructs only those two fields instead of spreading unknown fields. Every normalization can therefore discard platform-owned accepted-entry and participant-token metadata. This must be corrected as part of the platform metadata boundary, not copied into a compatibility layer.

| Route | Intended principal | Current principal source | Projection/mutation |
| --- | --- | --- | --- |
| `POST /api/python-list-practice/create` | public creation adapter | none | Creates session; returns ID; issues no manager capability. |
| `GET /api/python-list-practice/:sessionId` | public/session member plus manager data | session ID only | Returns full named roster/statistics and selected question types. |
| `GET /api/python-list-practice/:sessionId/students` | manager | session ID only | Returns full named roster/statistics. |
| `POST /api/python-list-practice/:sessionId/stats` | student | body `studentId` and/or `studentName` | Updates an existing participant or creates a named participant, then broadcasts the roster. |
| `POST /api/python-list-practice/:sessionId/question-types` | manager | session ID only | Changes question types and broadcasts them. |

The shared WebSocket namespace differs materially from the Java activities:

- Any socket with a session ID is retained and receives an immediate `questionTypesUpdate` before identity checks.
- A socket with no student name is treated as an observer in practice. This is how the manager receives broadcasts, but there is no authenticated role or explicit public-display declaration; any anonymous session-ID holder gets the same access.
- Named sockets use the same accepted-participant helper weakness as the Java activities: a request-supplied name is enough and a request-supplied ID can be adopted. The client itself generates an ID before server admission.
- `studentsUpdate` containing the full roster/statistics and `questionTypesUpdate` go to every session socket, including unfiltered pub/sub. `studentId` goes to the admitted student socket.
- There are no inbound domain messages. Manager mutation remains on unprotected HTTP.
- Unlike the Java helpers, this socket does not close duplicate participant sockets. Multiple connections can independently mark the same participant disconnected when either closes.

Student request-visible identity and participant-scoped stats are stored in `localStorage`; waiting-room handoff uses `sessionStorage`. Neither REST nor WebSocket validates the participant cookie. The manager holds no credential and relies entirely on session-ID access.

Activity tests cover client/domain utilities and exports, but there are no activity server route/socket tests. Shared status/registry tests use the activity as a fixture without enforcing its trust boundaries.

Missing cases include platform metadata preservation, explicit observer policy, narrow public projection, manager REST/socket authentication, pre-admission snapshot denial, claimed-ID/name rejection, cookie-derived stats attribution, roster audience filtering across local/pub-sub delivery, duplicate socket semantics, expiry recovery, and handler error/logging behavior.

- [x] Complete route, message, persistence, recovery, and test classification.

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

- [x] Fully audit `java-format-practice` as the representative simple shared student/manager WebSocket activity.
- [x] Produce its exact route principal table, WebSocket message audience table, session fields, client persistence, and missing tests.
- [x] Compare its manager boundary with `mobcode` and `video-sync` before proposing the shared manager-capability contract.
- [x] Audit `java-string-practice` to determine how much of Java Format's behavior is copied and how much differs.
- [x] Audit `python-list-practice` to test whether the same contract covers a third practice activity without activity-specific exceptions.
- [ ] Consolidate the three practice audits into pilot requirements and decide whether anonymous observer access is needed by any of them.
- [ ] Audit `binary-breach` as the next distinct student-progress activity.

## Pilot Comparison: Java Format, MobCode, and Video Sync

This comparison is limited to evidence needed to choose the pilot contract; it is not a completed audit of MobCode or Video Sync.

| Concern | Java Format | MobCode | Video Sync | Contract implication |
| --- | --- | --- | --- | --- |
| Temporary creator authority | none | random passcode returned in JSON and stored in session | random passcode returned in JSON and stored in session | Replace client-readable temporary credentials with an automatically issued httpOnly manager capability. |
| Manager REST | session ID only | passcode repeated in request bodies | passcode repeated in request bodies | Shared middleware should resolve the manager principal once from a cookie. |
| Manager WebSocket | manager is rejected by student admission | query role is only a hint; `manager-auth` message is verified before manager mutations/audience | instructor query role triggers an auth-message challenge before subscription/snapshot | Preserve Video Sync's crucial ordering: authenticate before subscription or initial state, but source authority from the shared capability. |
| Student REST identity | request body ID | accepted-entry httpOnly participant cookie | telemetry accepts optional body `studentId`; activity treats it as attribution, not authority | The shared student principal must replace claimed IDs for protected state; explicitly declare non-authoritative telemetry identifiers where needed. |
| Outbound audience | session-only full-roster broadcast | explicit `all`/`managers` filtering, including pub/sub | common playback/telemetry projection after socket admission | Shared delivery needs authenticated audience filtering modeled after MobCode, not activity-local socket flags. |
| Recovery | student local hints; no manager credential | location/router bootstrap, then `sessionStorage` fallback | location/router bootstrap plus persistent/embedded teacher-cookie recovery | Keep persistent/embedded authority adapters, but do not retain browser-stored passcodes in the new temporary-session design. |
| Projection | narrow public state; separate unprotected roster | explicit student and manager snapshots | explicit public session projection excludes passcode | Make projections declared and role-specific; retain proven narrow projection builders. |

The comparison supports Java Format as the first migration: it is small enough to expose the complete contract, while MobCode supplies audience/projection examples and Video Sync supplies the correct authenticate-before-subscribe lifecycle. Neither passcode implementation should be copied as the new temporary manager credential model.
