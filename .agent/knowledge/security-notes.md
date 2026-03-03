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
