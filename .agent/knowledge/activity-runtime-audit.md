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
| `algorithm-demo` | 5 | `/ws/algorithm-demo` | public observer + manager | Fully classified |
| `binary-breach` | 8 | `/ws/binary-breach` | student + manager | Fully classified |
| `embedded-test` | 2 | `/ws/embedded-test` | student + embedded manager | Fully classified |
| `gallery-walk` | 11 | `/ws/gallery-walk` | manager + reviewer/reviewee | Fully classified |
| `java-format-practice` | 6 | `/ws/java-format-practice` | student + manager | Fully classified |
| `java-string-practice` | 5 | `/ws/java-string-practice` | student + manager | Fully classified |
| `mobcode` | 10 | `/ws/mobcode` | student + manager + solo | Fully classified |
| `postboard` | 15 | none | student + manager | Fully classified |
| `python-list-practice` | 5 | `/ws/python-list-practice` | student + manager | Fully classified |
| `raffle` | 3 | `/ws/raffle` | anonymous entrant + manager | Fully classified |
| `resonance` | 18 | `/ws/resonance` | student + manager | Fully classified |
| `syncdeck` | 14 activity routes plus 9 Learn routes | `/ws/syncdeck` | student + manager + embedded + integration | Fully classified |
| `traveling-salesman` | 15 | `/ws/traveling-salesman` | student + manager | Fully classified |
| `video-sync` | 6 | `/ws/video-sync` | student + instructor + embedded | Fully classified |
| `www-sim` | 9 | `/ws/www-sim` | scoped host + manager | Fully classified |

Counts are structural aids, not security assertions. Route registration wrappers and parameterized actions must be inspected individually.

## Per-Activity Audit Checklist

Each activity must document:

- [x] Session creation and all alternate factories.
- [x] Public HTTP routes and exact projection.
- [x] Student HTTP routes and principal source.
- [x] Manager HTTP routes and principal source.
- [x] Specialized HTTP roles.
- [x] WebSocket admission and principal source.
- [x] Inbound message authorization.
- [x] Outbound message/broadcast audiences.
- [x] Sensitive session fields and normalization behavior.
- [x] Browser-persisted state and credentials.
- [x] Student and manager reload/recovery behavior.
- [x] Solo, persistent, embedded, and integration differences.
- [x] Existing boundary tests and missing cases.

## Activities

### algorithm-demo

- Product intent is explicit in the activity documentation: live students anonymously watch an instructor-controlled synchronized visualization and do not interact; solo students control a client-only copy. This is a genuine public observer projection.
- Configuration supports standalone/direct/permalink/home solo entry and embedded/persistent algorithm preselection, with no waiting-room identity fields.
- Stored fields are algorithm ID, arbitrary algorithm state, and server history. The normalizer spreads unknown fields, preserving platform metadata.
- Creation is unauthenticated, returns only `{ id }`, and establishes no manager authority.

| Route | Intended principal | Current principal source | Boundary |
| --- | --- | --- | --- |
| `POST /api/algorithm-demo/create` | public creation adapter | none | Creates session without manager capability. |
| `GET /api/algorithm-demo/:sessionId/session` | public observer projection or manager projection | session ID only | Returns the entire raw `SessionRecord`, including history, unknown platform metadata, embedded launch fields, and unprojected algorithm state. |
| `POST /api/algorithm-demo/:sessionId/select` | manager | session ID only | Replaces algorithm ID/state, records history, broadcasts selection. |
| `POST /api/algorithm-demo/:sessionId/state` | manager | session ID only | Replaces arbitrary algorithm state, records history keys, broadcasts state. |
| `POST /api/algorithm-demo/:sessionId/event` | manager | session ID only | Accepts arbitrary event type/payload, records type, and broadcasts payload. Current clients ignore these events, but the extensible protocol makes unauthenticated injection unsafe. |

The public observer cannot receive the same raw algorithm state as the manager in all cases. The guessing-game state contains the instructor's secret number; the student UI deliberately does not display it, but the raw HTTP response and socket state still expose it to browser developer tools. Each algorithm therefore needs an activity-owned observer projection (for example omitting `secret` until reveal), not just a generic shallow session projection.

#### WebSocket role decision

- Manager and student clients both connect with only `sessionId`; the server immediately subscribes them without first verifying the session exists.
- The socket is outbound-only on the server. The manager client attempts to send selection/state messages over it, but no server message handler consumes them; REST performs the actual mutations.
- `algorithm-selected`, `state-sync`, and `event` are broadcast identically to every local/pub-sub socket. The first two are intentionally observer-visible only after the activity applies its observer projection. Arbitrary manager events need an explicit declared public projection before delivery.
- There is no initial socket snapshot; both clients load HTTP state first. Students additionally poll the raw session every three seconds.

Target roles:

- `manager`: automatic capability; complete state and all controls.
- `public`: activity-declared anonymous observer; validated session admission and read-only projected state/messages, with no credential or participant identity.
- solo: local client mode outside live-session authorization.

This resolves the cross-cutting observer decision: support public/anonymous sockets only when the activity explicitly declares a public projection. A session ID can locate that projection but never inherits manager state or mutations.

#### Persistence, recovery, and tests

- Live observers store no identity or credential. Reload fetches and resubscribes to the public projection.
- Solo state is saved in `localStorage` under the synthetic solo session ID.
- Managers hold no credential and rely on session-ID-only REST/socket access.
- Server tests cover namespace registration, creation, selection persistence/broadcasting, invalid session/state normalization, and pub/sub failure tolerance. Client tests cover message parsing, embedded option reading, solo rendering, and algorithm domain behavior.
- Missing tests cover manager authorization, public projection/secret exclusion, raw platform metadata exclusion, session validation before socket subscription, unauthorized mutations, message projection, reload, and public-versus-manager pub/sub isolation.

- [x] Complete route, message, persistence, recovery, and test classification.

### binary-breach

- Configuration: standalone/direct/permalink/home entry, required waiting-room display name, client-only solo play, and persistent/embedded launch options for mission settings.
- Session creation: the unauthenticated activity create route returns only `{ id }`; embedded/persistent sessions may instead arrive with `embeddedLaunch.selectedOptions`, which the normalizer reads to hydrate settings.
- Stored fields: settings, students, mission seed, and active flag. Student records contain identity, connection timestamps, progress, challenge index, and the current private challenge.
- Critical normalization issue: the normalizer reconstructs only activity fields and drops unknown platform metadata. It also consumes then drops `embeddedLaunch`, so subsequent normalization retains hydrated settings but loses the launch envelope and any accepted-entry/token data.

| Route | Intended principal | Current principal source | Projection/mutation |
| --- | --- | --- | --- |
| `POST /api/binary-breach/create` | public creation adapter | none | Creates session and returns ID; issues no manager capability. |
| `GET /api/binary-breach/:sessionId/state` | manager | session ID only | Returns mission settings and named roster with connection state, progress, and challenge index. |
| `POST /api/binary-breach/:sessionId/settings` | manager | session ID only | Replaces settings and broadcasts roster/settings. |
| `POST /api/binary-breach/:sessionId/mission/new` | manager | session ID only | Resets every student and broadcasts manager roster plus per-student mission state. |
| `POST /api/binary-breach/:sessionId/student/register` | student | body `studentId`/`studentName` | Finds or creates a student and returns that student's challenge/progress. |
| `POST /api/binary-breach/:sessionId/student/answer` | student | body `studentId`/`studentName` | Validates against and advances the selected student's stored challenge. |
| `POST /api/binary-breach/:sessionId/student/retry` | student | body `studentId`/`studentName` | Resets the selected student's mission. |
| `POST /api/binary-breach/:sessionId/student/hint` | student | body `studentId`/`studentName` | Mutates hint/progress state and returns the selected student's challenge/hint. |

