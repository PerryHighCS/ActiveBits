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

- Date: 2026-02-23
- Surface: activity interface
- Contract: `ActivityConfig.deepLinkOptions` supports structured option metadata: `{ label?: string; type?: 'select' | 'text'; options?: Array<{ value: string; label: string }>; validator?: 'url' }`.
- Compatibility constraints: `validator` is optional and defaults to no validation. Existing activities with legacy option objects remain compatible because parser fallback treats unrecognized values as no validator.
- Validation rules: For `validator: 'url'`, dashboard treats the field as required and enforces valid `http(s)` URL syntax before persistent-link create and solo copy/open actions.
- Evidence (schema/tests/path): `types/activity.ts`; `client/src/components/common/manageDashboardUtils.ts`; `client/src/components/common/manageDashboardUtils.test.ts`; `client/src/components/common/ManageDashboard.tsx`.
- Follow-up action: If additional validators are introduced, centralize them in `manageDashboardUtils` to keep parser + UI behavior consistent across modals.
- Owner: Codex

- Date: 2026-02-24
- Surface: activity interface
- Contract: `ActivityConfig.manageDashboard.customPersistentLinkBuilder?: boolean` advertises that the activity provides an activity-owned persistent-link modal UI via client-module export `PersistentLinkBuilderComponent`, and shared `ManageDashboard` should render that component instead of the generic `deepLinkOptions` form.
- Compatibility constraints: Flag is optional and defaults to `false`; activities without the flag or without a component continue to use the generic dashboard permanent-link flow. Shared dashboard placement and success-state behavior remain standardized.
- Validation rules: Runtime `activity.config` schema validates `manageDashboard.customPersistentLinkBuilder` as boolean when present. Client module component must implement standardized props (`activityId`, `onCreated(...)`) so dashboard can persist/show the resulting authoritative link.
- Evidence (schema/tests/path): `types/activity.ts`; `types/activityConfigSchema.ts`; `client/src/activities/index.ts`; `client/src/components/common/ManageDashboard.tsx`; `client/src/components/common/manageDashboardViewUtils.ts`; `client/src/components/common/ManageDashboard.test.tsx`; `activities/syncdeck/activity.config.ts`; `activities/syncdeck/client/components/SyncDeckPersistentLinkBuilder.tsx`.
- Follow-up action: Expand `ActivityPersistentLinkBuilderProps` only when multiple activities need additional shared callbacks or state; avoid pushing activity-specific protocol/UI details back into shared dashboard code.
- Owner: Codex

- Date: 2026-02-23
- Surface: REST
- Contract: `POST /api/syncdeck/:sessionId/configure` now requires `presentationUrl` to be a valid `http(s)` URL in addition to passcode checks; invalid URL shape returns `{ error: 'invalid payload' }` with `400`.
- Compatibility constraints: Response shape remains unchanged (`{ ok: true }` on success), and existing passcode/urlHash flows continue to work when URL is valid.
- Validation rules: Reject missing or non-http(s) `presentationUrl`, reject bad passcode, reject client-provided `persistentHash`, and reject invalid/missing mapping for `urlHash` verification paths.
- Evidence (schema/tests/path): `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts` (configure invalid URL, tampered hash, mapping missing).
- Follow-up action: Keep configure validation policy synchronized with generate-url endpoint validation to avoid drift.
- Owner: Codex

