# Commissioned Ideas Activity Plan

This plan outlines a new multi-phase ActiveBits activity for classroom presentations. `Commissioned Ideas` should stay self-contained under `activities/commissioned-ideas/`, and the product description can continue to frame it as Shark Tank-inspired while the activity itself keeps a broader classroom-friendly name.

## Status (2026-11-16)

Phases 0–7 are implemented and committed on `feat-commissioned-ideas`: registration, team formation with instructor drag/drop, naming, presentations and rounds, voting with reduced ballots for small classes, and the results podium with shared steps for equal funding. Phase 8 (verification and polish) is in progress; see its checklist for the remaining open question.

## Active bootstrap fix (2026-11-16)

Owner: `activities/commissioned-ideas/client/manager/`. The manager must resolve its instructor passcode from the same-tab navigation payload or the activity's in-memory create-session handoff without writing it to browser storage. Repeated React effect setup for the same session must return the same passcode; if neither source has a valid passcode, manager controls stay unavailable and the UI shows a recovery message.

- [x] Cover dashboard creation and manager entry in a browser test.
- [x] Centralize and test passcode resolution for ordinary, repeated, missing, and malformed handoffs.
- [x] Verify creation and teacher join flows with `npm test` and root `npm run test:e2e`.
- [x] Document the final credential handoff contract.

## Manager reload recovery (2026-11-18)

Owner: `activities/commissioned-ideas/client/manager/passcode.ts` (client resolution and recovery) and the `create` / `instructor-passcode` routes in `server/routes.ts`.

Problem: the manager only had the instructor passcode from router state or the in-memory handoff. Router state was never cleared, so the passcode stayed in `window.history.state`, and a reload depended on that leftover state.

Contract:
- `POST /create` issues a core manager capability (`issueActivityCapability`, only a SHA-256 digest is stored on the session) and sets it as the httpOnly `activebits_cap_manager_<scope>` cookie (SameSite=Lax, Secure in production, 7-day expiry). Persistent-link Teacher Join already issues the same capability through core.
- `GET /:sessionId/instructor-passcode` returns the passcode only when the caller's manager capability cookie resolves for that session; otherwise `403`. Responses are `no-store` and logged.
- The manager uses router state or the in-memory handoff when present, then clears router state (`replace`, `state: null`) so the passcode does not persist in browser history. Without a handoff (a reload), it calls the exchange endpoint. On `403` it calls core `POST /api/session/:id/persistent-manager-capability` once (which reissues the cookie from the persistent teacher cookie) and retries the exchange once. Anything else leaves manager controls unavailable with the recovery message.
- Snapshots sent to clients list their fields explicitly. Session-only data (`instructorPasscode`, `activityCapabilities`, participant tokens, anything core adds) never reaches students, and the manager snapshot also omits the passcode and capability records.
- The WebSocket still authenticates with the passcode message after connect; no passcode in URLs or browser storage.

Failure behavior: an expired or missing capability with no persistent teacher cookie yields the existing "Instructor passcode not found" recovery message. A rate-limited (`429`) persistent recovery is treated as a failure for that load.

- [x] Server: issue the manager capability cookie on create; add the exchange route
- [x] Server: explicit field lists for student and manager snapshots
- [x] Client: clear router state after reading the handoff; exchange on reload with one persistent fallback
- [x] Tests: route tests (cookie issued, exchange accepts/rejects, snapshots exclude secrets), client recovery decision table, Playwright real reload for dashboard, Teacher Join, and persistent-link entries
- [x] Docs: data contract, security notes
- [x] PR description (after the change is pushed)

## CodeRabbit July review follow-up (2026-11-18)

Triage of the 25 unresolved CodeRabbit threads from 2026-07-30 on PR #243, verified against current code.

- [x] Already fixed earlier: Strict Mode bootstrap consumption, missing student-flow tests, passcode in manager frames, full reshuffle, `allowLateRegistration`
- [x] Critical: participant impersonation via reconnect; WebSocket identity from URL (see "Commissioned Ideas participant identity" in `.agent/knowledge/data-contracts.md`)
- [x] Normalization fails closed instead of minting secrets on read; no display names in logs; socket `error` listener; manager stops reconnecting on auth refusal
- [x] Shared `allowSessionStorageFallback: false` survives an otherwise-empty bootstrap config
- [x] Smaller items: shared WS URL helper, no-op unmount guard removed, max-team-size revert on failure, focus restored after name edit, loading states announced, `GroupingMode` typing, shared ballot-amount check, plan names/tree updated
- [x] Declined with reason: runtime validation of same-origin snapshot payloads
- [ ] Open, needs product/engineering decision: participant token in `localStorage` (move to a core httpOnly participant capability); per-session atomic updates (`updateAtomic` for every writer)
- [x] Post replies and resolve threads after the fixes are pushed (0690ab1a: 23 resolved; the two follow-up threads replied to and left open)

## CodeRabbit review round 7 (2026-11-19)

4 threads on 5edb18a4, no outside-diff comments.

1. **Retries only when nothing was committed (high).** Owner: core `updateAtomic`, with the activity's `atomicUpdate`. Invariant: a mutation is re-run only after a failure that definitely committed nothing. Core throws `AtomicUpdateNotCommittedError` when its compare-and-set budget is exhausted or the read before a write fails. Any other store error (a lost reply) is ambiguous: it is passed on as a `500` with an unknown outcome and is never retried. Before this, a lost reply could register a student twice or advance two rounds.
2. **Read-only routes read committed state.** `/instructor-passcode` (and `/state`, through `loadSession`) and the presence check use `getStrict`, so a manager capability reissued on another instance is visible. A read failure is a `500`, not a `404`.
3. **A socket that closed during its connect read creates no subscription**, because its close handler has already run and nothing would release it.
4. **Focus after placing or rejecting a late arrival** goes to the next waiting student's select, or to an "All late arrivals are placed" status when none remain. It uses the shared restore hook, which now finds its target when it restores and waits until that target can take focus (`targetFocusable` in the decision table).

- [x] Core: `AtomicUpdateNotCommittedError`, with classification tests
- [x] Server: 1, 2, 3, with tests (no double apply, a definite no-commit retried, passcode across instance caches, outage 500, no subscription after close)
- [x] Client: 4, with a Playwright regression (Chromium and WebKit)
- [x] Docs

## CodeRabbit review round 6 (2026-11-18)

9 threads on a53f6cfb, no outside-diff comments. Grouped by contract (AGENTS.md rule 16):

