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