`ensureStudent` trusts valid request IDs. A caller can select an existing student by ID, rename that record using a supplied name, and answer, retry, or request hints as that student. An unknown supplied ID creates a record with that server-accepted ID. Registration is therefore not merely public enrollment; it is also the identity resolver for every protected student mutation.

#### WebSocket boundary

- The shared namespace reads `sessionId`, `studentId`, and `studentName` from query parameters and subscribes before resolving any role or identity.
- An anonymous session-ID-only socket is retained as the manager/observer path. On every connection the server broadcasts the manager roster to all session sockets.
- A claimed student ID/name is passed to the same permissive `ensureStudent` resolver, with no accepted-entry or participant-cookie check.
- `binary-breach:roster` includes every student's name, connected status, progress, and challenge index and is delivered to managers, students, and anonymous sockets through both local and unfiltered pub/sub delivery.
- `binary-breach:mission-reset` contains one student's private current challenge/progress/settings and is targeted locally by matching request-controlled socket ID/name. It is not published, but a forged student socket can match another student and receive their reset state.
- There are no inbound socket messages. Student answer/hint/retry traffic is HTTP.
- Duplicate sockets are not closed or reference-counted; closing any socket carrying an ID marks that participant disconnected even if another connection remains active.

#### Persistence, recovery, and tests

- Students persist request-visible identity in `localStorage` and resolve waiting-room handoff via `sessionStorage`; there is no separate local stats store because progress is server-owned.
- Student reload immediately calls the claimed-identity registration route, then opens a claimed-identity socket. Cookie loss is not detected.
- The manager stores no credential. It polls the unprotected manager state every 2.5 seconds and uses an anonymous socket for roster updates.
- Server tests provide useful domain coverage for creation, embedded setting hydration, duplicate display names, answer validation, settings, hints, retry, mission reset, stale challenge behavior, and pub/sub failure tolerance. Manager component tests cover query-setting races and roster updates.
- Missing tests cover every auth boundary: capability issuance/reload, manager route/socket denial, cookie-derived student selection, forged IDs/renames, cross-student mission reset delivery, roster audience isolation, pre-auth subscription, duplicate disconnect behavior, metadata preservation, and terminal recovery.

Migration implication: the practice pilot principal/projection contract generalizes without a new role. Binary Breach adds private per-student command responses and targeted socket delivery, so shared runtime APIs must support `sendToParticipant(principalId, ...)` in addition to role-audience broadcasts.

- [x] Complete route, message, persistence, recovery, and test classification.

### embedded-test

- This is a development-only SyncDeck contract harness. Standalone entry, direct paths, permalinks, and home surfacing are disabled, but its activity-local create and manager URLs remain directly callable.
- SyncDeck normally creates it as a child session with `embeddedParentSessionId`, instance/location data, and `embeddedLaunch`. The activity create route is a second, unauthenticated factory that returns only `{ id }` and establishes no manager authority.
- Stored activity fields are `students` and the last 100 chat `messages`. The normalizer spreads unknown data, so accepted-entry records, participant token maps, embedded launch metadata, and manager bootstrap metadata survive normalization.

| Route | Intended principal | Current principal source | Boundary |
| --- | --- | --- | --- |
| `POST /api/embedded-test/create` | public development factory | none | Creates a standalone session despite the activity's disabled standalone UI; issues no manager capability. |
| `GET /api/embedded-test/:sessionId/session` | manager, if retained | session ID only | Returns the raw `SessionRecord`, including the named roster, chat history, accepted-entry/token metadata, and embedded launch/bootstrap fields. Neither current activity client calls it. |

#### WebSocket and embedded-manager boundary

- Both clients use `/ws/embedded-test`. The manager adds `role=instructor`; the server immediately treats that query value as authority. Any caller knowing a session ID can join as manager, receive the full state, send manager-attributed chat, and remain subscribed.
- SyncDeck creates a short-lived embedded-manager entry token and places it in the manager iframe URL even for this credentialless child. `EmbeddedTestManager` neither consumes nor removes it. Because the child has no instructor passcode, the generic passcode exchange cannot establish authority for it; the token is currently unused while `role=instructor` remains the bypass.
- Student query claims are `sessionId`, `studentId`, and `studentName`. The activity calls `connectAcceptedSessionParticipant`, but a supplied non-empty name bypasses accepted-entry lookup and an unknown supplied ID is inserted. It never resolves the httpOnly participant cookie.
- Student reload consumes waiting-room handoff when present, then falls back to request-visible name/ID in `localStorage`; it generates an ID client-side when none is available. Cookie loss is not detected.
- The sole inbound message, `chat-message`, is allowed for either claimed role. Attribution comes from the socket's manager flag or claimed student ID; text is trimmed and limited to 500 characters.
- The sole outbound message, `embedded-test-state`, contains the complete participant roster (IDs, names, timestamps, connection state), complete shared chat history, and connected count. It is sent identically to every manager and student socket. Shared chat visibility is intentional for this harness, but students need a student projection without platform metadata or future manager-only fields.
- Delivery is process-local only. There is no pub/sub fanout, so embedded manager/student overlays attached to different instances can diverge.
- Multiple sockets for one student are allowed. Connected state is derived from all open sockets, which avoids a stale close marking an active participant offline, but `lastSeenAt` is updated only on connection and close merely rebroadcasts.

#### Recovery and tests

- The embedded manager has no activity credential or recovery logic. SyncDeck can remount the iframe with a fresh bootstrap token, but the child ignores it; direct manager reload continues to work only because the role query is accepted.
- The manager hides its end-session control for child IDs and relies on SyncDeck to end the child. A manually opened non-child manager can call the shared session-delete endpoint, whose authorization is outside this activity adapter.
- Server tests cover creation, accepted-entry connection/chat broadcast, and name length. The manager/student unit tests cover only button visibility and socket-ready placeholders. The happy-path socket test explicitly codifies `role=instructor` and a query `studentId` as sufficient authority.
- Missing cases include parent-to-child manager grant validation, unauthorized role-query denial before retention/snapshot, cookie-derived participant identity, forged ID/name rejection, raw-session projection exclusion, manager/student message attribution, cross-role projection isolation, multi-instance fanout, bootstrap token consumption/removal, expiry/recovery, and embedded child teardown behavior.

Migration implication: `embedded-manager` must be a first-class platform principal derived from authenticated parent orchestration and scoped to one child session. Credentialless activity domain design must not mean credentialless manager transport. The parent-to-child handoff should establish a generic httpOnly child-manager capability (or equivalent server-resolved grant), not return an activity passcode or require each child to implement a passcode exchange.

- [x] Complete route, message, persistence, recovery, and test classification.

### gallery-walk

- Configuration: no waiting-room fields and no persistent live-session permalink. Participants self-register inside the activity as project stations (`reviewee`) or feedback authors (`reviewer`). A separate solo utility imports an exported `.gw` file locally and has no live authority.
- Stored fields: stage, title/config, reviewees, reviewers, feedback, aggregate counts, and embedded launch metadata. The normalizer spreads unknown fields and preserves platform metadata.
- Creation is unauthenticated, returns `{ id, sessionId }`, and issues no manager capability.
- Corrected inventory: 11 HTTP routes, not 10.

#### Principal and route table

