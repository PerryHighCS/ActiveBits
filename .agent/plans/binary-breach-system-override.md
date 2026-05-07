# Binary Breach: System Override Implementation Plan

## Goal

Build a new ActiveBits activity, tentatively `binary-breach`, where students restore locked systems by solving binary number-sense challenges. The first classroom-ready version should feel like a complete mission while keeping the implementation incremental and reviewable.

## Product Summary

Students play as junior cybersecurity technicians responding to a rogue process that has scrambled system access. Each challenge restores part of a locked system. Correct answers lower risk and advance the mission; incorrect answers increase `traceLevel` or `systemHeat`. The framing should stay in safe cybersecurity language: locked systems, firewall rules, corrupted control panels, routers, memory vaults, and recovery consoles.

Learning targets:

- Convert binary values to decimal values.
- Convert decimal values to binary values.
- Compare binary values.
- Order binary values from least to greatest.
- Reason about binary place values and bit length.
- Recognize patterns such as even/odd values and value limits.
- Decide whether decimal values fit within a given number of bits.

## Scope

In scope for MVP:

- Add a self-contained activity under `activities/binary-breach/`.
- Support standard ActiveBits live session flow with manager and student views.
- Support standalone practice/permalink entry if the implementation can reuse the normal waiting-room fields without custom dashboard work.
- Implement four first-version challenge types:
  - Binary to decimal conversion.
  - Decimal to binary conversion.
  - Greater-than / less-than binary comparison.
  - Ordering binary numbers least to greatest.
- Track per-student stats: systems restored, attempts, accuracy, streak, best streak, hints used, trace level, and mission score.
- Give immediate feedback after each submission.
- Include a limited hint system for place values and comparison guidance.
- Add focused unit tests for challenge generation, answer validation, scoring, normalization, and route utilities.
- Add accessibility semantics for all controls, especially answer choices, order controls, toggles, and hint buttons.

Out of scope for MVP:

- Teacher dashboard analytics beyond live student progress summary.
- Cross-session long-term progress tracking.
- Custom report exports.
- SyncDeck-specific embedded launch behavior.
- Drag-only ordering UI. MVP ordering must have keyboard-friendly move controls; drag can be an enhancement.
- Advanced challenge types unless added after the MVP is stable.

Wave 2 scope:

- Broken Bit missing-bit challenges.
- Bit Flip Repair challenges.
- Overflow Alert challenges.
- Pattern Scan challenges.
- Closest Match challenges.
- Final Firewall mixed sequences with reduced hints.

## Repository Alignment

Follow current activity conventions:

- `activities/binary-breach/activity.config.ts` owns metadata and entry pointers.
- `activities/binary-breach/client/index.ts` stays side-effect free and exports `ManagerComponent`, `StudentComponent`, and `footerContent`.
- `activities/binary-breach/server/routes.ts` owns activity routes and registers a session normalizer.
- Shared client/server code must remain activity-agnostic.
- New and modified application code must be TypeScript.
- Runtime session data must normalize safely after Valkey/in-memory reloads.
- Tests for intentionally noisy failure paths must include explicit `[TEST]` log markers.

Recommended config shape:

```ts
const binaryBreachConfig: ActivityConfig = {
  id: 'binary-breach',
  name: 'Binary Breach',
  description: 'Restore locked systems by solving binary and decimal challenges',
  color: 'cyan',
  standaloneEntry: {
    enabled: true,
    supportsDirectPath: true,
    supportsPermalink: true,
    showOnHome: true,
    title: 'Binary Breach: System Override',
    description: 'Practice binary conversion, comparison, and ordering through system recovery missions',
  },
  waitingRoom: {
    fields: [
      {
        id: 'displayName',
        label: 'Display Name',
        type: 'text',
        required: true,
        placeholder: 'Your name',
      },
    ],
  },
  clientEntry: './client/index.ts',
  serverEntry: './server/routes.ts',
}
```

## Proposed File Structure

- `activities/binary-breach/activity.config.ts`
- `activities/binary-breach/binaryBreachTypes.ts`
- `activities/binary-breach/shared/binaryUtils.ts`
- `activities/binary-breach/shared/challengeGenerator.ts`
- `activities/binary-breach/shared/challengeValidation.ts`
- `activities/binary-breach/shared/scoring.ts`
- `activities/binary-breach/client/index.ts`
- `activities/binary-breach/client/styles.css`
- `activities/binary-breach/client/manager/BinaryBreachManager.tsx`
- `activities/binary-breach/client/student/BinaryBreachStudent.tsx`
- `activities/binary-breach/client/components/`
- `activities/binary-breach/server/routes.ts`
- `activities/binary-breach/server/routeUtils.ts`
- Matching `*.test.ts` / `*.test.tsx` files close to the helpers and components they cover.

