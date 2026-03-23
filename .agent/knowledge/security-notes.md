# Security Notes

Track security-relevant boundaries, risks, and mitigation decisions.

## Entry Template

- Date:
- Area:
- Threat or risk:
- Control or mitigation:
- Residual risk:
- Validation (test/review/path):
- Follow-up action:
- Owner:

## Notes

- Date: 2026-03-22
- Area: Playwright production-mode test secret handling
- Threat or risk: Committing a fixed `PERSISTENT_SESSION_SECRET` in the Playwright harness creates secret-scanner noise and normalizes checking pseudo-secrets into the repo, even when the value is test-only.
- Control or mitigation: `playwright.config.ts` now generates a random 32-byte hex secret at config-load time and passes it through `webServer.env`; CI or other deterministic environments can override it with `PLAYWRIGHT_PERSISTENT_SESSION_SECRET`.
- Residual risk: A caller that reuses the same override value across many runs still has a long-lived test secret by choice, but it is no longer embedded in version control.
- Validation (test/review/path): `playwright.config.ts`; `npm run test:e2e -- --list`.
- Follow-up action: Reuse the same runtime-generation pattern for any other local test harness secret that only exists to satisfy production-mode startup checks.
- Owner: Codex

- Date: 2026-03-21
- Area: resonance persistent-link question payload decryption
- Threat or risk: Authenticated but attacker-controlled compressed payloads can trigger very large inflation output (zip-bomb style), causing high memory pressure during `inflateSync` before JSON parsing.
- Control or mitigation: `decryptQuestions` now enforces a hard inflate output ceiling via `inflateSync(..., { maxOutputLength })` and returns `null` when decompression exceeds the cap.
- Residual risk: The cap constrains worst-case inflate memory, but decryption/inflate CPU cost for malformed high-entropy inputs is still non-zero; rate limiting remains a broader transport-layer concern.
- Validation (test/review/path): `activities/resonance/server/questionCrypto.ts`; `activities/resonance/server/questionCrypto.test.ts`.
- Follow-up action: If payload complexity grows (for example image support), re-evaluate the output cap and consider streaming decompression for stricter incremental control.
- Owner: Codex

- Date: 2026-03-14
- Area: devcontainer privilege model
- Threat or risk: Granting `SYS_ADMIN` and disabling AppArmor/seccomp in the default devcontainer materially increases local container privilege and can surprise contributors or CI-like environments that expect the repo's base dev setup to stay constrained.
- Control or mitigation: The default devcontainer stays least-privilege, and the elevated settings now live in a separate opt-in profile at `.devcontainer/privileged/devcontainer.json` via `.devcontainer/docker-compose.privileged.yml`.
- Residual risk: Contributors who choose the privileged profile still accept a wider local attack surface and weaker isolation for that container.
- Validation (test/review/path): `.devcontainer/docker-compose.yml`; `.devcontainer/docker-compose.privileged.yml`; `.devcontainer/privileged/devcontainer.json`; `README.md`
- Follow-up action: Keep any future privileged devcontainer changes opt-in, and document the specific local tool class that requires them instead of broadening the default container.
- Owner: Codex

- Date: 2026-03-04
- Area: syncdeck instructor websocket authentication
- Threat or risk: `syncdeck` previously put `instructorPasscode` in the instructor websocket query string, which exposes the credential to URL logging in proxies, access logs, and observability tooling.
- Control or mitigation: The instructor client now connects to `/ws/syncdeck` with only `sessionId` and `role=instructor`, then sends a one-shot websocket `authenticate` message with the passcode after the socket opens; the server waits for that auth message before marking the socket as an instructor or replaying instructor-only state.
- Residual risk: The passcode still exists in live client memory and in websocket frame payloads. If stronger protection is needed, move to an httpOnly cookie or short-lived server-issued websocket token.
- Validation (test/review/path): `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.ts`; `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`.
- Follow-up action: Keep `syncdeck` aligned with `video-sync` if either websocket auth flow is hardened further, so manager activities do not diverge back to query-string secrets.
- Owner: Codex

- Date: 2026-03-04
- Area: video-sync manager websocket authentication
- Threat or risk: Putting `instructorPasscode` in the manager websocket query string exposes a session credential to request URL logging in proxies, access logs, and observability tooling even though it never appears in the browser address bar.
- Control or mitigation: The manager client now connects to `/ws/video-sync` with only `sessionId` and `role=manager`, then sends a one-shot websocket `authenticate` message containing the passcode after the socket opens; the server ignores URL-based manager passcodes and verifies the post-connect auth message before subscribing the socket or sending manager state.
- Residual risk: The passcode still exists in live client memory and travels in websocket message payloads, so raw websocket frame capture at the edge would still reveal it. If stronger protection is needed later, prefer an httpOnly cookie or short-lived server-issued websocket token over long-lived shared secrets.
- Validation (test/review/path): `activities/video-sync/client/manager/VideoSyncManager.tsx`; `activities/video-sync/client/manager/VideoSyncManager.test.ts`; `activities/video-sync/server/routes.ts`; `activities/video-sync/server/routes.test.ts`.
- Follow-up action: If other manager-only websocket activities use query-string secrets, move them to the same post-connect auth or cookie-backed pattern.
- Owner: Codex