| Route | Intended principal | Current principal source | Boundary |
| --- | --- | --- | --- |
| `POST /create` | public creation adapter | none | Creates session without manager authority. |
| `POST /:sessionId/stage` | manager | session ID only | Switches between gallery/review stages. |
| `POST /:sessionId/title` | manager | session ID only | Mutates display/report title. |
| `POST /:sessionId/reviewee` | public enrollment, then reviewee/station | body `revieweeId`, name, project | Caller may request a six-character ID; collisions generate a replacement. No server-issued authority is established. |
| `POST /:sessionId/reviewer` | public enrollment, then reviewer | body `reviewerId` and name | Arbitrary ID overwrites that reviewer's name. No server-issued authority is established. |
| `POST /:sessionId/feedback` | reviewer, targeted to public station address | body `revieweeId` and `reviewerId` | Does not require either record to exist and does not enforce gallery stage. Caller chooses attribution and target. |
| `GET /:sessionId/feedback` | manager | session ID only | Returns every feedback message, both identity maps, statistics, stage, and config. The shared student hook also calls this route, so every student downloads the manager dataset. |
| `GET /:sessionId/feedback/:revieweeId` | matching reviewee after reveal | path reviewee ID | Returns that project's feedback plus the complete reviewer-name map in either stage. The short QR address acts as a read credential. |
| `GET /:sessionId/export` | manager | session ID only | Returns raw complete export bundle. |
| `GET /:sessionId/report-data` | manager/embedded report service | session ID only over HTTP | Returns aggregate and per-student structured report data. Internal report-builder invocation is a separate trusted platform path. |
| `GET /:sessionId/report` | manager | session ID only | Downloads self-contained full-session HTML report. |

The product rule that participants cannot see feedback until review mode is currently client presentation only. The full-feedback GET route, per-reviewee GET route, initial shared hook state, and socket payloads all expose feedback during gallery mode. Feedback can also still be submitted after the stage changes because the server never checks stage.

#### Specialized principal model

One generic student principal is insufficient. The clean-cutover model should distinguish:

- `manager`: full session, stage/title, export/report, all identities and feedback.
- `reviewee` or `station`: authority scoped to one project record and its revealed feedback.
- `reviewer`: authority to submit feedback under one server-established reviewer identity.
- public station address: the QR `revieweeId` selects a target but grants no right to read that target's feedback.

Public reviewee/reviewer registration should issue scoped server capabilities. Feedback submission then derives `from` from the reviewer principal, validates that the target exists, and enforces the activity stage. Reading project feedback derives the project ID from the reviewee principal rather than a path claim and is unavailable until the server-authoritative reveal stage.

#### WebSocket audiences

- `/ws/gallery-walk` accepts and subscribes every socket with only a session ID. It has no role, identity, admission, initial snapshot, or inbound messages.
- `stage-changed` is legitimate session-wide state for admitted manager/reviewer/reviewee principals.
- `reviewees-updated` currently sends the full named project directory to every socket. No current reviewer flow needs the full directory because the QR supplies its target; restrict this to managers unless a deliberate gallery-directory projection is added.
- `feedback-added` sends the complete message, target, reviewer ID/name snapshot, timestamp, and style to every socket and pub/sub subscriber. It must become manager-only during collection; after reveal, the target reviewee needs at most a scoped notification or its own feedback projection.
- The same explicit audiences must apply locally and through pub/sub.

#### Browser state, recovery, and tests

- Project stations store `revieweeId` in `localStorage`. Reviewers store their ID, name, and note style there. These are currently replayed as credentials and attribution claims.
- QR links put the target reviewee ID in the URL. This is appropriate as an address only; it must not remain authorization to read feedback.
- Manager recovery has no credential. Reviewee/reviewer recovery depends entirely on local claimed IDs.
- Tests cover report rendering/routes, message parsing, UI helpers, sorting, and scanner validation. There are no server tests for enrollment, feedback submission, stage enforcement, scoped reads, WebSocket audiences, identity overwrite, or authorization/recovery.

Migration implications:

- Extend the principal contract with activity-declared scoped grants rather than adding Gallery Walk knowledge to shared code. A student-like principal may carry `subject: reviewer` or `subject: reviewee` plus an opaque activity resource ID.
- Keep authentication generic while Gallery Walk owns stage rules, target existence, reviewer/reviewee lifecycle, and feedback projections.
- Split the shared client hook: manager full-state loading cannot be reused by student pages.
- Protect HTTP report/export routes with manager authority while retaining the internal registered report builder for authenticated parent orchestration.

- [x] Complete route, message, persistence, recovery, and test classification.

### java-format-practice

> **Pre-migration snapshot.** This section records the trust model that motivated
> the plan. Java Format was migrated to the shared cookie/capability model in
> PR #349 (Slice A): `POST /create` now issues an httpOnly manager capability,
> manager REST/socket routes require it, `POST /stats` requires the participant
> cookie, and the sockets authenticate before subscription. The permalink /
> persistent-teacher path does **not** yet issue a manager capability (tracked
> separately) and remains a known gap. See
> `.agent/knowledge/activity-runtime-threat-model.md` and the plan's Slice A for
> the migrated contract.

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

- Modes include temporary live sessions, SyncDeck embedded children, and server-backed persistent solo workspaces. Live creation returns an instructor passcode in JSON; the dashboard copies it into router state and `sessionStorage`. Embedded managers exchange a one-time URL token for that same passcode. Solo creation returns its edit token in JSON and in the URL fragment while also issuing a long-lived httpOnly, route-scoped cookie.
- Stored state includes the instructor passcode, instructor file tree/content, student-mode settings, private named student workspaces, an optionally shared anonymous example, solo edit token/mode, runner selection, and embedded/platform metadata. Its normalizer spreads unknown fields and preserves platform metadata.

| Route group | Intended principal | Current principal source | Boundary |
| --- | --- | --- | --- |
| `POST /create`, `/create-solo` | public factories | none | Live creation exposes manager credential in JSON. Solo returns the edit token despite also setting it httpOnly. |
| `GET /:sessionId/session` | admitted student, or solo viewer/editor projection | session ID; solo edit cookie only affects `canEditSolo` | Excludes passcodes/tokens and student workspaces, but exposes the complete instructor workspace to anyone knowing the ID. The student client uses it as a read-only fallback after participant denial. |
| `POST /:sessionId/student-workspace`, `/student-workspace/state`, `/student-workspace/reset` | student | session-scoped httpOnly participant cookie | Correctly derives identity from the accepted-entry token; returns only the caller's workspace plus public instructor/shared state. |
| `POST /:sessionId/manager-session`, `/student-code/:action`, `/shared-workspace/state` | manager | body instructor passcode | Returns/mutates named private student code and manager settings after constant-time passcode verification. |
| `POST /:sessionId/state` | manager or solo editor | body instructor/solo token, with solo cookie fallback | Persists instructor/solo files; request-visible solo token remains accepted for URL-fragment compatibility. |

#### WebSocket and projections

- `/ws/mobcode` initially trusts query `sessionId` and uses query `role` only to select the authentication path. It retains/subscribes every socket before checking session existence, a participant cookie, or manager credentials.
- Managers must send `manager-auth`; later content, active-file, and presence mutations re-load the session and re-verify the passcode. Failed auth does not close the socket, so an unauthenticated manager remains subscribed as a student-shaped receiver.
- Student sockets have no authentication at all. They can receive all-audience instructor files, shared-example/settings changes, and live editor presence when sharing is enabled. Participant-private workspaces stay on authenticated HTTP and are not broadcast.
- `student-code-updated` is manager-only and local/pub-sub delivery filters on `isAuthenticatedManager`. Durable state is manager-only when sharing is disabled and all-socket when enabled. Live relay applies the same local audience rule, but is not published cross-instance.
- There is no initial socket snapshot. HTTP establishes state; sockets carry later changes. In-memory live edits are process-local and cleaned up after the last local session socket closes.

#### Recovery and tests

- Temporary manager reload depends on `sessionStorage`; browser restart loses authority. Embedded recovery can mint a new one-time exchange token from the authenticated parent. Solo authority survives through its one-year cookie, while its URL-fragment/router-state token is also client-readable.
- Students consume the waiting-room handoff to establish the cookie. On denial, embedded students retry once, then every student falls back to the session-ID-only instructor projection rather than terminal re-entry.
- Tests provide strong normalization/size/path validation, student-versus-manager snapshots, cookie-derived student route denial, manager/solo denial, passcode/token exclusion, WebSocket mutation validation, and manager passcode verification. Playwright covers runner and student UI modes.
- Missing boundaries include authenticate-before-subscribe, participant-authenticated socket admission, failed-manager terminal close, unauthorized sockets receiving no later broadcasts, cross-instance live relay, cookie expiry/re-entry, manager browser-restart recovery, and eliminating request-visible manager/solo credentials.