## Runtime Model

Session data should hold classroom-level settings and normalized student records, not every derived challenge detail unless required for validation.

Draft session shape:

```ts
type BinaryBreachSessionData = {
  settings: BinaryBreachSettings;
  students: BinaryBreachStudentRecord[];
  missionSeed: string;
  active: boolean;
};

type BinaryBreachSettings = {
  maxBits: 4 | 5 | 6 | 7 | 8;
  challengeTypes: BinaryBreachChallengeType[];
  missionLength: number;
  timerMode: 'off' | 'generous' | 'standard';
  hintsEnabled: boolean;
  placeValueSupport: 'visible' | 'optional' | 'hidden';
};

type BinaryBreachStudentRecord = {
  id: string;
  name: string;
  connected: boolean;
  joined: number;
  lastSeen: number;
  progress: BinaryBreachProgress;
  currentChallenge: BinaryBreachChallenge | null;
  challengeIndex: number;
};
```

Validation should prefer server-authoritative generated challenge records. For deterministic recovery, store each student's `currentChallenge` plus enough challenge history or seed/index data to regenerate pending work after reload.

## Challenge Contracts

Represent each challenge as a discriminated union with stable IDs and typed answer payloads.

MVP types:

- `binary-to-decimal`: student enters decimal digits for a shown binary value.
- `decimal-to-binary`: student enters a binary string for a shown decimal value.
- `compare-binary`: student chooses the larger or smaller shown binary value.
- `order-binary`: student orders a small list of binary values least to greatest.

Wave 2 types:

- `missing-bit`.
- `bit-flip`.
- `pattern-scan`.
- `overflow-alert`.
- `closest-match`.
- `final-firewall-sequence`.

Challenge generation should enforce:

- Level 1 uses 4-bit values and visible place-value support.
- Level 2 mixes 4-bit and 5-bit conversion challenges.
- Level 3 introduces compare/order.
- Level 4 introduces overflow and bit limits.
- Level 5 introduces missing-bit and bit-flip repair.
- Level 6 uses mixed final firewall sequences.

## API / WebSocket Plan

Keep endpoints activity-owned and validate session type on every request.

Draft routes:

- `POST /api/binary-breach/create`
  - Create a session with default settings.
- `GET /api/binary-breach/:sessionId/state`
  - Return sanitized manager/student-visible state.
- `POST /api/binary-breach/:sessionId/settings`
  - Manager updates mission settings before or during a run.
- `POST /api/binary-breach/:sessionId/student/register`
  - Register or recover student identity from waiting-room display name.
- `POST /api/binary-breach/:sessionId/student/answer`
  - Validate answer, update progress, return feedback and next challenge.
- `POST /api/binary-breach/:sessionId/student/hint`
  - Record hint use and return the next allowed hint.

WebSocket:

- Register `/ws/binary-breach`.
- Broadcast manager progress summaries on student join, answer, hint use, disconnect, and settings changes.
- Send student-specific identity/recovery messages when needed.
- Use structured error payloads and structured server logging for route failures.

## Student Experience

Core screen:

- Mission header with system name, progress, streak, trace level, and hint count.
- Current challenge panel with safe cybersecurity scenario copy.
- Answer controls matched to challenge type.
- Optional place-value chart.
- Immediate feedback region with `aria-live="polite"`.
- Next-system transition after feedback.
- Mission summary with systems restored, accuracy, hints used, best streak, trace level, and score.

Accessibility requirements:

- Use native buttons and inputs wherever possible.
- Icon-only controls need `aria-label`.
- Choice controls need `aria-pressed` or native radio semantics.
- Ordering controls need keyboard-accessible move up/down buttons and stable item labels.
- Hint button must expose disabled state when hints are exhausted.
- Feedback must be announced without moving focus unexpectedly.

## Manager Experience

MVP manager view:

- Standard session header.
- Mission settings:
  - Max bits.
  - Challenge types included.
  - Mission length.
  - Timer mode.
  - Hints enabled.
  - Place-value support level.
