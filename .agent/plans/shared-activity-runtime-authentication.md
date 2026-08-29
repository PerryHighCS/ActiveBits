# Shared Activity Runtime and Authentication Plan

## Status

- [x] Recognize the repository-wide architecture problem exposed by issue #341 and PR #342.
- [x] Inventory registered activities at a coarse level for sessions, WebSockets, entry configuration, and existing identity/authentication code.
- [x] Start the durable audit matrix in `.agent/knowledge/activity-runtime-audit.md` with all registered activities represented.
- [ ] Complete a route-by-route and message-by-message audit before defining the final shared contract.
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

The exact API is intentionally deferred until the audit is complete. The contract should provide activity handlers with an already-resolved context similar to:

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

This is a design direction, not a requirement to adopt this exact syntax.

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

- [ ] All session creation paths: dashboard, direct create, persistent, solo, embedded, Learn/integration, and test factories.
- [ ] Every REST route, required role, sensitive inputs, and response projection.
- [ ] Every WebSocket namespace, connection role, inbound messages, outbound messages, and broadcast audience.
- [ ] All client-persisted identity, session, recovery, and credential data.
- [ ] All server-stored shared metadata and activity normalizers.
- [ ] Manager reload/rejoin/recovery behavior.
- [ ] Student reload/rejoin/recovery behavior.
- [ ] Duplicate-socket and disconnect semantics.
- [ ] Report/export authorization.
- [ ] Public display, observer, reviewer, runner-popup, or other non-student/non-manager roles.
- [ ] Existing tests and missing boundary coverage.

Deliverables:

- [x] Add an activity runtime audit matrix under `.agent/knowledge/activity-runtime-audit.md`.
- [ ] Assign each route/message one explicit principal requirement.
- [ ] Identify existing vulnerabilities separately from migration regressions.
- [ ] Identify activity behavior that should remain intentionally public.

## Phase 2: Define Shared Principal and Capability Contracts

- [ ] Define `ActivityRole` and discriminated `ActivityPrincipal` types.
- [ ] Define an activity-agnostic scoped-grant shape for specialized student-like subjects/resources; keep activity-specific role meaning and lifecycle in the activity.
- [ ] Define public resource addresses separately from authentication capabilities so QR/link target identifiers never implicitly grant private reads.
- [ ] Define temporary-session manager capability issuance during session creation.
- [ ] Store only hashed manager capability tokens server-side.
- [ ] Issue opaque tokens only in httpOnly, same-site cookies with live-connection-aware `Secure` handling.
- [ ] Define bounded expiry, revocation, rotation, session-end cleanup, and store normalization.
- [ ] Define persistent teacher-cookie to manager-principal resolution.
- [ ] Define embedded-parent and Learn instructor handoff to manager-principal resolution.
- [ ] Define student accepted-entry token to student-principal resolution.
- [ ] Define anonymous no-name participant issuance for activities such as Raffle that do not use waiting-room identity.
- [ ] Define an idempotent, principal-bound resource claim pattern for ticket-like enrollment results.
- [ ] Define solo-mode principals without weakening live-session authorization.
- [ ] Define public/observer projection rules.
- [ ] Require activity-owned projections for opaque domain state so secrets embedded inside an activity state object are not exposed by generic serialization.
- [ ] Document threat model and trust boundaries before implementation.

## Phase 3: Build Shared HTTP Authorization and Projection Primitives

- [ ] Add generic middleware/wrappers for public, student, manager, and specialized-role routes.
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
- [ ] Migrate create, manager REST, student REST, manager socket, and student socket together.
- [ ] Verify zero-prompt instructor creation and live updates.
- [ ] Verify student waiting-room entry, reload, cookie expiry, and rejoin.
- [ ] Review the contract before migrating a sibling activity.

### Slice B: REST-only/private projection activity

- [ ] Use Postboard to prove student-private and manager-private HTTP projections.
- [ ] Preserve moderation semantics and report authorization.

### Slice C: mature multi-mode activity

- [ ] Use Video Sync or MobCode to prove persistent/embedded adapters without replacing their domain protocols prematurely.

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

- [ ] Complete Phase 1 as a read-only audit and review the resulting matrix before implementing issue #344. This prevents the manager-capability design from solving only the five activities discovered in PR #342 while missing other role shapes already present elsewhere.