- Date: 2026-03-04
- Area: video-sync manager bootstrap
- Observation: Temporary `video-sync` sessions now recover the create-session `instructorPasscode` from a same-tab in-memory bootstrap map when router navigation state is unavailable. The payload is consumed once and never written to Web Storage for this fallback path.
- Why it matters: This restores ad hoc teacher startup without reintroducing the broader XSS exposure of persisting the passcode in `sessionStorage` across the tab lifetime.
- Evidence: `client/src/components/common/manageDashboardUtils.ts`; `client/src/components/common/ManageDashboard.tsx`; `activities/video-sync/client/manager/VideoSyncManager.tsx`
- Follow-up action: If cross-reload recovery is needed for non-persistent sessions, add an explicit server-issued recovery mechanism rather than expanding Web Storage use.
- Owner: Codex

- Date: 2026-03-04
- Area: video-sync manager credential bootstrap
- Threat or risk: Persisting the manager `instructorPasscode` in `sessionStorage` leaves a 32-byte session credential available to any same-origin JavaScript, so an XSS bug could recover and replay it long after the initial create redirect.
- Control or mitigation: `video-sync` now treats the create-session passcode as a one-time router-state bootstrap consumed on first manager mount and immediately removed from navigation state; subsequent recovery uses the teacher-cookie-authenticated `/api/video-sync/:sessionId/instructor-passcode` endpoint instead of browser storage.
- Residual risk: The passcode remains present in live React state while the manager page is open and still travels in manager-authenticated requests/WebSocket URLs. Temporary non-persistent sessions also no longer survive a full-page reload with manager credentials intact unless another authenticated recovery path is added.
- Validation (test/review/path): `activities/video-sync/client/manager/VideoSyncManager.tsx`; `activities/video-sync/client/manager/VideoSyncManager.test.ts`; `client/src/components/common/ManageDashboard.tsx`; `activities/video-sync/activity.config.ts`.
- Follow-up action: If preserving manager control across full reloads for temporary sessions becomes a requirement, prefer an httpOnly server-issued recovery cookie or short-lived recovery token over reintroducing Web Storage.
- Owner: Codex

- Date: 2026-03-03
- Area: video-sync persistent teacher-cookie parsing
- Threat or risk: The `persistent_sessions` cookie is client-controlled input, so logging JSON parse failures at error level lets attackers generate noisy server log spam without affecting authorization.
- Control or mitigation: `activities/video-sync/server/routes.ts` now treats malformed `persistent_sessions` JSON as an ordinary invalid cookie and returns `[]` without calling `console.error`; instructor-passcode recovery still returns the same `403` path when no valid teacher entry is present.
- Residual risk: Malformed cookies are now silent, so malformed-input observability would need an explicit debug/rate-limited logger if incident analysis later requires it.
- Validation (test/review/path): `activities/video-sync/server/routes.ts`; `activities/video-sync/server/routes.test.ts`.
- Follow-up action: If other activities add persistent-cookie recovery helpers, keep malformed-cookie handling non-erroring unless there is a rate-limited structured logging path available.
- Owner: Codex

- Date: 2026-03-03
- Area: video-sync telemetry normalization
- Threat or risk: Session records created before current clamp logic (or modified externally) can carry oversized `telemetry.error.code/message` strings that are rebroadcast to all websocket clients and returned by session APIs.
- Control or mitigation: `normalizeTelemetry` now sanitizes persisted `telemetry.error` using `normalizeTelemetryErrorField` with `MAX_TELEMETRY_ERROR_CODE_LENGTH` and `MAX_TELEMETRY_ERROR_MESSAGE_LENGTH`, matching event-ingestion caps.
- Residual risk: Oversized values are now truncated, not rejected; if strict rejection is required for forensics, add explicit invalid-record signaling.
- Validation (test/review/path): `activities/video-sync/server/routes.ts`; `activities/video-sync/server/routes.test.ts`; `npm run test:activities:scope -- --target=video-sync`.
- Follow-up action: Keep any new telemetry string fields wired through normalization helpers to avoid reintroducing persisted unbounded payloads.
- Owner: Codex

- Date: 2026-03-03
- Area: activities/video-sync command + config responses
- Threat or risk: Returning full session `data` in routine success responses can leak `instructorPasscode` into browser logs, monitoring payload captures, or downstream persistence layers that ingest API responses.
- Control or mitigation: `PATCH /api/video-sync/:sessionId/session` and `POST /api/video-sync/:sessionId/command` now return only public fields via `toPublicSessionData(data)` (`state`, `telemetry`).
- Residual risk: The passcode is still intentionally returned by create/recovery endpoints and sent by manager command/config requests; avoid logging request bodies and keep passcode handling scoped.
- Validation (test/review/path): `activities/video-sync/server/routes.ts`; `activities/video-sync/server/routes.test.ts`; `npm run test:activities:scope -- --target=video-sync`.
- Follow-up action: If additional video-sync endpoints add success payloads, reuse `toPublicSessionData` to keep response surfaces consistent and secret-free.
- Owner: Codex