- Date: 2026-02-23
- Surface: websocket
- Contract: SyncDeck websocket relay uses activity channel `syncdeck-state-update` (instructor -> server) and `syncdeck-state` (server -> students). The relayed payload is a Reveal plugin envelope and student client translates `action: 'state'` into host command envelope (`action: 'command'`, `payload.name: 'setState'`) before posting to iframe.
- Compatibility constraints: Server message wrapper keys (`type`, `payload`) must remain stable for manager/student clients; plugin-level envelope fields should remain aligned with `.agent/plans/reveal-iframe-sync-message-schema.md`.
- Validation rules: Instructor websocket requires `role=instructor` plus matching `instructorPasscode`; students connect by `sessionId` only. Invalid/unknown ws messages are ignored.
- Evidence (schema/tests/path): `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts` (snapshot + relay tests); `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `.agent/plans/reveal-iframe-sync-message-schema.md`.
- Follow-up action: Add dedicated student-side unit tests for `state` -> `command.setState` translation when adding more plugin command support.
- Owner: Codex

- Date: 2026-03-20
- Surface: REST + websocket + activity interface
- Contract: Resonance REST endpoints — `POST /api/resonance/create` → `{ id, instructorPasscode }`; `POST /api/resonance/:sessionId/register-student` body `{ name }` → `{ studentId, name }`; `POST /api/resonance/generate-link` body `{ teacherCode, questions: Question[] }` → `{ hash, url }`; `GET /api/resonance/:sessionId/state` → student-safe snapshot (no isCorrect, no response data); `GET /api/resonance/:sessionId/responses` (instructor auth) → responses + annotations; `GET /api/resonance/:sessionId/instructor-passcode` (teacher cookie) → `{ instructorPasscode }`; `GET /api/resonance/:sessionId/report` (instructor auth) → HTML or JSON export.
- Compatibility constraints: `isCorrect` must never appear in student-facing payloads before a reveal; instructor passcode is never included in student snapshots; annotations (star/flag) are instructor-private and excluded from shared-response payloads.
- Validation rules: Questions validated by `activities/resonance/shared/validation.ts`; student name trimmed, max 80 chars; answer payload type must match active question type; selectedOptionId must be a valid option id on the target question.
- Evidence (schema/tests/path): `activities/resonance/shared/types.ts`; `activities/resonance/shared/validation.ts`; `activities/resonance/server/routes.ts`.
- Follow-up action: Add route tests for each endpoint in Phase 9; add WebSocket message contract entry when Phase 7 is implemented.
- Owner: Codex

- Date: 2026-03-20
- Surface: activity interface
- Contract: `ActivityConfig.utilMode?: boolean` advertises that the activity exposes a utility/tools page at `/util/:activityId`, rendered from the client module's `UtilComponent` export. `ActivityClientModule.UtilComponent` is only loaded by the registry when `utilMode: true`.
- Compatibility constraints: Flag is optional and defaults to undefined/false; existing activities without the flag are unaffected. Route `/util/:activityId` is registered in App.tsx only for activities that have `UtilComponent`.
- Validation rules: Schema validates `utilMode` as boolean when provided.
- Evidence (schema/tests/path): `types/activity.ts`; `types/activityConfigSchema.ts`; `client/src/activities/index.ts`; `client/src/App.tsx`; `activities/resonance/activity.config.ts`.
- Follow-up action: If a second activity adopts `utilMode`, document any shared navigation or shell conventions needed in this contract.
- Owner: Codex

- Date: 2026-03-20
- Surface: websocket
- Contract: Resonance WebSocket envelope — `{ version: '1', activity: 'resonance', sessionId: string, type: string, timestamp: number, payload: unknown }`. All message types use a `resonance:` prefix (e.g. `resonance:question-activated`). Instructor connects with `role=instructor&instructorPasscode=<code>`. Student connects with `studentId=<id>`.
- Compatibility constraints: Envelope `version` field must be checked before processing; unknown types must be silently ignored on client; never include `isCorrect` or `instructorPasscode` in student-bound payloads.
- Validation rules: Server closes socket with code 1008 on missing sessionId, unknown session, or invalid instructor passcode.
- Evidence (schema/tests/path): `activities/resonance/shared/types.ts` (ResonanceWsEnvelope); `activities/resonance/server/routes.ts`.
- Follow-up action: Flesh out full message dispatch and add WS tests in Phase 7.
- Owner: Codex

- Date: 2026-03-02
- Surface: internal module
- Contract: SyncDeck reveal-sync protocol version is centralized in `activities/syncdeck/shared/revealSyncProtocol.ts` and must be reused by manager, student, server, and preflight handshake code.
- Compatibility constraints: Host-generated reveal-sync envelopes should stay on the same protocol version across runtime relay and preflight ping flows so decks that validate protocol compatibility do not accept one surface and reject another.
- Validation rules: Preflight ping, manager-issued commands, student-issued host commands, and server-generated reveal-sync payloads all import the shared `REVEAL_SYNC_PROTOCOL_VERSION`.
- Evidence (schema/tests/path): `activities/syncdeck/shared/revealSyncProtocol.ts`; `activities/syncdeck/client/shared/presentationPreflight.ts`; `activities/syncdeck/client/shared/presentationPreflight.test.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/server/routes.ts`.
- Follow-up action: If the reveal-sync schema version changes again, update the shared module once and keep compatibility tests around preflight/startup handshakes.
- Owner: Codex
