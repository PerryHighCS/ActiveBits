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

- Date: 2026-03-13
- Surface: REST
- Contract: Generic persistent-link creation and listing now carry `entryPolicy?: PersistentSessionEntryPolicy`. `POST /api/persistent-session/create` accepts `entryPolicy` alongside `activityName`, `teacherCode`, and optional `selectedOptions`; `GET /api/persistent-session/list` returns each saved link with normalized `entryPolicy`.
- Compatibility constraints: Missing or invalid `entryPolicy` values must normalize to `instructor-required`. Existing cookie-backed saved links without server metadata must still list as `instructor-required` until metadata is created by a newer flow.
- Validation rules: Only `instructor-required`, `solo-allowed`, and `solo-only` are accepted; other values are treated as compatibility fallback to `instructor-required`. `solo-only` must not allow managed-session startup through the persistent-session websocket teacher-start path.
- Evidence (schema/tests/path): `server/routes/persistentSessionRoutes.ts`; `server/core/persistentSessionWs.ts`; `server/persistentSessionRoutes.test.ts`; `client/src/components/common/persistentSessionEntryPolicyUtils.ts`; `client/src/components/common/ManageDashboard.tsx`.
- Follow-up action: Add shared error/response contracts for policy-rejected teacher start attempts and extend server-side enforcement beyond the websocket start path when join/session APIs are unified.
- Owner: Codex

- Date: 2026-03-13
- Surface: activity interface
- Contract: Waiting-room Phase 0 shared contract is split across `ActivityConfig.waitingRoom` and shared waiting-room types. `ActivityConfig.waitingRoom.fields` accepts declarative field metadata with built-in field types `text`, `select`, and `custom`, while persistent/permalink entry policy uses `PersistentSessionEntryPolicy = 'instructor-required' | 'solo-allowed' | 'solo-only'` with compatibility default `instructor-required`.
- Compatibility constraints: Existing activities without `waitingRoom` remain unchanged. Existing persistent-session metadata that lacks `entryPolicy` must resolve to `instructor-required` in both stored metadata normalization and waiting-room status responses. Custom field `props` must stay data-only and serializable so config remains declarative.
- Validation rules: `waitingRoom.fields` must be an array; each field requires non-empty `id` and valid `type`; `select` fields require at least one option; `custom` fields require a string `component`; `custom.props` and `custom.defaultValue` must be serializable; persistent entry policy values outside the supported vocabulary normalize to `instructor-required`.
- Evidence (schema/tests/path): `types/waitingRoom.ts`; `types/activity.ts`; `types/activityConfigSchema.ts`; `server/activityConfigSchema.test.ts`; `server/core/persistentSessions.ts`; `server/routes/persistentSessionRoutes.ts`; `server/persistentSessionRoutes.test.ts`.
- Follow-up action: Phase 3 should reuse `PersistentSessionEntryPolicy` across the remaining join/session enforcement paths, and Phase 4 should carry waiting-room-collected data into downstream entry flows.
- Owner: Codex

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

- Date: 2026-03-02
- Surface: internal module
- Contract: SyncDeck reveal-sync protocol version is centralized in `activities/syncdeck/shared/revealSyncProtocol.ts` and must be reused by manager, student, server, and preflight handshake code.
- Compatibility constraints: Host-generated reveal-sync envelopes should stay on the same protocol version across runtime relay and preflight ping flows so decks that validate protocol compatibility do not accept one surface and reject another.
- Validation rules: Preflight ping, manager-issued commands, student-issued host commands, and server-generated reveal-sync payloads all import the shared `REVEAL_SYNC_PROTOCOL_VERSION`.
- Evidence (schema/tests/path): `activities/syncdeck/shared/revealSyncProtocol.ts`; `activities/syncdeck/client/shared/presentationPreflight.ts`; `activities/syncdeck/client/shared/presentationPreflight.test.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/server/routes.ts`.
- Follow-up action: If the reveal-sync schema version changes again, update the shared module once and keep compatibility tests around preflight/startup handshakes.
- Owner: Codex
