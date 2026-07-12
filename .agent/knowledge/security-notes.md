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

- Date: 2026-06-24
- Area: dependency update audit
- Threat or risk: Dependabot PR `#279` identified current npm security updates for `undici`, `http-proxy-middleware`, `vite`, and `esbuild`; additional direct dependency patch/minor releases were also available.
- Control or mitigation: Refreshed root and standalone workspace npm locks; updated `undici` to `7.28.0`, `http-proxy-middleware` to `^4.1.1`, updated `esbuild` to `0.28.1`, and moved current direct ranges for Vite, React Router, TypeScript ESLint, JSDoc ESLint plugin, globals, React plugin, React refresh plugin, and Brython. Kept `@types/node` on the Node 24 line because the repo engine is `>=24 <25`. 
- Residual risk: `npm outdated --workspaces --include-workspace-root` still reports `@types/node` 26.x as latest, but this is intentionally held until the runtime engine moves beyond Node 24.
- Validation (test/review/path): `package.json`; `package-lock.json`; `client/package.json`; `client/package-lock.json`; `server/package.json`; `server/package-lock.json`; `activities/package.json`; `activities/package-lock.json`; root and standalone workspace audits; `npm run test:codex`; `npm run verify:deploy`; `npm run verify:node-version-sync`; `npm run verify:playwright-version-sync`; `npm run verify:activity-test-groups`; `npm run verify:server`.
- Follow-up action: Revisit `@types/node` only with a coordinated runtime engine update.
- Owner: Codex

