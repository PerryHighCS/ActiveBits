# Comprehensive Test Coverage Exploration Plan

## Purpose

Create a practical, phased plan to move ActiveBits toward comprehensive and auditable test coverage without slowing migration velocity or destabilizing runtime behavior.

## Scope

- Workspaces: `client`, `server`, `activities`, root verification scripts.
- Test types: unit, contract, integration, and selected end-to-end smoke checks.
- Tooling and CI policy for coverage visibility and enforcement.

## Non-Goals (Initial)

- Chasing 100% line coverage.
- Replacing fast seam/contract tests with browser tests where unit/contract coverage already gives a better signal-to-cost ratio.
- Rewriting stable tests only for style consistency.

## Constraints and Inputs

- Preserve existing behavior unless explicitly requested.
- Keep migration-compatible mixed-extension test discovery (`.test.js/.test.ts/.test.tsx`).
- Respect known sandbox limits: socket-binding tests require canonical verification outside restricted sandbox.
- Playwright is now installed at the repo root with a shared harness in `playwright.config.ts`.
- Current browser projects are `chromium` and `webkit`; on this Linux Arm64 environment, use `webkit` as the Safari-engine layer instead of expecting branded Safari/Chrome binaries.
- The browser suite currently runs against an isolated production-style server on `127.0.0.1:3100` to avoid the dev-server `localhost:3000` launch behavior.
- Follow the repository's validation and agent contract documentation.

## Coverage Dimensions

Each touched area should be classified on these axes:

1. Code path coverage: happy path, validation errors, malformed input, edge boundaries.
2. State transitions: session lifecycle, persistent session lifecycle, websocket reconnect/cleanup.
3. Contract coverage: request/response payload shapes and websocket message contracts.
4. Cross-workspace integration: activity route registration, shared type assumptions, runtime import paths.
5. Operational coverage: startup/health checks, deploy verification, failure-mode observability.

## Current-State Baseline (To Capture)

1. Inventory all existing tests by workspace and type.
2. Tag each test as `unit`, `contract`, `integration`, or `smoke`.
3. Identify critical flows with no explicit tests.
4. Record baseline in `.agent/plans/testing_coverage_review.md`.

Suggested inventory commands:

```bash
find client server activities -type f \( -name "*.test.js" -o -name "*.test.ts" -o -name "*.test.tsx" \) | sort
rg -n "listen\(|fetch\(|WebSocket|register\(" server activities --glob "*.test.*"
```

## Gap Model

Classify uncovered risk by severity:

- `P0`: session/data loss, security-sensitive auth flows, websocket contract breakage, startup/deploy regressions.
- `P1`: activity-specific state corruption or teacher/student flow mismatch.
- `P2`: display-level regressions and non-critical utility edge cases.

Prioritize new tests in that order.

## Workstreams

### Workstream A: Test Inventory and Mapping

Checklist:
- [ ] Build a test matrix by workspace, module, and flow.
- [ ] Map each critical user flow to at least one test.
- [ ] Mark missing contract tests and missing failure-path tests.

Deliverable:
- `testing_coverage_review.md` matrix with uncovered flows and severity.

### Workstream B: Server Contract and Lifecycle Coverage

Checklist:
- [ ] Add/expand websocket contract tests for router and persistent-session messages.
- [ ] Add session-store invariant tests (in-memory + Valkey-compatible behavior).
- [ ] Add route contract tests for status and persistent-session endpoints.
- [ ] Keep socket-binding integration tests; add non-network contract tests where practical.

Deliverable:
- New/updated server tests with explicit assertions for malformed input and lifecycle edges.

### Workstream C: Client and Activity Contract Coverage

Checklist:
- [ ] Validate activity loader contract and module shape assumptions.
- [ ] Add targeted tests for manager/student flow reducers and state hydration.
- [ ] Ensure each migrated activity keeps at least one manager-path and one student-path behavioral test.

Deliverable:
- Per-activity minimum contract checks and shared loader contract tests.

### Workstream D: Integration and Smoke Coverage

Checklist:
- [ ] Keep root smoke checks (`verify:deploy`, `verify:server`) authoritative.
- [ ] Add deterministic integration tests for high-risk flows where mocks are insufficient.
- [ ] Document which tests require real socket binding and must run in canonical env.

Deliverable:
- Integration test list with environment requirements.

### Workstream E: Browser-Level Interaction Coverage

Goal:
- Add a small, high-value browser test layer only for flows that still cross too many boundaries for the current Node test runner to cover comfortably.