Migration implication: retain MobCode's activity-owned projections, cookie-derived student REST identity, constant-time verification during transition, and explicit audience metadata. Replace passcodes with shared manager principals, authenticate every socket before subscription, and decide whether instructor code is an explicit public projection; current product entry requires waiting-room admission, so the safe initial classification is authenticated student plus manager, not anonymous observer.

- [x] Complete route, message, persistence, recovery, and test classification.

### postboard

- This is the REST-only reference: managers and students poll every 2.5 seconds. Modes are temporary live, persistent permalink, and SyncDeck child; waiting-room display name is required. Creation returns an instructor passcode in JSON/router state, and embedded managers exchange a one-time parent token for that passcode. There is no persistent-manager recovery in the activity.
- Stored state includes passcode, prompt/settings, named attributed posts and moderation status, per-user raw reactions, flags/reasons, and embedded/platform metadata. The normalizer spreads unknown fields and preserves platform metadata.

#### Principal and projection table

| Route group | Intended principal | Current principal source | Boundary |
| --- | --- | --- | --- |
| `POST /create` | public factory | none | Returns manager credential in JSON. |
| `GET /instructor-state`, `/report` | manager | passcode header/body | Snapshot/report include names, ownership, pending/rejected/deleted/hidden content, flags, and aggregate reactions. HTTP report is protected; the registered internal report builder is a separate trusted orchestration path. |
| `POST /setup`, moderation actions, `/reorder`, `/flag` | manager | passcode header/body | All manager mutations consistently call the same activity-local verifier. |
| `GET /student-state` | student | query `studentId`, checked only for membership in accepted-entry records | Projection correctly hides peer identity, pending/rejected peer posts, hidden posts, flags, and raw reactions, but a forged accepted ID reveals that student's private pending/rejected posts and ownership markers. With no/invalid ID it still returns the approved public-looking board. |
| `POST /posts` | student or manager | manager passcode, otherwise body `studentId` checked only for accepted-entry membership | Student attribution can be forged; accepted display name overrides the body name. |
| `POST /posts/:postId/delete` | owning student | body `studentId` plus accepted-entry membership | Allows deletion only for that ID's rejected post, but the ID is not authenticated. |
| `POST /posts/:postId/react` | student or manager | manager passcode, otherwise body `studentId` plus accepted-entry membership | Students cannot react to hidden, unapproved, or their own posts; another accepted identity can nevertheless be forged. |

The student snapshot is a strong activity-owned projection and should be retained. Approved-note visibility is not evidence of an intentional anonymous display: the configured live flow requires waiting-room admission and has no separate public viewer. Require a student principal for live polling, while any future standalone/public board must be explicitly declared as its own projection.

#### Recovery and tests

- Manager credentials are intentionally limited to same-tab router state or the short-lived embedded exchange; no Web Storage fallback exists. Temporary reload/browser restart loses manager authority. Polling and every mutation repeatedly send the passcode in a header.
- Students persist request-visible name/ID in `localStorage` and use `sessionStorage` for entry handoff. Postboard never reads the httpOnly participant cookie; loss of it is invisible and stored IDs continue to select private state.
- Responses do not consistently set `Cache-Control: no-store`, including manager/student private snapshots and reports.
- Server tests cover normalization, projection exclusion, manager denial, report auth/rendering, creation/setup, post limits, moderation, reorder, reactions, and own rejected deletion. Playwright covers manager/student flow, pending/approval/return behavior, reorder, and layout.
- Existing happy-path tests encode request `studentId` as authority. Missing cases include cookie-derived attribution, forged accepted-ID denial across every student route, wrong-session/expired token denial, anonymous live-state denial, manager capability reload, private cache headers, and internal-versus-HTTP report authorization contracts.

Migration implication: Postboard proves that shared HTTP authorization can wrap activity-owned projections without a WebSocket abstraction. Replace passcode handling with the manager principal, resolve student identity from the participant cookie once, pass its ID into the existing projection/domain rules, and protect report and polling responses with the same shared route-group middleware.

- [x] Complete route, message, persistence, recovery, and test classification.

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

- Configuration: dashboard/live activity only; no standalone entry, direct path, standalone permalink, or waiting-room fields.
- Stored activity state is only the ticket-number array. The normalizer mutates the existing data object and therefore preserves platform metadata.
- Creation is unauthenticated, returns only `{ id }`, and establishes no manager authority.

| Route | Intended principal | Current principal source | Boundary |
| --- | --- | --- | --- |
| `POST /api/raffle/create` | public creation adapter | none | Creates session without manager capability. |
| `GET /api/raffle/generateTicket/:raffleId` | anonymous entrant | session ID only | Mutating GET creates and appends a random ticket on every request. There is no server idempotency, entrant identity, uniqueness check, or replay protection. |
| `GET /api/raffle/listTickets/:raffleId` | manager | session ID only | Returns the complete ticket pool. The current manager client does not call it because the socket supplies its snapshot. |

The student client persists its visible ticket in `localStorage` under the generic session key and avoids requesting another while that value remains. Clearing storage, using another browser context, retrying a lost response, prefetching, or directly replaying the GET creates additional entries. Although the activity description says tickets are unique, random values are not checked for collision.

#### WebSocket and role decision

- Only the manager client opens `/ws/raffle`; the student ticket page has no socket.
- Admission requires only `raffleId`, immediately retains the socket, then sends the entire ticket list.
- `tickets-update` always contains the full pool and is delivered to all subscribers in a process. There is no role/auth check and no Valkey pub/sub integration, so an unauthorized socket can observe tickets while managers on other instances can miss updates.
- There are no inbound messages. Winner selection happens entirely in manager browser state and is neither persisted nor broadcast by the server.
- There is no separate public display/observer component or product flow. The manager's QR code is an entrant link, not a display client.

The target model is:

- `manager`: authenticated socket access to the full ticket pool and any future manager mutations.
- anonymous `entrant`: a server-issued session-scoped principal requiring no name/account, authorized only to claim or recover its own ticket.
- no public observer/display socket for this activity.

Ticket claiming should be an idempotent `POST`. On first claim the server binds one collision-checked ticket to the anonymous entrant principal; retries return the same ticket. The ticket number may remain in local storage because it is display state and currently authorizes no API, while the opaque entrant capability remains httpOnly.

Existing activity tests cover only winner-count/random-selection utilities and ticket-list accessibility semantics. Shared registry/status tests exercise activity discovery/session fixtures, not Raffle routes, WebSocket admission, ticket issuance, collision handling, retries, multi-instance delivery, or recovery.

Missing tests: manager capability creation and socket admission, unauthorized socket receives no snapshot/update, entrant capability issuance, idempotent retry, collision retry, mutating-GET removal, cross-session capability denial, local-display recovery, and pub/sub fanout.

- [x] Complete route, message, persistence, recovery, and test classification.

### resonance

- Modes include temporary live, encrypted persistent-question links, explicit self-paced standalone sessions, and SyncDeck children. Creation returns a passcode except for self-paced mode; persistent/embedded managers can recover the child passcode through verified parent authority.
- Stored state includes passcode, full authored questions/correctness, roster, private submitted answers and live drafts, annotations, reveals/reactions, ordering, timers/staged-run state, encrypted-link metadata, and embedded/platform metadata. The normalizer spreads unknown fields and preserves platform metadata.

