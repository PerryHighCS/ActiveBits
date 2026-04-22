# Commissioned Ideas Activity Plan

This plan outlines a new multi-phase ActiveBits activity for classroom presentations. `Commissioned Ideas` should stay self-contained under `activities/commissioned-ideas/`, and the product description can continue to frame it as Shark Tank-inspired while the activity itself keeps a broader classroom-friendly name.

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
| `POST` | `/api/commissioned-ideas/:sessionId/max-team-size` | Instructor sets max team size |
| `POST` | `/api/commissioned-ideas/:sessionId/grouping-mode` | Instructor chooses manual or random grouping |
| `POST` | `/api/commissioned-ideas/:sessionId/team/create` | Create a new team shell |
| `POST` | `/api/commissioned-ideas/:sessionId/team/membership` | Join or leave a team |
| `POST` | `/api/commissioned-ideas/:sessionId/team/remove-member` | Instructor removes a student from a team |
| `POST` | `/api/commissioned-ideas/:sessionId/random-groups` | Instructor assigns or reshuffles random groups |
| `POST` | `/api/commissioned-ideas/:sessionId/random-groups-ungrouped` | Instructor places only ungrouped students into teams/new groups |
| `POST` | `/api/commissioned-ideas/:sessionId/manual-assignment` | Instructor manually assigns an ungrouped or late student to a team |
| `POST` | `/api/commissioned-ideas/:sessionId/team/proposal` | Propose a team name or project name |
| `POST` | `/api/commissioned-ideas/:sessionId/team/proposal-vote` | Vote on a name proposal |
| `POST` | `/api/commissioned-ideas/:sessionId/team/proposal-moderation` | Instructor rejects or restores a proposal |
| `POST` | `/api/commissioned-ideas/:sessionId/grouping-lock` | Instructor locks or unlocks student grouping |
| `POST` | `/api/commissioned-ideas/:sessionId/naming-lock` | Instructor locks or unlocks team/project naming |
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
- [ ] Implement participant registration and reconnect flow
- [ ] Implement instructor edit/reject name flow
- [ ] Implement roster state for connected, disconnected, and rejected students
- [ ] Add manager registration dashboard shell
- [ ] Add QR code and join-link display on the manager registration screen
- [ ] Add tests for participant registration, normalization, and moderation routes

Exit criteria:
- Students can join by name, instructors can moderate names live, and both views stay in sync.

### Phase 3: Team Formation

Goal:
- Support classroom grouping workflows before naming begins.

Implementation:
- [ ] Implement max team size control
- [ ] Implement manual team formation and leave/join flow
- [ ] Implement optional random grouping flow
- [ ] Implement reshuffle-ungrouped flow for post-lock cleanup
- [ ] Implement instructor manual assignment flow for late/ungrouped students
- [ ] Implement instructor removal of students from groups
- [ ] Implement `studentGroupingLocked` behavior so grouped students are fixed while ungrouped/late students remain instructor-placeable
- [ ] Add manager/team roster UI for grouped and ungrouped students
- [ ] Add tests for membership constraints, random grouping, reshuffle-ungrouped, and instructor-only late assignment

Exit criteria:
- The teacher can get every student into a valid team structure without reopening full free-form grouping.

### Phase 4: Team Naming And Proposal Voting

Goal:
- Let teams collaboratively settle on a team name and project name after grouping is mostly stable.

Implementation:
- [ ] Implement team-name proposal creation
- [ ] Implement project-name proposal creation
- [ ] Implement team-member voting and vote changes for both proposal types
- [ ] Implement instructor proposal rejection/restoration
- [ ] Implement deterministic current-name resolution from non-rejected proposals
- [ ] Implement `namingLocked` behavior separately from student grouping lock
- [ ] Add manager and student proposal/voting UI
- [ ] Add tests for proposal tallying, vote changes, moderation, and naming lock enforcement

Exit criteria:
- Teams have stable displayed names and project titles that survive reloads and moderation.

### Phase 5: Presentation Flow And Rounds

Goal:
- Support live presentation facilitation across one or more rounds.

Implementation:
- [ ] Implement presentation order management
- [ ] Implement direct presenting-team selection
- [ ] Implement randomizer for teams not yet presented in the current round
- [ ] Implement `presentationRound` tracking and `presentationHistory`
- [ ] Implement start-next-round/reset-round controls
- [ ] Implement return-from-results to presentation
- [ ] Add manager presentation queue UI and student active-presenter view
- [ ] Add tests for round tracking, randomizer eligibility, and multi-round behavior

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
