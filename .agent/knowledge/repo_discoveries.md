# Repo Discoveries

Use this log for durable findings that future contributors and agents should reuse.

## Entry Template

- Date:
- Area: client | server | activities | tooling | docs
- Discovery:
- Why it matters:
- Evidence:
- Follow-up action:
- Owner:

## Discoveries

- Date: 2026-03-14
- Area: server | testing
- Discovery: Waiting-room route coverage is now broad enough to validate most current entry-gateway API edges without a browser harness. `persistentSessionRoutes.test.ts` covers malformed permalink entry requests, corrupted cookie parsing, stale backing-session repair, student/teacher live-entry role differences, and solo-unavailable permalink outcomes, while `sessionEntryRoutes.test.ts` covers missing-session and token-trimming behavior for live entry-participant handoff routes.
- Why it matters: The remaining test gaps are now concentrated in still-unimplemented embedded-role inheritance and `WaitingRoom.tsx` component interactions rather than basic entry-route correctness. That keeps future effort focused on real product gaps instead of more route boilerplate.
- Evidence: `server/persistentSessionRoutes.test.ts`; `server/sessionEntryRoutes.test.ts`; `server/entryStatus.test.ts`
- Follow-up action: When embedded entry work lands, add route/integration coverage there first; for `WaitingRoom.tsx`, extend the new presentational seam and only add a heavier browser-style harness if interaction coverage still cannot be reached through the existing client test stack.
- Owner: Codex

- Date: 2026-03-14
- Area: client | testing
- Discovery: `WaitingRoom` now has a pure presentational seam in `WaitingRoomContent.tsx`, which can be tested directly in the Node client suite even though the full container still depends on the Vite activity loader.
- Why it matters: This removes the earlier all-or-nothing testing boundary around the waiting-room UI. We can now cover accessibility wiring, teacher-control disabled states, and other rendering-critical behavior without introducing Playwright or reworking the activity loader just to test one shared component.
- Evidence: `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/WaitingRoomContent.tsx`; `client/src/components/common/WaitingRoomContent.test.tsx`
- Follow-up action: Add more render-level cases through the seam as waiting-room UI evolves, and reserve any future browser-harness work for behavior that genuinely needs end-to-end navigation, websocket timing, or storage integration.
- Owner: Codex

- Date: 2026-03-14
- Area: client | testing
- Discovery: `WaitingRoom` carry-forward persistence now has its own stable helper seam in `waitingRoomHandoffUtils.ts`, covering the high-risk branch between successful server-backed token storage and local-value fallback.
- Why it matters: This closes another part of the earlier “full container or nothing” testing gap without introducing Playwright. The current client test stack can now verify that waiting-room exit data is preserved correctly across success, failure, and malformed-token responses before any heavier browser harness is justified.
- Evidence: `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/waitingRoomHandoffUtils.ts`; `client/src/components/common/waitingRoomHandoffUtils.test.ts`
- Follow-up action: Keep extracting similarly narrow `WaitingRoom` seams for websocket/wait-state transitions if needed, and only revisit browser-level tooling once those seams stop covering the remaining risky behavior.
- Owner: Codex

- Date: 2026-03-14
- Area: client | testing
- Discovery: `WaitingRoom` websocket message handling now also has a stable seam in `waitingRoomTransitionUtils.ts`, so teacher-auth, session-started, session-ended, waiter-count, and teacher-code-error routing can be verified without importing the full container into a browser-style harness.
- Why it matters: This narrows the remaining waiting-room test gap again. The hard-to-reach portion is no longer “all websocket behavior,” it is the lifecycle wiring around open/close/error and any true end-to-end submission path that still spans the container boundary.
- Evidence: `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/waitingRoomTransitionUtils.ts`; `client/src/components/common/waitingRoomTransitionUtils.test.ts`
- Follow-up action: If more waiting-room test depth is needed, prefer a small seam around websocket lifecycle error/close handling next; only revisit Playwright or another browser harness if that final boundary still resists direct coverage.
- Owner: Codex

- Date: 2026-03-14
- Area: server | client | testing
- Discovery: Waiting-room entry semantics are now testable at a stable helper boundary instead of only through route/component flows: `server/core/entryStatus.ts` covers shared join/wait/solo/pass-through decisions, `server/core/sessionEntryParticipants.ts` covers tokenized live-entry handoff normalization/one-shot consume behavior, and `entryParticipantStorage` covers client-side 404-vs-retry token handling.
- Why it matters: The branch’s remaining test gaps are now narrower and easier to reason about. We can add high-signal matrix coverage for shared entry behavior without forcing a brittle DOM harness around the whole `WaitingRoom` component before the API contracts settle.
- Evidence: `server/entryStatus.test.ts`; `server/sessionEntryParticipants.test.ts`; `client/src/components/common/entryParticipantStorage.test.ts`
- Follow-up action: Add targeted `WaitingRoom.tsx` interaction tests later for required-field blocking and carry-forward once the shared helper and route contracts stop moving.
- Owner: Codex

- Date: 2026-03-14
- Area: server | activities
- Discovery: Participant ID minting is now centralized in `server/core/participantIds.ts`, and multiple activity server paths (`java-string-practice`, `java-format-practice`, `traveling-salesman`, SyncDeck registration) reuse the same 16-hex format instead of each route inventing its own timestamp/random pattern.
- Why it matters: This is the first concrete server-side step toward a shared `participantId` contract, and it removes name-derived or route-shaped ID differences before reconnect semantics are centralized.
- Evidence: `server/core/participantIds.ts`; `server/participantIds.test.ts`; `activities/java-string-practice/server/routes.ts`; `activities/java-format-practice/server/routes.ts`; `activities/traveling-salesman/server/routes/shared.ts`; `activities/syncdeck/server/routes.ts`
- Follow-up action: Centralize participant lookup/reconnect behavior next; generation format alone is not enough to make participant identity portable across activities.
- Owner: Codex

- Date: 2026-03-14
- Area: server | activities
- Discovery: `server/core/sessionParticipants.ts` now centralizes the common “reconnect by ID or create a participant record” flow for session-backed student arrays, and `java-string-practice`, `java-format-practice`, and `traveling-salesman` all use it.
- Why it matters: This is the next real step after shared ID generation: the branch now has one reusable reconnect/create rule for multiple activities instead of repeating subtly different `find(...)` and mutation logic in each websocket route.
- Evidence: `server/core/sessionParticipants.ts`; `server/sessionParticipants.test.ts`; `activities/java-string-practice/server/routes.ts`; `activities/java-format-practice/server/routes.ts`; `activities/traveling-salesman/server/routes/students.ts`
- Follow-up action: Migrate Python List Practice and evaluate whether SyncDeck's REST registration + websocket reconnect path should converge on the same helper or a broader shared participant-entry service.
- Owner: Codex

- Date: 2026-03-14
- Area: activities | docs
- Discovery: The current activities split into three migration buckets for waiting-room/participant work. Good-fit identity migrations are `java-string-practice`, `java-format-practice`, `traveling-salesman`, and likely `python-list-practice`; low-priority or special-case deferrals are `raffle`, `gallery-walk`, `syncdeck`, `www-sim`, and mostly `algorithm-demo`.
- Why it matters: Future work should not treat every activity as if it needs the same waiting-room identity flow. Some activities mainly need shared participant entry, while others use local storage for workflow state (`raffle` ticket caching, `www-sim` hostname workspace state) or have specialized solo/reviewer flows that need separate design (`gallery-walk`, `syncdeck`).
- Evidence: `activities/java-string-practice/client/student/JavaStringPractice.tsx`; `activities/java-format-practice/client/student/JavaFormatPractice.tsx`; `activities/traveling-salesman/client/student/TSPStudent.tsx`; `activities/python-list-practice/client/student/PythonListPractice.tsx`; `activities/raffle/client/student/TicketPage.tsx`; `activities/gallery-walk/client/student/StudentPage.tsx`; `activities/syncdeck/server/routes.ts`; `activities/www-sim/client/student/WwwSim.tsx`; `activities/algorithm-demo/client/student/DemoStudent.tsx`; `.agent/plans/waiting-room-expansion.md`
- Follow-up action: Keep these notes as deferred migration guidance until the remaining Phase 0-3 waiting-room work is complete, then prioritize `python-list-practice` and `traveling-salesman` before revisiting the special-case activities.
- Owner: Codex

