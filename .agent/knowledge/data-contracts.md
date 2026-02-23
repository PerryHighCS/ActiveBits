# Data Contracts

Document API and data-shape assumptions that must stay compatible over time.

## Entry Template

- Date:
- Surface: REST | websocket | internal module | activity interface
- Contract:
- Compatibility constraints:
- Validation rules:
- Evidence (schema/tests/path):
- Follow-up action:
- Owner:

## Contracts

- Date: 2026-02-23
- Surface: REST
- Contract: Activity-specific deep-link URL generation contract for SyncDeck uses `POST /api/syncdeck/generate-url` with request body `{ activityName: 'syncdeck', teacherCode: string, selectedOptions: { presentationUrl?: string } }` and returns `{ hash: string, url: string }` where `url` is the authoritative persistent activity URL including validated query params (`presentationUrl`) plus integrity metadata (`urlHash`).
- Compatibility constraints: Keep existing `/api/persistent-session/create` contract unchanged for activities without a custom generator. `selectedOptions` remains optional and object-shaped to preserve backward compatibility in dashboard callers.
- Validation rules: `activityName` must match `syncdeck`; `teacherCode` follows existing persistent-session constraints; `selectedOptions.presentationUrl` must be a valid `http`/`https` URL before URL generation.
- Evidence (schema/tests/path): `.agent/plans/syncdeck.md` (Implementation Checklist + REST endpoint table); `client/src/components/common/ManageDashboard.tsx`; `server/routes/persistentSessionRoutes.ts`.
- Follow-up action: Implement `deepLinkGenerator` in `ActivityConfig` and route `ManageDashboard` create-link calls to custom endpoint when configured; add route tests for invalid URL and malformed payload.
- Owner: Codex

