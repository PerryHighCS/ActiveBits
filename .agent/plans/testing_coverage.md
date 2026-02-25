# Comprehensive Test Coverage Exploration Plan

## Purpose

Create a practical, phased plan to move ActiveBits toward comprehensive and auditable test coverage without slowing migration velocity or destabilizing runtime behavior.

## Scope

- Workspaces: `client`, `server`, `activities`, root verification scripts.
- Test types: unit, contract, integration, and selected end-to-end smoke checks.
- Tooling and CI policy for coverage visibility and enforcement.

## Non-Goals (Initial)

- Chasing 100% line coverage.
- Introducing a browser E2E framework before server/client contract gaps are closed.
- Rewriting stable tests only for style consistency.

## Constraints and Inputs

- Preserve existing behavior unless explicitly requested.
- Keep migration-compatible mixed-extension test discovery (`.test.js/.test.ts/.test.tsx`).
- Respect known sandbox limits: socket-binding tests require canonical verification outside restricted sandbox.
- Follow repo validation contract in `AGENTS.md`.

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
4. Record baseline in `.claude/plans/testing_coverage_review.md`.

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

1. Build a test matrix by workspace, module, and flow.
2. Map each critical user flow to at least one test.
3. Mark missing contract tests and missing failure-path tests.

Deliverable:
- `testing_coverage_review.md` matrix with uncovered flows and severity.

### Workstream B: Server Contract and Lifecycle Coverage

1. Add/expand websocket contract tests for router and persistent-session messages.
2. Add session-store invariant tests (in-memory + Valkey-compatible behavior).
3. Add route contract tests for status and persistent-session endpoints.
4. Keep socket-binding integration tests; add non-network contract tests where practical.

Deliverable:
- New/updated server tests with explicit assertions for malformed input and lifecycle edges.

### Workstream C: Client and Activity Contract Coverage

1. Validate activity loader contract and module shape assumptions.
2. Add targeted tests for manager/student flow reducers and state hydration.
3. Ensure each migrated activity keeps at least one manager-path and one student-path behavioral test.

Deliverable:
- Per-activity minimum contract checks and shared loader contract tests.

### Workstream D: Integration and Smoke Coverage

1. Keep root smoke checks (`verify:deploy`, `verify:server`) authoritative.
2. Add deterministic integration tests for high-risk flows where mocks are insufficient.
3. Document which tests require real socket binding and must run in canonical env.

Deliverable:
- Integration test list with environment requirements.

### Workstream E: Coverage Tooling and CI Policy

1. Introduce coverage reporter(s) only after baseline matrix exists.
2. Start with reporting-only thresholds; enforce per-risk-area gates later.
3. Gate on critical-path coverage deltas before global percentage gates.

Deliverable:
- CI coverage report artifacts and phased gating policy.

## Rollout Phases

1. Phase A: Inventory + baseline review file.
2. Phase B: P0 server contract/lifecycle gaps.
3. Phase C: P1 activity and client contract gaps.
4. Phase D: Coverage reporting + policy ratchet.

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
4. CI exposes coverage deltas and blocks regressions on critical-path coverage.
5. Coverage review file is current and auditable.

## Immediate Next Step

Create `.agent/plans/testing_coverage_review.md` with:

1. Test inventory table.
2. Flow-to-test mapping.
3. P0/P1/P2 uncovered list.
4. First 3 proposed PR slices.
