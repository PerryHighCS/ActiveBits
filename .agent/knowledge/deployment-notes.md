# Deployment Notes

Track deployment constraints, environment expectations, and operational learnings.

## Entry Template

- Date:
- Environment: local | staging | production
- Change:
- Risk:
- Rollback approach:
- Evidence (runbook/logs/path):
- Follow-up action:
- Owner:

## Entries

- Date: 2026-03-04
- Environment: production
- Change: `video-sync` now stores unsynced-student telemetry in a Valkey-backed per-session key when `VALKEY_URL` is configured, instead of relying only on in-process maps.
- Risk: If Valkey is unavailable, cross-instance `telemetry.sync.unsyncedStudents` coherence degrades back to single-instance behavior, though normal playback sync still functions.
- Rollback approach: Revert the `video-sync` unsynced-student persistence change in `activities/video-sync/server/routes.ts` and redeploy.
- Evidence (runbook/logs/path): `activities/video-sync/server/routes.ts`; `activities/video-sync/server/routes.test.ts`; `DEPLOYMENT.md`
- Follow-up action: If other realtime activities need short-lived cross-instance telemetry state, extract a shared helper rather than duplicating activity-local Valkey key logic.
- Owner: Codex

- Date: 2026-06-06
- Environment: production
- Change: MobCode's Python runner loads Brython from the npm-installed `brython` package served by the ActiveBits server at `/vendor/brython/...` instead of from a CDN.
- Risk: Production installs must include workspace dependencies; if `node_modules/brython` is absent beside the server process, the popup cannot load Brython and will show its runner-load error.
- Rollback approach: Revert the `/vendor/brython` static route and runner script URLs, or restore the previous CDN URLs temporarily.
- Evidence (runbook/logs/path): `server/server.ts`; `activities/mobcode/client/runner/runnerUtils.ts`; `activities/mobcode/playwright/runner.spec.ts`; `DEPLOYMENT.md`
- Follow-up action: Keep the Playwright popup smoke test in the e2e suite because it caught blob URL asset resolution and worker-locale startup failures that unit tests could not execute.
- Owner: Codex