1. **Every local socket eventually gets the latest committed state (4 threads).** Owner: the per-session `InvalidationSubscription` record in `server/routes.ts`, with core `subscribeToBroadcast`. Invariant: whenever the instance's subscription becomes active (the first SUBSCRIBE, a retry after a failed one, or a subscriber reconnect), and whenever an invalidation arrives, local sockets get a snapshot read from committed state. Failure behavior:
   - A failed read is retried up to 3 times while the subscription is current.
   - A failed SUBSCRIBE rejects and is not cached as active; the activity retries with a capped backoff while local sockets need the session.
   - After a subscriber reconnect, core re-confirms each channel and calls its `onResubscribed` listener.
   - Refreshes are coalesced (one read per invalidation normally), and release cancels pending retries.
   The late-activation test now gates the activity channel specifically.
2. **A socket that is finishing auth counts as live for presence.** Its participant is claimed inside the presence write (while `pending`), so a cleanup for another tab that closes between this write's commit and its binding sees the participant as present. A refused or failed attempt clears its claim and reconciles presence. A refusal whose follow-up read fails closes with retryable `1011` instead of leaving the socket `pending`.
3. **Podium `next` names the step its button offered (`toStep`).** The server compares it with the next step computed from the committed state. This refuses a click made before a concurrent reveal or reset, or before moderation changed the number of places. It accepts the click when unrelated changes leave the next step the same. This replaces `fromStep`.
4. **Focus restoration waits until it can act.** The student API reports `ok`/`refused`/`unknown`, like instructor requests. After a refusal, focus returns to the control once it is enabled again. After an unknown outcome, focus returns to the control, and removal is still tracked so a late snapshot moves focus to the status strip. The decision is a tested table (`focusRestoreDecision`), with a Playwright regression for the refused-while-disabled case.

- [x] Core: SUBSCRIBE failure, handler de-duplication, reconnect re-activation, with tests
- [x] Server: 1, 2, 3, with regressions that fail when each fix is removed
- [x] Client: 3, 4
- [x] Tests and docs

## CodeRabbit review round 5 (2026-11-18)

34 threads: 21 new, 12 from round 4 that were missed because the thread query read only the first 100 of 133 threads (now paginated), and 1 outside-diff comment. Grouped by contract (AGENTS.md rule 16):

1. **Revisions order responses against snapshots (root cause of five threads).** Every snapshot and every mutation response carries `revision`, the session's committed `mutationRevision`. Client pending state from a write is released only by a snapshot at or after that write's revision, never because a field changed. This applies to keyboard focus after a move, the podium reveal button, and the local ballot summary. Clients also drop snapshots older than the last one they accepted.
2. **Tab identity is pinned.** A student tab accepts only snapshots whose `viewerParticipantId` equals its registered participant, across automatic reconnects. If another identity appears, the view is hidden and the tab asks for a reload. A snapshot is scoped to its connection: a new connection shows "Connecting…" until it delivers an authenticated snapshot. Request status (busy and error) belongs to the participant that sent the request.
3. **Requests name the state they were made from.** Podium `next` sends `fromStep`, and name proposals and votes send `expectedTeamId`. The server refuses a mismatch with `409` before any change.
4. **Socket auth re-checks the cookie inside the presence write** and binds the socket only after commit. A connect-time store failure closes with `1011` (retryable); a missing session closes with `1008`. Cross-instance reads (invalidations, connect, auth) use `getStrict`, which bypasses the per-instance cache.
5. **Subscriptions have a lifecycle.** Core `subscribeToBroadcast` resolves when the subscription is active. After activation, the instance re-reads and delivers a fresh snapshot, covering changes published before it was active. `unsubscribeFromBroadcast` releases it when the instance's last socket for the session closes.
6. **Focus follows the user.** Restoration happens only when the action removed the focused control and the user has not moved focus elsewhere. This covers roster Join, Switch, and Leave, the ballot view changes, and failed or unknown moves, which restore focus in place once controls re-enable.
7. **Smaller client and test fixes:**
   - Snapshot payload validation.
   - The ballot draft is keyed by viewer.
   - The ballot announcement uses the server's `replaced` result.
   - A max-size edit that returns to its starting value is no draft.
   - A recovery timeout is retryable.
   - Unknown-outcome wording.
   - Tests and docs that did not pin their rule.

- [x] Core: subscription activation and unsubscribe, with tests
- [x] Server: 1, 3, 4, 5
- [x] Client: 1, 2, 6, 7
- [x] Tests and docs

## CodeRabbit review round 4 (2026-11-18)

23 threads, the fourth round, so they are grouped by the contract each one breaks (AGENTS.md rule 16):

1. **Snapshot eligibility (socket auth).** A socket counted as `authenticated` while its presence write was still pending, so a concurrent broadcast could reach it before auth committed. Contract: a student socket gets snapshots only after its presence write commits. Until then it stays `pending`, with its participant bound only so a close can clean up.
2. **One identity per tab.** The cookie is per browser, but a tab binds its participant when the socket connects. If another tab changes the cookie, a POST from the first tab would act as someone else. Contract: every student POST carries `expectedParticipantId`, the participant the tab's socket is bound to. The server refuses a mismatch with `409` and `code: 'participant-mismatch'` before any change. The student hook ties snapshots to the registration attempt and shows "Connecting…" until an authenticated snapshot arrives.
3. **Atomic-write contract follow-through.** No logging inside a mutation (ballot withdrawals are logged after commit). Registration retries on compare-and-set exhaustion with jittered backoff. Presence is set only by socket auth (new participants start offline, and HTTP reconnect leaves presence unchanged). Moderation fields are strictly boolean.
4. **Cross-instance delivery.** After every commit, the writer publishes a small invalidation (`{ type, origin }`, never a snapshot) on the session's Commissioned Ideas channel. Other instances re-read the committed session and send role-appropriate snapshots to their own sockets. The origin instance ignores its own message. Presence remains per-instance (documented limit).
5. **Keyboard focus after moves.** Focus restoration is tied to the server's answer: committed → focus once the snapshot shows the confirmed destination; refused → focus in place; unknown outcome → wait for the participant to move. Any focus the instructor moves elsewhere cancels the request.
6. **Manager recovery and inputs.** The shared passcode recovery has a deadline, so a stalled request clears and can retry. A max-team-size draft survives snapshots while being edited.
7. **Tests and docs that did not pin the rule.** Fix them where they could pass with the rule removed.

- [x] Server: 1, 2 (server side), 3, 4
- [x] Client: 2 (client side), 5, 6
- [x] Tests for each, including a two-instance harness and a held presence write
- [x] Docs: data contracts, security notes, testing patterns, react practices, plan wording

## Deferred follow-ups (2026-11-18)

### A. Atomic session writes

Owner: `mutateSession` in `activities/commissioned-ideas/server/routes.ts`.

Problem: routes did `get → mutate → set`. Two concurrent requests could both pass a check (for example, team capacity) and one write could silently drop the other. Core's manager-capability reissue (`issueManagerCapabilityAtomically`) already writes these sessions with `updateAtomic`. Per `server/core/sessions.ts`, once any writer for a session type uses `updateAtomic`, every writer must, or a plain `set()` that lands between the read and the compare-and-set is silently overwritten.