- Date: 2026-03-13
- Area: client
- Discovery: Started persistent sessions no longer always bypass the waiting-room shell. When an activity declares `waitingRoom.fields`, `SessionRouter` now routes already-started permalink entry through `WaitingRoom` with a `join-live` outcome, while activities without fields keep the simpler direct join card.
- Why it matters: This preserves the plan's "collect preflight while waiting and carry it into entry" direction for started-session joins too, so required participant fields are not silently skipped just because the teacher already launched the session before the student arrived.
- Evidence: `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/waitingRoomViewUtils.ts`
- Follow-up action: Fold the same preflight-aware gateway into ad-hoc `/:sessionId` join-code entry so permalink and join-code flows stop diverging on required entry fields.
- Owner: Codex

- Date: 2026-03-13
- Area: client
- Discovery: Direct `/:sessionId` join-code entry can now reuse `WaitingRoom` as a field-only `join-live` preflight shell by disabling teacher/share affordances and completing entry through a callback instead of navigation.
- Why it matters: This reduces the biggest functional gap between permalink and join-code entry for activities that declare `waitingRoom.fields`, without blocking on the larger future server-side participant-entry contract.
- Evidence: `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/sessionEntryRenderUtils.ts`
- Follow-up action: Replace the client-only completion callback with a shared entry handoff that submits/stores participant preflight data and works consistently for both permalink and direct session joins.
- Owner: Codex

- Date: 2026-03-14
- Area: client | server
- Discovery: Direct `/:sessionId` joins no longer treat `/api/session/:sessionId` as both gateway lookup and runtime payload. The server now exposes `GET /api/session/:sessionId/entry`, and `SessionRouter` uses that entry-status response first to decide whether join-code entry should render the waiting-room shell or pass straight through before it fetches the full session record.
- Why it matters: This is the first server-backed gateway step for ad-hoc join-code entry, so permalink and join-code flows now share the same broad shape of “entry metadata first, activity payload second” instead of join-code being only a client-side preflight wrapper.
- Evidence: `server/core/sessions.ts`; `server/sessionEntryRoutes.test.ts`; `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/sessionRouterUtils.ts`; `client/src/components/common/sessionEntryRenderUtils.ts`; `types/waitingRoom.ts`
- Follow-up action: Unify the persistent-link and join-code gateway endpoints once participant handoff moves server-side; right now they still expose parallel entry contracts even though the client flow is more aligned.
- Owner: Codex

- Date: 2026-03-14
- Area: client | server
- Discovery: Permalink entry now follows the same server-backed “entry metadata first” pattern as join-code entry. The server exposes `GET /api/persistent-session/:hash/entry`, and `SessionRouter` now uses that route’s resolved role/outcome/presentation payload instead of recomputing permalink status on the client from `entryPolicy`, teacher cookie, and session-start flags.
- Why it matters: This removes another split-brain decision path from the client and brings permalink and join-code entry much closer to the same gateway model, even though the backend still uses separate persistent-session and direct-session lookup endpoints.
- Evidence: `server/core/persistentSessionEntryStatus.ts`; `server/routes/persistentSessionRoutes.ts`; `server/persistentSessionRoutes.test.ts`; `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/sessionRouterUtils.ts`; `types/waitingRoom.ts`
- Follow-up action: The next true unification step is backend-side, not router-side: collapse the parallel entry-status endpoints into one shared gateway abstraction once participant handoff and role inheritance rules are stable enough.
- Owner: Codex

- Date: 2026-03-14
- Area: server
- Discovery: Even though join-code and permalink entry still use different REST endpoints, their entry-status payload assembly no longer lives in separate route-local logic. `server/core/entryStatus.ts` now builds both the direct-session and persistent-session gateway decisions.
- Why it matters: This is the first backend-side unification seam for the waiting-room gateway. It reduces the risk that one entry surface drifts on `presentationMode` or destination rules while the other keeps evolving.
- Evidence: `server/core/entryStatus.ts`; `server/core/sessions.ts`; `server/routes/persistentSessionRoutes.ts`; `server/sessionEntryRoutes.test.ts`; `server/persistentSessionRoutes.test.ts`
- Follow-up action: Move shared lookup/normalization around that builder next if we want one true gateway service instead of just one shared decision function.
- Owner: Codex

- Date: 2026-03-14
- Area: server
- Discovery: The opaque waiting-room participant handoff now has one shared backend normalization/token helper in `server/core/entryParticipants.ts`, and both the live-session wrapper (`sessionEntryParticipants.ts`) and persistent-session wrapper (`persistentSessions.ts`) delegate to it.
- Why it matters: This keeps `participantId` minting, serializable-value filtering, token shape, and one-shot consume behavior aligned across the two entrypoints without pretending the surrounding session lookup lifecycles are identical.
- Evidence: `server/core/entryParticipants.ts`; `server/core/sessionEntryParticipants.ts`; `server/core/persistentSessions.ts`; `server/entryParticipants.test.ts`; `server/sessionEntryParticipants.test.ts`; `server/persistentSessionRoutes.test.ts`; `server/sessionEntryRoutes.test.ts`
- Follow-up action: Reuse this helper if more entry-backed contexts appear, and keep the wrapper modules responsible only for container lookup/persistence rather than reintroducing token/normalization logic there. The next non-refactor step after this helper is not more token plumbing; it is defining the shared post-handoff participant acceptance/reconnect contract.
- Owner: Codex

- Date: 2026-03-13
- Area: client | activities
- Discovery: Waiting-room exit now writes collected values into a shared sessionStorage handoff keyed by destination (`session` or `solo`), and `java-string-practice` consumes that handoff's `displayName` to skip its duplicate live-session name prompt when preflight already captured it.
- Why it matters: This is the first concrete carry-forward step from waiting-room UI into downstream activity entry, proving the migration path without yet introducing a server-backed participant registry.
- Evidence: `client/src/components/common/entryParticipantStorage.ts`; `client/src/components/common/WaitingRoom.tsx`; `activities/java-string-practice/activity.config.ts`; `activities/java-string-practice/client/student/JavaStringPractice.tsx`
- Follow-up action: Extend the same handoff to more activities or replace it with a shared server-backed participant-entry contract once `participantId` issuance and reconnect semantics are designed.
- Owner: Codex

- Date: 2026-03-14
- Area: client | server | activities
- Discovery: Live-session waiting-room carry-forward is no longer limited to raw browser storage. `WaitingRoom` now posts live-entry values to a temporary server-backed session handoff store, keeps only an opaque token in sessionStorage, and `java-string-practice` / `java-format-practice` consume `displayName` through that token-backed path on startup.
- Why it matters: This is the first real move from “client sessionStorage is the handoff system” toward a shared server-backed participant-entry contract, while still keeping the migration surface narrow enough for the already-adopted activities.
- Evidence: `server/core/sessionEntryParticipants.ts`; `server/core/sessions.ts`; `server/sessionEntryRoutes.test.ts`; `client/src/components/common/entryParticipantStorage.ts`; `client/src/components/common/WaitingRoom.tsx`; `activities/java-string-practice/client/student/JavaStringPractice.tsx`; `activities/java-format-practice/client/student/JavaFormatPractice.tsx`
- Follow-up action: Decide whether the next participant-context step should extend the same handoff beyond `displayName` or pivot to shared `participantId` acceptance/reconnect before broadening activity adoption.
- Owner: Codex

- Date: 2026-03-14
- Area: client | server
- Discovery: Persistent permalink `continue-solo` now uses the same broad opaque-token handoff pattern as live entry. `WaitingRoom` posts solo preflight values to new persistent-session entry-participant routes, stores only the returned token plus `persistentHash` in sessionStorage, and `entryParticipantStorage` can consume that token later for solo startup while still falling back to local values if the server-backed write fails.
- Why it matters: This removes the previous asymmetry where live entry had early shared `participantId` and server-backed carry-forward but solo permalink continuation still depended entirely on client-held values. The branch now has one reusable token-based handoff shape for both live and persistent-solo waiting-room exits without collapsing the entrypoints themselves.
- Evidence: `server/core/persistentSessions.ts`; `server/routes/persistentSessionRoutes.ts`; `server/persistentSessionRoutes.test.ts`; `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/entryParticipantStorage.ts`; `client/src/components/common/entryParticipantStorage.test.ts`
- Follow-up action: Decide whether standalone `/solo/:activityId` should eventually consume the same server-backed participant context, or remain a lighter compatibility path outside persistent permalink entry.
- Owner: Codex

