# Shared Activity Runtime and Authentication Plan

## Near-term delivery sequence (2026-09-24)

This sequence coordinates [#352](https://github.com/PerryHighCS/ActiveBits/issues/352), [#383](https://github.com/PerryHighCS/ActiveBits/issues/383), [#344](https://github.com/PerryHighCS/ActiveBits/issues/344), and [#353](https://github.com/PerryHighCS/ActiveBits/issues/353). Keep each phase independently reviewable. [#313](https://github.com/PerryHighCS/ActiveBits/issues/313) owns the broader atomic session-write migration and follows as a separate workstream; shared entry and lifecycle writes touched here must still use its safe mutation contract.

**Current delivery state:** [PR #387](https://github.com/PerryHighCS/ActiveBits/pull/387) contains the three implemented Phase A slices. It passed CI and was marked ready for review on 2026-09-24; it has not merged. CodeRabbit's first review identified two solo-entry gaps: the standalone roster gap is fixed in #387, and parent binding for solo children is tracked in [#388](https://github.com/PerryHighCS/ActiveBits/issues/388). Phase A is still under review. The original Phases 0–8 farther down are the long-range design/audit checklist; this near-term sequence is the current delivery tracker.

### Contract and observed failure

**Owner:** The shared entry and principal layer decides whether a session-scoped student may enter an activity; the activity owns its student record and private state. **Invariant:** A public waiting-room request cannot claim an arbitrary participant ID. An accepted, registered student with a valid server-issued principal can reload into the same student ID. An explicit fresh join in a shared browser can create a different student. A consumed one-time handoff cannot issue a second capability. **Failure behavior:** Missing, expired, wrong-session, or revoked authority returns to normal waiting-room acceptance or a controlled authorization error; it never silently adopts a local-storage ID or an old browser user's capability.

The #383 browser report had a deterministic path: Resonance registration revokes `acceptedEntryParticipants[studentId]` after issuing an activity participant capability. Previously, `GET /api/session/:id/entry` checked only the revoked accepted-entry token, so it omitted `participantAuthenticated` and the router showed the waiting room. The subsequent join minted a new ID. PR #387 recognizes a valid registered capability at `/entry`, covers the saved-draft reload in Chromium, removes #352's public supplied-ID trust, and requires parent-cookie proof for SyncDeck child tokens and student transport. #313 races remain possible.

### Phase A: Secure student entry and restore reload identity (#352, #383)

- [x] Restore `/entry` recognition of a valid registered participant capability and prove Resonance's saved-draft reload retains its student ID (#383 first slice).
- [x] Make public live/persistent stores mint IDs, and use parent-cookie-authorized SyncDeck embedded and solo child handoffs for identity continuity (#352 slice).
- [x] Move SyncDeck's remaining student WebSocket admission and student-ID HTTP routes to the accepted-entry principal contract; WebSocket join, embedded context, and auto-activation now require cookie authority and reject mismatched ID hints.
- [x] Update `ARCHITECTURE.md`, `.agent/knowledge/data-contracts.md`, and `.agent/knowledge/security-notes.md` for the delivered student-entry behavior.
- [x] Restore solo child handoff for an accepted standalone SyncDeck student who has no WebSocket roster record; derive the ID from the accepted-entry token and test that path. `solo-activity/entry` now uses `resolveAcceptedSyncDeckEntryIdentity`, which takes the ID and fallback name from the accepted-entry record and uses the roster only for the display name. Removal revokes the parent accepted entry, so a removed student is still denied.
- [ ] Require proof that a solo child belongs to the requesting SyncDeck parent before issuing its trusted entry token; reject an unrelated existing session ID. Design recorded below; implementation tracked in [#388](https://github.com/PerryHighCS/ActiveBits/issues/388), outside PR #387.
  - [ ] Add an activity-agnostic server hook for creating a solo session from `selectedOptions` (for example `createSoloSession` on the server activity registry), and move each solo-capable activity's create validation behind it: Resonance, Video Sync, MobCode.
  - [ ] Add `POST /api/syncdeck/:sessionId/solo-activity/start`, which authorizes the accepted-entry cookie, creates the child through the hook, and records the binding before returning the child ID.
  - [ ] Change `solo-activity/entry` to require a matching binding; switch `SyncDeckStudent` to the start route instead of calling each activity's client `launchPersistentSoloEntry`.
  - [ ] Route tests: unbound existing session, binding owned by another student, other parent's child, missing/expired child, revoked parent entry, a student who relaunches the same slide (binding reused or replaced), plus a standalone browser smoke test.
- [ ] Resolve CodeRabbit's first review (roster finding fixed in #387; parent-binding finding deferred to #388), complete review, and merge PR #387; close #352 and #383 only after the merged behavior is verified.
- [ ] Record the proof accepted by standalone, persistent, and SyncDeck embedded entry, including the parent-roster and session-incarnation checks for child handoffs. Keep the rule in the shared principal layer.
- [ ] Complete the accepted-entry-to-registered transition matrix: explicit new entry in a shared browser must supersede stale authority without replaying a consumed handoff; cookie loss, expiry, and wrong-session proof must reach a controlled entry path.
- [ ] Reconcile route and browser coverage against that matrix, including the existing Resonance draft/reload test and an additional activity's reload path. Put any demonstrated gap in a focused follow-up rather than widening PR #387 during review.

**Exit gate:** A valid registered student reloads under the same server-authorized ID; a new or unauthorized visitor cannot claim that ID; SyncDeck embedded identity continuity still works.

#### Solo child binding (CodeRabbit finding on PR #387)

**Owner:** SyncDeck's server routes own the binding. The parent SyncDeck session record keeps `soloChildren[childSessionId] = { studentId, activityId, createdAt }`, written only by `solo-activity/start` in the same request that creates the child. The shared layer owns only the generic solo-create hook; it never learns about SyncDeck.

**Invariant:** `solo-activity/entry` issues a trusted child entry token only when the parent's accepted-entry cookie resolves to student S, `soloChildren[childSessionId]` exists, its `studentId` is S, and the child session still exists with the recorded `activityId` as its type. A client-supplied child ID never proves ownership on its own. Record count per student is capped, and records are pruned when the child is missing, so the parent record cannot grow without limit.

**Failure behavior:** A missing or mismatched binding returns 403 with no write to the child session. A missing child returns 404, and the stale binding is removed. The client shows the existing "Unable to launch this solo activity" notice; it never falls back to an unauthenticated child entry. Removing a student deletes that student's bindings along with the accepted-entry revocation.

**Why server-side creation rather than a post-create registration step:** A registration call made after the client created the child cannot prove the caller created it, so it would still accept any known session ID. The cost is the new activity hook: each activity's solo create validation currently lives only behind its own `/api/<activity>/create` route. Phase B's planned creator capability (an httpOnly cookie issued when a session is created) could replace the parent-held binding with direct proof of creation. If Phase B lands first, re-evaluate before building the hook.

### Phase B: Establish the temporary manager contract (#344)

- [ ] Reconcile #344's old stacked-on-#342 delivery note with the current branch/PR state; implement this as a focused successor rather than depending on the unmerged audit branch.
- [ ] Define and apply a generic temporary-session creator capability at creation, verified for manager REST and WebSocket access. Preserve zero-prompt instructor startup, cookie-backed reload, and the existing verified persistent and embedded manager adapters. Never place instructor passcodes or manager credentials in browser storage.
- [ ] Prove the contract on one representative activity, using Java Format's existing capability work where appropriate. Pair its manager-route migration with Phase C before treating the activity as fully protected.
- [ ] Test forged `role=manager`, absent/expired/wrong-session cookie, shared-browser student/manager tabs, persistent and embedded recovery, and browser reload for the pilot.

**Exit gate:** The shared contract and one pilot derive manager REST and WebSocket authority from the same server-verifiable principal. Its shared End Session path remains an explicit Phase C gate.

### Phase C: Protect shared session termination (#353)

- [ ] Extend the shared HTTP principal contract to `DELETE /api/session/:sessionId` and any equivalent end-session path, with an activity-agnostic policy declaration. Gate each migrated activity's End Session with the same manager principal as its other manager routes. Avoid a one-off Java Format branch or a blanket change that breaks unmigrated activities.
- [ ] Check the session type and incarnation inside the authorized termination boundary, and ensure denial has no delete or broadcast side effect.
- [ ] Add route and browser tests for authorized end, known-ID unauthenticated delete, student cookie, wrong-session manager cookie, expired manager cookie, and embedded parent-controlled end. Document the lifecycle authorization rule.

**Exit gate:** A known session ID alone cannot end the pilot activity; the legitimate manager and parent-owned embedded lifecycle still work. Apply this gate with each subsequent manager migration.

### Phase D: Roll out manager protection in reviewable slices (#344, #353)

- [ ] Complete or verify Python List, Binary Breach, Java String, Java Format, and Traveling Salesman against the Phase B manager contract; keep activity-specific domain commands inside each activity.
- [ ] For each activity, protect manager REST, manager WebSocket, and shared End Session in the same slice. Include temporary, persistent, embedded, and reload paths that activity supports.
- [ ] Add the Phase B/C authorization matrix and browser smoke coverage for each slice before marking that activity complete.

**Exit gate:** Every activity named in #344 has consistent manager authority across its control surfaces, including session termination.

### Phase E: Complete atomic session-write migration (#313)

- [ ] Use #313's writer inventory to migrate complete session-type writer sets, including the shared entry/consume and lifecycle routes changed above. Do not mix plain `set()` and atomic writers for one session type.
- [ ] Verify overlapping entry, registration, manager, and end-session operations against the chosen in-memory and Valkey stores. Preserve session-incarnation, TTL, and cache behavior.

**Exit gate:** The identity and authorization guarantees from Phases A–D survive concurrent writers and scale-out; #313 retains the detailed project-wide checklist.

## Status

- [x] Recognize the repository-wide architecture problem exposed by issue #341 and PR #342.
- [x] Inventory registered activities at a coarse level for sessions, WebSockets, entry configuration, and existing identity/authentication code.
- [x] Start the durable audit matrix in `.agent/knowledge/activity-runtime-audit.md` with all registered activities represented.
- [x] Complete a route-by-route and message-by-message audit before defining the final shared contract.
- [ ] Implement in small, independently reviewable PRs rather than another repository-wide rollout PR.

## Purpose

ActiveBits began with activities owning their full runtime stack. That kept early activity development simple, but the platform now has repeated implementations of the same security- and lifecycle-critical behavior: session creation, waiting-room acceptance, student identity, instructor authority, REST authorization, WebSocket admission, reconnect/rejoin handling, public/private state projection, persistent links, and embedded launches.

This plan moves those platform concerns into shared, activity-agnostic infrastructure while preserving activity ownership of domain state, commands, events, UI, validation, and reporting.

The target is not one giant activity framework. The target is a small trusted runtime boundary underneath self-contained activity modules.

## Problem Statement

The current design creates several recurring risks:

- [ ] Activities parse identity claims, cookies, query parameters, and WebSocket roles differently.
- [ ] Manager and student connections sometimes share one namespace without a server-authenticated principal.
- [ ] Public, student, and instructor state projections are inconsistent or implicit.
- [ ] Temporary, persistent, solo, and SyncDeck-embedded sessions enter activities through different paths that can drift.
- [ ] Reconnect and expired-cookie behavior is duplicated across clients.
- [ ] Session normalizers may preserve activity fields while accidentally dropping shared security metadata.
- [ ] Security fixes require auditing every activity copy and can introduce cross-activity regressions.
- [ ] Tests verify individual implementations but do not enforce a common platform contract.

## Architectural Boundary

### Shared platform owns

- [ ] Session creation and shared session metadata.
- [ ] Temporary-session instructor capability issuance, recovery, rotation, revocation, and expiry.
- [ ] Persistent-session and embedded-session instructor authority adapters.
- [ ] Waiting-room acceptance and server-issued participant identity.
- [ ] Student and instructor cookie names and attributes.
- [ ] REST and WebSocket principal resolution.
- [ ] Role authorization before activity handlers execute.
- [ ] Public, student, and instructor projection boundaries.
- [ ] Common WebSocket admission, connection metadata, duplicate-connection policy, and lifecycle hooks.
- [ ] Standard authentication-failure protocol and client rejoin/recovery decisions.
- [ ] Shared limits, structured logging fields, and security-focused contract tests.
- [ ] Preservation/normalization of platform-owned session metadata.

### Activities continue to own

- [ ] Activity-specific state and normalization.
- [ ] Student and instructor UI.
- [ ] Domain commands, events, broadcasts, and validation.
- [ ] Activity-specific state projections after the platform supplies an authenticated principal.
- [ ] Scoring, moderation, challenge generation, presentation behavior, and reporting.
- [ ] Activity-local accessibility and browser interaction tests.

### Activities must not own after migration

- [ ] Cookie parsing or authentication-token resolution.
- [ ] Trust decisions based on `studentId`, `participantId`, `role`, or display-name request fields.
- [ ] Manager authorization based only on a session ID, URL location, or client-selected WebSocket role.
- [ ] Direct serialization of raw session records to unauthenticated callers.
- [ ] Independent definitions of authentication-close reasons and rejoin behavior.

## Proposed Runtime Contract

The audit is complete. The versioned authority, capability, projection, and transport
contract now lives in `.agent/knowledge/activity-runtime-threat-model.md`. The eventual
handler API should provide activity code with an already-resolved context similar to:

```ts
interface ActivityRequestContext<TSession, TRole extends ActivityRole> {
  session: TSession
  principal: ActivityPrincipal<TRole>
  transport: 'http' | 'websocket'
}

type ActivityPrincipal<TRole extends ActivityRole = ActivityRole> =
  | { role: 'public' }
  | { role: 'student'; participantId: string; displayName: string | null }
  | { role: 'manager'; capabilityId: string }
  | { role: 'embedded-manager'; parentSessionId: string; capabilityId: string }
```

Activity registration should declare authorization and projection requirements instead of implementing authentication:

```ts
registerActivityRuntime({
  activityId: 'example',
  routes: {
    public: publicRoutes,
    student: studentRoutes,
    manager: managerRoutes,
  },
  websocket: {
    student: handleStudentSocket,
    manager: handleManagerSocket,
  },
  projections: {
    public: buildPublicState,
    student: buildStudentState,
    manager: buildManagerState,
  },
})
```

This is a design direction, not a requirement to adopt this exact syntax. The threat
model is authoritative for its security properties; implementation API naming remains
open until the first shared primitive PR.

## Current Activity Inventory

This initial inventory is deliberately conservative. Each row must be expanded during Phase 1 with exact routes, messages, state sensitivity, session modes, and current trust assumptions.

| Activity | WebSocket | Student identity/state | Instructor or manager authority | Initial migration concern |
| --- | --- | --- | --- | --- |
| `algorithm-demo` | Yes | Audit needed | Session-ID-based manager surfaces likely | Separate observer and controller messages; classify public demo state |
| `binary-breach` | Yes | Student progress and attributed mutations | Manager REST/socket authority needs platform capability | Shared student/manager namespace and private roster/progress |
| `embedded-test` | Yes | Uses accepted-entry concepts | Embedded manager trust needs explicit adapter | Development-only status must not exempt shared boundary tests |
| `gallery-walk` | Yes | Reviewer identity and feedback privacy need audit | Manager/report routes need audit | QR/reviewer flows may require additional scoped principals |
| `java-format-practice` | Yes | Attributed progress | Manager REST/socket currently lacks a platform principal | Representative simple migration candidate |
| `java-string-practice` | Yes | Attributed progress | Manager REST/socket currently lacks a platform principal | Closely related to Java Format; migrate after proving contract once |
| `mobcode` | Yes | Private workspaces and responses | Has explicit manager-auth protocol/passcode concepts | Strong reference implementation, but browser-storage/passcode rules must remain enforced |
| `postboard` | No activity socket | Private moderation/ownership state | Instructor passcode/recovery paths exist | Useful REST-only student projection/auth reference |
| `python-list-practice` | Yes | Attributed stats | Manager REST/socket currently lacks a platform principal | Shared namespace plus reconnect/rejoin behavior |
| `raffle` | Yes | Participant/entry semantics need audit | Manager control authority needs audit | May need public-display or observer principal distinct from student |
| `resonance` | Yes | Private answers, drafts, attribution | Instructor passcode/recovery paths exist | Current #341 reference for student-cookie boundary; do not treat as final shared API |
| `syncdeck` | Yes | Student presentation state | Multiple instructor paths: temporary, persistent, Learn, embedded | Most complex adapter; migrate after core contract stabilizes |
| `traveling-salesman` | Yes | Attributed routes and leaderboard state | Manager REST/socket currently lacks a platform principal | Split route modules make middleware composition important |
| `video-sync` | Yes | Student identity currently limited but must be classified | Mature instructor/passcode and embedded recovery paths | Reference for role normalization and persistent/embedded auth adapters |
| `www-sim` | Yes | Participant role and state need audit | Manager/controller authority needs audit | Simulation roles may require more than student/manager |

## Guiding Decisions

- [x] Keep activity domain modules self-contained.
- [x] Centralize security and lifecycle decisions that must be consistent.
- [x] Preserve the no-account instructor experience.
- [x] Treat automatic httpOnly capabilities as authentication; do not require a visible login prompt for temporary-session creators.
- [x] Treat session IDs as routing identifiers, not credentials.
- [x] Treat request-controlled role and participant fields as hints only.
- [x] Protect manager REST and WebSocket surfaces together; do not fix only one transport.
- [x] Use explicit adapters for persistent, embedded, Learn, and solo modes.
- [x] Treat credentialless embedded activity managers as authenticated parent-derived principals, not public managers; the child need not invent or receive an activity passcode.
- [x] Prefer replacement PRs and staged migrations over a single repository-wide rollout.
- [x] Use a clean deployment cutover; preserving sessions that were live before deployment is not required.
- [x] Represent intentional anonymous observers with the `public` principal and activity-declared projections; reject anonymous sockets for activities without that declaration.
- [ ] Decide capability recovery behavior after browser restart for temporary-session instructors.
- [ ] Decide whether temporary manager capabilities are per session, bounded collections in one cookie, or exchanged from a short-lived handoff.

## Phase 0: Stabilize Current Work

- [x] Keep PR #342 as an audit/history record; do not merge it.
- [x] Open focused draft PR #345 for the original Resonance/Postboard issue #341 scope.
- [x] Track reusable WebSocket recovery testing in issue #343.
- [x] Track temporary-session manager authentication in issue #344.
- [ ] Review PR #345 only against its narrow security boundary.
- [ ] Do not restart broad activity rollout until the shared runtime contract is reviewed.

## Phase 1: Complete Repository-Wide Runtime Audit

For every activity, record the following in a single audit matrix:

- [x] All session creation paths: dashboard, direct create, persistent, solo, embedded, Learn/integration, and test factories.
- [x] Every REST route, required role, sensitive inputs, and response projection.
- [x] Every WebSocket namespace, connection role, inbound messages, outbound messages, and broadcast audience.
- [x] All client-persisted identity, session, recovery, and credential data.
- [x] All server-stored shared metadata and activity normalizers.
- [x] Manager reload/rejoin/recovery behavior.
- [x] Student reload/rejoin/recovery behavior.
- [x] Duplicate-socket and disconnect semantics.
- [x] Report/export authorization.
- [x] Public display, observer, reviewer, runner-popup, or other non-student/non-manager roles.
- [x] Existing tests and missing boundary coverage.

Deliverables:

- [x] Add an activity runtime audit matrix under `.agent/knowledge/activity-runtime-audit.md`.
- [x] Assign each route/message one explicit principal requirement.
- [x] Identify existing vulnerabilities separately from migration regressions.
- [x] Identify activity behavior that should remain intentionally public.

## Phase 2: Define Shared Principal and Capability Contracts

- [x] Define `ActivityRole` and discriminated `ActivityPrincipal` types.
- [x] Define an activity-agnostic scoped-grant shape for specialized student-like subjects/resources; keep activity-specific role meaning and lifecycle in the activity.
- [x] Keep scoped subject IDs immutable and separate from mutable activity-owned addresses such as simulated hostnames.
- [x] Define public resource addresses separately from authentication capabilities so QR/link target identifiers never implicitly grant private reads.
- [x] Define temporary-session manager capability issuance during session creation.
- [x] Store only hashed manager capability tokens server-side.
- [x] Issue opaque tokens only in httpOnly, same-site cookies with live-connection-aware `Secure` handling.
- [x] Define bounded expiry, revocation, rotation, session-end cleanup, and store normalization.
- [x] Define persistent teacher-cookie to manager-principal resolution.
- [x] Define embedded-parent and Learn instructor handoff to manager-principal resolution.
- [x] Make the embedded-parent handoff child-session-scoped and activity-agnostic so credentialless children consume authority without implementing a passcode exchange.
- [x] Define student accepted-entry token to student-principal resolution.
- [x] Define anonymous no-name participant issuance for activities such as Raffle that do not use waiting-room identity.
- [x] Define an idempotent, principal-bound resource claim pattern for ticket-like enrollment results.
- [x] Define solo-mode principals without weakening live-session authorization.
- [x] Define public/observer projection rules.
- [x] Require activity-owned projections for opaque domain state so secrets embedded inside an activity state object are not exposed by generic serialization.
- [x] Document threat model and trust boundaries before implementation.

## Phase 3: Build Shared HTTP Authorization and Projection Primitives

- [ ] Add generic middleware/wrappers for public, student, manager, and specialized-role routes.
- [ ] Extend the manager principal requirement to session **lifecycle** routes (`DELETE /api/session/:sessionId` / end-session), with a per-activity principal contract, so a migrated activity's End Session is gated like the rest of its surface ([#353](https://github.com/PerryHighCS/ActiveBits/issues/353)).
- [ ] Support route-group composition so split activity modules can apply a principal requirement once without reimplementing credential parsing.
- [ ] Invoke activity-owned domain validation only after shared session/principal resolution; authentication must not imply that domain payloads are trustworthy.
- [ ] Ensure wrappers validate session existence and activity type before invoking activity code.
- [ ] Pass authenticated principals to handlers; do not expose raw tokens.
- [ ] Add explicit public/student/manager projection helpers or registration contracts.
- [ ] Make raw `SessionRecord` serialization unavailable to public routes by default.
- [ ] Standardize `Cache-Control: no-store` for participant- or manager-private responses.
- [ ] Standardize structured authorization failure logging without identity/credential leakage.
- [ ] Add shared contract tests for forged IDs, forged roles, missing/expired cookies, wrong-session tokens, and projection leakage.

## Phase 4: Build Shared WebSocket Admission and Delivery Primitives

- [ ] Resolve principal before retaining an activity socket or subscribing it to broadcasts.
- [ ] Store authenticated role and principal ID on the server-side socket object.
- [ ] Route outbound messages by authenticated audience, not client query parameters.
- [ ] Provide participant-targeted delivery keyed by the authenticated student principal for private activity state.
- [ ] Standardize manager, student, public-display, and specialized-role registration.
- [ ] Standardize duplicate participant socket handling and disconnect lifecycle callbacks.
- [ ] Define one versioned authentication-close/error protocol.
- [ ] Ensure pub/sub fanout retains audience boundaries across instances.
- [ ] Add tests proving unauthorized sockets receive no initial snapshot and no later broadcast.
- [ ] Add tests for authenticated manager/student sockets and cross-role message isolation.
- [x] Keep development-tool WebSocket upgrades outside the activity router so Vite HMR cannot be destroyed before its proxy handler runs (Java Format lifecycle validation).

## Phase 5: Standardize Client Recovery

- [ ] Add a shared decision helper for authentication close/status responses.
- [ ] Add a reusable WebSocket test harness as tracked in issue #343.
- [ ] Clear only routing hints on authentication expiry; preserve non-sensitive student work where appropriate.
- [ ] Return students through normal waiting-room acceptance.
- [ ] Recover managers automatically when a valid httpOnly capability exists.
- [ ] Present a clear recovery path when a temporary manager capability is genuinely unavailable.
- [ ] Prevent reconnect loops after terminal authentication failures.
- [ ] Add browser-level tests for cookie loss, reload, expiry, and role isolation.

## Phase 6: Prove the Contract with Representative Activities

Do not begin with all activities at once.

### Slice A: simple student + manager WebSocket activity

- [x] Select `java-format-practice` as the initial candidate based on the three-practice-activity audit and comparison with MobCode/Video Sync.
- [x] Decide that the practice pilot has no anonymous observer socket; future activities must explicitly declare a real public-display use case.
- [x] Migrate create, manager REST, student REST, manager socket, and student socket together (Java Format; commits `0d52082b` and `0c5bfcf4`).
- [x] Verify zero-prompt instructor creation and manager cookie recovery (Java Format Playwright coverage).
- [x] Verify student waiting-room entry, reload, capability loss, and recovery to normal entry (Java Format Playwright coverage). Cookie-backed reload retains a non-sensitive local display-name hint; a fresh-browser cookie-only identity bootstrap remains a deliberate follow-up decision.
- [x] Make Java Format socket startup Strict-Mode-safe: cancel the throwaway effect before it starts a browser WebSocket, then open only the retained manager or student connection (browser coverage rerun).
- [x] Verify that a student tab sharing the instructor browser context selects its participant capability and cannot be misclassified as the manager (Java Format browser coverage).
- [ ] Review the contract before migrating a sibling activity.
- [x] Resolved Slice A permalink gap: the shared persistent teacher-auth route issues and persists the manager capability after server-side teacher-code verification, so Java Format restores `supportsPermalink: true` for persistent and solo links ([#351](https://github.com/PerryHighCS/ActiveBits/issues/351)).
- [ ] Known gap from Slice A: the manager UI's **End Session** control hits the activity-agnostic `DELETE /api/session/:sessionId` (`server/core/sessions.ts`), which is still authorized by session ID only, so the session-termination lever is unprotected even though the rest of the Java Format manager surface now requires the capability. Tracked in [#353](https://github.com/PerryHighCS/ActiveBits/issues/353). The fix belongs in the Phase 3 shared HTTP authorization primitive extended to session **lifecycle** routes, then adopted per activity; it is not fixed in shared code as a one-off because every unmigrated activity shares that route.
- [ ] Known gap from Slice A: Java Format's `POST /stats` and participant WebSocket admission each read-modify-write `session.data.students` then call `sessions.set`, which is an unconditional write, so a concurrent stats submit and socket connect can clobber each other (drop the new `stats` or `connected: true`). This is the same class of race as the SyncDeck roster issue ([#350](https://github.com/PerryHighCS/ActiveBits/issues/350)) and is blocked on the project-wide atomic session-mutation primitive ([#313](https://github.com/PerryHighCS/ActiveBits/issues/313)); both java-format paths should adopt it once it exists rather than hand-rolling a compare-and-swap loop here.

### Slice B: REST-only/private projection activity

- [ ] Use Postboard to prove student-private and manager-private HTTP projections.
- [ ] Preserve moderation semantics and report authorization.

### Slice C: mature multi-mode activity

- [ ] Use Video Sync or MobCode to prove persistent/embedded adapters without replacing their domain protocols prematurely.

#### Historical Slice C branch: `feat/persistent-manager-capability-adapter` (Video Sync)

- [x] Select Video Sync because its persistent-teacher and SyncDeck-parent recovery paths are already server-verified and its manager surface is narrower than MobCode's private-workspace model.
- [x] Audit the existing adapter: verified persistent/parent authority currently reaches the manager by returning `instructorPasscode` from `GET /api/video-sync/:sessionId/instructor-passcode`.
- [x] Add the shared capability issuance adapter (`issueActivityCapability` to mint + persist the digest, `writeActivityCapabilityCookie` to deliver the opaque token as an httpOnly cookie), used only after an approved server-side authority source has been verified — an activity's existing parent or persistent-teacher authority, or a validated-and-consumed one-time `embeddedManagerEntryToken` on the SyncDeck embedded-manager route — and without exposing an activity credential.
- [x] Issue the httpOnly manager capability on Video Sync persistent/parent recovery and accept it on manager REST routes.
- [x] Admit Video Sync manager WebSockets from that capability, initially alongside the early auth-message listener and passcode fallback for mixed-deploy safety — both since removed by the "Complete the Video Sync clean cutover" item below, so admission is now capability-only.
- [x] Add a parallel, generic SyncDeck embedded-manager exchange that consumes the one-time child token and issues only the child manager capability; retain the existing passcode exchange until its other activity clients migrate.
- [x] Add the shared client hook for the cookie-only embedded-manager exchange, including bounded refresh behavior and request-contract tests.
- [x] Migrate the Video Sync manager client to capability-only embedded bootstrap, cookie-authenticated WebSockets, and cookie-authorized REST commands. (The server passcode fallback retained here for temporary mixed-deploy compatibility was subsequently removed by the clean-cutover item below.)
- [x] Remove the Video Sync persistent-solo launcher’s passcode handoff; session creation issues the manager capability before its configuration request.
- [x] Add Chromium browser coverage for Video Sync manager recovery from its httpOnly capability cookie without a passcode handoff (WebKit API-request cookie retention is unavailable in the shared harness).
- [x] Stabilize the existing SyncDeck student-return browser regression test: wait for each rendered roster row, rather than only its early connected-count update, before opening the next student socket (the underlying atomic-mutation race remains tracked in [#350](https://github.com/PerryHighCS/ActiveBits/issues/350)).
- [x] Preserve an origin-only cross-origin referrer for SyncDeck embedded managers and explicitly pass the ActiveBits origin to Video Sync's YouTube players, so Safari can satisfy YouTube's client-identification requirement without leaking the child manager's one-time entry token.
- [x] Set the client document referrer policy to `strict-origin`, so embedded-manager bootstrap tokens also cannot reach child-document subresources; persist manager capabilities before issuing their cookies and request a bounded fresh bootstrap token after a temporary persistence failure.
- [x] Complete the Video Sync clean cutover: remove its legacy raw `instructorPasscode` field, responses, REST bodies, and manager-WebSocket fallback now that new sessions do not need mixed-deploy compatibility.
- [x] Harden the shared resilient WebSocket hook so events from a replaced socket cannot overwrite the state of the current manager connection (including React Strict Mode's discarded development connection).
- [x] Add Chromium Video Sync browser coverage that clears a temporary manager's capability cookie and verifies the manager becomes read-only without a passcode fallback.
- [x] Serialize Video Sync's in-process per-session read-modify-write paths (manager commands, telemetry, heartbeats, connection changes, and stale-telemetry pruning) so an overlapping background write cannot restore an older playback state; retain the existing cross-instance atomicity follow-up in Slice A.
- [x] Revalidate Video Sync manager access and replace its manager WebSocket when SyncDeck makes a warm embedded manager active again, so returning to a slide cannot retain a stale connection.
- [x] Add a bounded first-load retry for SyncDeck instructor and student WebSockets so transient startup ordering cannot leave a newly configured session disconnected until a browser reload.
- [ ] Add persistent, embedded, temporary-manager, capability-loss, and cross-role browser/route/socket coverage.
- [x] Restore Java Format permalink support in the Phase 6 retrofit after the adapter was proven ([#351](https://github.com/PerryHighCS/ActiveBits/issues/351)).
- [x] Restore the Java Format persistent permalink manager handoff: recover a manager capability from the verified persistent-teacher cookie before its gated manager REST and WebSocket surfaces connect.

### Phase 6 wrap-up (after Slice C, before Phase 7)

- [x] Retrofit `java-format-practice` permalink / persistent-teacher manager auth onto the Slice C persistent adapter ([#351](https://github.com/PerryHighCS/ActiveBits/issues/351)); this closes the Slice A known gap so Wave 1's near-identical practice activities inherit a settled pattern.
- [ ] Re-review the contract once a simple, a REST-only, and a multi-mode activity are all migrated.

## Phase 7: Migrate Remaining Activities in Risk-Based Waves

### Wave 1: similar practice activities

- [ ] `java-string-practice`
- [ ] `python-list-practice`
- [ ] `traveling-salesman`
- [ ] `binary-breach`

### Wave 2: established participant-private activities

- [ ] `resonance`
- [ ] `mobcode`
- [ ] `gallery-walk`

### Wave 3: public/display/simulation role activities

- [ ] `algorithm-demo`
- [ ] `raffle`
- [ ] `www-sim`
- [ ] `embedded-test`

### Wave 4: orchestration and multi-mode activities

- [ ] `video-sync`
- [ ] `syncdeck`
  - Pre-existing roster race to fix during this migration: independent
    `/ws/syncdeck` handlers each read-modify-write the whole `session.data`
    with no per-session serialization, so a concurrent student join and
    instructor state message can clobber the roster (instructor panel then
    under-reports connected students). Tracked in
    https://github.com/PerryHighCS/ActiveBits/issues/350. A per-session write
    lock around the socket handlers fits naturally with this migration.

For every migration:

- [ ] Remove local cookie parsing and request-role trust.
- [ ] Declare route and socket principal requirements.
- [ ] Define explicit projections and broadcast audiences.
- [ ] Preserve activity behavior and accessibility.
- [ ] Update activity tests plus shared contract tests.
- [ ] Update `DEPLOYMENT.md` and architecture docs when runtime behavior changes.
- [ ] Update `skills/syncdeck/references/ACTIVITY_PAYLOADS.md` if embedded launch formats change.

## Phase 8: Enforce the Boundary

- [ ] Add repository checks preventing new activity-local authentication cookie parsing.
- [ ] Add checks or lint conventions preventing request-controlled role fields from being treated as authority.
- [ ] Add an activity registration contract test covering every registered activity.
- [ ] Add a security checklist to `ADDING_ACTIVITIES.md`.
- [ ] Require explicit public/student/manager projection declarations for new activities.
- [ ] Deprecate and then remove legacy shared helpers superseded by the runtime contract.
- [ ] Remove compatibility paths after their documented cleanup condition is met.

## Testing Strategy

- [ ] Shared unit tests for capability issuance, hashing, lookup, expiry, rotation, revocation, and wrong-session rejection.
- [ ] Shared HTTP contract tests for every principal class.
- [ ] Shared WebSocket contract tests for admission and audience isolation.
- [ ] Activity adapter tests proving authenticated context reaches domain handlers.
- [ ] Negative tests with explicit `[TEST]` logs for expected denials.
- [ ] Playwright coverage for session creation, automatic manager capability, live manager updates, student entry, reload, cookie loss, and rejoin.
- [ ] Multi-instance/pub-sub tests for audience-preserving broadcasts where practical.
- [ ] Full `npm test` at cross-workspace milestones.
- [ ] `npm run test:e2e` whenever routing, cookie, WebSocket, or browser recovery behavior changes.

## Delivery and Review Strategy

- [ ] Keep each PR centered on one shared primitive or one activity migration.
- [ ] Avoid mixing security foundation, migration compatibility, unrelated cleanup, and broad activity rollout.
- [ ] Mark architectural foundation PRs draft until their contract and threat model are reviewed.
- [ ] Batch automated review findings before pushing follow-ups.
- [ ] Treat security/correctness blockers separately from style and optional coverage suggestions.
- [ ] Use tracking issues for valid follow-ups instead of expanding the active PR indefinitely.
- [ ] Record merge order for stacked PRs.
- [ ] Do not merge a temporary compatibility bypass that is known to weaken authorization.

## Compatibility and Rollout Policy

- [x] Use a clean cutover. Sessions created before deployment may be invalidated or allowed to expire; they do not require continued participation or manager recovery.
- [ ] Require the new principal/capability model immediately for every session created after deployment.
- [ ] Do not add legacy claimed-ID fallbacks, migration markers, mixed-mode token maps, or pre-deployment session compatibility branches.
- [ ] Ensure clients respond to an old/incompatible session with a clear restart or re-entry path rather than a reconnect loop.
- [ ] Document the deployment boundary and expected invalidation of any pre-deployment sessions.
- [ ] Use PR #342 only as audit evidence; do not copy its temporary compatibility code into the clean-main implementation.

## Documentation Deliverables

- [ ] Update `ARCHITECTURE.md` with the shared runtime/principal boundary.
- [ ] Update `DEPLOYMENT.md` with capability cookie and proxy/TLS requirements.
- [ ] Update `ADDING_ACTIVITIES.md` with the registration and projection contract.
- [ ] Update `.agent/knowledge/security-notes.md` with the final threat model.
- [ ] Update `.agent/knowledge/data-contracts.md` with principal, route, socket, and projection contracts.
- [ ] Update `.agent/knowledge/testing-patterns.md` with the shared transport-auth harness.

## Definition of Done

- [ ] Every registered activity has an audited and documented role/projection model.
- [ ] No activity trusts client-controlled participant or manager identity.
- [ ] Temporary-session creators become authenticated managers automatically without user accounts or another prompt.
- [ ] Persistent, embedded, Learn, and solo modes use explicit adapters to the same principal model.
- [ ] Manager REST and WebSocket access enforce the same authority.
- [ ] Student-private state and mutations require the same server-issued participant identity across transports.
- [ ] Public responses and broadcasts contain only explicitly public projections.
- [ ] Authentication expiry produces deterministic recovery rather than reconnect loops.
- [ ] Shared contract tests cover every registered activity adapter.
- [ ] Legacy duplicated authentication code and compatibility shims are removed.

## Immediate Next Step

- [x] Complete Phase 1 as a read-only audit before implementing issue #344.
- [x] Review the completed matrix and extract the versioned principal, capability, projection, and transport threat model before implementation begins.
- [x] Open the first shared-primitives implementation PR and record its pilot results in the Phase 6 checklist above.
- [ ] Complete review and merge PR #387's Phase A issue fixes. Merge requires the standalone roster finding to be fixed (done in #387); the solo child parent-binding gap is a known, accepted open issue at merge and is tracked in [#388](https://github.com/PerryHighCS/ActiveBits/issues/388). Reconcile the remaining Phase A contract matrix before starting the #344/#353 manager and termination pilot on a fresh branch.