| Route group | Intended principal | Current principal source | Boundary |
| --- | --- | --- | --- |
| `/create`, `/prepare-link-options` | public factories/tooling | none | Creates live/self-paced sessions or encrypts validated link options; live creation returns manager credential. |
| `/instructor-passcode` | persistent/embedded manager adapter | verified persistent parent cookie | Returns the activity passcode rather than resolving a principal. |
| `/register-student` | public enrollment after waiting-room acceptance | body name and optional ID | Does not inspect accepted-entry records/cookie; arbitrary IDs can create or overwrite roster entries. |
| `/state`, `/submit-answer` | student | query/body `studentId` | Student projection is viewer-specific, but a forged ID reads another student's submitted answers, reviewed annotations, reveal ownership/reaction state, and can submit as them. |
| `/responses`, question/annotation/share/reorder/timer controls, `/report` | manager | passcode header | Manager routes consistently verify the passcode and expose/mutate full questions, names, drafts, responses, annotations, and reports. The registered report builder is a separate trusted internal path. |

#### WebSocket messages and audiences

- Session existence and instructor query passcode are checked before the initial snapshot. The passcode itself is placed in the WebSocket URL. Student sockets require only session ID and optional claimed student ID; there is no participant-cookie validation.
- Instructor inbound messages cover activation/staging, add question, result sharing, annotations, timers, and response ordering. They are accepted only on the passcode-authenticated instructor socket and revalidate activity domain payloads.
- Student inbound `submit-answer` and `update-draft` are bound to the socket's claimed ID; payload ID cannot switch identity, but the connection claim itself is untrusted. `react-to-shared` likewise uses that claimed socket ID.
- Instructor snapshots and response/draft events are role-filtered locally. Student session-state broadcasts are individually projected using each socket's claimed viewer ID, so forging the connection ID selects another student's private projection.
- `question-added` broadcasts the raw instructor `Question` to every socket, potentially leaking multiple-choice correctness fields that normal student snapshots deliberately remove. Results sharing does apply a student-safe question projection.
- Other all-role events contain intended shared activation/timer/reveal/reaction state. Delivery is process-local only; there is no pub/sub fanout, so manager/student state can diverge across instances.

#### Recovery and tests

- Temporary managers store the passcode in `sessionStorage`; persistent and embedded managers recover through server-verified parent authority, then also cache the passcode there. Students persist request-visible name/ID in `localStorage` and consume `sessionStorage` handoff, but no activity transport resolves the participant cookie.
- Student clients fall back from WebSocket to REST polling with the same claimed ID and reconnect indefinitely on authorization failures. Instructor clients similarly poll and reconnect using the browser-readable passcode.
- Tests provide extensive domain, normalization, staged/self-paced, projection, report, recovery, and broadcast behavior coverage, including rejecting a message payload ID that differs from the socket ID. They do not prove that the socket ID itself or REST identity comes from a server principal.
- Missing boundaries include accepted-entry/cookie-derived registration and identity, forged-ID denial across REST/WebSocket, private draft/answer projection isolation, passcode-free manager capability and reload, credential-free WebSocket URL, terminal expiry recovery, projected `question-added`, role-preserving pub/sub, and internal-versus-HTTP report contracts.

Migration implication: keep Resonance's activity-owned viewer-specific snapshots and domain validation, but supply the viewer ID exclusively from the shared principal. Shared delivery must support per-participant projections as well as role audiences, and every event carrying question data must pass through the same student-safe projection used by snapshots.

- [x] Complete route, message, persistence, recovery, and test classification.

### syncdeck

- SyncDeck is the orchestration superset: temporary and persistent instructors, standalone sessions, HMAC-authenticated Learn service calls, signed substitute-instructor links, one-time browser handoffs, waiting-room students, and parent-managed embedded child sessions.
- Stored state includes presentation URL/mode, passcode and recovery token, Learn lifecycle/linkage, last Reveal payload/state, chalkboard buffer/tool mode, named student presence/state, and embedded child registry. Its normalizer reconstructs this shape and manually preserves only `linkedSessionId`, `acceptedEntryParticipants`, and `entryParticipants`; it drops `participantAuthTokens` and other unlisted platform metadata. This is direct evidence for a platform-owned session envelope.

#### HTTP principal families

| Route family | Intended principal | Current principal source | Boundary |
| --- | --- | --- | --- |
| `/create`, `/generate-url` | public creation/link tooling | none; link generation accepts teacher code and writes its httpOnly persistent cookie | Temporary creation issues a bounded httpOnly recovery cookie but also returns the passcode in JSON. |
| `/instructor-passcode`, `/configure`, student return, report manifest/report, delete | manager | recovery/persistent cookie exchanges to passcode; mutations/reads then send passcode in body/header | Manager protection is consistent, including child cascade deletion and report aggregation, but authority is repeatedly converted back into a browser-readable credential. |
| `/embedded-activity/start`, `/end` | parent manager | body passcode | Creates/deletes child sessions and role-tailored lifecycle messages; start returns a short-lived manager entry token and currently may also include child passcode bootstrap data. |
| `/embedded-manager-passcode` | child embedded manager handoff | single-use child token | Atomically consumes the URL token and returns the child passcode. Replace with a generic child-scoped principal/cookie exchange. |
| `/embedded-context`, `/embedded-activity/entry`, `/auto-activate` | parent manager or authenticated parent student | passcode for teacher; otherwise body `studentId` checked only against roster | A forged current roster ID can resolve student context, mint fresh child entry tokens, or trigger allowed child auto-activation as that student. |
| Learn status/student-entry/start/stop | Learn integration service | timestamped HMAC request with configured provider key | Uses mapping fingerprints, replay/coordination locks, bounded state, and no-store responses; this is a specialized service principal, not a manager cookie. |
| Learn substitute/browser wait/instructor handoffs | signed substitute or single-use browser principal | signed expiring link; consumed opaque token; signed httpOnly waiting/recovery cookie | Establishes browser authority then redirects without placing the durable recovery secret in the destination URL. |

The shared `GET /api/session/:sessionId` route used during client routing returns the raw session record by session ID. For SyncDeck this includes instructor/recovery material, student data, and orchestration metadata; the same cross-cutting exposure applies to other activity sessions according to their stored data. The instructor-passcode leak is being handled separately through the draft advisory and must not be folded into an unrelated migration PR. The runtime design must nevertheless replace raw session serialization with registered entry/public projections.

#### WebSocket and child delivery boundary

- `/ws/syncdeck` validates the session and stopped-Learn state first. Instructors must send a valid first authentication message within five seconds before any replay; this is the same strong authenticate-before-snapshot lifecycle as Video Sync.
- Students present query `studentId`. A new record requires accepted-entry metadata, but any existing roster ID reconnects without the participant cookie. Thus knowing a current ID is sufficient to receive presentation/chalkboard state and child-entry tokens for that participant.
- Only authenticated instructors may send `syncdeck-state-update`. The server serializes instructor updates, persists replay/chalkboard/tool state, and relays the extensible Reveal payload to every other local session socket. Protocol incompatibility is logged but not rejected.
- Student roster/presence is instructor-only. Presentation, chalkboard/tool, and embedded start/end lifecycle are class-wide after admission. Embedded-start payloads are personalized: instructors receive no student entry token; each student receives a freshly stored child handoff token for its claimed parent ID.
- Duplicate participant sockets are closed by claimed ID. Disconnect presence is recomputed from open local sockets. Ordinary state and embedded lifecycle delivery are process-local; unlike session-ended signaling, they have no pub/sub fanout, so multi-instance clients may diverge.

#### Recovery, tests, and migration

- Temporary manager reload works through the bounded httpOnly recovery cookie; persistent, Learn, and substitute modes establish the same recovery path. The client then stores/uses the recovered passcode in memory/bootstrap flow. Embedded manager tokens are cached in parent memory and placed briefly in same-origin iframe URLs.
- Students persist identity hints in both local and session storage, replay child handoff tokens through session storage, and can request replacement child tokens using the claimed parent ID. Return-to-waiting-room revokes parent/child accepted entries and tokens and closes matching sockets, but does not make initial ID claims authentic.
- Route and Learn suites are extensive: manager recovery/denial, HMAC/browser/substitute flows, WebSocket auth/replay/cleanup, duplicate students, child lifecycle/concurrency/rollback, reports, keepalive, return/revocation, and normalization. The happy paths still encode roster ID as student authority and do not contract-test preservation of the participant-token map.
- Missing boundaries include cookie-derived parent student admission on HTTP/WebSocket, forged roster-ID denial, platform metadata preservation, passcode-free manager context, child-scoped generic manager grants, role-preserving multi-instance delivery, raw shared-session projection denial, terminal expiry recovery, and end-to-end Learn/embedded principal propagation.