- Date: 2026-03-01
- Area: video-sync student telemetry event ingestion
- Threat or risk: `POST /api/video-sync/:sessionId/event` is intentionally student-writable for telemetry, so accepting arbitrary `errorCode` and `errorMessage` on every event let callers overwrite manager-visible error state and persist unbounded strings into the session.
- Control or mitigation: Only `load-failure` events may update `telemetry.error`, and both `errorCode` and `errorMessage` are trimmed and capped before persistence/broadcast (`64` and `256` chars respectively).
- Residual risk: Students can still emit repeated `load-failure` events for a real session and replace the latest error within those bounds. Unsync telemetry is also student-writable, but the per-session unsynced-student map is now capped to bound memory growth; if noise becomes a problem, add rate limiting or stronger per-student identity on top.
- Validation (test/review/path): `activities/video-sync/server/routes.ts`; `activities/video-sync/server/routes.test.ts`; `npm --workspace activities run test:activity --activity=video-sync`.
- Follow-up action: If the manager UI needs richer diagnostics, define an explicit allowlist of load-failure error codes rather than treating the code field as arbitrary text, and consider rate limiting repeated unsync events per session.
- Owner: Codex

- Date: 2026-02-23
- Area: persistent link deep-link parameters
- Threat or risk: Generic persistent-link deep-link options are appended as query params and are not integrity-protected by the existing `/api/persistent-session/create` flow. A teacher-facing URL parameter such as `presentationUrl` can be modified by URL tampering if an activity trusts it directly.
- Control or mitigation: Use an activity-specific URL generator endpoint for sensitive deep-link options (SyncDeck: `POST /api/syncdeck/generate-url`) that validates option values and emits signed integrity metadata (`urlHash`) bound to persistent hash + option payload. Treat generated URL as authoritative and verify signature before applying sensitive options.
- Residual risk: If activity code bypasses signature verification during session configuration, tampered links may still be accepted. Verification must remain server-side and mandatory on sensitive configuration paths.
- Validation (test/review/path): `.agent/plans/syncdeck.md` (Architecture + Checklist); `server/routes/persistentSessionRoutes.ts` (current unsigned generic flow); planned tests in `activities/syncdeck/server/routes.test.ts`.
- Follow-up action: Implement verification in SyncDeck configure path and add explicit tampered-`urlHash` test coverage.
- Owner: Codex

- Date: 2026-02-23
- Area: deep-link input validation (client + server)
- Threat or risk: Without field-level validation, malformed or unsafe presentation links can be entered in modals and later submitted through alternative paths.
- Control or mitigation: Added declarative `validator: 'url'` support in activity deep-link options; ManageDashboard now shows inline errors and disables create/copy/open actions for invalid URL inputs; SyncDeck server configure route independently validates `presentationUrl` as `http(s)`.
- Residual risk: URL syntax validation does not enforce destination trust (for example host allowlists). Instructors can still provide any public `http(s)` URL.
- Validation (test/review/path): `client/src/components/common/manageDashboardUtils.ts`; `client/src/components/common/ManageDashboard.tsx`; `activities/syncdeck/server/routes.ts`; `client/src/components/common/manageDashboardUtils.test.ts`; `activities/syncdeck/server/routes.test.ts`; `npm test`.
- Follow-up action: Add optional hostname/domain allowlist policy if deployment requires restricting presentation origins.
- Owner: Codex

- Date: 2026-03-23
- Area: syncdeck manager bootstrap token consumption
- Threat or risk: One-time manager bootstrap tokens were previously consumed by loading the session, removing the matching token in memory, and blindly writing the whole session back. On a multi-instance Valkey-backed deployment, two parallel consume requests could both read the same token and both obtain the instructor passcode before either overwrite landed.
- Control or mitigation: `POST /api/syncdeck/:sessionId/consume-manager-bootstrap` now uses a SyncDeck-specific Valkey Lua script on the production-backed store path to atomically prune expired bootstrap records, remove the matching token, and return the instructor passcode only once. If the atomic path is available and finds no token, the route returns `403` and does not fall back to the stale in-memory snapshot.
- Residual risk: The in-memory fallback used in tests/local dev still does not provide cross-process atomicity, because there is no shared transaction primitive in the generic `SessionStore` contract yet. Production safety depends on running the shared Valkey-backed session store.
- Validation (test/review/path): `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `npm test --workspace activities -- syncdeck/server/routes.test.ts`.
- Follow-up action: If more activities need one-time secret consumption, promote an atomic compare-and-consume helper into the shared session store layer instead of duplicating Valkey scripts per activity.
- Owner: Codex
