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

- Date: 2026-02-26
- Scope: integration
- Pattern: When `server/activities/activityRegistry` is initialized during `node --test`, treat a discovered config file that disappears before import as a skippable race (`ERR_MODULE_NOT_FOUND` or loader-level `ENOENT`) instead of a fatal production config error.
- Why it helps: Server test files run concurrently and some tests create/remove temporary `activities/<id>` folders; registry initialization in another file can observe the directory during discovery and lose the config before load.
- Example (file/path): `server/activities/activityRegistry.ts`; `server/activities/activityRegistry.test.ts`
- Failure signal: CI fails with `[ERROR] Failed to load config for activity "...test-activity..."` followed by `ENOENT ... activity.config.js` and a fatal production exit during unrelated server tests.
- Follow-up action: Prefer temp fixtures outside the auto-discovered `activities/` root when possible, or mark them `isDev` and clean up deterministically.
- Owner: Codex