- Live roster/progress summary:
  - Student name.
  - Systems restored.
  - Accuracy.
  - Current streak.
  - Hints used.
  - Trace level.
  - Connected state.
- Reset/start new mission action with confirmation semantics.

Keep teacher analytics lightweight for MVP. More detailed classroom dashboard controls can come after core gameplay is proven.

## Scoring Direction

Use scoring that rewards persistence and improvement:

- Correct answer: restore one system and increase streak.
- Incorrect answer: increase trace level/system heat and reset current streak.
- Hint use: small score reduction but no failure.
- Mission score combines systems restored, accuracy, streak, and trace management.
- Do not make speed the primary score driver in MVP.

Draft formula:

```ts
score =
  systemsRestored * 100
  + bestStreak * 25
  - incorrectAttempts * 15
  - hintsUsed * 10
  - traceLevel * 20
```

Clamp score at zero and keep the formula in a tested shared helper.

## Implementation Checklist

- [x] Create branch `plan/binary-breach-system-override`.
- [x] Capture implementation plan in `.agent/plans/binary-breach-system-override.md`.
- [ ] Scaffold `activities/binary-breach/` with config, client entry, server routes, and shared types.
- [ ] Implement and test binary utilities: parse, format, compare, bit limits, ordering.
- [ ] Implement and test MVP challenge generation and validation.
- [ ] Implement and test scoring/progress helpers.
- [ ] Implement server create/state/register/answer/hint routes with session normalization.
- [ ] Implement manager view settings and live roster summary.
- [ ] Implement student gameplay UI for four MVP challenge types.
- [ ] Add activity-scoped lint/type/test coverage.
- [ ] Add browser-level Playwright coverage if shared routing, activity-card surfacing, standalone entry, or waiting-room behavior changes.
- [ ] Update docs if runtime/build/deployment behavior changes.
- [ ] Record durable discoveries in `.agent/knowledge/*` as implementation patterns emerge.

## Suggested Milestones

### Milestone 1: Pure Game Engine

- Define types.
- Implement binary utilities.
- Implement challenge generation/validation for MVP types.
- Implement scoring/progress helpers.
- Unit-test edge cases:
  - Leading zero handling.
  - Maximum bit bounds.
  - Decimal-to-binary answer normalization.
  - Ordering ties are avoided or handled deterministically.
  - Compare prompts correctly honor “larger” vs “smaller”.

### Milestone 2: Server Session Contract

- Add config and create route.
- Register session normalizer.
- Add student registration/recovery.
- Add answer and hint endpoints.
- Add route utility tests with cloned session-store mocks.
- Add `[TEST]` markers before intentional invalid-session or invalid-answer log noise.

### Milestone 3: Student MVP UI

- Build challenge panel, answer controls, feedback, hint display, place-value chart, and mission summary.
- Make ordering challenge keyboard-accessible with move up/down controls.
- Add component/helper tests for answer serialization and accessible markup where practical.

### Milestone 4: Manager MVP UI

- Build settings panel and roster summary.
- Wire progress updates from routes/websocket.
- Ensure all controls have labels, disabled state, and clear state semantics.

### Milestone 5: Classroom Readiness

- Run scoped activity checks:
  - `npm_config_activity=binary-breach npm --workspace activities run test:activity`
  - `npm_config_activity=binary-breach npm --workspace activities run lint:activity`
  - `npm --workspace activities run typecheck`
- Run root checks before merge:
  - `npm test`
  - `npm run test:e2e` if activity-card surfacing, standalone launcher, waiting-room, routing, fetch, storage, or websocket boundaries changed.
- If sandbox port binding blocks full checks, run `npm run test:codex` and record the limitation.

## Risks and Open Questions

- Standalone/permalink support is valuable for practice, but the first implementation must confirm the waiting-room display-name flow works cleanly with solo direct entry.
- Ordering UI should avoid drag-only interactions because keyboard and screen-reader users need an equivalent path.
- Timer and lockout pressure can be motivating, but MVP should default to low-pressure settings to keep classroom use safe and growth-oriented.
- Student progress persistence should be explicit. If the first version only preserves current-session progress, UI copy must avoid implying long-term best-score history.
- If future SyncDeck embedding is requested, update `skills/syncdeck/references/ACTIVITY_PAYLOADS.md` in the same branch when adding or changing embedded launch payload formats.

