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

- Date: 2026-09-01
- Environment: production
- Change: The `video-sync` 3s heartbeat now reads the session with `{ strict: true }` (cache-bypassing Valkey GET) instead of the cache-backed `sessions.get`. Before persisting it re-reads strictly and merges onto the latest record: only the two heartbeat-owned telemetry counters (`connections.activeCount`, `sync.unsyncedStudents`) are written onto the fresh state, and `data.state` is overwritten with the stop-reached frame only when it is a genuine stop transition *and* `isDeepStrictEqual(latest.data.state, snapshot.state)` — i.e. the stored state is byte-for-byte the snapshot the tick started from. If the re-read shows any divergence (another instance committed a pause / re-play — same or newer `serverTimestampMs`), the tick broadcasts the projection of *that* stored state instead of its own stale stop frame. The strict-heartbeat failure path now logs structured JSON (`activity`/`event`/`sessionId`/`errorName`).
- Additional strict reads: the `/command` handler, the `GET /api/video-sync/:sessionId/session` projection, and the websocket initial-snapshot path (`ensureVideoSyncSessionData` -> `applyStopIfReached` -> `sessions.set`) also use `{ strict: true }`. `applyStopIfReached` re-stamps `serverTimestampMs` to now, so any of those cache-backed reads could otherwise persist / broadcast / hand a reconnecting client a freshly stamped pre-pause `isPlaying:true` that the client freshness guard would accept over the authoritative paused state. The websocket snapshot path additionally re-reads strictly right before its `sessions.set` and only overwrites `state` with its projection when `isDeepStrictEqual(latest.state, snapshotState)` (same shape as the heartbeat persist), so a pause committed by another instance between the read and the write is neither clobbered in Valkey nor sent to the connecting client. On a Valkey outage the `/command` and `/session` routes answer a retryable 500 and the socket's initial snapshot is skipped (structured log `event: initial-snapshot-failed`).
- Risk: ~1 extra Valkey GET per session per 3s while a session has live subscribers, plus a second strict GET only on ticks that actually persist (telemetry drift or stop-reached), plus one strict GET per `/session` GET and per socket connect. On a Valkey outage a heartbeat tick rejects and is skipped (logged) rather than serving a stale local cache; the next successful tick recovers. Without this, a multi-instance deploy could rebroadcast — and, on a telemetry-triggered persist, write back — a stale `isPlaying:true` for up to the 30s cache TTL after another instance handled a pause. The residual sub-3s broadcast race (a pause landing on another instance between this heartbeat's read and its broadcast) is backstopped by the client monotonic guard, which rejects the older frame.
- Rollback approach: In `activities/video-sync/server/routes.ts` drop the `{ strict: true }` on the heartbeat / command / session-GET / socket-snapshot reads and restore the single combined `data.state = heartbeatState` persist branch; redeploy.
- Evidence (runbook/logs/path): `activities/video-sync/server/routes.ts`; `activities/video-sync/server/routes.test.ts` ("heartbeat reads authoritative state strictly…", "heartbeat persisting a telemetry-only change…", "command route mutates from the strict read…", "websocket initial snapshot reads authoritative state…"); `DEPLOYMENT.md`
- Follow-up action: If more realtime activities need cache-bypassing heartbeat reads, extract a shared `getStrict`-aware heartbeat read helper.
- Owner: Claude

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
# Development WebSocket upgrade routing

- The Node server hosts both activity WebSockets (`/ws` and `/ws/...`) and the development Vite proxy. The activity router must ignore non-activity upgrade paths so the later Vite proxy listener can handle `/vite-hmr`; it must still explicitly destroy unregistered activity socket paths.