- Date: 2026-03-14
- Area: client | activities
- Discovery: The already-migrated Java activities now share one client-side post-handoff identity helper in `entryParticipantIdentityUtils.ts`. That helper consumes waiting-room handoff values, prefers existing session-local identity when present, persists accepted preflight identity into local storage for reconnect, and avoids `java-format-practice` minting a one-off client-generated participant ID during manual name submit.
- Why it matters: This does not finish the cross-activity participant contract, but it does tighten the current “after handoff, before websocket” behavior into one reusable rule for the migrated activities. It makes the remaining gap clearer: the branch now lacks a shared server-accepted participant contract, not a shared client hydration pattern.
- Evidence: `client/src/components/common/entryParticipantIdentityUtils.ts`; `client/src/components/common/entryParticipantIdentityUtils.test.ts`; `activities/java-string-practice/client/student/JavaStringPractice.tsx`; `activities/java-format-practice/client/student/JavaFormatPractice.tsx`
- Follow-up action: Reuse this helper for any additional activities that adopt waiting-room identity before the server-side accepted-entry contract is finalized, and replace it later if a broader shared participant bootstrap flow becomes authoritative.
- Owner: Codex

- Date: 2026-03-14
- Area: server | activities
- Discovery: `server/core/sessionParticipants.ts` now also exposes shared accepted-participant lookup via `findSessionParticipant(...)`, and the migrated Java activity progress endpoints use it instead of route-local `find(...)` logic.
- Why it matters: This extends the shared participant contract one step past websocket join. Waiting-room-issued or reconnected `participantId` is now the first lookup key for later progress updates too, while legacy name-only fallback remains explicitly opt-in for older sessions.
- Evidence: `server/core/sessionParticipants.ts`; `server/sessionParticipants.test.ts`; `activities/java-string-practice/server/routes.ts`; `activities/java-format-practice/server/routes.ts`
- Follow-up action: Reuse the same helper anywhere post-entry activity routes need to resolve an already-accepted participant, and only keep name fallback where backward compatibility with older unnamed records is still necessary. When more routes need to mutate accepted participants, prefer the shared update helper over open-coding lookup plus `lastSeen` mutations.
- Owner: Codex

- Date: 2026-03-14
- Area: server | activities
- Discovery: Shared participant handling now extends beyond lookup into later accepted-participant state updates. `updateSessionParticipant(...)` in `server/core/sessionParticipants.ts` is now used for Java progress updates plus traveling-salesman disconnect/route-submission paths, so those routes all touch `lastSeen` and resolve participants through the same post-handoff rules.
- Why it matters: This pushes the shared participant contract further past entry and reconnect. More of the “already accepted participant” lifecycle now uses one helper instead of each activity route choosing its own lookup/update semantics.
- Evidence: `server/core/sessionParticipants.ts`; `server/sessionParticipants.test.ts`; `activities/java-string-practice/server/routes.ts`; `activities/java-format-practice/server/routes.ts`; `activities/traveling-salesman/server/routes/students.ts`
- Follow-up action: Keep moving remaining post-entry mutation routes onto this helper where it fits, but stop short of forcing activities with different participant models onto it until the broader accepted-entry service is designed.
- Owner: Codex

- Date: 2026-03-14
- Area: server | activities
- Discovery: `server/core/sessionParticipants.ts` now also has a dedicated disconnect helper, and the same shared participant-read helper is used in traveling-salesman’s algorithm broadcast selection. The shared participant contract now spans reconnect/create, accepted lookup, later mutation, and disconnect handling for the current shared-path activities.
- Why it matters: This reduces more route-local participant boilerplate and makes the remaining gap easier to see: we no longer mainly need more helper extraction in these activities, we need a broader accepted-entry service boundary for activities that still live outside this shared path.
- Evidence: `server/core/sessionParticipants.ts`; `server/sessionParticipants.test.ts`; `activities/java-string-practice/server/routes.ts`; `activities/java-format-practice/server/routes.ts`; `activities/traveling-salesman/server/routes/students.ts`; `activities/traveling-salesman/server/routes/algorithms.ts`
- Follow-up action: Prefer these shared helpers for any further post-entry participant reads/mutations inside the current shared-path activities, and spend future design effort on the cross-activity accepted-entry contract rather than more route-local cleanup.
- Owner: Codex

- Date: 2026-03-14
- Area: server | activities
- Discovery: Duplicate student-socket eviction now also lives in shared server code. `server/core/participantSockets.ts` centralizes the “same session + same participant ID replaces older socket” rule, and the Java routes, traveling-salesman, and SyncDeck websocket student path now delegate to it.
- Why it matters: This keeps one more part of the accepted-participant lifecycle aligned across the activities already on the shared path. The same participant ID now implies the same duplicate-connection replacement behavior without each route carrying its own close-loop implementation, even in SyncDeck where broader registration/reconnect semantics are still activity-owned.
- Evidence: `server/core/participantSockets.ts`; `server/participantSockets.test.ts`; `activities/java-string-practice/server/routes.ts`; `activities/java-format-practice/server/routes.ts`; `activities/traveling-salesman/server/routes/shared.ts`; `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`
- Follow-up action: Reuse this helper anywhere session-bound participant sockets should be single-owner by `participantId`, and avoid reintroducing route-local duplicate-close loops unless an activity genuinely needs a different replacement policy.
- Owner: Codex

- Date: 2026-03-14
- Area: server | activities
- Discovery: SyncDeck student websocket reconnect now also uses an activity-owned participant helper instead of route-local `students.find(...)` mutation, and the websocket path no longer accepts client-invented IDs. Students must reconnect with a previously registered server-issued `studentId`, while stale cached IDs are treated as reconnect failures.
- Why it matters: This tightens SyncDeck back toward the intended “server-issued participant identity” model without forcing its broader presentation/embed registration flow into the shared waiting-room contract yet. The remaining gap is narrower now: SyncDeck still owns REST registration and instructor/embed authority, but its websocket participant touch path no longer has to drift separately or silently trust arbitrary client IDs.
- Evidence: `activities/syncdeck/server/studentParticipants.ts`; `activities/syncdeck/server/studentParticipants.test.ts`; `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`
- Follow-up action: Keep SyncDeck’s broader embedded-role and registration decisions on the presentation track, but reuse this helper path if more websocket-side participant mutation is needed before that larger design lands.
- Owner: Codex