Invariant: every write to a Commissioned Ideas session, including create, presence updates, and socket auth, goes through `updateAtomic` (via `mutateSession`, or `atomicUpdate` for non-route callers). Nothing calls `sessions.set` directly.

Contract:
- The mutation callback works on a fresh normalized copy and may run more than once on a revision conflict. It has no external side effects (no responses, no broadcasts, no success logs). Generated IDs and timestamps are fine, because only the committed run's values are used.
- Every check (auth, phase, capacity, existence) runs inside the callback against the copy being committed, so a check cannot pass on stale state.
- A refusal throws `Refusal(status, error)` from inside the callback. That aborts the compare-and-set with no write and no revision bump. The route then sends that status.
- After commit, the route broadcasts the committed data, logs, and responds. Cross-field invariants (`reconcilePodiumReveal`) run inside the callback.
- Failure behavior: a missing session, or a record of another type, is `404`. Exhausted CAS retries or a store error is `500`, with a structured error log. A store without `updateAtomic` (minimal test doubles only) falls back to read-modify-write.

- [x] Plan the contract (this section)
- [x] `atomicUpdate`, `mutateSession`, and `Refusal`; convert every route, create, socket auth, and presence
- [x] Test double with revision-checked `updateAtomic`; tests for refusals not writing, a conflicting writer between read and commit, concurrent joins at capacity, and 500 on store failure
- [x] Promote to data-contracts.md

### B. Participant credential in an httpOnly cookie

Owner: `resolveParticipantFromCookies` in `activities/commissioned-ideas/server/routes.ts`, using core's participant capabilities (`activityCapabilities.ts`, the same mechanism Resonance uses).

Problem: the participant token lived in `localStorage`, where any same-origin script can read it, and it outlived the session.

Contract:
- `register-participant` reconnects when the request's `activebits_cap_participant_<scope>` cookie resolves to an existing participant (rejected participants included, so a reload cannot shed a rejection). Otherwise it registers a new participant and issues a participant capability for it (`subjectId` = participant ID), set as an httpOnly, SameSite=Lax cookie (Secure in production). It never returns a credential. A client-sent `participantId` is ignored; the cookie alone decides identity. The capability cap (200 per session) returns `409`.
- HTTP student actions authenticate only from that cookie. A rejected participant is refused (`403`), as before.
- Student WebSockets authenticate at connect from the upgrade request's cookie. There is no `participant-auth` message. States: `pending → authenticated | anonymous`. A refusal sends `code: 'participant-auth-refused'` plus the anonymous snapshot. A store failure sends `participant-auth-failed` and closes with `1011`; the reconnect retries.
- Student snapshots carry `viewerParticipantId` so the client uses the server's identity, not its stored copy.
- The client stores no credential. `localStorage` keeps only the name and participant ID (not secret), to pre-fill the form and to decide whether to reconnect on load. A refused socket shows the form again; re-registering with a still-valid cookie reconnects the same participant.
- Participant records no longer have a `token` field.

Failure behavior: a missing or expired cookie means the student registers again as a new participant. Losing `localStorage` alone does not lose identity, because the cookie reconnects on the next registration.

Test impact: WebKit drops Secure cookies on the plain-HTTP Playwright origin (`NODE_ENV=production`), so specs that drive the student UI run in Chromium only, like the manager-cookie specs. API-driven students use their own request context and an explicit `Cookie` header.

- [x] Plan the contract (this section)
- [x] Server: capability issue on register, cookie auth for HTTP and WebSocket, `viewerParticipantId`, drop `token`
- [x] Client: no token storage or header; socket without an auth message; identity from the snapshot
- [x] Tests: route and socket tests through cookies; Playwright helpers per student; WebKit skips with reason
- [x] Docs: data contracts and security notes; resolve the CodeRabbit thread

## CodeRabbit review round 3 (2026-11-18)

35 new threads. This is the third review round on this PR, so per AGENTS.md rule 16 the fixes are grouped by the contract each cluster broke rather than patched one by one.

Root causes and contracts (owners in parentheses):

1. **Client-keyed map lookups.** Team and roster maps are plain objects, so `map[id]` for `__proto__` or `toString` returns inherited values. Contract: every lookup by a client-supplied id uses `ownEntry` (`shared/records.ts`). Failure: unknown id → `404`.
2. **Socket auth and presence were implicit.** Contract: an explicit per-socket state machine (`StudentSocketAuth`, `server/routes.ts`). As finally built (after "Deferred follow-ups → B" and round 4): `pending → authenticated | anonymous`, with one attempt per socket at connect, from the participant cookie. A socket gets snapshots only after its presence write commits. A store failure sends `participant-auth-failed` and closes with `1011`, and the client's reconnect retries. Presence is derived: online while at least one open, authenticated socket on this process is bound to the participant (`hasLiveParticipantSocket`, `syncParticipantPresence`). Subscribe to broadcasts only after the session lookup succeeds. Known limit: with several server instances, the instance handling the last close decides presence.
3. **Moderation could break derived results.** Contracts: deleting a team withdraws every ballot that funded it (`withdrawBallotsFundingMissingTeams`, `shared/validation.ts`; called only from `deleteTeam`). A revealed podium is pinned to the podium it was revealed for (`podiumRevealKey` / `reconcilePodiumReveal`, `shared/podium.ts`). `atomicUpdate` applies this inside every update before commit, and a changed podium resets the reveal to `hidden`.
4. **Implicit request defaults.** `assign-participant` needs an explicit target (`parseAssignTarget`, `shared/membership.ts`); a missing target is `400`, never Ungrouped. `settings` is `409` outside `registration`. A verified reconnect returns the server-side (moderated) name.
5. **Student identity outlived its session.** The student view is keyed by session ID. Team controls wait for the first authenticated snapshot. As finally built (cookie identity, "Deferred follow-ups → B"): an explicit refusal (`participant-auth-refused`) clears nothing on the client, because there is no stored credential. It shows the registration form with the name pre-filled and keeps the non-secret name and ID. A transient failure (close, `participant-auth-failed`) just reconnects. Submitting the form with an expired or missing cookie registers a new participant. With a cookie that is still valid, including one for a rejected student, it reconnects that same participant, so a rejection is preserved.