- Date: 2026-07-12
- Area: SyncDeck embedded instructor manager bootstrap
- Threat or risk: Embedded manager iframes run in a separate JavaScript context, so an in-memory parent handoff cannot deliver an instructor passcode. Persisting that passcode to browser storage is prohibited.
- Control or mitigation: SyncDeck mints a random, five-minute child-manager entry token server-side, passes it only to the same-origin iframe, and the child exchanges it once through the SyncDeck endpoint for its passcode. The exchange response and browser request both opt out of caching, and the iframe uses `no-referrer`; after a successful exchange, the child replaces its URL to remove the consumed query token. The iframe is not mounted until the token arrives from the authenticated embedded-start response.
- Residual risk: The short-lived token is present in the iframe URL while it loads. Keep it same-origin, do not log query strings, and do not reuse it as an activity API credential. Child managers yield once before exchanging it so React StrictMode's development-only setup/cleanup pass cannot consume it before the durable mount commits.
- Operational constraint: Because the token is consumed after exchange, SyncDeck clears a child token when its manager iframe is evicted from the warm-mount limit and reuses the authenticated embedded-start backfill path to obtain a fresh token before a later remount.
- Validation (test/review/path): `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `client/src/components/common/embeddedManagerBootstrap.ts`; `client/src/components/common/embeddedManagerBootstrap.test.ts`; `activities/video-sync/client/manager/VideoSyncManager.test.ts`; `activities/resonance/client/manager/ResonanceManager.test.ts`.
- Follow-up action: If iframe URL query logging becomes a concern, replace the query handoff with an httpOnly one-time exchange cookie scoped to the child manager route.
- Owner: Codex

- Date: 2026-06-13
- Area: dependency update audit
- Threat or risk: Dependabot flagged the transitive `esbuild` version, and stale workspace lockfiles can keep vulnerable transitive packages even when the root lock is already refreshed.
- Control or mitigation: Refreshed root and standalone workspace npm locks; `server/package-lock.json` now resolves `tsx` through `esbuild@0.28.1`, and direct dependency ranges were bumped for `@tailwindcss/vite`, `tailwindcss`, `brython`, and `eslint`. Kept `@types/node` on the Node 24 line because the repo engine is `>=24 <25`.
- Residual risk: `npm outdated --workspaces --include-workspace-root` still reports `@types/node` 25.x as latest, but this is intentionally held on 24.x until the repo's Node engine moves beyond `>=24 <25`.
- Validation (test/review/path): `package-lock.json`; `client/package-lock.json`; `server/package-lock.json`; `activities/package-lock.json`; `client/package.json`; `server/package.json`; `activities/package.json`; `npm audit --include=dev --workspaces --include-workspace-root`; standalone workspace audits; `npm run test:codex`; `npm run verify:deploy`; `npm run verify:server`.
- Follow-up action: Revisit `@types/node` only with a coordinated runtime engine update.
- Owner: Codex

- Date: 2026-06-11
- Area: dependency update audit
- Threat or risk: Dependency updates can leave stale vulnerable transitive packages or accidentally move type/runtime assumptions ahead of the deployed Node major.
- Control or mitigation: Refreshed root and workspace npm locks after point and selected major updates; `npm install --package-lock-only --include=dev --workspaces --include-workspace-root` and each workspace lock refresh reported `found 0 vulnerabilities`. Kept `@types/node` on the Node 24 line because the repo engine is `>=24 <25`, even though the registry also has Node 25 types.
- Residual risk: Full `npm test` remains limited by known sandbox port-binding failures for selected server tests in this environment; use `npm run test:codex` as the documented sandbox gate and rerun full `npm test` in a canonical environment.
- Validation (test/review/path): `package.json`; `client/package.json`; `server/package.json`; `activities/package.json`; `package-lock.json`; `npm run test:codex`.
- Follow-up action: Revisit `@types/node` only with a coordinated runtime engine update.
- Owner: Codex

- Date: 2026-06-06
- Area: MobCode Brython vendor assets
- Threat or risk: The Python runner needs same-origin Brython JavaScript files, and file-serving routes without rate limiting can be abused for repeated filesystem-backed reads.
- Control or mitigation: `/vendor/brython/:assetName` uses `express-rate-limit` before serving an allowlist of Brython assets (`brython.min.js`, `brython.js`, `brython_stdlib.js`) resolved from the server-owned npm package. Requests outside the allowlist return 404 directly, and production Express instances trust one proxy hop so Render-forwarded client IPs feed IP-based limits.
- Residual risk: The route still serves public static runtime code and depends on the server workspace installing the `brython` package.
- Validation (test/review/path): `server/server.ts`; `npm --workspace server run lint`; `npm --workspace server run typecheck`.
- Follow-up action: If more vendor assets are exposed later, keep them behind explicit allowlists and shared rate-limited middleware instead of broad package-directory static routes.
- Owner: Codex

- Date: 2026-06-04
- Area: mobcode zip/file import
- Threat or risk: Client-side zip/file imports that allocate full file buffers before enforcing size caps can freeze the tab or exhaust memory with oversized plain files or highly compressed zip entries.
- Control or mitigation: MobCode now rejects oversized plain files by `File.size` before `arrayBuffer()` and uses JSZip central-directory `uncompressedSize` metadata to skip oversized zip entries before inflating them.
- Residual risk: The import path still trusts JSZip metadata enough to decide whether to inflate an entry; malformed archives can still cost zip-parse work up to the outer archive-size cap, but no longer inflate obviously oversized entries.
- Validation (test/review/path): `activities/mobcode/client/utils/zipUtils.ts`; `activities/mobcode/client/utils/zipUtils.test.ts`.
- Follow-up action: If we ever need stronger zip-bomb resistance than JSZip metadata plus archive-size caps, move archive extraction into a streaming worker or server-side preprocessing path.
- Owner: Codex

- Date: 2026-06-02
- Area: resonance Markdown rendering
- Threat or risk: Authored Markdown for question stems and MCQ choices can carry raw HTML or unsafe URLs that would create XSS, navigation, or local-file exposure risks if rendered directly.
- Control or mitigation: Resonance renders Markdown through `react-markdown` with raw HTML skipped, GFM enabled, and activity-owned URL filtering. Links allow safe web/mail schemes and open with `rel="noopener noreferrer"`. Images allow `http:`, `https:`, and non-SVG image MIME `data:` URLs only; `javascript:`, `file:`, and SVG data URLs are blocked.
- Residual risk: Remote and data images can still display instructor-authored external content and may affect payload size, so validation keeps finite caps and classroom authors remain responsible for image provenance.
- Validation (test/review/path): `activities/resonance/client/components/FormattedMarkdown.tsx`; `activities/resonance/client/components/FormattedMarkdown.test.tsx`; `activities/resonance/shared/validation.test.ts`
- Follow-up action: If SVG image support becomes required, add a sanitizer-specific design and tests before allowing SVG data URLs.
- Owner: Codex

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

- Date: 2026-07-11
- Area: syncdeck static-presentation instructor launch
- Threat or risk: Storing the generated SyncDeck `instructorPasscode` in `sessionStorage` for `/util/syncdeck/launch-presentation?mode=instructor` triggers CodeQL clear-text sensitive-storage alerts and exposes the temporary manager credential to any same-origin JavaScript for the life of the tab.
- Control or mitigation: Immediate instructor launches now pass the generated passcode to `/manage/syncdeck/:sessionId` through same-tab React Router state. The SyncDeck manager reads that one-shot router state before falling back to cookie-backed recovery, so the presentation launch path does not write the passcode to Web Storage.
- Residual risk: The passcode still exists in live React state while the manager page is open and travels in manager-authenticated requests/websocket auth messages. A full-page reload of this temporary launch path may lose manager credentials unless an authenticated recovery path exists.
- Validation (test/review/path): `activities/syncdeck/client/util/SyncDeckLaunchPresentation.tsx`; `activities/syncdeck/client/util/SyncDeckLaunchPresentation.test.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`.
- Follow-up action: If reload-stable manager recovery is needed for presentation-launched temporary sessions, prefer an httpOnly server-issued recovery cookie or short-lived recovery token over Web Storage.
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