- Date: 2026-03-14
- Area: client | activities | testing
- Discovery: SyncDeck’s stale-student-ID recovery is now isolated behind a tiny client helper rather than living only inside the full student component close handler.
- Why it matters: This gives the branch a direct test seam for the newer “server-issued IDs only” contract on the client side. We can verify that stale cached SyncDeck identity clears local registration and requires rejoin without needing a full browser-style websocket harness.
- Evidence: `activities/syncdeck/client/student/reconnectUtils.ts`; `activities/syncdeck/client/student/reconnectUtils.test.ts`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`
- Follow-up action: If SyncDeck’s reconnect UX changes again, update the helper and its tests first, then keep the student component wiring thin.
- Owner: Codex

- Date: 2026-03-14
- Area: server | activities
- Discovery: SyncDeck now has a first runtime surface for embedded role inheritance, even though no embedded child launcher consumes it yet. `POST /api/syncdeck/:sessionId/embedded-context` can validate inherited teacher role from instructor passcode or inherited student role from a registered parent-session student ID.
- Why it matters: This converts the embedded-role plan from pure design text into a concrete server proof surface. The remaining work is now more specific: wire child launch/entry to this validated parent context instead of inventing teacher/student role in the embedded child from scratch.
- Evidence: `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`
- Follow-up action: When the embedded child-launch path is implemented, use this endpoint plus the matching client helper in `activities/syncdeck/client/shared/embeddedContextUtils.ts` as the parent-context authority rather than trusting client-claimed inherited role or re-deriving passcode/student identity ad hoc.
- Owner: Codex

- Date: 2026-03-14
- Area: activities | server
- Discovery: Python List Practice is no longer fully outside the shared participant contract on the server side. Its websocket join, stats updates, disconnect handling, and normalized stored student records now use shared-style participant IDs and activity-owned wrappers around the common session participant helpers, and the student client now accepts a server-issued `studentId` message.
- Why it matters: This closes one of the explicit remaining gaps from the plan without forcing a waiting-room UI migration for the activity. Python List Practice can now participate in the same broader participant-ID/reconnect direction as the Java and traveling-salesman activities, while still keeping its own activity-specific UI flow for now.
- Evidence: `activities/python-list-practice/server/studentParticipants.ts`; `activities/python-list-practice/server/studentParticipants.test.ts`; `activities/python-list-practice/server/routes.ts`; `activities/python-list-practice/client/student/PythonListPractice.tsx`
- Follow-up action: If Python List Practice later adopts waiting-room entry, reuse the existing shared participant path instead of introducing another activity-local server identity lifecycle.
- Owner: Codex

- Date: 2026-03-14
- Area: client | server | activities
- Discovery: The live entry-participant handoff now mints shared `participantId` before activity-specific websocket join. `java-string-practice` and `java-format-practice` can carry that ID into their first live-session websocket URL instead of waiting for the activity route to assign and echo a new one after connection.
- Why it matters: This is the first shared path where participant identity exists before activity-specific join logic runs, which narrows the gap between “waiting-room accepted entry” and “activity-owned participant registration” without yet forcing every activity onto one registration service.
- Evidence: `server/core/sessionEntryParticipants.ts`; `server/core/participantIds.ts`; `client/src/components/common/entryParticipantStorage.ts`; `activities/java-string-practice/client/student/JavaStringPractice.tsx`; `activities/java-format-practice/client/student/JavaFormatPractice.tsx`; `.agent/plans/waiting-room-expansion.md`
- Follow-up action: Extend the same accepted-entry `participantId` model to more activities only after deciding whether shared reconnect semantics or a unified registration endpoint is the next abstraction boundary.
- Owner: Codex

- Date: 2026-03-13
- Area: client | activities
- Discovery: `consumeEntryParticipantDisplayName(...)` now gives activities one shared way to read waiting-room `displayName` handoff data for either live-session or solo entry, and `java-format-practice` is the second activity to adopt it.
- Why it matters: This reduces migration copy-paste and proves the handoff model works for both `session` and `solo` destinations before a server-backed participant context exists.
- Evidence: `client/src/components/common/entryParticipantStorage.ts`; `activities/java-string-practice/client/student/JavaStringPractice.tsx`; `activities/java-format-practice/activity.config.ts`; `activities/java-format-practice/client/student/JavaFormatPractice.tsx`
- Follow-up action: Keep later activity migrations using the shared helper instead of re-implementing storage-key logic, and replace the helper with a server-backed lookup once participant entry is centralized.
- Owner: Codex

- Date: 2026-03-13
- Area: client
- Discovery: `WaitingRoom` is no longer hard-coded as a teacher-wait blocker. It now accepts the resolved entry outcome so `continue-solo` permalink flows with waiting-room fields can render a solo-preflight screen and CTA instead of incorrectly telling the user to wait for a teacher.
- Why it matters: Without outcome-aware presentation, future activities that add waiting-room fields would regress on `solo-allowed` or `solo-only` permalinks by showing misleading copy and the wrong primary action even though the router had already resolved a solo destination.
- Evidence: `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/waitingRoomViewUtils.ts`; `client/src/components/common/SessionRouter.tsx`
- Follow-up action: Extend the same outcome-aware waiting-room shell when preflight data starts flowing into downstream activity entry so the primary CTA can hand off validated participant data rather than only local sessionStorage state.
- Owner: Codex

- Date: 2026-03-13
- Area: client
- Discovery: Persistent permalink entry resolution now lives in shared client utility logic (`resolvePersistentSessionEntryOutcome`) so `SessionRouter` can treat `solo-only` and `solo-allowed` links consistently across started-session, teacher-cookie, and solo-support cases.
- Why it matters: This prevents regressions where a remembered teacher cookie or an already-started managed session accidentally overrides `solo-only` behavior, and it gives later Phase 3 work one place to extend instead of scattering policy branches through route components.
- Evidence: `client/src/components/common/persistentSessionEntryPolicyUtils.ts`; `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/persistentSessionEntryPolicyUtils.test.ts`
- Follow-up action: Reuse the resolver shape when ad-hoc join-code entry is folded into the same waiting-room gateway, and expand it to account for waiting-room preflight state once participant-data carry-forward lands.
- Owner: Codex

- Date: 2026-03-14
- Area: client
- Discovery: Standalone permalink entry resolution now has one shared decision shape for role, destination, and presentation mode, and `SessionRouter` uses that decision to pass student `join-live` permalinks straight into the running session when no waiting-room fields are required.
- Why it matters: This removes one more special-case permalink branch, codifies the plan's “student by default, teacher only via auth intent, `solo-only` stays solo” rule, and keeps role/presentation decisions in one place before the later server-backed gateway work.
- Evidence: `client/src/components/common/persistentSessionEntryPolicyUtils.ts`; `client/src/components/common/persistentSessionEntryPolicyUtils.test.ts`; `client/src/components/common/SessionRouter.tsx`; `.agent/plans/waiting-room-expansion.md`; `.agent/knowledge/data-contracts.md`
- Follow-up action: Expand the same decision model to join-code and embedded entry once those flows stop bypassing the shared resolver and can carry parent role or server-issued participant context.
- Owner: Codex

- Date: 2026-03-13
- Area: client
- Discovery: Waiting-room custom fields now reuse the owning activity's existing lazy-loaded client entry bundle via `loadActivityWaitingRoomFields(...)` instead of introducing a second discovery/bundling path.
- Why it matters: This keeps waiting-room customization aligned with the current activity loader, avoids parallel registry complexity, and lets shared waiting-room UI fail safely with a loading or unavailable message when a custom field component cannot be resolved.
- Evidence: `client/src/activities/index.ts`; `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/waitingRoomFieldUtils.ts`
- Follow-up action: When an activity adopts `waitingRoom.fields` with `type: 'custom'`, export the matching component from its client entry `waitingRoomFields` map rather than adding shared-module conditionals.
- Owner: Codex

- Date: 2026-03-01
- Area: activities
- Discovery: SyncDeck presentation URLs must be scheme-compatible with the ActiveBits host page. When ActiveBits is loaded over HTTPS, configuring or joining a SyncDeck session with an `http://...` presentation URL causes mixed-content blocking, the iframe stays on an `about:blank` parent-origin window, and subsequent `postMessage(..., "http://...")` calls fail in the student view.
- Why it matters: The symptom can look like a `postMessage` protocol bug, but the root cause is browser mixed-content policy. SyncDeck client validation now blocks that configuration early and shows an explicit error instead of trying to sync a blocked iframe.
- Evidence: `activities/syncdeck/client/shared/presentationUrlCompatibility.ts`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/components/SyncDeckPersistentLinkBuilder.tsx`; `activities/syncdeck/client/shared/presentationUrlCompatibility.test.ts`
- Follow-up action: For local deck testing from production/staging ActiveBits, prefer an HTTPS dev tunnel or host the presentation over HTTPS. Loopback URLs such as `http://127.0.0.1` may work from `https://...` ActiveBits pages in Chromium-based browsers, but Safari blocks them, and non-loopback HTTP origins will still fail mixed-content checks.
- Owner: Codex
- Date: 2026-02-27
- Area: docs
- Discovery: Repository instructions now explicitly require frontend controls to include appropriate accessibility semantics and state attributes, with examples such as `aria-pressed`, `aria-expanded`, accessible names for icon-only controls, and preference for native interactive elements.
- Why it matters: This makes accessibility requirements part of the default implementation standard instead of a per-review afterthought, which should reduce repeated UI fixes across activities and shared client code.
- Evidence: `AGENTS.md`
- Follow-up action: When adding or reviewing frontend controls, check semantics and state exposure alongside behavior and styling.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck manager/student directional navigation is now host-overlaid on iframe edges (left/right/up/down) and driven by iframe `reveal-sync` `state/ready` payloads (`indices` + `capabilities.canNavigateBack/canNavigateForward`) rather than hardcoded deck assumptions.
- Why it matters: Navigation controls can be reused across decks without per-presentation edits, and student forward controls now disable at the effective sync boundary unless the student has opted out by backtracking.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: If reveal iframe protocol expands directional capability flags (`canNavigateLeft/Right/Up/Down`), wire those into button visibility to refine per-axis disable states beyond current back/forward capability fallback.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck manager instructor updates now relay to other instructors by default, and each manager has a local toolbar sync toggle (`🔗`) that disables both outbound instructor broadcasts and inbound instructor state application while still keeping the connection active for session metadata (for example student presence).
- Why it matters: Multiple instructors stay in lockstep by default, and any instructor can temporarily navigate independently without disrupting student/instructor shared state until they re-enable sync.
- Evidence: `activities/syncdeck/server/routes.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/server/routes.test.ts`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`
- Follow-up action: If instructors request independent viewing with read-only follow indicators, extend the toggle into explicit sync modes (follow-only, broadcast-only, fully detached) rather than introducing activity-specific behavior in shared modules.
- Owner: Codex

- Date: 2026-02-27
- Area: client
- Discovery: SyncDeck persistent teacher auth from `WaitingRoom` must send `selectedOptions` parsed from the permalink query (including decode-normalized `presentationUrl` for encoded/double-encoded values), and manager passcode hydration should replace invalid current `presentationUrl` state with the validated cookie-backed `persistentPresentationUrl`.
- Why it matters: Without `selectedOptions` in waiting-room auth, the refreshed `persistent_sessions` cookie loses `presentationUrl/urlHash`, making `/api/syncdeck/:sessionId/instructor-passcode` return null recovery fields; if query bootstrap is percent-encoded, manager state can remain invalid and block configure/start.
- Evidence: `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/sessionRouterUtils.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `client/src/components/common/sessionRouterUtils.test.ts`
- Follow-up action: Remove temporary `[SYNCDECK-DEBUG]` logs after confirming production traces show decoded `selectedOptions.presentationUrl` and non-null `persistentPresentationUrl/persistentUrlHash` through waiting-room teacher startup.
- Owner: Codex