Migration implication: SyncDeck should remain the final adapter. Preserve its service/signed-handoff principals, authenticate-before-replay lifecycle, child lifecycle locks, personalized entry handoffs, revocation cascade, and report registry. Replace every passcode/claimed-ID conversion with shared principals and move platform metadata/projection/fanout below the activity boundary.

- [x] Complete route, message, persistence, recovery, and test classification.

### traveling-salesman

- Configuration: standalone/direct/permalink/home entry with a required waiting-room display name and client-only solo mode.
- Server organization: one activity entry registers four modules (`session`, `students`, `instructor`, and `algorithms`). This is the first audited activity that requires shared principal middleware to compose across independently registered route groups.
- Stored state: problem/cities/distance matrix, full student identities/routes/timing, algorithm results/progress, instructor route, broadcast selections, and shared phase state. Its normalizer spreads unknown fields, preserving platform metadata.
- Creation is unauthenticated, returns only `{ id }`, and issues no manager authority.

#### HTTP principal table

| Route group | Routes | Intended principal | Current principal source and exposure |
| --- | --- | --- | --- |
| Session read | `GET /:sessionId/session` | split public/student/manager projections | Session ID only; returns the complete raw activity data, including participant IDs, names, routes/timing, algorithm and instructor state. Students use this leak to restore their own route by claimed ID. |
| Manager problem controls | `POST /set-problem`, `/reset-routes`, `/set-broadcasts` | manager | Session ID only; replace the class problem, clear routes, or select broadcast overlays. Broadcast IDs are only type-checked strings and need activity-level referential validation. |
| Leaderboard | `GET /leaderboard` | manager under current UI | Session ID only; returns named student progress/routes metrics plus instructor/algorithm results. No student client consumes it, so there is no current evidence for an intentionally public class leaderboard. |
| Student route | `POST /submit-route` | student | Body `studentId`; selects and mutates that record. Route, distance, and completion time are client claims. |
| Instructor route controls | `POST /update-instructor-route`, `/reset-instructor-route`, `/broadcast-route`, `/broadcast-clear` | manager | Session ID only; create/reset/publish instructor route state. |
| Algorithm controls | `POST /compute-algorithms`, `/algorithm-progress`, `/reset-heuristic`, `/broadcast-solution` | manager | Session ID only; store client-computed algorithm results/progress and publish any stored student/algorithm solution. |

The student submission route validates shapes and non-negative numbers but does not verify that route city IDs belong to the current problem, are unique/complete as claimed, or that `distance` matches the authoritative distance matrix. A forged student ID can overwrite another student's route, and any student can submit an arbitrarily favorable leaderboard distance. Authentication belongs in the shared runtime; route/distance verification remains an activity-owned domain validator executed after principal resolution.

#### WebSocket and projection boundary

- The shared namespace has only student-shaped admission. It subscribes by session ID before calling `connectAcceptedSessionParticipant` with query ID/name claims.
- As in Java Format/String, a supplied name is sufficient and an unknown supplied ID may be adopted. The manager connects with only a session ID, receives `waiting-room-required`, and is closed, so manager live refresh does not work reliably.
- On admission the student receives its ID, the current problem, and selected broadcast routes. Duplicate student sockets are closed by ID.
- `studentsUpdate` broadcasts full raw student records—including IDs, names, routes, timestamps, and progress—to every session socket and through unfiltered pub/sub. The student UI ignores it, but still receives the data.
- `problemUpdate`, `broadcastUpdate`, and `clearBroadcast` are legitimate class-wide projections for authenticated students and managers.
- `algorithmsComputed` is also broadcast to all sockets using the request payload, although current student UI does not consume it; it should be manager-only unless an explicit student projection is demonstrated.
- There are no inbound activity socket messages. All commands use HTTP.
- Close/error both run disconnect handling. The shared duplicate-socket helper's ignore flag limits the replacement race, but the activity still needs shared, tested connection ownership semantics.

#### Persistence, recovery, and tests

- Students persist request-visible participant name/ID in `localStorage` and resolve handoff through `sessionStorage`. On reload they read the raw session projection and select a route using the stored ID, then reconnect with query claims.
- Managers hold no credential. They depend on raw REST reads and a student-shaped socket that rejects them.
- Server tests cover only selected input validation (`set-problem`, missing student, zero completion time, instructor timing, and validation helpers). They do not cover route groups comprehensively, WebSockets, projections, auth, broadcast audiences, normalizer metadata, or route/distance integrity.
- Client tests cover domain helpers and component behavior, not transport authorization or browser recovery.

Migration implications:

- Shared wrappers must be composable at module registration time, for example manager/student route registrars receiving an authenticated context factory instead of individually parsing credentials.
- Replace the raw session response with public problem/broadcast state, student-private route state, and manager-complete state.
- Keep leaderboard visibility manager-only for the first migration; making it public later should be an explicit product choice with a name/privacy projection.
- Add an activity validator that recomputes route distance and completion from authoritative problem data before persisting an authenticated student's submission.

- [x] Complete route, message, persistence, recovery, and test classification.

### video-sync

- Modes are temporary live, persistent permalink, SyncDeck child, and standalone persistent launch. Live creation returns the instructor passcode in JSON/router bootstrap state; persistent managers recover it through a verified teacher cookie, and embedded managers exchange a one-time parent-issued URL token for it.
- Stored state includes the instructor passcode, standalone flag, synchronized YouTube state, aggregate connection/autoplay/sync/error telemetry, and embedded/platform metadata. The normalizer spreads unknown fields and preserves platform metadata.

| Route | Intended principal | Current principal source | Boundary |
| --- | --- | --- | --- |
| `POST /api/video-sync/create` | public factory | none | Creates the session and returns its manager credential in JSON. |
| `GET /:sessionId/instructor-passcode` | persistent or embedded manager adapter | verified persistent teacher cookie for the session or SyncDeck parent | Returns the child/activity passcode and optionally signed persistent source URL. This is a sound adapter shape but should resolve a manager principal instead of exposing another credential. |
| `GET /:sessionId/session` | admitted student/manager; public only for declared standalone mode | session ID | Returns a deliberate passcode-free playback/telemetry projection. Live waiting-room sessions are nevertheless readable anonymously. |
| `PATCH /:sessionId/session` | manager | body passcode | One-time video configuration and standalone flag. |
| `POST /:sessionId/command` | manager | body passcode | Play, pause, and seek mutations. |
| `POST /:sessionId/event` | student telemetry | no principal; optional body `studentId` | Mutates and broadcasts aggregate telemetry. Claimed IDs affect unsynced cardinality and can be forged; load-failure text can overwrite the session error projection. |

#### WebSocket and projection boundary

- `/ws/video-sync` normalizes query `manager` to `instructor`. Instructor sockets must provide a valid first `authenticate` message within five seconds. Session lookup and authentication both complete before subscription, retention, heartbeat creation, or initial snapshot; this is the repository's strongest admission lifecycle reference.
- Student sockets require only a valid session ID. They do not resolve the accepted-participant cookie, so bypassing the waiting room still yields the complete live playback and telemetry stream.
- After admission, instructor and student sockets receive the same `state-snapshot`, `state-update`, `heartbeat`, and `telemetry-update` projections, with role added only to the initial snapshot. No inbound domain messages follow authentication; mutations use HTTP.
- Pub/sub broadcasts have no role audience because the projected playback/aggregate telemetry is common to both admitted roles. Connection counts are local-process subscriber counts, while unsynced counts use Valkey when available, so aggregate telemetry can differ across instances.
- Close/error cleanup is guarded against double execution. A disappeared backing session closes retained sockets; heartbeats avoid overlapping ticks.

