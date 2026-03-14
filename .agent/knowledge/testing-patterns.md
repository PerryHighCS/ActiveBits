# Testing Patterns

Capture reusable test setup patterns, common failure modes, and reliability guidance.

## Entry Template

- Date:
- Scope: unit | integration | e2e
- Pattern:
- Why it helps:
- Example (file/path):
- Failure signal:
- Follow-up action:
- Owner:

## Entries

- Date: 2026-03-14
- Scope: unit
- Pattern: For waiting-room entry logic, put the outcome matrix in small shared server/client helpers and test those helpers directly before relying on route/component integration coverage.
- Why it helps: The important regressions here are policy/output combinations (`wait`, `join-live`, `continue-solo`, `solo-unavailable`, `render-ui`, `pass-through`) and one-shot handoff semantics, which are easier to exercise exhaustively in helper tests than through brittle full-component flows.
- Example (file/path): `server/entryStatus.test.ts`; `server/sessionEntryParticipants.test.ts`; `client/src/components/common/entryParticipantStorage.test.ts`
- Failure signal: A new policy branch or handoff behavior changes the resolved outcome/presentation or token cleanup semantics without any route/component snapshot obviously failing.
- Follow-up action: Keep helper-level matrix coverage current as new entry outcomes or handoff semantics are added, then add integration tests only for the riskiest UI or API glue.
- Owner: Codex

- Date: 2026-03-14
- Scope: integration
- Pattern: When a server test intentionally triggers noisy warning/error output on waiting-room entry paths, add a short `[TEST]` console marker immediately before the trigger so expected parse/auth noise is distinguishable from real regressions in the test log.
- Why it helps: Waiting-room and permalink tests now intentionally exercise corrupted-cookie and similar failure paths; explicit markers make the resulting server logs legible during focused runs and in broader sandbox fallback gates.
- Example (file/path): `server/persistentSessionRoutes.test.ts`
- Failure signal: Test output includes scary-looking parse/auth error logs with no nearby indication that the noise was intentionally triggered by the test.
- Follow-up action: Add the same marker pattern to future waiting-room tests that intentionally produce console noise, especially around cookie parsing, auth failures, or storage fallbacks.
- Owner: Codex

- Date: 2026-03-14
- Scope: unit
- Pattern: For shared components that are hard to import in the Node test runner because their container pulls Vite-only activity loading, extract a pure presentational seam and test that seam with `react-dom/server` markup assertions first.
- Why it helps: This gives us real accessibility and control-state coverage without forcing a new browser harness or trying to mock `import.meta.glob` inside the existing Node-based client suite.
- Example (file/path): `client/src/components/common/WaitingRoomContent.tsx`; `client/src/components/common/WaitingRoomContent.test.tsx`
- Failure signal: Important ARIA wiring or disabled-state regressions slip through because the only directly testable surface is a low-level helper, while the container component remains too heavy for the current test runner.
- Follow-up action: Use this seam pattern sparingly for high-value shared containers, then add fuller interaction tests later if the runtime boundary becomes easier to exercise.
- Owner: Codex

- Date: 2026-03-14
- Scope: unit
- Pattern: For activity-owned reconnect/recovery behavior that hangs off websocket close events, extract the close-decision logic into a tiny activity-local helper and test that helper directly instead of trying to simulate the whole websocket lifecycle in the component test.
- Why it helps: It keeps the test focused on the product contract change, like “stale server-issued identity should clear cached registration and require rejoin,” without depending on browser WebSocket mocks or the full student component state machine.
- Example (file/path): `activities/syncdeck/client/student/reconnectUtils.ts`; `activities/syncdeck/client/student/reconnectUtils.test.ts`
- Failure signal: Recovery copy/state regressions slip through because the only available tests cover low-level URL builders or large render snapshots, not the close-event decision itself.
- Follow-up action: Reuse this pattern for other activity-owned reconnect paths when the decision surface is stable and the container wiring is much heavier than the rule being tested.
- Owner: Codex

- Date: 2026-03-13
- Scope: integration
- Pattern: In sandboxed agent environments where some server tests fail during local port binding or related host restrictions, use `npm run test:codex` as the validation gate and record the skipped full-suite limitation alongside targeted checks for the touched server surface.
- Why it helps: It preserves a strong merge gate (`typecheck`, `lint`, client tests, non-port server tests, activities tests) without misattributing environment-specific failures in unrelated server files to the active change.
- Example (file/path): `package.json` (`test:codex`); waiting-room entry-policy slice validated with `node --import tsx --test server/persistentSessionRoutes.test.ts`
- Failure signal: Full `npm test` fails in sandbox with unrelated server test files such as `server/galleryWalkRoutes.test.ts`, `server/sessionStore.test.ts`, or `server/statusRoute.test.ts`, while `npm run test:codex` passes.
- Follow-up action: When working outside the sandbox, rerun full `npm test`; inside the sandbox, keep adding focused tests for modified server files so behavior changes are still covered.
- Owner: Codex

- Date: 2026-03-05
- Scope: unit
- Pattern: Prefer behavior-driven assertions over source-text matching (for example, avoid `readFileSync` + regex checks against component source strings).
- Why it helps: Source-string tests are brittle under formatting/renaming and can fail without any runtime regression signal.
- Example (file/path): `activities/syncdeck/client/shared/syncDebug.test.ts`
- Failure signal: Tests fail after whitespace or symbol-name changes even though debug/tracing behavior is unchanged.
- Follow-up action: Keep checks at API/runtime boundary; place any unavoidable structural checks close to the owning component tests.
- Owner: Codex

- Date: 2026-02-26
- Scope: integration
- Pattern: When `server/activities/activityRegistry` is initialized during `node --test`, treat a discovered config file that disappears before import as a skippable race (`ERR_MODULE_NOT_FOUND` or loader-level `ENOENT`) instead of a fatal production config error.
- Why it helps: Server test files run concurrently and some tests create/remove temporary `activities/<id>` folders; registry initialization in another file can observe the directory during discovery and lose the config before load.
- Example (file/path): `server/activities/activityRegistry.ts`; `server/activities/activityRegistry.test.ts`
- Failure signal: CI fails with `[ERROR] Failed to load config for activity "...test-activity..."` followed by `ENOENT ... activity.config.js` and a fatal production exit during unrelated server tests.
- Follow-up action: Prefer temp fixtures outside the auto-discovered `activities/` root when possible, or mark them `isDev` and clean up deterministically.
- Owner: Codex