- Date: 2026-02-26
- Area: activities
- Discovery: SyncDeck `instructor-passcode` recovery for persistent sessions must normalize `selectedOptions.presentationUrl` from the cookie (including iterative `decodeURIComponent` fallback with up to 3 decode attempts when the stored value is percent-encoded) and recompute `urlHash` from the persistent hash when the cookie entry is missing `urlHash`.
- Why it matters: In the persistent-session teacher flow, the generic `persistent-session/authenticate` cookie rewrite can preserve or seed a cookie entry that lacks SyncDeck's `urlHash`, and encoded `presentationUrl` values fail URL validation, causing the manager to stall on the configure screen instead of auto-starting the presentation.
- Evidence: `activities/syncdeck/server/routes.ts` (`/api/syncdeck/:sessionId/instructor-passcode`); `activities/syncdeck/server/routes.test.ts` (encoded cookie URL + missing `urlHash` regression)
- Follow-up action: Investigate the upstream source of percent-encoded `presentationUrl` values entering persistent cookies (likely a double-encoded permalink copy/share path) and consider normalizing URL-validated deep-link options when persisting generic persistent-session auth cookies.
- Owner: Codex

- Date: 2026-02-26
- Area: tooling
- Discovery: GitHub Actions dependency install can intermittently fail during `esbuild` postinstall with `spawnSync .../node_modules/esbuild/bin/esbuild ETXTBSY`; switching CI to `npm ci` and retrying the install step mitigates the runner-side binary write/execute race.
- Why it matters: The failure occurs before tests run and is transient/infrastructure-related, causing flaky CI even when repository code is unchanged.
- Evidence: `.github/workflows/ci.yml` (install step retry loop + `npm ci`); CI error logs showing `node_modules/esbuild/install.js` `ETXTBSY`
- Follow-up action: If flakes continue, capture whether they cluster on a specific runner image and consider pinning npm version or adding a cache cleanup before retries.
- Owner: Codex

- Date: 2026-02-24
- Area: activities
- Discovery: SyncDeck chalkboard replay buffering now caps `chalkboard.delta` to the most recent 200 stroke commands during both runtime updates and persisted-session normalization.
- Why it matters: Prevents unbounded session-store growth and keeps replay payload size bounded when new instructor/student clients join long-running sessions with heavy drawing activity.
- Evidence: `activities/syncdeck/server/routes.ts` (`MAX_CHALKBOARD_DELTA_STROKES`, `normalizeChalkboardDelta`, `applyChalkboardBufferUpdate`); `activities/syncdeck/server/routes.test.ts`
- Follow-up action: If replay latency remains high in practice, add a size-based cap and/or server-triggered periodic `chalkboardState` snapshot refreshes so stroke deltas reset more aggressively.
- Owner: Codex

- Date: 2026-02-25
- Area: tooling
- Discovery: `client/tsconfig.json` and `activities/tsconfig.json` need `lib` aligned with the repo `ES2022` baseline (plus DOM libs) to avoid client/activity typecheck failures for newer standard APIs like `Array.prototype.at`.
- Why it matters: Mixed lib baselines let the same API typecheck in server/shared contexts (`ES2022`) but fail in client/activity code still using `ES2020` libs, causing inconsistent TS diagnostics during migration work.
- Evidence: `tsconfig.base.json`; `client/tsconfig.json`; `activities/tsconfig.json`
- Follow-up action: Keep workspace `lib` arrays aligned when raising the base TS target/lib to prevent drift between browser and server type environments.
- Owner: Codex

- Date: 2026-02-25
- Area: client
- Discovery: Upgrading `eslint-plugin-react-hooks` to `7.x` adds stricter lint rules (including `react-hooks/refs` and `react-hooks/immutability`) that flag render-time ref reads and callback self-reference patterns previously accepted by the repo.
- Why it matters: Major lint-plugin upgrades can require behavior-preserving code refactors (not just config/package changes) to keep `npm test` green.
- Evidence: `client/src/components/common/StatusDashboard.tsx`; `client/src/hooks/useResilientWebSocket.ts`; `client/package.json`
- Follow-up action: When upgrading React hooks lint tooling, run full lint early and budget time for small hook/ref refactors instead of assuming a lockfile-only change.
- Owner: Codex

- Date: 2026-02-25
- Area: activities
- Discovery: `java-format-practice` client-side formatter evaluator must support Java hex specifiers (`%x/%X`) because advanced challenge output validation relies on `%04X` in the mission badge clearance line.
- Why it matters: Missing `%x/%X` support leaves tokens like `%04X` uninterpreted in client validation/output previews, causing false negatives in otherwise correct advanced answers.
- Evidence: `activities/java-format-practice/client/utils/formatUtils.ts`; `activities/java-format-practice/client/evaluateFormatString.test.ts`
- Follow-up action: Add evaluator test cases whenever new Java `Formatter` specifiers are introduced in challenge content so challenge migrations cannot silently outpace parser support.
- Owner: Codex

- Date: 2026-02-25
- Area: activities
- Discovery: `java-format-practice` student difficulty/theme controls must be treated as solo-only; in managed sessions the student view should reflect manager broadcasts but not allow local changes.
- Why it matters: A TypeScript migration regression left the student selector interactive in teacher-managed sessions, allowing students to change session-wide difficulty/theme outside the manage dashboard.
- Evidence: `activities/java-format-practice/client/student/JavaFormatPractice.tsx`; `activities/java-format-practice/client/components/basicComponents.test.tsx`
- Follow-up action: When migrating activity student views, explicitly gate session-setting handlers and selector interactivity on `isSoloSession` to avoid reintroducing managed-mode control paths.
- Owner: Codex

