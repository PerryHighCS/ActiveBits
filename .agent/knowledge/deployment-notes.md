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
- Status: **SUPERSEDED 2026-09-02 (PR #365, commit 58eed143)** by the 2026-09-02 "Video Sync atomic session mutation" entry below. The strict-read + `isDeepStrictEqual`-gate + whole-record `sessions.set` design described here did **not** ship in its final form. Kept for history; do not use its concurrency/rollback model.
- Change (historical, partially shipped): an intermediate revision made the `video-sync` 3s heartbeat and the `/command`, `GET /session`, websocket initial-snapshot, `/event`, unsynced-prune, and socket-cleanup paths take a `{ strict: true }` (cache-bypassing) Valkey read, then re-read strictly before a whole-record `sessions.set` and only overwrite `data.state` when `isDeepStrictEqual(latest.state, snapshot.state)`. The final commit replaced that with `SessionStore.updateAtomic` compare-and-set (next entry): the strict reads remain where a value is needed before the mutation, but the read-modify-write itself is now a revision-checked CAS with bounded retries, and there is no `isDeepStrictEqual` gate. The structured failure logs (`event: socket-cleanup-failed`, `initial-snapshot-failed`, and the heartbeat failure JSON) did ship.
- Owner: Claude

- Date: 2026-09-02
- Environment: production
- Change: Video Sync atomic session mutation. `SessionStore` gains `compareAndSet(id, expectedMutationRevision, session, ttl?, expectedCreated?)` and `updateAtomic(id, mutate, ttl?)` plus a `mutationRevision` on every session record. In-memory does a revision-checked whole-record replace (single-threaded, effectively atomic per session); Valkey runs a server-side Lua `GET` -> revision-check -> incarnation (`created`) check -> `SET … PX` compare-and-set, wrapped by a 12-attempt retry loop in `createSessionStore.updateAtomic` that re-reads via `getStrict` each attempt. **CAS incarnation binding:** `updateAtomic` passes the strict-read `created` as `expectedCreated`; the Lua (`ARGV[4] ~= '' and current.created ~= nil and tostring(current.created) ~= ARGV[4]`) and the in-memory check refuse the commit if the stored `created` changed. Without this, a same-id delete+recreate resets `mutationRevision` to `0`, so a stale replacement built from the gone incarnation would pass a revision-only CAS (`0 == 0`) and overwrite the fresh one — an ABA that the route-level `created` check in the mutate callback cannot catch because that window is between the callback and the `EVAL`. On a `created` mismatch `updateAtomic` re-reads (same as a revision conflict); a stored record with no `created` degrades to revision-only. The cache is invalidated before the write and repopulated from the normalized result. **Every async cache fill** — the cache-miss loader in `SessionCache.get`, `getStrict`, `compareAndSet` results, the token/expiry finalizers, and the keepalive revalidation reads in `touchDirect`/`touch` — goes through `SessionCache.replaceStaleFill(id, incoming, seen)` instead of a bare `cache.set`. `seen` is the cached session object the caller `peek`ed *before* its await; the fill lands only when the cache is empty, still holds exactly `seen` (nothing raced the await), **or** `supersedes(incoming, current)` proves it newer by a clock-independent test. `cacheEntrySupersedes` returns true only for the *same* incarnation (equal `created`) at `mutationRevision >= cached` — it never orders across incarnations, because `created` is a node-local `Date.now()` and a replacement minted on a peer with a lagging clock can carry a smaller value. Cross-incarnation is decided purely by the identity check, so a stalled older-incarnation read cannot roll the cache back and a recreated incarnation the caller actually read is not blocked by a wall-clock comparison. Covers: a slow `getStrict` predating a CAS; a slower CAS winner N+1 resolving after a faster N+2; an older incarnation resolving after a recreate. `set()` (explicit authoritative whole-record write) stays unconditional. Residual (CAS + cache): an identical id recreated within the same millisecond yields equal `created` — the same assumption the route-level `expectedCreated` binding makes; a backend-monotonic per-id token would be the fuller fix. `createSessionStore.compareAndSet` normalizes the candidate before persisting (parity with `set()`) and both `compareAndSet` impls touch an embedded child's parent on success (parity with `get()`/`getStrict()`). Every write in the `video-sync` route module (heartbeat, `/command`, `GET /session` persist, `/event`, config PATCH, capability issuance, socket admission/cleanup, unsynced-prune) now goes through `updateVideoSyncSessionAtomic` (which prefers `updateAtomic`, with a non-atomic `getStrict` + `set` fallback only for the minimal test store). The shared platform routes that also mutate this session record — `entry-participant` / `consume` — are **not** migrated (see Risk). SyncDeck `embedded-manager-capability` and `persistentSessionRoutes` `teacher-authenticate` / `persistent-manager-capability` all issue the manager capability through one shared helper — `issueManagerCapabilityAtomically(sessions, sessionId, { expectedType, expectedCreated })` in `server/core/activityCapabilities.ts` — which runs the single CAS, aborts on a type/incarnation mismatch via a sentinel throw (never a no-op draft commit), and returns `issued` / `incarnation-mismatch` / `not-committed` / `no-atomic-store` for the route to map. Each route logs a structured `*-incarnation-mismatch` event before its 404. **Incarnation binding:** a capability/command is authorized against one live-session incarnation, so `updateVideoSyncSessionAtomic` takes `{ expectedCreated }` (now including the heartbeat persist) and the shared capability helper binds on `expectedType` + `expectedCreated` — a delete + recreate of the same id (even same activity type) during the store/rate-limit awaits or a CAS retry fails the mutation (404 / heartbeat teardown / socket close) instead of applying to the replacement. `created` is only enforced when present on the authorizing snapshot (pre-migration records degrade to the type-only check). Playback state also carries a monotonic `playbackRevision` bumped on every command / config / stop-transition persist; clients order by it before `serverTimestampMs`. Commands carry a unique `commandId` (server de-dupes a bounded 128-entry window) + a per-page `managerId`; `sendCommand` retries an ambiguous transport failure once with the same id.
- Risk: `updateAtomic` adds a `getStrict` per write and, under cross-instance write contention, up to 12 CAS retries (throws `Atomic session update exhausted retry budget` if exhausted — surfaces as a retryable 500 / a skipped-logged heartbeat tick). A Valkey outage stays a retryable 500 or a skipped heartbeat rather than serving stale cache. Residual: shared platform routes `POST /api/session/:sessionId/entry-participant[/consume]` still `get` + mutate + plain `set()` the same session record — a lost-update window with a concurrent playback command, tracked in #313 (see `.agent/knowledge/data-contracts.md`).
- Rollback approach: revert commit 58eed143 (and the follow-up review commits on branch `fix/video-sync-playback-reliability-364`); the `mutationRevision` field is ignored by older code.
- Evidence (runbook/logs/path): `server/core/sessions.ts`; `server/core/valkeyStore.ts`; `server/core/sessions.ts` + `server/sessionStore.test.ts` + `server/core/valkeyStore.test.ts`; `activities/video-sync/server/routes.ts` + `routes.test.ts` ("command route retries its atomic write…", "session patch retries its atomic write…", "command route atomic path accumulates the playback revision…"); `ARCHITECTURE.md` ("Atomic Session Mutation"); `DEPLOYMENT.md` item 7.
- Follow-up action: #313 — migrate the remaining shared/whole-session writers (entry-participant routes, MobCode) to `updateAtomic`, or make `set()` participate in revision advancement.
- Owner: Codex / Claude

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