#### Persistence, recovery, and tests

- Temporary manager authority is in router/bootstrap memory only and is not persisted in browser storage; reload/browser restart cannot recover it. Persistent and embedded modes recover through server-verified parent cookies/token exchange. The manager does not open a socket until a passcode is resolved.
- Students store request-visible name/ID in `localStorage` and consume handoff through `sessionStorage`, but neither the socket nor event route uses the participant cookie. Generated/stored IDs are telemetry labels, not current authority.
- Tests thoroughly cover projection redaction/normalization, manager route denial, persistent/embedded recovery, auth timeout and authenticate-before-subscribe behavior, invalid sessions, cleanup/heartbeat races, telemetry bounds, and Valkey unsynced counts. Client tests cover bootstrap/recovery, protocol, sync math, player hosts, and student telemetry helpers.
- Missing boundaries include authenticated student socket/event admission, forged telemetry identity and aggregate abuse, anonymous live-session projection denial, temporary manager reload under the new capability, manager capability rather than passcode recovery, cross-instance connection counts, and browser-level expiry/re-entry.

Migration implication: preserve the authenticate-before-subscribe lifecycle, explicit public projection builder, normalized role hint, and persistent/embedded authority adapters. Replace passcode exchange with shared manager-principal resolution, require a student principal for live sockets/events, and declare the playback projection public only for genuine standalone sessions.

- [x] Complete route, message, persistence, recovery, and test classification.

### www-sim

- Configuration: dashboard/live activity only with no standalone or waiting-room entry. Students choose a simulated hostname inside the activity, based on an external classroom exercise.
- Stored state: host roster, per-host request templates, distributed passage fragments/assignments, and selected passage. The normalizer spreads unknown fields and preserves platform metadata.
- Creation is unauthenticated, returns `{ id }`, and establishes no manager capability.

#### Addressing versus authority

The hostname is domain state, not authentication identity:

- It is public inside the simulated network and embedded in template URLs.
- The instructor can rename it, rewriting assignments/templates and live socket labels.
- It must be unique at a point in time but need not be a permanent identity.

The target host principal therefore needs an immutable server-issued subject/resource ID with a mutable activity-owned hostname. Renaming the hostname changes addressing without rotating or transferring authority. A hostname in a URL, body, or socket query only selects a simulated address and cannot prove ownership.

#### HTTP principal table

| Route | Intended principal | Current principal source | Boundary |
| --- | --- | --- | --- |
| `GET /api/www-sim/passages` | public | none | Returns built-in curriculum passages; intentionally public application content. |
| `POST /api/www-sim/create` | public creation adapter | none | Creates session without manager authority. |
| `GET /api/www-sim/:id` | manager | session ID only | Returns full roster, every host template, complete hosting map/fragments, and passage. |
| `POST /api/www-sim/:id/join` | public host enrollment, then host | body hostname | Creates a host or silently takes over an existing hostname by refreshing its join time; establishes no server principal. |
| `PATCH /api/www-sim/:id/students/:hostname` | manager | session/path hostname only | Renames a host and rewrites every dependent template/assignment/socket label. |
| `DELETE /api/www-sim/:id/students/:hostname` | manager | session/path hostname only | Removes any host but leaves related templates/fragment assignments in stored state. |
| `POST /api/www-sim/:id/assign` | manager | session ID only | Generates all fragment placement and templates from a supplied passage, then broadcasts them. |
| `PUT /api/www-sim/:id/assign` | manager/integration only if retained | session ID plus body hostname | Inserts an arbitrary template for a host. No current client call was found; classify as manager until its integration purpose is demonstrated. |
| `GET /api/www-sim/:id/fragments/:hostname` | matching host | path hostname | Returns the selected host's raw assigned passage fragments and request template to anyone naming it. |

Joining an occupied hostname must return a conflict unless the request carries the already-bound host principal. Host-private fragment reads derive the host resource from that principal, not the path. Manager rename/remove/assignment operations require manager authority. The activity owns hostname validation, uniqueness, dependency rewrites, and cleanup semantics.

#### WebSocket messages and audiences

- `/ws/www-sim` accepts `sessionId` and optional hostname, subscribes before validating either the session or host, and stores the claimed hostname on the socket.
- The manager connects without a hostname. Students may attempt connection before joining and later reconnect with the locally stored hostname.
- There are no activity inbound messages; clients send keepalive `ping` frames handled outside this activity path.
- `student-joined` is primarily manager roster state. If students need topology discovery, expose a narrower public hostname event without join timestamps.
- `student-updated` is legitimately relevant to all authenticated hosts because templates contain simulated URLs, but it should expose address changes only.
- `student-removed` is manager plus the affected host; a broader topology notification can be separately declared if required.
- `fragments-assigned` currently broadcasts every template, hosting assignment, fragment hash, and raw passage fragment to all session sockets/pub-sub clients. It must be manager-only.
- `template-assigned` currently broadcasts one host's private request template to everyone. It must be manager plus that authenticated host.
- `assigned-fragments` contains raw fragments hosted by one student and its request template. Local delivery targets the request-controlled socket hostname; forged sockets can receive another host's content, and cross-instance targeted delivery is absent. It must use authenticated participant-targeted delivery through the shared fanout layer.

#### Browser state, recovery, and tests

- Students store hostname, recovered fragment contents, and DNS worksheet mappings in `localStorage`. These are appropriate non-secret activity state once hostname is no longer treated as authority.
- There is no participant capability. Reload begins as unjoined client state even when a hostname is stored, and the socket/query plus join route replay the claim.
- Managers hold no credential and use complete REST/socket state based only on session ID.
- Tests cover hostname syntax, passage splitting/hashing, hosting-map generation, collision-safe generated filenames, template generation, and client exports. No route, socket, projection, auth, join collision/takeover, rename/delete consistency, or recovery tests exist.

Migration implications:

- Use the generic scoped participant grant introduced by Gallery Walk, with an immutable host subject ID; hostname remains activity data/address.
- Add shared participant-targeted pub/sub delivery for private fragments/templates.
- Define narrow manager, host-private, and optional topology projections instead of broadcasting raw assignment structures.
- Add activity-owned referential-integrity tests for rename/remove after assignment.

- [x] Complete route, message, persistence, recovery, and test classification.

## Cross-Cutting Findings to Verify

- [x] Which create routes are reachable only through the manager dashboard versus directly callable by any browser.
- [x] Which create responses can establish automatic httpOnly manager capability without changing client UX.
- [x] Which manager views are recoverable after reload and which rely only on URL/session ID possession.
- [x] Which WebSocket broadcasts contain full session or roster objects.
- [x] Which REST reads return raw activity session data.
- [x] Which role query parameters are routing hints versus current authority.
- [x] Which activities have intentional anonymous/public displays.
- [x] Which normalizers spread unknown fields and which reconstruct data narrowly.
- [x] Which persistent/embedded factories bypass normal activity create routes.
- [x] Which clients persist participant IDs, names, passcodes, or manager context in browser storage.

## Next Audit Slice

