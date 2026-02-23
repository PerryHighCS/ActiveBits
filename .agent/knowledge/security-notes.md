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

- Date: 2026-02-23
- Area: persistent link deep-link parameters
- Threat or risk: Generic persistent-link deep-link options are appended as query params and are not integrity-protected by the existing `/api/persistent-session/create` flow. A teacher-facing URL parameter such as `presentationUrl` can be modified by URL tampering if an activity trusts it directly.
- Control or mitigation: Use an activity-specific URL generator endpoint for sensitive deep-link options (SyncDeck: `POST /api/syncdeck/generate-url`) that validates option values and emits signed integrity metadata (`urlHash`) bound to persistent hash + option payload. Treat generated URL as authoritative and verify signature before applying sensitive options.
- Residual risk: If activity code bypasses signature verification during session configuration, tampered links may still be accepted. Verification must remain server-side and mandatory on sensitive configuration paths.
- Validation (test/review/path): `.agent/plans/syncdeck.md` (Architecture + Checklist); `server/routes/persistentSessionRoutes.ts` (current unsigned generic flow); planned tests in `activities/syncdeck/server/routes.test.ts`.
- Follow-up action: Implement verification in SyncDeck configure path and add explicit tampered-`urlHash` test coverage.
- Owner: Codex

