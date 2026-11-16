# Commissioned Ideas Activity Plan

This plan outlines a new multi-phase ActiveBits activity for classroom presentations. `Commissioned Ideas` should stay self-contained under `activities/commissioned-ideas/`, and the product description can continue to frame it as Shark Tank-inspired while the activity itself keeps a broader classroom-friendly name.

## Active bootstrap fix (2026-11-16)

Owner: `activities/commissioned-ideas/client/manager/`. The manager must resolve its instructor passcode from the same-tab navigation payload or the activity's in-memory create-session handoff without writing it to browser storage. Repeated React effect setup for the same session must return the same passcode; if neither source has a valid passcode, manager controls stay unavailable and the UI shows a recovery message.

- [x] Cover dashboard creation and manager entry in a browser test.
- [x] Centralize and test passcode resolution for ordinary, repeated, missing, and malformed handoffs.
- [x] Verify creation and teacher join flows with `npm test` and root `npm run test:e2e`.
- [x] Document the final credential handoff contract.

## Goal

Create a live classroom activity where:

1. Students register as individuals, organize themselves into teams, and collaboratively settle on a team name and project name.
2. The instructor moves the class into a presentation phase.
3. Participants rate projects by assigning exactly one `$100`, one `$300`, and one `$500` award to three different projects.
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
- Voting rule: each voter must assign `$100`, `$300`, and `$500` to three distinct teams
- Result ranking: total awarded dollars, descending
- Tiebreakers:
  1. more `$500` awards
  2. more `$300` awards
  3. earlier registration time
- Self-voting: disallowed by default when the voter belongs to a registered team
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

## Proposed Activity Shape

```text
activities/commissioned-ideas/
├── activity.config.ts
├── shared/
│   ├── types.ts
│   ├── scoring.ts
│   └── validation.ts
├── client/
│   ├── index.ts
│   ├── manager/
│   │   ├── SharkTankManager.tsx
│   │   ├── PodiumReveal.tsx
│   │   └── PresentationQueue.tsx
│   └── student/
│       ├── SharkTankStudent.tsx
│       ├── TeamRegistrationForm.tsx
│       └── VotingBallot.tsx
└── server/
    ├── routes.ts
    └── routes.test.ts
```

## Session Model

```ts
type SharkTankPhase = 'registration' | 'presentation' | 'voting' | 'results'

type PodiumRevealStep = 'hidden' | 'third' | 'second' | 'winner' | 'complete'

interface SharkTankTeam {
  id: string
  groupName: string | null
  projectName: string | null
  registeredAt: number
  presenterOrder: number | null
  locked: boolean
  memberIds: string[]
  proposedGroupNames: {
    id: string
    value: string
    proposedByParticipantId: string
    createdAt: number
    rejectedByInstructor: boolean
  }[]
  proposedProjectNames: {
    id: string
    value: string
    proposedByParticipantId: string
    createdAt: number
    rejectedByInstructor: boolean
  }[]
  groupNameVotes: Record<string, string>
  projectNameVotes: Record<string, string>
}

interface SharkTankBallot {
  voterId: string
  voterName: string
  voterTeamId: string | null
  allocations: {
    teamId: string
    amount: 100 | 300 | 500
  }[]
  submittedAt: number
}

interface SharkTankSessionData {
  phase: SharkTankPhase
  studentGroupingLocked: boolean
  namingLocked: boolean
  maxTeamSize: number
  groupingMode: 'manual' | 'random'
  presentationRound: number
  allowLateRegistration: boolean
  teams: Record<string, SharkTankTeam>
  participantRoster: Record<string, {
    id: string
    name: string
    teamId: string | null
    connected: boolean
    lastSeen: number
    rejectedByInstructor: boolean
  }>
  ballots: Record<string, SharkTankBallot>
  presentationHistory: {
    round: number
    teamId: string
    presentedAt: number
  }[]
  currentPresentationTeamId: string | null
  podiumRevealStep: PodiumRevealStep
}
```

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
  - exactly three allocations
  - must contain one each of `$100`, `$300`, `$500`
  - all three target teams must be different
  - target teams must exist
  - if self-voting is disabled, the participant's own team cannot be selected
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

This gives deterministic ordering without adding a shared tie-break abstraction.

## Proposed REST / WS Contract