- [x] Fully audit `java-format-practice` as the representative simple shared student/manager WebSocket activity.
- [x] Produce its exact route principal table, WebSocket message audience table, session fields, client persistence, and missing tests.
- [x] Compare its manager boundary with `mobcode` and `video-sync` before proposing the shared manager-capability contract.
- [x] Audit `java-string-practice` to determine how much of Java Format's behavior is copied and how much differs.
- [x] Audit `python-list-practice` to test whether the same contract covers a third practice activity without activity-specific exceptions.
- [x] Consolidate the three practice audits into pilot requirements and decide whether anonymous observer access is needed by any of them.
- [x] Audit `binary-breach` as the next distinct student-progress activity.
- [x] Add targeted participant delivery to the proposed WebSocket contract requirements.
- [x] Audit `traveling-salesman` because its split route modules test shared HTTP middleware composition and its leaderboard tests public-versus-manager projection decisions.
- [x] Add module-composable authorization and post-auth activity-domain validation to the proposed contract requirements.
- [x] Audit `gallery-walk` to model reviewer/reviewee resource-scoped principals and feedback projections.
- [x] Add activity-declared scoped student grants and address-versus-authority separation to the proposed contract.
- [x] Audit `raffle` to distinguish entrant, manager, and any intentional display/observer projection.
- [x] Add anonymous no-name participant principals and idempotent resource claiming to the proposed contract requirements.
- [x] Audit `algorithm-demo` and confirm its observer/controller split is intentionally public.
- [x] Resolve the shared observer decision as an activity-declared public projection and require domain-specific projection of opaque activity state.
- [x] Audit `www-sim` and distinguish simulated host addressing from authenticated resource authority.
- [x] Add immutable scoped-subject identity with mutable activity addressing to the proposed contract requirements.
- [x] Audit `embedded-test` as the smallest explicit embedded-manager adapter.
- [x] Require parent-derived, child-scoped embedded-manager authority even when the child activity has no activity-local passcode.
- [x] Fully audit `mobcode` as the mature role/audience reference and identify its pre-authentication subscription gap.
- [x] Audit `video-sync` and preserve its authenticate-before-snapshot lifecycle and embedded/persistent adapter pattern.
- [x] Audit `postboard` as the REST-only private-projection reference.
- [x] Audit `resonance` as the private answer/draft and bidirectional WebSocket reference.
- [x] Audit `syncdeck`, including temporary/persistent/Learn/substitute instructor, student return, and embedded child orchestration.
- [x] Complete detailed route/message classification for all 15 registered activities.

## Pilot Comparison: Java Format, MobCode, and Video Sync

The full MobCode and Video Sync audits are their dedicated sections above (both are `Fully classified` in the route summary). This section does not repeat them; it only extracts the subset of that evidence needed to choose the pilot contract.

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

## Practice-Activity Pilot Requirements

The completed Java Format, Java String, and Python List audits establish the minimum pilot contract. These requirements are evidence-backed by all three activities unless a narrower scope is stated.

### Principal and creation requirements

- [ ] Activity creation must establish a temporary manager capability for the creating browser without returning the credential in JSON or requiring an instructor prompt.
- [ ] Session IDs remain routing identifiers and cannot authorize manager or student operations.
- [ ] Student identity must resolve from the server-issued participant cookie. Request `studentId`, `studentName`, and similar fields may be retained temporarily as display/routing hints but cannot select the record being mutated.
- [ ] Activities may declare scoped student-like grants (for example reviewer or reviewee resource ownership) without teaching shared authentication code activity-specific semantics.
- [ ] Support anonymous, no-name participant principals for activities whose participant role does not require a waiting-room identity.
- [ ] Provide an idempotent claim primitive for activity resources bound to a principal, so retries recover the same resource rather than creating duplicates.
- [ ] Separate public resource addresses, such as QR target IDs, from principals/capabilities that authorize mutation or private reads.
- [ ] Keep scoped principal subject IDs immutable while allowing activity-owned public addresses (for example hostnames) to be renamed or reassigned under domain rules.
- [ ] A capability must be scoped to one session and role; credentials from another session or activity must fail closed.
- [ ] Parent orchestration must mint or exchange a child-session-scoped `embedded-manager` grant; a credentialless child activity may omit an activity passcode but may not accept an unverified manager role hint.
- [ ] Clean cutover is acceptable: no fallback to legacy claimed identities or credentialless manager access is required for sessions created before deployment.

### HTTP requirements

- [ ] Declare three projections: public configuration, authenticated student state, and authenticated manager roster/state.
- [ ] Public configuration may include Java Format difficulty/theme, Java String selected methods, and Python List selected question types. It must exclude named rosters, participant IDs, connection timestamps, and attributed statistics.
- [ ] Manager configuration mutations and roster reads require the manager principal.
- [ ] Student progress/statistics mutations derive attribution only from the student principal.
- [ ] Student-private and manager-private responses use `Cache-Control: no-store`.
- [ ] Shared wrappers provide activity/session validation, consistent status codes, structured denial/error logging, and top-level exception handling.
- [ ] Route-group registrars can apply shared principal requirements once while keeping split activity modules independent.
- [ ] Shared wrappers authenticate and resolve the principal before invoking activity-owned domain validation; the platform must not treat authentication as validation of route contents, scores, distances, or other activity claims.

### WebSocket requirements

- [ ] Resolve and authenticate the role before subscribing the socket, retaining it as an activity client, or sending an initial snapshot.
- [ ] Store the resolved principal on the server-side socket; query `role` is at most an admission hint.
- [ ] Deliver roster/progress messages only to managers and configuration messages only to authenticated students/managers.
- [ ] Provide participant-targeted delivery keyed by the authenticated principal ID for private challenge/state resets; never target using socket query claims.
- [ ] Apply the same audience rules to local delivery and cross-instance pub/sub.
- [ ] Standardize duplicate student connection/disconnect behavior so one stale socket cannot mark an active participant disconnected.
- [ ] Use a shared terminal authentication failure code/reason that stops reconnect loops and sends students through normal waiting-room re-entry.

### Observer decision for the pilot

None of the three practice activities has a user-facing observer/display client. Python List's anonymous socket is an implementation shortcut for its manager, not evidence of an intentional public role. Therefore:

- [x] The practice pilot will not admit anonymous observer sockets.
- [ ] The future shared contract may support an explicitly declared public-display principal/projection for activities that demonstrate a real display use case.
- [ ] Anonymous/public access must never inherit manager messages merely because it knows a session ID.

Repository-wide observer decision after auditing Algorithm Demo:

- [x] Model intentional anonymous observers as the existing `public` principal plus an activity-declared HTTP/WebSocket projection, not as a credential-bearing student or manager role.
- [x] Validate session/activity existence before retaining or subscribing a public socket.
- [ ] Require activity-owned projection of opaque domain state; generic wrappers cannot know that fields such as a guessing-game secret must be withheld.
- [ ] Activities without an explicit public projection reject anonymous sockets.

### Session metadata and client recovery requirements

- [ ] Platform-owned authentication metadata must live outside activity-owned normalized data where feasible, or be preserved by construction through a shared session envelope.
- [ ] Add a contract test that runs each activity normalizer and proves platform metadata survives; Python List is the known failing specimen.
- [ ] Keep request-visible participant ID/name only as non-secret UI/recovery hints; loss of the httpOnly participant token requires waiting-room re-entry.
- [ ] Manager reload succeeds automatically while the httpOnly manager capability remains valid and presents a clear recovery route when it does not.
- [ ] Preserve non-sensitive local exercise progress, with participant-scoped keys for shared browsers.

### Required pilot tests

- [ ] Creation emits exactly one scoped, non-empty httpOnly manager cookie with the intended SameSite/Secure/path/expiry attributes.
- [ ] Missing, forged, expired, and wrong-session manager capabilities cannot read rosters, mutate configuration, subscribe, or receive later broadcasts.
- [ ] Missing, forged, expired, and wrong-session participant capabilities cannot mutate progress or subscribe as that participant.
- [ ] Claimed participant IDs/names cannot overwrite or create another student's server record.
- [ ] Authenticated managers receive roster updates; authenticated students receive configuration updates but never the roster.
- [ ] Pub/sub delivery enforces the same role audiences as in-process delivery.
- [ ] Reload, duplicate socket replacement, cookie loss, terminal close, and waiting-room re-entry are covered at unit/integration level, with one browser-level happy path plus expiry/recovery path.