Current status:
- [x] Root Playwright harness added (`playwright.config.ts`).
- [x] Root scripts added for `npm run test:e2e`, `test:e2e:headed`, and `test:e2e:ui`.
- [x] First browser smoke coverage added for registry-backed card rendering on `/` and `/manage`.

Guiding rule:
- Browser tests should confirm shared container behavior across routing, fetch, storage, and websocket/runtime boundaries.
- They should not replace the existing helper, contract, and activity-level tests that already give the fast inner loop.

Recommended rollout:

Checklist:
- [x] Add a minimal browser harness in reporting-only mode.
- [x] Start with initial smoke coverage for `/` and `/manage` shared activity-card surfaces.
- [ ] Add 1-3 P0/P1 shared flows that have already produced regressions during manual testing.
- [ ] Keep fixtures deterministic and local to the test environment.
- [ ] Avoid broad screenshot/snapshot suites in the first pass.

First-wave candidate scenarios:

1. `live/solo` permalink waiting-room transition
   - Student opens permalink and sees solo continuation available.
   - Instructor authenticates and starts a live session.
   - Student waiting-room button flips from solo to live join.
   - Instructor ends the live session before student joins.
   - Student regains solo continuation.
   - A second instructor can still reach the teacher-code path from the same permalink.
2. Waiting-room name collection and rejoin persistence
   - Student enters name once in the waiting room.
   - Activity opens without a second prompt.
   - Reload reuses stored participant identity and skips both waiting-room and activity-local duplicate prompts.
3. Permalink role-auth split
   - Student path remains available without teacher cookie.
   - Teacher-code submission can still start the live session from a no-cookie browser.
   - Teacher-authenticated follow-up navigation lands on the correct manage/session path.
4. Activity-registry smoke expansion
   - `/manage` continues to render all intended activity cards, including Resonance.
   - `/` continues to render standalone activities and home-surface utility cards from the shared registry.
   - Shared activity metadata regressions are caught at the browser layer even if module-shape unit tests still pass.

Entry criteria for adding browser tests:

- A regression spans multiple shared boundaries such as router + fetch + websocket + storage.
- The current seam-first helper tests can describe the logic but do not make the full mounted flow easy to trust.
- The scenario is shared enough to justify harness cost rather than belonging only in one activity’s local test surface.

Out of scope for the first browser wave:

- Broad visual regression coverage.
- Activity-specific runtime protocols that are already well covered in activity-local tests.
- Embedded-activity flows before a real runtime consumer exists.

Deliverable:
- A short browser suite covering:
  - registry-backed `/` and `/manage` smoke coverage, and
  - the first 1-3 shared waiting-room/permalink scenarios,
  with clear notes about what remains intentionally covered by seam/unit tests instead.

### Workstream F: Coverage Tooling and CI Policy

Checklist:
- [ ] Introduce coverage reporter(s) only after baseline matrix exists.
- [ ] Start with reporting-only thresholds; enforce per-risk-area gates later.
- [ ] Gate on critical-path coverage deltas before global percentage gates.

Deliverable:
- CI coverage report artifacts and phased gating policy.

## Rollout Phases

1. Phase A: Inventory + baseline review file.
2. Phase B: P0 server contract/lifecycle gaps.
3. Phase C: P1 activity and client contract gaps.
4. Phase D: Selected browser-level interaction coverage for shared flows, starting from the existing `/` and `/manage` Playwright smoke layer.
5. Phase E: Coverage reporting + policy ratchet.

Each phase should be shipped in small PR slices with explicit validation commands and outcomes.

## Verification Matrix for This Plan

- Docs/plan updates:
  - Verify referenced commands and paths are valid.
- When implementation starts:
  - Use `AGENTS.md` workspace/cross-workspace verification commands based on touched scope.

## Exit Criteria

1. All P0 flows have explicit automated tests.
2. Each active activity has manager + student contract coverage.
3. Server lifecycle and websocket contracts are tested for both happy and failure paths.
4. The highest-risk shared waiting-room/permalink interaction flows have either:
   - browser-level tests, or
   - an explicit documented decision that seam/contract coverage is sufficient.
5. CI exposes coverage deltas and blocks regressions on critical-path coverage.
6. Coverage review file is current and auditable.

## Immediate Next Step

Create `.agent/plans/testing_coverage_review.md` with:

1. Test inventory table.
2. Flow-to-test mapping.
3. P0/P1/P2 uncovered list.
4. First 3 proposed PR slices.

Then queue the next Playwright slice:

1. `live/solo` permalink waiting-room transition.
2. Waiting-room rejoin/name persistence.
3. Permalink role-auth split.