### REST

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/commissioned-ideas/create` | Create session |
| `GET` | `/api/commissioned-ideas/:sessionId/state` | Return current student-safe snapshot |
| `POST` | `/api/commissioned-ideas/:sessionId/register-participant` | Register/reconnect a participant |
| `POST` | `/api/commissioned-ideas/:sessionId/participant-name` | Instructor edits or rejects a participant name |
| `POST` | `/api/commissioned-ideas/:sessionId/settings` | Instructor sets `maxTeamSize`, `groupingMode`, `studentGroupingLocked`, `namingLocked`, `allowLateRegistration` |
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
| `GET` | `/api/commissioned-ideas/:sessionId/results` | Instructor-visible scored results |
| `POST` | `/api/commissioned-ideas/:sessionId/podium-step` | Instructor advances/reset reveal step |

### WebSocket Messages

- `commissioned-ideas:session-state`
- `commissioned-ideas:registration-updated`
- `commissioned-ideas:phase-changed`
- `commissioned-ideas:team-updated`
- `commissioned-ideas:presentation-active`
- `commissioned-ideas:ballot-progress`
- `commissioned-ideas:podium-step`

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

Failure behavior: membership mutations that would exceed `maxTeamSize` return `409` without mutating state. Student-initiated membership changes after `studentGroupingLocked` return `403`; instructor moves are always allowed during registration. Any team mutation outside the `registration` phase returns `409`. Full reshuffle while grouping is locked returns `409`.

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
| voting | no | yes | – | yes |
| results | no | yes | yes | – |

Every successful transition resets `podiumRevealStep` to `hidden`. Entering `presentation` normalizes presenter order and clears `currentPresentationTeamId` if that team no longer exists. Voting stays open with as few as one team. Product decision (2026-11-16): when a voter has fewer than three eligible teams (teams other than their own), they still vote but get fewer awards: the ballot size is `min(3, eligibleTeamCount)`, and a voter with zero eligible teams cannot vote. Phase 6 must centralize this ballot-size rule in shared code and decide which amounts the smaller ballot keeps.

Presenter order invariant: in `presentation`, `presenterOrder` values for the existing teams are exactly `0..n-1`. Teams with no order sort after ordered ones by `registeredAt`, then `id`. `presentation-order` takes the full permutation of current team IDs; anything else returns `400`.

Rounds: a team counts as "presented" in round `r` when `presentationHistory` has an entry `{round: r, teamId}`. Spotlighting a team (`presentation-active`) records at most one entry per team per round. The randomizer picks uniformly among existing teams with no entry for the current round; when none remain it returns `409`. `presentation-round` `next` increments the round and clears the spotlight; `reset` drops the current round's history entries and clears the spotlight. Spotlight, randomize, and round actions are only accepted in `presentation` (`409` otherwise).

Exit criteria:
- The instructor can reliably run manual or randomized presentation rounds without losing team state.

### Phase 6: Voting

Goal:
- Collect valid weighted ballots tied to participant identity and team membership.

Implementation:
- [ ] Implement voting ballot UI with accessibility semantics
- [ ] Enforce `$100/$300/$500` distinct-team validation on client and server
- [ ] Enforce self-vote blocking from `participant.teamId`
- [ ] Implement ballot create/replace persistence
- [ ] Implement manager voting-progress dashboard
- [ ] Add tests for ballot validation, self-vote blocking, replace behavior, and progress reporting

Exit criteria:
- Valid ballots can be submitted and tracked live, and invalid/self-voting ballots are rejected deterministically.

### Phase 7: Results And Podium

Goal:
- Reveal the winning teams in a clean, dramatic final phase.

Implementation:
- [ ] Implement ranking calculation and deterministic tie-breakers
- [ ] Implement results route / results state derivation
- [ ] Implement podium reveal sequencing
- [ ] Implement manager podium controls
- [ ] Implement student reveal screen updates
- [ ] Verify top-three rendering, reveal resets, and return-to-presentation behavior
- [ ] Add tests for scoring, tie-breakers, reveal-step transitions, and top-three rendering

Exit criteria:
- The instructor can reveal 3rd, 2nd, and winner cleanly, and rankings stay stable across reloads.

### Phase 8: Verification And Polish

Goal:
- Close the feature with the expected repo validation and durable notes.

Implementation:
- [ ] Add any missing activity-specific tests
- [ ] Run repo-appropriate validation commands
- [ ] Run `npm run test:e2e` if shared browser seams changed materially
- [ ] Update docs if runtime/build/deployment behavior changes
- [ ] Record durable implementation discoveries in `.agent/knowledge/`

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
| Ranking and tie-breaks | scoring helper tests | results route returns deterministic top three | final podium reflects computed order |
| Podium reveal | reveal-step helper tests | reveal route broadcasts reveal state | student results screen animates through `3`, `2`, winner |

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