- Date: 2026-02-24
- Area: server
- Discovery: `activity.config` files now have a shared runtime parser/schema (`types/activityConfigSchema.ts`) and the server activity registry validates configs during load before filtering/route registration.
- Why it matters: TypeScript annotations on activity configs do not protect runtime-loaded `.js` configs or malformed shared-contract fields; schema validation now fails fast in production with a config-path-specific error.
- Evidence: `types/activityConfigSchema.ts`; `server/activities/activityRegistry.ts`; `server/activityConfigSchema.test.ts`; `server/activities/activityRegistry.test.ts`
- Follow-up action: Consider reusing the same parser in `client/src/activities/index.ts` so the dashboard/client registry warns and skips invalid configs consistently in the browser build path too.
- Owner: Codex

- Date: 2026-02-24
- Area: client
- Discovery: Shared `ManageDashboard` now supports a generic `createSessionBootstrap.sessionStorage[]` activity-config contract for persisting create-session response fields (for example SyncDeck `instructorPasscode`) without activity-specific conditionals in shared code.
- Why it matters: Preserves the Activity Containment Boundary by keeping shared dashboard logic activity-agnostic while still allowing activities to bootstrap manager-only client state from create responses.
- Evidence: `types/activity.ts`; `client/src/components/common/manageDashboardUtils.ts`; `client/src/components/common/ManageDashboard.tsx`; `activities/syncdeck/activity.config.ts`; `client/src/components/common/manageDashboardUtils.test.ts`
- Follow-up action: Reuse this contract for future activities that need post-create client bootstrap values, and extend the contract (rather than branching in shared UI) if new storage targets are needed.
- Owner: Codex

- Date: 2026-02-24
- Area: server
- Discovery: `resolvePersistentSessionSecret()` now memoizes the first successfully resolved value for the process, so later calls return the same secret and do not repeat warning side effects.
- Why it matters: Multiple modules import persistent-session helpers at module init (including activity routes), and without memoization non-production warnings can duplicate while test/runtime env mutations could produce inconsistent HMAC secrets across call sites.
- Evidence: `server/core/persistentSessions.ts`; `server/persistentSessionsSecret.test.ts`
- Follow-up action: If future tests need to exercise multiple resolver scenarios in one process, continue using cache-busting dynamic imports (or add a test-only reset helper rather than mutating global process env mid-module).
- Owner: Codex

- Date: 2026-02-24
- Area: activities
- Discovery: SyncDeck persistent-link cookie entries must persist the signed `urlHash` alongside `presentationUrl` (or equivalent full query params), because the generic dashboard list/CSV/copy flow reconstructs share links from cookie `selectedOptions`.
- Why it matters: If only `presentationUrl` is stored, previously created SyncDeck links copied/exported from `/manage` lose `urlHash`, causing tamper-protection bypass/failure and broken links.
- Evidence: `activities/syncdeck/server/routes.ts` (`/api/syncdeck/generate-url` cookie write); `server/routes/persistentSessionRoutes.ts` (`/api/persistent-session/list` returns cookie `selectedOptions`); `client/src/components/common/ManageDashboard.tsx` + `client/src/components/common/manageDashboardUtils.ts` (copy/CSV append query from `selectedOptions`)
- Follow-up action: Keep signed/generated query params in sync with any future SyncDeck deep-link integrity fields and add migration handling if cookie entry shape changes again.
- Owner: Codex

- Date: 2026-02-23
- Area: tooling
- Discovery: Upgrading `client`/`server` to `eslint@10` is currently blocked by `eslint-plugin-react-hooks`. The latest published `eslint-plugin-react-hooks@7.0.1` still declares a peer dependency range that supports ESLint up to `^9.0.0`, so `npm install` fails with `ERESOLVE` before lint can run.
- Why it matters: Future dependency update attempts may incorrectly assume ESLint 10 is ready because `npm outdated` shows newer `eslint` and `@eslint/js` versions. This saves time and avoids forced installs on the main branch.
- Evidence: `client/package.json`; `server/package.json`; `npm install --include=dev --workspaces --include-workspace-root` (ERESOLVE peer conflict); `npm view eslint-plugin-react-hooks@latest version peerDependencies --json`
- Follow-up action: Re-check `eslint-plugin-react-hooks` peer support for ESLint 10 on the next dependency refresh, then retry the ESLint 10 bump in a separate commit.
- Owner: Codex

- Date: 2026-02-23
- Area: client
- Discovery: `deepLinkOptions` is currently UI/query metadata only; the generic permanent-link flow appends selected options as query params and does not cryptographically bind them. A safer extension path is to keep the shared modal UX in `ManageDashboard` but allow an activity-configured deep-link generator endpoint to return the authoritative URL.
- Why it matters: Activities that require integrity-protected deep-link params (for example SyncDeck `presentationUrl` + `urlHash`) should not rely on unsigned query strings from the generic create route.
- Evidence: `activities/algorithm-demo/activity.config.ts`; `client/src/components/common/manageDashboardUtils.ts`; `client/src/components/common/ManageDashboard.tsx`; `server/routes/persistentSessionRoutes.ts`; `client/src/components/common/SessionRouter.tsx`
- Follow-up action: Implement optional `deepLinkGenerator` in `ActivityConfig`, branch `ManageDashboard` create-link calls to that endpoint when configured, and keep legacy `/api/persistent-session/create` behavior as fallback.
- Owner: Codex

- Date: 2026-02-23
- Area: client
- Discovery: `deepLinkOptions` now supports an explicit per-field validator contract (`validator: 'url'`) that is parsed by dashboard utilities and enforced in ManageDashboard modals with inline field errors and disabled actions.
- Why it matters: Activity configs can require valid URL inputs before link creation/copy/open actions, reducing malformed deep-link generation and improving teacher feedback in the modal UX.
- Evidence: `types/activity.ts`; `client/src/components/common/manageDashboardUtils.ts`; `client/src/components/common/ManageDashboard.tsx`; `activities/syncdeck/activity.config.ts`; `client/src/components/common/manageDashboardUtils.test.ts`; `npm --workspace client test`
- Follow-up action: Reuse `validator: 'url'` for any future deep-link text fields that represent external links; add additional validator types only when there is a concrete activity need.
- Owner: Codex

- Date: 2026-02-23
- Area: server
- Discovery: SyncDeck now validates `presentationUrl` format in both deep-link generation (`/api/syncdeck/generate-url`) and runtime configure (`/api/syncdeck/:sessionId/configure`) so the configure path no longer accepts non-http(s) URLs.
- Why it matters: Prevents bypass where malformed or unsafe URLs could be injected at configure time even if deep-link generation validates correctly.
- Evidence: `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `npm --workspace activities run test:activity --activity=syncdeck`; `npm test`
- Follow-up action: Keep validation helpers aligned if URL policy is tightened (for example hostname allowlists), and mirror policy in both generation and configure endpoints.
- Owner: Codex

- Date: 2026-02-23
- Area: activities
- Discovery: SyncDeck student sync requires translating iframe-origin `reveal-sync` `action: "state"` messages into plugin-compatible host commands (`action: "command"`, `payload.name: "setState"`) before posting into the student iframe.
- Why it matters: Forwarding raw state envelopes does not reliably apply navigation in the custom `reveal-iframe-sync` plugin contract; command-form messages are the stable host→iframe control surface.
- Evidence: `.agent/plans/reveal-iframe-sync-message-schema.md`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/server/routes.ts`.
- Follow-up action: Keep all new SyncDeck relay commands aligned to the schema doc and add explicit tests when introducing additional command names beyond `setState`.
- Owner: Codex

