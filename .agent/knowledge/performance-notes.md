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