- [x] Shared helpers with decision-table tests: `ownEntry`, `parseAssignTarget`, `withdrawBallotsFundingMissingTeams`, `podiumRevealKey`/`reconcilePodiumReveal`, `maxTeamSizeBlurAction`, `isParticipantAuthRefusal`, `lateArrivalNotice`, token storage helpers, shared passcode recovery
- [x] Server: own-key lookups, socket auth state machine, derived presence, subscribe after lookup, ballot withdrawal on team deletion, podium pinning, explicit assign target, settings phase guard, moderated name on reconnect
- [x] Manager UI: single DELETE via `SessionHeader`, clipboard failure message, max-size rollback and no unedited writes, accessible online status, Enter uses the Save rule, moderation buttons disabled while saving, one shared passcode recovery per session
- [x] Student UI: session-keyed identity, credential-refusal recovery, storage warning, first-snapshot gate, results-phase notice, naming panel keyed by team, focus kept after Join/Switch/Leave
- [x] Tests: route tests for each server change, websocket interleavings (concurrent auth, close during read, second tab, store failure), Playwright for refusal recovery, roster keyboard focus, passcode values in storage, and real manager-cookie reissue
- [x] Docs: transition table, reduced-ballot wording, socket auth, test matrix, data contracts
- [x] Per-session atomic updates: done (see "Deferred follow-ups → A")
- [x] Participant token in `localStorage`: replaced by an httpOnly cookie (see "Deferred follow-ups → B")

## Goal

Create a live classroom activity where:

1. Students register as individuals, organize themselves into teams, and collaboratively settle on a team name and project name.
2. The instructor moves the class into a presentation phase.
3. Participants fund other teams' projects: `$500`, `$300`, and `$100`, each to a different team. With fewer than three other teams the ballot keeps the top amounts only (see "Ballot contract").
4. The instructor reveals the final podium with a dramatic `3 ... 2 ... winner` sequence showing the top three teams.

## Default Product Decisions

- Activity id: `commissioned-ideas`
- Display name: `Commissioned Ideas`
- Session model: normal instructor-managed live session
- Registration starts with individual student names
- Instructor can edit or reject student display names
- Instructor sets a maximum team size for the session
- Instructor can choose manual self-organized grouping or random group assignment
- Instructor can continue assigning late or ungrouped students after the main student lock
- Students self-organize into teams during registration
- Team names and project names are proposed by team members and voted on by that team's members
- Voting rule: each voter gives `$500`, `$300`, and `$100` to distinct teams other than their own; with fewer than three other teams, only the top `min(3, eligible)` amounts (see "Ballot contract")
- Result ranking: total awarded dollars, descending
- Podium: teams with equal total funding share a podium step (decision 2026-11-16). The tiebreakers below only order the instructor's full rankings table:
  1. more `$500` awards
  2. more `$300` awards
  3. earlier registration time
- Self-voting: never allowed (not configurable). Only students on a team can vote, and their own team is not eligible
- Podium reveal: instructor-controlled stepper showing third place, then second place, then winner

## Scope

In scope:

- A new self-contained activity under `activities/commissioned-ideas/`
- Team registration flow for student groups
- Instructor-controlled phase transitions
- Live presentation roster / queue view
- Weighted ballot submission with validation
- Final ranking and podium reveal
- Activity-specific tests for shared logic, routes, and core client flows

Out of scope for v1:

- Persistent links or standalone utility flows
- Judge-specific weighting rules beyond the single `$100/$300/$500` ballot
- Multiple simultaneous ballots per voter
- Cross-session exports/reports unless the implementation later needs them
- SyncDeck embedding

## Why This Fits The Current Repo

- `gallery-walk` already demonstrates activity-local registration, stage changes, and teacher/student realtime updates.
- `resonance` already demonstrates instructor-controlled timed/live phases and review/reveal-oriented manager UI.
- `traveling-salesman` already demonstrates leaderboard-style ranking views.
- `raffle` already demonstrates a simple winner-focused manager reveal pattern that can inspire the podium moment.

The new activity should borrow those ideas without adding Commissioned Ideas-specific conditionals to shared code.

## Activity Shape (as built)

The original proposal used `SharkTank*` placeholder names; Phase 0 switched everything to `CommissionedIdeas*`. Tests sit beside the code they cover (`*.test.ts`), and browser specs are under `playwright/`.

```text
activities/commissioned-ideas/
├── activity.config.ts
├── shared/                      # rules shared by client and server, each with a decision-table test
│   ├── types.ts                 # session model (authoritative)
│   ├── naming.ts                # team/project name resolution
│   ├── membership.ts            # which instructor team moves are allowed when
│   ├── presentation.ts          # phase transitions, presentation order, rounds
│   ├── validation.ts            # who can vote, ballot size and validity
│   ├── podium.ts                # funding ranks, ties, reveal sequence
│   ├── scoring.ts               # team totals and rankings-table order
│   └── id.ts
├── client/
│   ├── index.ts
│   ├── PodiumStage.tsx/.css     # podium shared by manager and student
│   ├── teamLabels.ts
│   ├── hooks/useCommissionedIdeasSession.ts
│   ├── manager/                 # CommissionedIdeasManager, PhaseControls, RegistrationDashboard,
│   │                            # TeamBoard, PresentationDashboard, VotingDashboard, ResultsDashboard,
│   │                            # LateArrivalsPanel, passcode recovery, API hooks
│   └── student/                 # CommissionedIdeasStudent, RegistrationForm, StudentRoster,
│                                # TeamNamingPanel, PresentationView, VotingBallot, ResultsView
├── server/routes.ts
└── playwright/                  # manager-entry, teams, presentation, voting, results, late-arrival
```

## Session Model

The authoritative model is `CommissionedIdeasSessionData` in `shared/types.ts` (teams with naming proposals and votes, the participant roster, ballots, presentation round and history, podium step, and settings). Client snapshot shapes are `StudentSafeTeam` / `StudentSafeParticipant` and the manager snapshot built in `server/routes.ts`; both use explicit field lists (see "Manager reload recovery").

## Phase Behavior

### 1. Registration

- Student view starts with individual name entry.
- The instructor can edit or reject submitted student names before registration is locked.
- The instructor sets a session-wide maximum team size.
- The instructor can remove students from groups.
- Student grouping lock and naming lock are separate controls.
- After student grouping is locked, existing groups stay fixed, but the instructor can still place ungrouped or late-arriving students.
- Students see the live roster of students and current groups.
- Students can:
  - remain ungrouped
  - create a new team
  - join a team by selecting a classmate or existing group when grouping mode is manual
  - leave a team until student grouping is locked
- The joining affordance should feel active and social, for example `Click a name to join a group with...`.
- If grouping mode is random, the instructor can assign or reshuffle random groups up to the grouping lock.
- After student grouping is locked, the instructor can still `reshuffle ungrouped` to place only students who are not yet in a team.
- After student grouping is locked, the instructor can manually assign ungrouped or late-arriving students to teams.
- Team members can propose:
  - a team name
  - a project name
- Team members vote within their own team on those proposed names.
- The instructor can reject inappropriate names or proposals.
- Students can continue proposing names and changing votes after grouping is locked until naming is locked.
- A team's current displayed team name/project name resolves from the leading non-rejected proposal, with ties broken deterministically.
- Manager view shows:
  - total students
  - total teams
  - ungrouped students
  - live team membership
  - max team size control
  - grouping mode control
  - name moderation controls
  - proposal moderation controls
  - student removal from groups
  - lock students control
  - lock naming control
  - QR code and join URL display
  - reshuffle ungrouped control after the main grouping lock
  - manual assignment tools for ungrouped or late students
  - editable presentation order once teams are sufficiently formed
  - button to advance to presentations