- Date: 2026-02-23
- Area: activities
- Discovery: In SyncDeck manager, websocket URL builders passed to `useResilientWebSocket` must be memoized (`useCallback`) to prevent reconnect churn and visible status-dot flicker.
- Why it matters: Recreated URL builder functions can trigger repeated connect/disconnect cycles, which can interrupt message relay and make connection state indicators unstable.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx` (`buildInstructorWsUrl` + indicator debounce); observed red/green flashing resolved after memoization.
- Follow-up action: For future activities using `useResilientWebSocket`, memoize `buildUrl` callbacks and debounce transient disconnected indicators in UI status elements.
- Owner: Codex

- Date: 2026-02-23
- Area: server
- Discovery: Persistent-session HMAC secret validation is now strict in production. `PERSISTENT_SESSION_SECRET` must be present, at least 32 characters, and not in the weak/default denylist; otherwise process startup throws.
- Why it matters: Prevents running production with a known/default key that would allow forged persistent hashes and offline teacher-code guessing against HMAC-derived link checks.
- Evidence: `server/core/persistentSessions.ts` (`resolvePersistentSessionSecret`); `activities/syncdeck/server/routes.ts` (SyncDeck urlHash now uses shared resolver).
- Follow-up action: Ensure deployment environments set a strong random secret before rollout; keep test/dev environments on non-production mode unless intentionally validating startup failures.
- Owner: Codex

- Date: 2026-02-24
- Area: client
- Discovery: `ManageDashboard` now supports an activity-owned persistent-link builder UI slot via client-module export (`PersistentLinkBuilderComponent`), gated by `activity.config.manageDashboard.customPersistentLinkBuilder`, while generic activities continue using shared `deepLinkOptions` form handling.
- Why it matters: Keeps shared dashboard code activity-agnostic and moves complex preflight/protocol-specific permalink UX (like SyncDeck reveal-sync validation/preview) into the owning activity without losing a standardized modal placement.
- Evidence: `types/activity.ts`; `types/activityConfigSchema.ts`; `client/src/activities/index.ts`; `client/src/components/common/ManageDashboard.tsx`; `activities/syncdeck/activity.config.ts`; `activities/syncdeck/client/index.tsx`; `activities/syncdeck/client/components/SyncDeckPersistentLinkBuilder.tsx`
- Follow-up action: Focus future changes on evolving `ActivityPersistentLinkBuilderProps` (only if multiple activities need more shared callbacks/state) rather than adding protocol-specific branches back into `ManageDashboard`.
- Owner: Codex

- Date: 2026-02-26
- Area: client
- Discovery: Shared HTTP(S) URL validation used by `ManageDashboard` deep-link parsing and `SessionRouter` teacher redirect parsing now lives in `client/src/components/common/urlValidationUtils.ts` (`isValidHttpUrl`), and `SessionRouter`'s async manage-path resolver is memoized with `useCallback` so `react-hooks/exhaustive-deps` can include it without warnings.
- Why it matters: Prevents duplicate URL-policy drift across client parsers and keeps hook dependency arrays both correct and lint-clean when async helpers are referenced from effects.
- Evidence: `client/src/components/common/urlValidationUtils.ts`; `client/src/components/common/manageDashboardUtils.ts`; `client/src/components/common/sessionRouterUtils.ts`; `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/sessionRouterUtils.test.ts`
- Follow-up action: Reuse `urlValidationUtils.ts` for future client-side URL validation instead of re-implementing `new URL(...)` checks in feature files.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck index extraction now accepts `reveal-sync` `action: "ready"` envelopes in both manager and student clients, not only `state`, so first-message index snapshots are retained.
- Why it matters: Some decks publish navigation indices in the initial ready handshake, so keeping the parsers action-tolerant preserves first-message state if host-side navigation or diagnostics are reintroduced later.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: Keep reveal-sync parsing helpers action-tolerant when payload schema matches, and add tests whenever new actions can carry `indices`.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck manager restore conversion now treats restorable `reveal-sync` `ready` envelopes like `state` by translating `indices` or `navigation.current` into a `command/setState` restore before restore suppression is armed.
- Why it matters: Without this alignment, a `ready` message could contribute indices to suppression tracking while being posted back to the iframe unchanged, causing outbound state to be dropped until timeout with no actual restore applied.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`
- Follow-up action: Keep `extractIndicesFromRevealPayload()` and `buildRestoreCommandFromPayload()` behavior in sync whenever new inbound reveal actions become restorable.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck manager no longer relays outbound `reveal-sync` `ready` envelopes to the sync server; only meaningful state-bearing updates should drive cross-instructor synchronization.
- Why it matters: Initial iframe `ready` messages often report default indices before a pending restore is applied, and broadcasting them can make peer instructors jump backward by restoring from stale startup coordinates.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/shared/revealSyncRelayPolicy.ts`; `activities/syncdeck/client/shared/revealSyncRelayPolicy.test.ts`
- Follow-up action: If a future multi-instructor feature genuinely needs `ready` propagation, add an explicit opt-in relay path instead of falling back to generic outbound state relay.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck no longer exports unused `extractNavigationCapabilities()` helpers from the manager or student clients; dormant host-navigation parsing was removed because the shipped shells do not render overlay arrow controls that consume those values.
- Why it matters: Keeps the SyncDeck client modules aligned with actual runtime behavior, removes duplicated parser code, and avoids implying a supported host-navigation API surface that is not part of the shipped UI.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: If host-side navigation returns, reintroduce protocol parsing only alongside a real runtime consumer and keep the implementation shared instead of duplicating manager/student helpers.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck manager no longer exports the unused `buildDirectionalSlideIndices()` helper or its direction type; those test-only artifacts were removed because the host shell does not ship directional navigation controls.
- Why it matters: Keeps the production module surface aligned with actual runtime behavior and avoids implying a supported host-navigation API that the manager does not use.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`
- Follow-up action: If host-side directional navigation returns, add the helper back only alongside a real runtime caller rather than exporting test-only code from the manager module.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck student no longer exports the unused `isForwardNavigationLocked()` helper; forward-lock calculation remained only in unit tests after student forward-lock UI was left out of the shipped shell.
- Why it matters: Keeps `SyncDeckStudent.tsx` focused on active runtime behavior and avoids preserving a dead API surface that suggests the student shell currently enforces host-side forward-lock UI.
- Evidence: `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: If student forward-lock UI returns, add the calculation back alongside a real runtime caller rather than exporting it solely for tests.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck manager restore suppression now drops the first outbound `reveal-sync` `state` emitted when an inbound restore reaches target indices, then releases suppression.
- Why it matters: Prevents instructor-to-instructor echo loops where a relayed inbound state triggers a local `setState` restore, then re-broadcasts that same state back through the server.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`
- Follow-up action: Reuse `evaluateRestoreSuppressionForOutboundState` if additional restore paths are added so echo prevention remains consistent.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck host-side iframe overlay arrow controls were removed from both manager and student shells; navigation is now expected to use presentation-native controls inside the deck.
- Why it matters: Avoids duplicate/competing navigation UI at the host layer and removes schema-coupled host arrow-state complexity.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`
- Follow-up action: Keep host shell focused on sync/session controls; add navigation affordances in deck content/plugins if needed.
- Owner: Codex

- Date: 2026-03-01
- Area: activities
- Discovery: SyncDeck released-stack boundary comparisons must treat same-horizontal vertical child-slide movement as still inside the released region; only moving to a later horizontal slide should clear/supersede the explicit boundary, and student snapback logic must not pull `h`-matching lower child slides back to `v = 0`.
- Why it matters: Full `h/v/f` boundary comparisons caused manager relay logic to clear boundaries and student boundary sync to snap lower-stack students back to the top child when an instructor moved down and back up within an already released vertical stack.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: When adjusting SyncDeck release logic, keep reconnect boundary restoration intact but preserve horizontal-only released-stack semantics for explicit boundary clear/snap decisions.
- Owner: Codex

- Date: 2026-03-01
- Area: activities
- Discovery: SyncDeck presentation preflight should accept the iframe's origin-validated `reveal-sync` `ready` startup message as a successful validation signal in addition to `pong`.
- Why it matters: Some regression/manual decks announce `ready` on init but do not answer the host ping with `pong`, and `pong`-only validation incorrectly blocks otherwise compatible SyncDeck presentations.
- Evidence: `activities/syncdeck/client/shared/presentationPreflight.ts`; `activities/syncdeck/client/shared/presentationPreflight.test.ts`
- Follow-up action: Keep preflight strict on `origin`/`source`, but treat standard startup handshake messages as sufficient proof that the reveal-sync bridge is alive.
- Owner: Codex

- Date: 2026-03-01
- Area: activities
- Discovery: SyncDeck host/student boundary canonicalization now uses the documented end-of-slide sentinel `f: -1` and boundary-specific comparison helpers instead of `Number.MAX_SAFE_INTEGER`.
- Why it matters: The old sentinel leaked an internal comparison hack into boundary payloads and drifted from the reveal-sync schema; using `f: -1` keeps wire semantics aligned while still preserving “end of boundary slide” behavior in suppression and snapback logic.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: If the iframe starts exposing explicit fragment-count metadata in state payloads, revisit boundary comparison helpers and remove the remaining sentinel semantics entirely.
- Owner: Codex

- Date: 2026-03-01
- Area: activities
- Discovery: SyncDeck now treats `syncToInstructor` as the host-side “snap to instructor and resume follow mode” command; explicit boundary relays remain `setStudentBoundary`, but host-generated snapback paths no longer send deprecated `syncToBoundary` flags on boundary commands.
- Why it matters: This keeps SyncDeck aligned with the updated reveal-sync protocol, avoids using boundary-setting commands as a hidden force-sync mechanism, and prevents duplicate `setState` relays when the student iframe can apply the instructor sync atomically in one command.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`; `.agent/knowledge/reveal-iframe-sync-message-schema.md`
- Follow-up action: Keep future SyncDeck host relay changes split between explicit boundary grants (`setStudentBoundary`), boundary clears (`clearBoundary`), and explicit user-driven snap commands (`syncToInstructor`) instead of inferring snap-to-instructor from ordinary `state` payloads with `studentBoundary: null`.
- Owner: Codex

