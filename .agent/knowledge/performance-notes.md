# Performance Notes

Record performance findings, bottlenecks, and optimization decisions.

## Entry Template

- Date:
- Area:
- Observation:
- Baseline metric:
- Change applied:
- Result metric:
- Tradeoffs:
- Evidence (profile/log/path):
- Owner:

## Notes

- Date: 2026-06-05
- Area: activities | mobcode | live typing sync
- Observation: `clampMobCodeContentEdit(...)` originally recomputed total workspace UTF-8 bytes from every file on each CodeMirror document change, and live full-file websocket updates were throttled at 120 ms.
- Baseline metric: Typing-time size enforcement was `O(total files)` per keystroke, and worst-case large-file streaming could enqueue full-file payloads about 8 times per second.
- Change applied: Added cached per-file byte accounting for manager typing-time clamps and raised the full-file websocket throttle to 250 ms while keeping selection-presence updates separate.
- Result metric: Size-limit checks are now `O(1)` per keystroke in the steady state, and worst-case full-file pushes are cut to about 4 per second.
- Tradeoffs: The manager now keeps one extra in-memory byte-size map alongside the current file state, and live text propagation is slightly less aggressive than the previous 120 ms cadence.
- Evidence (profile/log/path): `activities/mobcode/client/manager/MobCodeManager.tsx`; `activities/mobcode/client/utils/fileUtils.ts`.
- Owner: Codex

- Date: 2026-06-04
- Area: activities | mobcode | bundle-size
- Finding: The first MobCode production build emits an isolated `activity-mobcode` chunk at about 522 KB minified / 167 KB gzip after adding CodeMirror 6 themes, language packs, and JSZip.
- Tradeoff: The chunk is lazy-loaded with the activity, so it does not affect the main dashboard bundle, but it exceeds Vite's default 500 KB warning threshold and is higher than the original plan's rough 100 KB gzip target.
- Evidence: `npm run build --workspace client` output on 2026-06-04.
- Follow-up action: If MobCode load time becomes noticeable on student Chromebooks, split less common language packs/themes behind narrower dynamic imports or move zip handling into an upload/download-only async path.
- Owner: Codex

- Date: 2026-03-27
- Area: persistent session teacher recovery
- Observation: `findHashBySessionId(sessionId)` originally scanned every persistent hash and loaded each record to recover the backing permalink for `/api/session/:sessionId/teacher-authenticate`.
- Baseline metric: Teacher recovery lookup cost scaled with total persisted session count, not just the target active session.
- Change applied: Added a persistent reverse index from `sessionId -> hash`, maintained on `startPersistentSession`, `resetPersistentSession`, and `cleanupPersistentSession`, and switched `findHashBySessionId(...)` to direct lookup.
- Result metric: Teacher recovery now uses O(1) store lookup in both in-memory and Valkey-backed persistent metadata paths.
- Tradeoffs: The persistent session lifecycle now has to keep the reverse index in sync whenever a started session is replaced or cleared.
- Evidence (profile/log/path): `server/core/persistentSessions.ts`; `server/core/valkeyStore.ts`; `server/persistentSessionRoutes.test.ts`.
- Owner: Codex

- Date: 2026-03-04
- Area: video-sync local websocket fanout
- Observation: `video-sync` already tracks per-session websocket subscribers, so falling back to `ws.wss.clients` for local heartbeat/state broadcasts turns each send into an avoidable `O(totalClients)` scan.
- Baseline metric: Without Valkey pub/sub fanout, every `broadcastEnvelope(...)` iterated all connected sockets, including unrelated sessions.
- Change applied: The local-send fallback now uses `subscribersBySession.get(sessionId)` and sends only to sockets already registered for that session; Valkey-backed `publishBroadcast(...)` remains the cross-instance path.
- Result metric: Local fanout work scales with subscribers in the target session rather than total connected websocket clients.
- Tradeoffs: Tests that previously modeled local delivery by dropping raw sockets into `ws.wss.clients` must register real `video-sync` subscribers instead, and connected sockets now receive the expected initial `telemetry-update` because they are part of the session subscriber set.
- Evidence (profile/log/path): `activities/video-sync/server/routes.ts`; `activities/video-sync/server/routes.test.ts`.
- Owner: Codex

- Date: 2026-03-03
- Area: video-sync heartbeat persistence
- Observation: The websocket heartbeat runs every 3 seconds for active sessions, and persisting `serverTimestampMs` on every tick creates steady write load even when no durable session state changed.
- Baseline metric: Pre-change, each active session heartbeat called `sessions.set(...)` once every 3 seconds.
- Change applied: Heartbeats now broadcast a projected playback snapshot from the last persisted baseline and only persist when the tick causes a durable transition: playback reaches `stopSec` or heartbeat-recomputed telemetry counts differ from persisted values.
- Result metric: Idle-in-terms-of-state heartbeat ticks avoid the periodic session-store write path while preserving websocket heartbeat updates.
- Tradeoffs: Persisted playback position advances in larger steps between durable transitions, so APIs that read directly from session state still rely on `applyStopIfReached(...)` to project the latest position at read time.
- Evidence (profile/log/path): `activities/video-sync/server/routes.ts`; `activities/video-sync/server/routes.test.ts`.
- Owner: Codex