### 2. Presentation

- Student view shows the ordered project list and highlights the active presenting team.
- The instructor can return from results to another presentation round without rebuilding teams.
- Manager view shows:
  - presentation queue
  - current round indicator
  - pick active/presenting team controls
  - randomizer for teams that have not yet presented in the current round
  - next/previous controls if the instructor is walking the queue manually
  - reset/start next round control
  - return-to-presentation control from results
  - button to advance to voting
- No ballots accepted yet.

### 3. Voting

- Student view switches to a ballot builder.
- Validation rules:
  - as built: the "Ballot contract" section below is authoritative
  - `min(3, eligible teams)` allocations, using the top amounts in order (`$500`, then `$300`, then `$100`)
  - each target team is different, exists, and is not the voter's own team
- Manager view shows:
  - ballot submission progress
  - who has submitted
  - optional live totals hidden until results
  - button to lock voting and move to results

### 4. Results

- Student view shows a waiting/reveal screen until the instructor reveals winners.
- Manager view shows:
  - computed rankings
  - podium reveal controls
  - a step button for `Reveal 3rd`, `Reveal 2nd`, `Reveal Winner`
  - final top-three podium after completion

## Scoring Rules

Aggregate each submitted ballot into per-team totals:

- total dollars
- count of `$500` awards
- count of `$300` awards
- count of `$100` awards

Ranking sort order:

1. `totalDollars` descending
2. `fiveHundredCount` descending
3. `threeHundredCount` descending
4. `registeredAt` ascending

This gives a deterministic order for the full rankings table. Podium steps ignore the tiebreakers: equal totals share a step (see the results and podium contract).

## Proposed REST / WS Contract