- Date: 2026-03-05
- Area: activities
- Discovery: SyncDeck now centralizes reveal-sync protocol compatibility assessment (`assessRevealSyncProtocolCompatibility`) and adds opt-in client tracing (`?syncdeckDebug=1` or `localStorage.syncdeck_debug=1`) plus structured server warning telemetry for incompatible protocol envelopes.
- Why it matters: Sync failures caused by message-schema/version drift were previously silent; instrumentation now shows where a payload was queued, relayed, suppressed, or warned for version mismatch without changing normal relay behavior.
- Evidence: `activities/syncdeck/shared/revealSyncProtocol.ts`; `activities/syncdeck/shared/revealSyncProtocol.test.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/server/routes.ts`
- Follow-up action: If protocol-major enforcement is required later, flip client/server compatibility warnings into explicit drops behind a gated rollout after decks are verified on `2.x`.
- Owner: Codex

- Date: 2026-03-05
- Area: activities
- Discovery: SyncDeck server reveal-sync protocol warning dedupe now uses a bounded in-memory TTL/LRU-style map (5-minute TTL, max 500 keys) instead of an unbounded set.
- Why it matters: Keeps protocol warning spam suppression while preventing unbounded memory growth during long-running sessions with diverse mismatch signatures.
- Evidence: `activities/syncdeck/server/routes.ts`
- Follow-up action: If warning volume increases in production, consider exposing dedupe hit/prune counters via status telemetry.
- Owner: Codex

- Date: 2026-03-05
- Area: activities
- Discovery: SyncDeck manager/student debug tracing refs must be initialized eagerly with `useRef(isSyncDeckDebugEnabled())` instead of `useRef(false)` to capture events that arrive before the first `useEffect` runs.
- Why it matters: Early WebSocket or message-handler traffic can occur between first render commit and effect execution; lazy post-render initialization silently drops `[SYNCDECK-DEBUG]` traces even when `?syncdeckDebug=1` is present.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/shared/syncDebug.test.ts`
- Follow-up action: Keep the existing `location.search` effect update for navigation-time toggles, but preserve eager ref initialization when refactoring trace logging paths.
- Owner: Codex
- Date: 2026-03-13
- Area: tooling
- Discovery: The macOS Docker Desktop devcontainer blocked nested sandbox tooling such as Codex `apply_patch` because the `app` service was running under a seccomp profile that denied `unshare`, even though `kernel.unprivileged_userns_clone = 1` inside the guest. A repo-local namespace-friendly seccomp profile plus `cap_add: [SYS_ADMIN]` was added under `.devcontainer/` to make namespace-based tools work without switching the whole container to `seccomp:unconfined`.
- Why it matters: Devcontainer-based coding agents and other sandboxed helpers can fail with `bwrap: No permissions to create a new namespace` or `unshare ... Operation not permitted` on macOS-backed containers unless the container security profile is loosened.
- Evidence: `.devcontainer/docker-compose.yml`; `.devcontainer/seccomp-namespace.json`; `unshare -Ur true` previously failed with `Operation not permitted` in the `app` container.
- Follow-up action: Rebuild the devcontainer after changing the compose security settings, then re-test namespace creation (`unshare -Ur true`) and Codex `apply_patch` before broadening the profile further.
- Owner: Codex

- Date: 2026-03-13
- Area: tooling
- Discovery: Even with the namespace-friendly seccomp profile, Codex sandbox launch can still fail with `bwrap: Failed to make / slave: Permission denied` when the container remains under AppArmor `docker-default (enforce)` and `bubblewrap` is missing.
- Why it matters: This failure occurs before normal command execution and blocks agent automation paths that depend on nested sandboxing.
- Evidence: `bwrap --ro-bind / / true` failed with `Failed to make / slave`; `/proc/self/attr/current` reported `docker-default (enforce)`; devcontainer updates in `.devcontainer/docker-compose.yml` (add `apparmor:unconfined`) and `.devcontainer/devcontainer.json` (install `bubblewrap` in `postCreateCommand`).
- Follow-up action: Rebuild the devcontainer, then verify a non-escalated command path works (for example `echo sandbox-ok`) before continuing feature work.
- Owner: Codex

- Date: 2026-03-13
- Area: tooling
- Discovery: After rebuilding with `seccomp:unconfined` and `apparmor:unconfined`, nested sandbox launch is still blocked for the non-root `vscode` user at the user-ID mapping step: `unshare -Ur ...` fails with `write failed /proc/self/uid_map: Operation not permitted`, and `bwrap` fails with `setting up uid map: Permission denied`, while the same `unshare`/`bwrap` commands succeed under `sudo`.
- Why it matters: The remaining blocker is no longer seccomp/AppArmor profile selection inside the container; it is unprivileged user-namespace ID mapping for `vscode`, so additional repo-local seccomp changes will not fix Codex sandbox startup on their own.
- Evidence: `cat /proc/self/attr/current` reported `unconfined`; `/proc/sys/kernel/unprivileged_userns_clone=1`; `/proc/sys/kernel/apparmor_restrict_unprivileged_userns=1`; `strace` showed `openat(..., "uid_map", O_RDWR|O_CLOEXEC) = -1 EACCES`; `sudo unshare -Ur ...` and `sudo bwrap ...` both succeeded; installing `uidmap` added `newuidmap`/`newgidmap` but did not change the non-root `bwrap` failure.
- Follow-up action: Investigate the host or Docker Desktop VM policy that still restricts unprivileged user namespace mapping for container users, or switch the agent path to a root/setuid-capable `bwrap` configuration that is actually honored by the runtime.
- Owner: Codex

- Date: 2026-03-13
- Area: tooling
- Discovery: After installing `bubblewrap` in the devcontainer, Codex can execute `bwrap` successfully only with escalated privileges; non-escalated runs still fail (`open /proc/.../ns/ns failed`). A minimal escalated command (`bwrap --ro-bind / / -- bash -lc 'echo BWRAP_MIN_OK'`) succeeds, and Codex `apply_patch` now executes end-to-end successfully.
- Why it matters: This confirms agent workflows are unblocked for privileged command paths, while non-escalated namespace operations remain constrained and should not be assumed to work.
- Evidence: Terminal validation on 2026-03-13: `command -v bwrap` => `/usr/bin/bwrap`; `bwrap --version` => `0.11.0`; non-escalated `bwrap` failed; escalated minimal `bwrap` succeeded; repeated `apply_patch` create/delete smoke tests succeeded.
- Follow-up action: Keep using escalation for `bwrap`-dependent checks in this environment, and prefer `apply_patch` for file edits now that it is stable.
- Owner: Codex