### REST

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/commissioned-ideas/create` | Create session |
| `GET` | `/api/commissioned-ideas/:sessionId/state` | Return current student-safe snapshot |
| `POST` | `/api/commissioned-ideas/:sessionId/register-participant` | Register/reconnect a participant |
| `POST` | `/api/commissioned-ideas/:sessionId/participant-name` | Instructor edits or rejects a participant name |
| `POST` | `/api/commissioned-ideas/:sessionId/settings` | Instructor sets `maxTeamSize`, `groupingMode`, `studentGroupingLocked`, `namingLocked` |
| `POST` | `/api/commissioned-ideas/:sessionId/create-team` | Student creates a team and joins it (manual mode, unlocked) |
| `POST` | `/api/commissioned-ideas/:sessionId/join-team` | Student joins or switches to a team (manual mode, unlocked) |
| `POST` | `/api/commissioned-ideas/:sessionId/leave-team` | Student leaves their team (manual mode, unlocked) |
| `POST` | `/api/commissioned-ideas/:sessionId/assign-participant` | Instructor moves a student to `teamId`, a `newTeam`, or ungrouped (`teamId: null`) |
| `POST` | `/api/commissioned-ideas/:sessionId/assign-random` | Instructor random placement: `scope: 'ungrouped'` (default) or `'all'` (unlocked only) |
| `POST` | `/api/commissioned-ideas/:sessionId/team/proposal` | Propose a team name or project name |
| `POST` | `/api/commissioned-ideas/:sessionId/team/proposal-vote` | Vote on a name proposal |
| `POST` | `/api/commissioned-ideas/:sessionId/team/proposal-moderation` | Instructor rejects or restores a proposal |
| `POST` | `/api/commissioned-ideas/:sessionId/phase` | Instructor changes phase |
| `POST` | `/api/commissioned-ideas/:sessionId/presentation-order` | Instructor reorders teams |
| `POST` | `/api/commissioned-ideas/:sessionId/presentation-active` | Instructor sets the current presenting team |
| `POST` | `/api/commissioned-ideas/:sessionId/presentation-randomize` | Select a random not-yet-presented team for the round |
| `POST` | `/api/commissioned-ideas/:sessionId/presentation-round` | Start the next presentation round or reset round tracking |
| `POST` | `/api/commissioned-ideas/:sessionId/ballot` | Submit or replace a participant ballot |
| `POST` | `/api/commissioned-ideas/:sessionId/podium-step` | Instructor advances/reset reveal step |

### WebSocket Messages

As built (2026-11-16): every server broadcast carries a full role-appropriate snapshot in `data`, and the client hooks treat the four snapshot types identically (`isSnapshotMessage`).

- `commissioned-ideas:session-state` — initial snapshot on connect (students) or after manager auth
- `commissioned-ideas:registration-updated` — any roster, team, naming, presentation, or ballot change
- `commissioned-ideas:phase-changed` — phase transitions
- `commissioned-ideas:podium-step` — podium reveal steps
- `commissioned-ideas:manager-auth` — client → server, carries the instructor passcode after connect
- Student auth (no message): a student socket authenticates once at connect from the httpOnly participant cookie on the upgrade request, and receives nothing until then. A valid cookie binds the socket and sends that student's personalized snapshot. Otherwise the socket gets `commissioned-ideas:error` with `code: 'participant-auth-refused'`, then the anonymous snapshot, and the client shows the registration form. A store failure sends `code: 'participant-auth-failed'` and closes with `1011`, so the client reconnects and retries. (Updated for "Deferred follow-ups → B"; the earlier `participant-auth` message was removed.)
- `commissioned-ideas:error` — server → client failure notice; `code` distinguishes `participant-auth-refused`, `participant-auth-failed`, and `session-not-found`

The originally proposed `team-updated`, `presentation-active`, and `ballot-progress` messages were not needed; those changes ride on `registration-updated`.

The outer message shape should follow the repo's existing activity-local realtime patterns rather than introducing new shared websocket infrastructure.

## UI Direction

### Manager

- Registration dashboard with:
  - roster moderation
  - max team size control
  - manual vs random grouping control
  - grouped / ungrouped students
  - team proposal moderation
  - lock students control
  - lock naming control
  - QR code and join link for the live session
  - reshuffle-ungrouped control after student lock
  - manual late-student assignment tools
- Presentation mode with a bold queue and active team spotlight
- Voting dashboard with submission progress and "Reveal Results"
- Results dashboard with:
  - compact ranking table
  - top-three cards
  - podium reveal control strip
  - dramatic stepwise reveal state

### Student

- Registration phase:
  - enter name
  - see classmates and groups in real time
  - click a student or team to join when grouping is manual
  - wait for assignment when grouping is random
  - leave current team until student grouping is locked
  - propose team/project names
  - vote or change vote on proposed names within the team until naming is locked
  - late students can still register after student grouping lock, but they wait for instructor assignment instead of regrouping everyone
- Presentation phase: read-only queue and active presenter callout
- Voting phase: accessible ballot builder using native selects or radio groups
- Results phase: suspense/reveal card that updates as the instructor advances the podium

## Validation / Normalization Requirements

- Register a session normalizer for `commissioned-ideas`
- Treat missing or malformed collections as empty objects
- Sanitize strings for participant names, group names, and project names
- Enforce max team size on join attempts
- Prevent team membership changes after student grouping is locked
- Prevent proposal creation or vote changes after naming is locked
- Prevent rejected participants from joining teams or voting
- Ignore rejected proposals when resolving displayed team/project names
- Allow instructor-only placement of ungrouped/late students after student grouping lock
- Reject ballots with invalid amounts or duplicate team targets
- Reject instructor-only routes from student callers
- Add structured server logging for invalid ballot submissions and phase transition errors

## Implementation Phases

### Phase 0: Finalize Contract

Goal:
- Lock the activity metadata and core product rules before code scaffolding starts.

Implementation:
- [x] Confirm final activity metadata (`id`, name, description, color)
- [x] Confirm whether branch naming, file naming, and component naming should switch from legacy `SharkTank...` placeholders to `CommissionedIdeas...`
- [x] Confirm default grouping mode (`manual`) and whether `allowLateRegistration` should default on or off
- [x] Confirm whether presentation order can be edited after the first round begins or only before presentation starts
- [x] Confirm whether ballots remain editable until voting is locked

Exit criteria:
- Product wording and default rules are stable enough to scaffold without churn.

### Phase 1: Scaffold Activity Boundary

Goal:
- Create the self-contained activity shell and shared data contract.

Implementation:
- [x] Scaffold `activities/commissioned-ideas/`
- [x] Add `activity.config.ts`
- [x] Add client entry and initial manager/student components
- [x] Add server routes entry
- [x] Define shared `types`, `validation`, and `scoring` modules
- [x] Register the session normalizer for `commissioned-ideas`
- [x] Add a minimal create-session route and student-safe state route

Exit criteria:
- Activity loads through the normal registry and returns normalized empty session state safely.

### Phase 2: Registration Roster And Moderation

Goal:
- Make individual student registration and instructor moderation work end to end.

Implementation:
- [x] Implement participant registration and reconnect flow
- [x] Implement instructor edit/reject name flow
- [x] Implement roster state for connected, disconnected, and rejected students
- [x] Add manager registration dashboard shell
- [x] Add QR code and join-link display on the manager registration screen
- [x] Add tests for participant registration, normalization, and moderation routes

Exit criteria:
- Students can join by name, instructors can moderate names live, and both views stay in sync.

### Phase 3: Team Formation

Goal:
- Support classroom grouping workflows before naming begins.

Implementation:
- [x] Implement max team size control
- [x] Implement manual team formation and leave/join flow
- [x] Implement optional random grouping flow
- [x] Implement reshuffle-ungrouped flow for post-lock cleanup
- [x] Implement instructor manual assignment flow for late/ungrouped students
- [x] Implement instructor removal of students from groups
- [x] Implement `studentGroupingLocked` behavior so grouped students are fixed while ungrouped/late students remain instructor-placeable
- [x] Add manager/team roster UI for grouped and ungrouped students
- [x] Add tests for membership constraints, random grouping, reshuffle-ungrouped, and instructor-only late assignment

Exit criteria:
- The teacher can get every student into a valid team structure without reopening full free-form grouping.

### Phase 3b: Phase 3 Audit Fixes And Instructor Team Arrangement (2026-11-16)

Goal:
- Close gaps found while verifying Phase 3 and give the instructor direct drag/drop control over team membership.

Audit findings (verified against code on 2026-11-16):
- Rejecting a participant left them in `team.memberIds`, so they still counted toward capacity and leaked into team member lists.
- Student snapshots spread the full team record, so every student would receive every team's proposals (including instructor-rejected ones) and raw vote maps once naming ships.
- Random mode could only place ungrouped students; there was no full reshuffle before the grouping lock, and placement packed teams (`4/4/1`) instead of balancing them.
- The instructor could not create a team or move a student directly from one team to another.
- Ungrouped students in random mode saw no "wait for assignment" message until grouping was locked.
- Found during browser verification: a student who registered through the activity's own Join form (no name pre-captured by the shared entry flow) stayed on the form forever because `nameSubmitted` was never set after a successful registration.
- Team mutations were accepted in any phase; they are now limited to `registration` (`409` otherwise) so ballots and presentations never see a moving roster.

Implementation:
- [x] Remove a participant from their team when the instructor rejects them; refuse instructor assignment of rejected participants
- [x] Build an explicit student-safe team shape (no proposals/votes for other teams, no rejected proposals)
- [x] Add instructor `newTeam` assignment (move a student into a brand-new team)
- [x] Add full random reshuffle (`scope: 'all'`, only while grouping is unlocked) and balance random placement (smallest open team first; full reshuffle pre-sizes `ceil(n / maxTeamSize)` teams)
- [x] Manager team board with native HTML5 drag/drop between teams, Ungrouped, and a "New team" drop zone
- [x] Keyboard/screen-reader alternative: per-student `Move … to` select with the same destinations
- [x] Student random-mode waiting message whenever ungrouped
- [x] Route-handler tests for reject-removes-membership, rejected-assignment refusal, newTeam, full reshuffle, and lock refusal
- [x] Playwright spec: instructor drags a student between teams and to a new team
- [x] Students can switch directly between teams in manual mode (server already allowed it; UI now offers `Switch`)
- [x] Fix student stuck on Join form after successful registration

Exit criteria:
- The instructor can rearrange any student at any time during registration with drag/drop or keyboard, and student views never receive moderation-only data.

#### Team membership contract

Owner: `activities/commissioned-ideas/server/routes.ts` (`removeParticipantFromTeam`, `addParticipantToTeam`, `assignRandom`).

Invariant: `participant.teamId === team.id` if and only if `participant.id ∈ team.memberIds`. A team with zero members is deleted. Rejected participants are never members of a team. When a participant leaves a team (any path: student leave/switch, instructor move/remove, rejection, reshuffle), their votes in that team's `groupNameVotes`/`projectNameVotes` are deleted and the team's displayed names are re-resolved.

Failure behavior: membership mutations that would exceed `maxTeamSize` return `409` without mutating state. Student-initiated membership changes after `studentGroupingLocked` return `403`; instructor moves are always allowed during registration. Any team mutation outside the `registration` phase returns `409`, with one exception: late placement. Full reshuffle while grouping is locked returns `409`.

Late arrivals (decision 2026-11-16): students may register in any phase. Outside `registration`, the instructor may place an ungrouped, non-rejected student onto an existing team (`assign-participant` with a `teamId`). This may exceed `maxTeamSize`, since the size setting is only editable during registration. Creating teams, removing members, or moving a grouped student remain `409` outside registration, because they would invalidate ballots or the presentation queue. The manager shows ungrouped students in a "Late arrivals" panel in every phase after registration.

### Phase 4: Team Naming And Proposal Voting

Goal:
- Let teams collaboratively settle on a team name and project name after grouping is mostly stable.

Implementation:
- [x] Implement team-name proposal creation
- [x] Implement project-name proposal creation
- [x] Implement team-member voting and vote changes for both proposal types
- [x] Implement instructor proposal rejection/restoration
- [x] Implement deterministic current-name resolution from non-rejected proposals
- [x] Implement `namingLocked` behavior separately from student grouping lock
- [x] Add manager and student proposal/voting UI
- [x] Add tests for proposal tallying, vote changes, moderation, and naming lock enforcement

#### Team naming contract

Owner: `activities/commissioned-ideas/shared/naming.ts` (`resolveTeamNames`, `resolveLeadingProposal`). Every server path that mutates proposals, votes, or membership calls `resolveTeamNames` and writes the result to `team.groupName`/`team.projectName`; normalization uses the same function.

Invariant: a team's displayed name for each kind is the non-rejected proposal with the most votes, counting only votes cast by current team members for non-rejected proposals of that team. Ties break by earlier `createdAt`, then earlier position in the append-only proposal list (IDs are random and never used for ordering). No eligible proposal → `null`. Proposing a value auto-casts the proposer's vote for it; proposing a value that case-insensitively matches an existing non-rejected proposal of the same kind casts a vote for the existing proposal instead of creating a duplicate. Each team holds at most 20 proposals per kind.

Failure behavior: proposals/votes after `namingLocked` return `403`; voting for a proposal in another team, an unknown proposal, or a rejected proposal returns `404`/`409` without mutating state. Rejecting a proposal keeps its votes on record but they stop counting; restoring it makes them count again.

Exit criteria:
- Teams have stable displayed names and project titles that survive reloads and moderation.

### Phase 5: Presentation Flow And Rounds

Goal:
- Support live presentation facilitation across one or more rounds.

Implementation:
- [x] Implement presentation order management
- [x] Implement direct presenting-team selection
- [x] Implement randomizer for teams not yet presented in the current round
- [x] Implement `presentationRound` tracking and `presentationHistory`
- [x] Implement start-next-round/reset-round controls
- [x] Implement return-from-results to presentation
- [x] Add manager presentation queue UI and student active-presenter view
- [x] Add tests for round tracking, randomizer eligibility, and multi-round behavior
- [x] Add the instructor `/phase` route and manager phase controls (no phase route existed before Phase 5)
- [x] Playwright spec: instructor starts presentations, spotlights/randomizes a team, student view follows live

Decision (recorded 2026-11-16, Phase 0 left it unrecorded): presentation order is editable during `registration` and `presentation`, including after a round has started. Reordering never changes `presentationHistory`.

#### Phase and presentation contract

Owner: `activities/commissioned-ideas/shared/presentation.ts` (`checkPhaseTransition`, `orderedPresentationTeams`, `normalizePresenterOrder`, `unpresentedTeamIds`, `adjacentTeamId`). Server routes call these; the manager UI uses the same functions to enable/disable controls.

Phase transitions (anything else → `409`, unchanged state):

| From \ To | registration | presentation | voting | results |
| --- | --- | --- | --- | --- |
| registration | – | needs ≥1 team | no | no |
| presentation | only with 0 ballots | – | needs ≥1 team | no |
| voting | no | needs ≥1 team | – | yes |
| results | no | needs ≥1 team | needs ≥1 team | – |

Every transition into `presentation` or `voting` needs at least one team, whatever the source phase. Moderation in `voting` or `results` can remove the last team, and then both transitions return `409`. Every successful transition resets `podiumRevealStep` to `hidden`. Entering `presentation` normalizes presenter order and clears `currentPresentationTeamId` if that team no longer exists. Voting stays open with as few as one team. Product decision (2026-11-16): when a voter has fewer than three eligible teams (teams other than their own), they still vote but get fewer awards: the ballot size is `min(3, eligibleTeamCount)`, and a voter with zero eligible teams cannot vote. Phase 6 must centralize this ballot-size rule in shared code and decide which amounts the smaller ballot keeps.

Presenter order invariant: in `presentation`, `presenterOrder` values for the existing teams are exactly `0..n-1`. Teams with no order sort after ordered ones by `registeredAt`, then `id`. `presentation-order` takes the full permutation of current team IDs; anything else returns `400`.

Rounds: a team counts as "presented" in round `r` when `presentationHistory` has an entry `{round: r, teamId}`. Spotlighting a team (`presentation-active`) records at most one entry per team per round. The randomizer picks uniformly among existing teams with no entry for the current round; when none remain it returns `409`. `presentation-round` `next` increments the round and clears the spotlight; `reset` drops the current round's history entries and clears the spotlight. Spotlight, randomize, and round actions are only accepted in `presentation` (`409` otherwise).

Exit criteria:
- The instructor can reliably run manual or randomized presentation rounds without losing team state.

### Phase 6: Voting

Goal:
- Collect valid weighted ballots tied to participant identity and team membership.

Implementation:
- [x] Implement voting ballot UI with accessibility semantics
- [x] Enforce `$100/$300/$500` distinct-team validation on client and server
- [x] Enforce self-vote blocking from `participant.teamId`
- [x] Implement ballot create/replace persistence
- [x] Implement manager voting-progress dashboard
- [x] Add tests for ballot validation, self-vote blocking, replace behavior, and progress reporting

- [x] Implement reduced ballots for voters with fewer than three eligible teams (top amounts)
- [x] Playwright spec: student submits and changes a ballot; manager progress updates live

#### Ballot contract

Owner: `activities/commissioned-ideas/shared/validation.ts` (`ballotEligibleTeamIds`, `requiredBallotAmounts`, `validateBallot`). The server route and the student ballot UI both use these.

- Only students on a team can vote (decision 2026-11-16): an ungrouped student, including a late arrival, gets `409` until the instructor places them. Eligible teams: every existing team except the voter's own. `voterBallotStatus` in `shared/validation.ts` is the single owner of "can this participant vote, and with how many awards".
- Ballot size: `min(3, eligibleTeamCount)`. The ballot keeps the top amounts in order: 1 team → `$500`; 2 teams → `$500, $300`; 3 or more → `$500, $300, $100` (decision 2026-11-16). A voter with zero eligible teams cannot vote.
- A valid ballot uses each required amount exactly once, on distinct eligible teams. Anything else returns `400` with a reason and a structured `warn` log; state is unchanged.
- Ballots are accepted only in `voting` (`409` otherwise), from authenticated, non-rejected participants. Submitting again replaces the voter's ballot. Going results → voting reopens editing; existing ballots are kept.
- Rejecting a participant deletes their ballot.
- Privacy: students receive only their own ballot plus a count. The manager receives submitter IDs (`ballotSubmitterIds`) and a count, never ballot contents, until the results phase (Phase 7).

Exit criteria:
- Valid ballots can be submitted and tracked live, and invalid/self-voting ballots are rejected deterministically.

### Phase 7: Results And Podium

Goal:
- Reveal the winning teams in a clean, dramatic final phase.

Implementation:
- [x] Implement ranking calculation and deterministic tie-breakers
- [x] Implement results route / results state derivation
- [x] Implement podium reveal sequencing
- [x] Implement manager podium controls
- [x] Implement student reveal screen updates
- [x] Verify top-three rendering, reveal resets, and return-to-presentation behavior
- [x] Add tests for scoring, tie-breakers, reveal-step transitions, and top-three rendering

- [x] Handle classes with fewer than three teams (skip podium places that do not exist)
- [x] Playwright spec: instructor reveals 3rd → 2nd → winner; student view follows; reset works
- [x] Teams with equal funding share a podium step; `$0` teams never get a step

#### Results and podium contract

Owner: `activities/commissioned-ideas/shared/podium.ts` (`podiumSequence`, `nextPodiumStep`, `revealedPlaces`) plus `shared/scoring.ts` (`computeTeamScores`, the ranking and tie-breakers). The server, manager UI, and student UI use these.

- Ranking table order: total dollars, then more `$500` awards, then more `$300` awards, then earlier team registration.
- Podium steps (decision 2026-11-16): each step is one funding amount. Step 1 holds every team with the highest total, step 2 every team with the next distinct total, step 3 the third (dense ranking: `$500, $500, $300, $100` → two winners, then 2nd and 3rd). Teams with `$0` never get a step. Tiebreakers do not separate podium steps. `fundingRanks` in `shared/podium.ts` is the single owner of this rule, and the rankings table shows the same rank numbers.
- Podium place count: the number of distinct funded totals, capped at 3. The reveal sequence skips places that do not exist: 3 places `hidden → third → second → winner → complete`; 2 places `hidden → second → winner → complete`; 1 place `hidden → winner → complete`; 0 places (no funding at all) stays `hidden`. Students receive the place count so their view can draw the right number of steps. `complete` shows the final podium together.
- `podium-step` takes `{ action: 'next' | 'reset' }`, only in `results` (`409` otherwise). `next` past `complete` returns `409`. Every phase transition resets the step to `hidden` (Phase 5 contract).
- Privacy: no separate results route. In `results` the manager snapshot carries the full `results` ranking (shown behind a spoiler toggle so a projected screen does not leak it). Students receive only `podium` entries for places already revealed; nothing else about scores.

Exit criteria:
- The instructor can reveal 3rd, 2nd, and winner cleanly, and rankings stay stable across reloads.

### Phase 8: Verification And Polish

Goal:
- Close the feature with the expected repo validation and durable notes.

Implementation:
- [x] Add any missing activity-specific tests (snapshot message filter)
- [x] Run repo-appropriate validation commands (`npm test` passes)
- [x] Run `npm run test:e2e` if shared browser seams changed materially (no shared seams changed; full suite run as a final check: 94 passed, 12 skipped, none of them in this activity)
- [x] Update docs if runtime/build/deployment behavior changes (README activity list; no deployment or env changes, so `DEPLOYMENT.md` is untouched)
- [x] Record durable implementation discoveries in `.agent/knowledge/`
- [x] Sync the plan's REST and WebSocket contract sections with what was built
- [x] Remove the brief ballot-form flash after submitting (local copy shown until the server snapshot arrives)
- [x] Late arrivals (decision 2026-11-16): remove the unused `allowLateRegistration` setting; students may always join; only students on a team can vote; the instructor places late arrivals onto existing teams from a "Late arrivals" panel in any phase after registration
  - Owners: `shared/membership.ts` (`checkInstructorMove`) and `shared/validation.ts` (`voterBallotStatus`), each with a decision-table test; `late-arrival.spec.ts` covers the browser flow

Exit criteria:
- The feature is reviewable, validated, and leaves reusable context for future contributors.

## Test Matrix

| Requirement | Unit tests | Integration tests | Browser-visible tests |
| --- | --- | --- | --- |
| Participant registration and moderation | validator and normalization tests | participant route persists roster data and instructor moderation works | student registers, teacher edits/rejects name, roster updates live |
| Team formation | membership helper tests | join/leave routes enforce max team size and grouping lock state | student joins/leaves a group and both views update |
| Random grouping | grouping helper tests | random assignment route respects max team size and current roster | instructor assigns random groups and views update live |
| Reshuffle ungrouped / late assignment | assignment helper tests | post-lock routes place only ungrouped students and preserve locked teams | instructor assigns late students without reopening full grouping |
| Team/project proposal voting | proposal tally helper tests | proposal vote route resolves current names deterministically and locks correctly | team members propose and vote on names in real time |
| Presentation rounds | round/randomizer helper tests | presenting-team route and randomizer skip already presented teams in the current round | instructor picks or randomizes presenting team across multiple rounds |
| Phase transitions | phase reducer/helper tests | instructor route updates phase and broadcasts | manager advances phases and student screen changes |
| Presentation ordering | order helper tests | reorder route persists order | active presenter changes appear on student view |
| Weighted ballot rules | ballot validation tests | invalid ballots rejected; valid ballots saved/replaced | voter can assign `$100/$300/$500` once each |
| Self-vote blocking | eligibility helper tests | own-team ballot target rejected | voter cannot submit with own team selected |
| Ranking and tie-breaks | scoring helper tests (`computeTeamScores`, `fundingRanks`) | `buildManagerSnapshot` in `results` returns the full ranking (no separate results route) | final podium reflects computed order |
| Podium reveal | reveal-step helper tests, `reconcilePodiumReveal` table | `podium-step` route; `buildStudentSnapshot` returns only revealed places | student results screen animates through `3`, `2`, winner |

If the implementation changes shared routing or browser seams materially, include `npm run test:e2e` per repo guidance.

## Rollout Order

Recommended execution order:

1. Phase 0 and Phase 1 first so the data contract and activity shell are stable.
2. Phase 2 and Phase 3 next so roster + grouping work before naming complexity is added.
3. Phase 4 after grouping, because naming lock semantics depend on team membership already existing.
4. Phase 5 before Phase 6 so the instructor can already facilitate presentations on stable teams.
5. Phase 6 and Phase 7 last for the live competition outcome.
6. Phase 8 at the end of each implementation slice, not only at the very end.

## Assumptions To Keep Unless Product Says Otherwise

- One ballot per participant, replaceable until the instructor leaves voting
- Students can watch all phases from the same session URL
- Teams are ranked by total awarded dollars, not by average score
- The podium highlights teams, not individual presenters
- No anonymous registration requirement for v1
- The instructor can move from results back into another presentation round when desired
