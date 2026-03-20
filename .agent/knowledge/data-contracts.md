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

- Date: 2026-03-18
- Surface: activity interface | internal module
- Contract: `ActivityConfig.reportEndpoint?: string` declares an activity-owned report download route that shared embedded-session surfaces such as SyncDeck can call without importing activity-specific server code. The value is metadata only; shared code treats it as an opaque non-empty string path and leaves auth, response format, and report generation semantics to the owning activity.
- Contract update: Embedded report downloads should resolve to one self-contained HTML file per activity session. The HTML should embed all required data, styles, and scripts and support internal view switching (for example whole-class summary and per-student detail) without extra network fetches.
- Contract update: SyncDeck's shared embedded report route now verifies the parent instructor passcode, resolves the child activity's `reportEndpoint` metadata, and redirects to the child-owned report URL. The first concrete consumer is `gallery-walk`, whose report endpoint returns an offline HTML document with both whole-class and per-student views derived from the same feedback export payload.
- Contract update: Per-activity report downloads are now a lower-level building block. The product-level target is a SyncDeck parent-session report that aggregates results from all embedded activities in a session into one downloadable self-contained HTML report with cross-activity summary, per-activity drill-down, and per-student drill-down.
- Contract update: The aggregate-path contract is structured-data-first. Child activities should contribute `ActivityStructuredReportSection` data plus an optional `ReportSectionComponent`, while SyncDeck owns the outer session-report container, scope selection, and manifest. Scopes currently planned are `activity-session`, `student-cross-activity`, and `session-summary`.
- Contract update: Structured child-report aggregation now uses a shared server registry (`registerActivityReportBuilder(activityType, builder)`). SyncDeck's `GET /api/syncdeck/:sessionId/report-manifest` route authenticates the parent instructor, walks `embeddedActivities`, invokes any registered child report builders, and returns a `SyncDeckSessionReportManifest` with deduplicated student refs.
- Contract update: SyncDeck manager now surfaces the parent-session export directly through a `Download Session Report` action that calls `GET /api/syncdeck/:sessionId/report` with the instructor passcode header and saves the returned self-contained HTML file locally.
- Contract update: Structured child report sections may now provide generic `scopeBlocks` and `studentScopeBlocks` in addition to summary cards. These blocks are activity-owned structured content (`rich-text` and `table` initially) that the SyncDeck session-report shell renders for `session-summary`, `activity-session`, and per-student drill-down views without importing activity-specific presentation code.
- Compatibility constraints: The field is optional and additive. Activities without reporting support omit it entirely. Shared parsers remove `null` values and reject non-string shapes so config loading stays deterministic. Shared SyncDeck code may assume the route returns downloadable HTML, but it should not depend on activity-specific DOM structure inside that document.
- Validation rules: `reportEndpoint` must be a non-empty string when present. Report documents should not depend on CDN assets, server-side templates that fetch follow-up JSON, or multiple companion files. The exported HTML should remain understandable when opened directly from disk after download. `scopeBlocks` and `studentScopeBlocks` must stay JSON-serializable and activity-agnostic enough for shared rendering.
- Evidence (schema/tests/path): `types/activity.ts`; `types/activityConfigSchema.ts`; `server/activityConfigSchema.test.ts`; `ARCHITECTURE.md`; `ADDING_ACTIVITIES.md`; `server/activities/activityReportRegistry.ts`; `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `activities/syncdeck/server/reportHtml.ts`; `activities/syncdeck/server/reportHtml.test.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`; `activities/gallery-walk/activity.config.ts`; `activities/gallery-walk/server/reportHtml.ts`; `activities/gallery-walk/server/reportHtml.test.ts`; `activities/gallery-walk/server/reportRoute.test.ts`
- Follow-up action: Expand the generic block vocabulary only when a second activity needs additional structures; avoid pushing activity-specific markup conventions into shared SyncDeck code.
- Owner: Codex

- Date: 2026-03-18
- Surface: REST | internal module | activity interface
- Contract: SyncDeck embedded child launches persist a generic bootstrap envelope on the child session at `session.data.embeddedLaunch = { parentSessionId, instanceKey, selectedOptions }`. The parent `POST /api/syncdeck/:sessionId/embedded-activity/start` route sanitizes object-shaped `activityOptions` into `selectedOptions`, and child activities consume that payload through shared client bootstrap helpers instead of SyncDeck-specific props or query params.
- Compatibility constraints: `selectedOptions` must remain activity-agnostic and JSON-serializable so any embedded activity can adopt the same bootstrap path. Missing, malformed, or non-object `activityOptions` normalize to `{}` rather than failing launch. Existing permalink/create-session bootstrap flows stay intact; embedded bootstrap is an additive read path for child-session managers.
- Validation rules: Parent route stores only sanitized object data; child readers treat absent or malformed `embeddedLaunch.selectedOptions` as `null`/no bootstrap; activity-specific validation still belongs inside the child activity. `video-sync` currently treats `selectedOptions.sourceUrl` as optional launch intent and falls back to its existing manual/permalink setup flow when invalid or absent.
- Evidence (schema/tests/path): `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `client/src/components/common/embeddedLaunchBootstrap.ts`; `client/src/components/common/embeddedLaunchBootstrap.test.ts`; `activities/video-sync/client/manager/VideoSyncManager.tsx`; `activities/video-sync/client/manager/VideoSyncManager.test.ts`
- Follow-up action: Add higher-level manager tests covering bootstrap-driven auto-configuration after child reload, then document any additional shared bootstrap fields only when a second embedded activity needs them.
- Owner: Codex

- Date: 2026-03-17
- Surface: REST | websocket | activity interface
- Contract: SyncDeck embedded child launch reuses waiting-room entry contracts plus parent-context proof. Parent session validates inherited role/identity through `POST /api/syncdeck/:sessionId/embedded-context`, child entry uses the shared child gateway (`GET /api/session/:childSessionId/entry` + entry-participant token consume), and parent SyncDeck state exposes an `embeddedActivities` map keyed by `instanceKey` (`{activityId}:{h}:{v}` or `{activityId}:global`).
- Contract update: Embedded pass-through is explicit: when child entry resolves to `entryOutcome: 'join-live'` and `waitingRoomFieldCount === 0`, overlay launch skips waiting-room UI by default. Two gating modes override this: `instructorGated: 'runtime'` skips waiting-room UI but holds students in instructor-owned state inside the activity; `instructorGated: 'waiting-room'` forces the waiting-room hold UI even with zero fields.
- Contract update: Multiplexing is not supported for embedded child activity realtime traffic. SyncDeck parent websocket only carries lifecycle envelopes (`embedded-activity-start` / `embedded-activity-end` keyed by `instanceKey`), while each active child activity/session maintains its own websocket connection to that activity server path.
- Compatibility constraints: Embedded launch must not introduce a parallel child claim API that bypasses shared waiting-room/accepted-entry seams. Parent websocket lifecycle envelopes must remain activity-agnostic and include `instanceKey`, `activityId`, and `childSessionId`; per-student `entryParticipantToken` remains nullable (for example manager role).
- Validation rules: `embeddedActivities` snapshot entries are map values shaped as `{ childSessionId, activityId, startedAt, owner }`. Late join/reconnect must request a fresh entry-participant token through parent-context-validated SyncDeck issuance instead of reusing an expired startup token.
- Evidence (schema/tests/path): `activities/syncdeck/server/routes.ts`; `activities/syncdeck/client/shared/embeddedContextUtils.ts`; `server/sessionEntryRoutes.test.ts`; `.agent/plans/syncdeck-embedded-activities.md`; `types/activity.ts`; `types/activityConfigSchema.ts`
- Follow-up action: Phase 1 should formalize lifecycle message payload interfaces in shared SyncDeck types and add server tests covering per-instance deduplication, owner arbitration, late-join token issuance, and parent-cull child teardown.
- Owner: Codex

- Date: 2026-03-03
- Surface: internal module
- Contract: `activities/video-sync` treats a valid YouTube video ID as exactly 11 URL-safe characters (`[A-Za-z0-9_-]{11}`) in both client-side URL parsing and server-side source validation.
- Compatibility constraints: Solo-mode parsing, managed session configuration, and shared URL parsing helpers should reject shorter IDs the same way; any intentional divergence would need explicit documentation because it changes behavior between solo and teacher-managed flows.
- Validation rules: `parseYouTubeVideoId()` and the server `normalizeYouTubeVideoId()` path should only accept 11-character IDs and return `null`/`invalid-video-id` for shorter or malformed values.
- Evidence (schema/tests/path): `activities/video-sync/client/student/VideoSyncStudent.tsx`; `activities/video-sync/client/student/VideoSyncStudent.test.ts`; `activities/video-sync/server/routes.ts`
- Follow-up action: Reuse the same 11-character rule in any future client-side Video Sync URL validation helpers instead of introducing activity-local regex variants.
- Owner: Codex

- Date: 2026-03-14
- Surface: internal module
- Contract: Shared server-side participant IDs now originate from `generateParticipantId()` in `server/core/participantIds.ts`, which returns a 16-character lowercase hex token. Activity server routes may still store that value under existing field names such as `studentId` or `id`, but new ID minting should come from the shared helper instead of route-local timestamp/random concatenation.
- Compatibility constraints: Existing websocket and REST payload keys remain unchanged for now (`studentId`, `id`, etc.) so activity clients do not break. This contract centralizes only issuance format, not yet the higher-level participant context schema or reconnect ownership.
- Validation rules: Generated IDs must match `/^[a-f0-9]{16}$/` and be random enough for repeated issuance without route-local prefixes or user-name-derived content.
- Evidence (schema/tests/path): `server/core/participantIds.ts`; `server/participantIds.test.ts`; `activities/java-string-practice/server/routes.ts`; `activities/java-format-practice/server/routes.ts`; `activities/traveling-salesman/server/routes/shared.ts`; `activities/syncdeck/server/routes.ts`.
- Follow-up action: Replace activity-owned reconnect matching and participant record creation with a shared participant-entry contract once waiting-room/server handoff design is ready.
- Owner: Codex

- Date: 2026-03-14
- Surface: internal module
- Contract: `connectSessionParticipant()` in `server/core/sessionParticipants.ts` now provides a shared reconnect-or-create flow for session-backed student arrays whose records use `{ id?, name, connected?, lastSeen? }` plus activity-specific extra fields. It resolves by explicit participant ID first and can optionally support legacy name-only matches for older sessions missing IDs.
- Compatibility constraints: The helper does not change activity wire formats; routes still send existing payload keys such as `studentId`. It only centralizes in-memory/session-store mutation rules for activities that opt in.
- Validation rules: Existing participant IDs win over name matches; legacy name fallback is only enabled where explicitly requested; reconnect updates `connected` and `lastSeen`; missing IDs on matched legacy participants are backfilled with a generated shared participant ID.
- Evidence (schema/tests/path): `server/core/sessionParticipants.ts`; `server/sessionParticipants.test.ts`; `activities/java-string-practice/server/routes.ts`; `activities/java-format-practice/server/routes.ts`; `activities/traveling-salesman/server/routes/students.ts`.
- Follow-up action: Extend or replace this helper once Python List Practice and SyncDeck are migrated to the same participant contract, especially where their current flows still mix registration, reconnect, and progress persistence differently.
- Owner: Codex

- Date: 2026-03-14
- Surface: internal module
- Contract: The current waiting-room branch treats `participantId` as shared early identity, but not yet as a fully authoritative accepted-entry contract. Shared code now covers ID issuance, entry handoff storage, reconnect/create for several session-backed activities, accepted-participant lookup, mutation, disconnect handling, and duplicate-socket replacement. Activity routes still own the final acceptance and persistence boundary after handoff.
- Compatibility constraints: Existing activities may continue to use activity-owned registration or acceptance flows as long as they do not break the earlier shared `participantId` and handoff assumptions. Separate `studentId` vs `id` field names remain tolerated for now.
- Validation rules: Waiting-room handoff may mint `participantId` before activity startup, but an activity may only treat that identity as authoritative after its own accepted-entry checks succeed. Shared helpers should be preferred for session-backed participant lookup/mutation where the participant record fits the common shape.
- Evidence (schema/tests/path): `server/core/participantIds.ts`; `server/core/entryParticipants.ts`; `server/core/sessionParticipants.ts`; `server/core/participantSockets.ts`; `server/sessionParticipants.test.ts`; `server/participantSockets.test.ts`; `client/src/components/common/entryParticipantStorage.ts`; `client/src/components/common/entryParticipantIdentityUtils.ts`
- Follow-up action: Decide whether to stop at the current shared-helper boundary or introduce one broader accepted-entry service that owns post-handoff participant acceptance/reconnect across more activities.
- Owner: Codex

- Date: 2026-03-14
- Surface: REST | internal module
- Contract: Consuming a live session entry-participant token now also records an accepted-entry participant record on the session in `acceptedEntryParticipants[participantId] = { participantId, displayName, acceptedAt }`. This makes accepted entry observable on the server after the token is redeemed, not only on the client that consumed it.
- Compatibility constraints: The consume route response remains `{ values }`, and activities are not yet required to consult `acceptedEntryParticipants` during websocket join or later updates. Existing direct joins without waiting-room handoff still work unchanged.
- Validation rules: Only consumed values with a non-empty string `participantId` produce an accepted-entry record. `displayName` is normalized to a trimmed string or `null`. The accepted-entry record is session-scoped and written at token-consume time.
- Evidence (schema/tests/path): `server/core/acceptedEntryParticipants.ts`; `server/core/sessions.ts`; `server/acceptedEntryParticipants.test.ts`; `server/sessionEntryRoutes.test.ts`
- Follow-up action: Decide which activity join/reconnect paths should start consulting `acceptedEntryParticipants` first so post-handoff participant acceptance becomes more authoritative than “client sent a matching name and ID”.
- Owner: Codex

- Date: 2026-03-14
- Surface: websocket | internal module
- Contract: `java-string-practice` and `java-format-practice` websocket joins now consult `acceptedEntryParticipants` by `participantId` when the reconnecting client does not send `studentName`. A previously accepted waiting-room entry can therefore rehydrate the participant name server-side during join.
- Compatibility constraints: Explicit `studentName` from the client still wins when present. Activities that have not opted into this behavior remain unchanged. Direct joins without prior accepted entry still require the existing query-name behavior.
- Validation rules: Only a non-empty accepted-entry `displayName` for the supplied `participantId` may be used as the fallback name. Missing accepted-entry records do not create or guess a name.
- Evidence (schema/tests/path): `server/core/acceptedEntryParticipants.ts`; `activities/java-string-practice/server/routes.ts`; `activities/java-format-practice/server/routes.ts`; `server/acceptedEntryParticipants.test.ts`
- Follow-up action: Decide whether to extend the same fallback rule to additional session-backed activities or replace it with a broader accepted-entry join service.
- Owner: Codex

- Date: 2026-03-14
- Surface: websocket | internal module
- Contract: `connectAcceptedSessionParticipant()` in `server/core/acceptedSessionParticipants.ts` is now the shared server entry-point for session-backed websocket joins that want to prefer accepted-entry identity. It resolves the effective participant name from explicit query input first, then from `acceptedEntryParticipants[participantId]`. When that `participantId` is present but not yet in the participant list, the helper now creates the first participant record with the same accepted `participantId` instead of minting a new one.
- Compatibility constraints: Activities opt into this service individually. It does not replace activity-specific participant fields or payload shapes, and it does not force activities without accepted-entry support to change behavior.
- Validation rules: A join only proceeds when the service can resolve a non-empty participant name. Explicit client-provided names still win over accepted-entry fallback when an activity passes them, but a non-empty `participantId` now stays stable on first accepted-entry create instead of being replaced. When the client reconnects with only `participantId`, the service may also reuse the already-stored participant name for that same participant record instead of requiring the browser to resend `studentName`. The downstream participant connect logic continues to own legacy unnamed matching and participant-shape-specific mutation.
- Evidence (schema/tests/path): `server/core/acceptedSessionParticipants.ts`; `server/acceptedSessionParticipants.test.ts`; `activities/java-string-practice/server/routes.ts`; `activities/java-format-practice/server/routes.ts`; `activities/traveling-salesman/server/routes/students.ts`; `activities/python-list-practice/server/studentParticipants.ts`; `activities/syncdeck/server/studentParticipants.ts`
- Follow-up action: The main remaining question is whether more activities should standardize on the same direct accepted-entry connect path instead of keeping separate pre-connect registration endpoints.
- Owner: Codex

- Date: 2026-03-14
- Surface: websocket | client entry
- Contract: SyncDeck student entry now resolves identity from either cached session storage or the accepted waiting-room handoff, then connects directly to `/ws/syncdeck`. On first connect, `connectAcceptedSessionParticipant()` preserves the waiting-room-issued `participantId` and creates the server-side student record when needed; later reconnects reuse the stored SyncDeck student record by the same ID.
- Compatibility constraints: Stored SyncDeck student identity still wins over newly consumed accepted-entry values, so reconnect behavior for previously connected students remains unchanged. When neither stored nor accepted identity exists, the client surfaces a “restart entry” state instead of an in-activity name form. The old pre-connect `register-student` route is gone.
- Validation rules: Direct student websocket entry requires both `studentId` and `studentName` from either stored or accepted identity. Missing identity no longer triggers an in-activity manual registration fallback, and first accepted-entry connect keeps the supplied `participantId` stable instead of minting a new one.
- Evidence (schema/tests/path): `server/core/acceptedSessionParticipants.ts`; `server/acceptedSessionParticipants.test.ts`; `activities/syncdeck/server/studentParticipants.ts`; `activities/syncdeck/server/studentParticipants.test.ts`; `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/student/entryIdentityUtils.ts`; `activities/syncdeck/client/student/entryIdentityUtils.test.ts`
- Follow-up action: The remaining SyncDeck divergence is now mostly about activity-owned websocket payload/session shape, not student identity establishment.
- Owner: Codex

- Date: 2026-03-14
- Surface: activity config | waiting room
- Contract: SyncDeck now declares the shared waiting-room `displayName` field in `activity.config.ts`, so join-code and permalink entry can collect student identity before the activity-specific registration/connect path runs.
- Compatibility constraints: SyncDeck still does not support the generic `/solo/:activityId` route, but the config model now allows standalone capability to be expressed separately from direct solo-path support. The waiting-room field declaration is now the required student-name collection step for new entry rather than a hint layered on top of an in-activity prompt.
- Validation rules: `displayName` is required and uses the same shared text-field contract as the migrated Java activities. New SyncDeck student entry now expects that value to be collected before the activity loads.
- Evidence (schema/tests/path): `activities/syncdeck/activity.config.ts`; `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/SessionRouter.tsx`
- Follow-up action: If SyncDeck later removes its separate registration route, keep the waiting-room field as the single authoritative student-name collection step instead of reintroducing a second in-activity prompt.
- Owner: Codex

- Date: 2026-03-13
- Surface: REST | websocket
- Contract: Generic persistent-link creation and listing now carry `entryPolicy?: PersistentSessionEntryPolicy`. `POST /api/persistent-session/create` accepts `entryPolicy` alongside `activityName`, `teacherCode`, and optional `selectedOptions`; `GET /api/persistent-session/list` returns each saved link with normalized `entryPolicy`. Teacher-start rejection for `solo-only` uses a shared payload shape across both `POST /api/persistent-session/authenticate` and websocket `teacher-code-error`.
- Contract update: canonical permalink signing is now the shared model for persistent links. `POST /api/persistent-session/create` returns `/activity/:activity/:hash?...&entryPolicy=...&urlHash=...`, where `urlHash` signs the canonical permalink state (`entryPolicy` plus canonicalized activity `deepLinkOptions`). Generic permalink entry/auth routes and activity-owned recovery paths should trust only that canonical signed state. Teacher cookies persist the same `entryPolicy` + `urlHash` so the dashboard can reconstruct links after a restart.
- Contract update: the shared dashboard now supports permalink maintenance too. `POST /api/persistent-session/update` accepts `{ activityName, hash, selectedOptions?, entryPolicy? }` and rewrites the signed permalink state for the same hash using the remembered teacher cookie entry; `POST /api/persistent-session/remove` accepts `{ activityName, hash }` and removes that saved permalink from the teacher cookie while cleaning up current runtime metadata for the hash.
- Compatibility constraints: Missing or invalid `entryPolicy` or `urlHash` values normalize to `instructor-required`. Generic permalink read/auth routes should not rely on server metadata as the source of truth for entry mode; invalid or absent signed URL state falls back to `instructor-required` / "Live Only".
- Validation rules: Only `instructor-required`, `solo-allowed`, and `solo-only` are accepted; other values are treated as compatibility fallback to `instructor-required`. `solo-only` must not allow managed-session startup through either `POST /api/persistent-session/authenticate` or the persistent-session websocket teacher-start path. Policy rejection uses `{ error, code: 'entry-policy-rejected', entryPolicy: 'solo-only' }` in REST and as the payload body for websocket `teacher-code-error`.
- Evidence (schema/tests/path): `server/routes/persistentSessionRoutes.ts`; `server/core/persistentSessionWs.ts`; `server/core/persistentSessionPolicyUtils.ts`; `server/persistentSessionRoutes.test.ts`; `server/persistentSessionPolicyUtils.test.ts`; `client/src/components/common/persistentSessionEntryPolicyUtils.ts`; `client/src/components/common/persistentSessionAuthUtils.ts`; `client/src/components/common/waitingRoomUtils.ts`; `client/src/components/common/ManageDashboard.tsx`.
- Follow-up action: Reuse the same policy-rejection shape if standalone join-code entry or future shared entry APIs introduce additional disallowed managed-entry paths, and keep client parsing centralized in `persistentSessionAuthUtils.ts`.
- Owner: Codex

- Date: 2026-03-13
- Surface: activity interface
- Contract: Waiting-room Phase 0 shared contract is split across `ActivityConfig.waitingRoom` and shared waiting-room types. `ActivityConfig.waitingRoom.fields` accepts declarative field metadata with built-in field types `text`, `select`, and `custom`, while persistent/permalink entry policy uses `PersistentSessionEntryPolicy = 'instructor-required' | 'solo-allowed' | 'solo-only'` with compatibility default `instructor-required`.
- Compatibility constraints: Existing activities without `waitingRoom` remain unchanged. Existing persistent-session metadata that lacks `entryPolicy` must resolve to `instructor-required` in both stored metadata normalization and waiting-room status responses. Custom field `props` must stay data-only and serializable so config remains declarative.
- Validation rules: `waitingRoom.fields` must be an array; each field requires non-empty `id` and valid `type`; `select` fields require at least one option; `custom` fields require a string `component`; `custom.props` and `custom.defaultValue` must be serializable; persistent entry policy values outside the supported vocabulary normalize to `instructor-required`.
- Evidence (schema/tests/path): `types/waitingRoom.ts`; `types/activity.ts`; `types/activityConfigSchema.ts`; `server/activityConfigSchema.test.ts`; `server/core/persistentSessions.ts`; `server/routes/persistentSessionRoutes.ts`; `server/persistentSessionRoutes.test.ts`.
- Follow-up action: Phase 3 should reuse `PersistentSessionEntryPolicy` across the remaining join/session enforcement paths, and Phase 4 should carry waiting-room-collected data into downstream entry flows.
- Owner: Codex

- Date: 2026-03-14
- Surface: internal module
- Contract: Standalone persistent-link entry resolution is now modeled as three outputs in shared client logic: `resolvedRole` (`student | teacher`), `entryOutcome` (`wait | join-live | continue-solo | solo-unavailable`), and `presentationMode` (`render-ui | pass-through`). Default unauthenticated permalink entry resolves to student. Remembered teacher cookie or successful teacher-code auth count as instructor intent for managed-entry policies, while `solo-only` always resolves to student-role solo behavior even when instructor auth exists.
- Compatibility constraints: This resolver currently governs standalone permalink entry in the client. Embedded-role inheritance is documented as the target contract but is not yet a runtime-enforced path. Existing server rejection behavior for `solo-only` managed startup remains unchanged and authoritative.
- Validation rules: `solo-only` must never resolve to managed `join-live`; waiting state always renders UI; any required waiting-room field forces `presentationMode: render-ui`; started student live entry with no required fields may use `presentationMode: pass-through`.
- Evidence (schema/tests/path): `client/src/components/common/persistentSessionEntryPolicyUtils.ts`; `client/src/components/common/persistentSessionEntryPolicyUtils.test.ts`; `client/src/components/common/SessionRouter.tsx`; `.agent/plans/waiting-room-expansion.md`
- Follow-up action: Reuse the same role/presentation resolver shape when join-code entry is moved behind a shared server-backed waiting-room gateway, and extend it to embedded parent-role inheritance once that track is ready.
- Owner: Codex

- Date: 2026-03-14
- Surface: REST | internal module
- Contract: Direct session/join-code entry now has a dedicated server-backed gateway payload at `GET /api/session/:sessionId/entry`. The response shape is `{ sessionId, activityName, waitingRoomFieldCount, resolvedRole, entryOutcome, presentationMode }`, currently fixed to student `join-live` with `presentationMode` derived from whether the activity declares waiting-room fields. `SessionRouter` uses this payload before fetching full session data.
- Compatibility constraints: `GET /api/session/:sessionId` remains unchanged for activity runtime data. The new `/entry` route adds gateway metadata without changing existing session payload consumers. Join-code entry still uses a separate endpoint from persistent/permalink entry; this contract narrows the divergence but does not fully unify the surfaces yet.
- Validation rules: Missing sessions return `404 { error: 'invalid session' }` like the existing session route. Activities with waiting-room fields must resolve to `presentationMode: render-ui`; activities without fields resolve to `pass-through`.
- Evidence (schema/tests/path): `types/waitingRoom.ts`; `server/core/sessions.ts`; `server/sessionEntryRoutes.test.ts`; `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/sessionRouterUtils.ts`; `client/src/components/common/sessionEntryRenderUtils.ts`
- Follow-up action: Collapse permalink and join-code entry onto one shared gateway service once server-backed participant handoff/storage is designed, so both surfaces stop carrying parallel entry payloads.
- Owner: Codex

- Date: 2026-03-14
- Surface: REST | internal module
- Contract: Persistent/permalink entry now also has a dedicated server-backed gateway payload at `GET /api/persistent-session/:hash/entry?activityName=...`. The response shape is `{ activityName, hash, entryPolicy, hasTeacherCookie, isStarted, sessionId, waitingRoomFieldCount, resolvedRole, entryOutcome, presentationMode }`, and `SessionRouter` now trusts that server-computed decision instead of recomputing permalink role/presentation locally from raw metadata.
- Compatibility constraints: `GET /api/persistent-session/:hash` remains available for older metadata/status consumers. Permalink and join-code entry now use parallel entry-status endpoints with aligned decision vocabulary, but they are not yet a single shared backend gateway service.
- Validation rules: Missing `hash` or `activityName` returns `400`; missing sessions still normalize/reset through existing persistent-session lookup rules before the entry-status payload is returned. `solo-only` with remembered teacher cookie must still resolve to student-role solo behavior, not teacher live entry.
- Evidence (schema/tests/path): `types/waitingRoom.ts`; `server/core/persistentSessionEntryStatus.ts`; `server/routes/persistentSessionRoutes.ts`; `server/persistentSessionRoutes.test.ts`; `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/sessionRouterUtils.ts`
- Follow-up action: When the entry surfaces are finally unified, replace the parallel session/persistent entry endpoints with one shared gateway abstraction instead of letting both grow independently.
- Owner: Codex

- Date: 2026-03-14
- Surface: internal module
- Contract: Server-side entry-status payload assembly is now centralized in `server/core/entryStatus.ts`. Direct-session and persistent-session routes still expose different REST endpoints and source data, but they now derive `resolvedRole`, `entryOutcome`, and `presentationMode` through the same backend builder logic instead of maintaining parallel payload assembly rules in each route file.
- Compatibility constraints: Endpoint URLs and top-level payload shapes remain unchanged for this refactor. The shared builder reduces duplication but does not yet merge the underlying session lookup and persistent-link lookup pathways.
- Validation rules: Presentation mode must remain derived from `waitingRoomFieldCount` plus `entryOutcome`; direct session entry stays fixed to student `join-live`; persistent entry preserves `solo-only`, teacher-cookie, and solo-support rules.
- Evidence (schema/tests/path): `server/core/entryStatus.ts`; `server/core/sessions.ts`; `server/routes/persistentSessionRoutes.ts`; `server/sessionEntryRoutes.test.ts`; `server/persistentSessionRoutes.test.ts`
- Follow-up action: Use this shared builder as the seam for a later unified gateway service instead of reintroducing route-local entry decision logic.
- Owner: Codex

- Date: 2026-03-14
- Surface: REST | internal module
- Contract: Waiting-room carry-forward now supports two server-backed opaque-token handoff paths. `POST /api/session/:sessionId/entry-participant` / `POST /api/session/:sessionId/entry-participant/consume` cover live-session entry, and `POST /api/persistent-session/:hash/entry-participant?activityName=...` / `POST /api/persistent-session/:hash/entry-participant/consume?activityName=...` cover persistent permalink solo continuation. Consume calls send `{ token }` in the JSON body. Both paths accept `{ values }`, normalize serializable waiting-room fields, temporarily store them behind an opaque token, and return `{ entryParticipantToken, values }` on store plus `{ values }` on one-shot consume.
- Compatibility constraints: Client sessionStorage still holds the handoff token and remains the fallback when server-backed storage fails. Existing activity websocket payloads and runtime `studentId` / `participantId` fields are unchanged; the token path is additive.
- Validation rules: Missing or mismatched sessions return `404 { error: 'invalid session' }` or `404 { error: 'invalid persistent session' }`; missing or already-consumed tokens return `404 { error: 'entry participant not found' }`; non-serializable values are dropped during normalization before storage; successful consume removes the stored token entry. Server-backed storage guarantees a non-empty `participantId` string in the stored/returned values, minting one with the shared participant ID helper when the waiting-room payload did not already include one.
- Evidence (schema/tests/path): `server/core/sessionEntryParticipants.ts`; `server/core/sessions.ts`; `server/core/persistentSessions.ts`; `server/sessionEntryRoutes.test.ts`; `server/persistentSessionRoutes.test.ts`; `client/src/components/common/entryParticipantStorage.ts`; `client/src/components/common/WaitingRoom.tsx`; `activities/java-string-practice/client/student/JavaStringPractice.tsx`; `activities/java-format-practice/client/student/JavaFormatPractice.tsx`
- Follow-up action: Extend this contract beyond `displayName` and temporary handoff only when shared participant identity and reconnect ownership are finalized, so we do not ossify an incomplete participant schema too early.
- Owner: Codex

- Date: 2026-03-14
- Surface: client | REST | websocket
- Contract: Waiting-room ownership is now split intentionally. Client-side waiting-room code owns declarative field rendering, required-field validation, wait-state form persistence, token persistence, and fallback local-value storage. Server-side entry routes own temporary handoff storage for live-session entry and persistent-session solo continuation, opaque token issuance/consume, and early shared `participantId` issuance. Activity routes/websockets still own activity-specific acceptance, reconnect matching, and progress semantics after entry is handed off.
- Compatibility constraints: This is an implementation contract, not yet a fully unified participant service. Activities that have not adopted waiting-room handoff continue to behave as before, and solo `/:activityId` entry remains a separate compatibility path outside the persistent permalink handoff routes.
- Validation rules: Client must not treat waiting-room form completion as equivalent to accepted activity registration; only server-issued handoff plus later activity join/startup acceptance are authoritative. Server handoff routes must not assume activity-specific participant schemas beyond serializable waiting-room values plus shared `participantId`.
- Evidence (schema/tests/path): `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/waitingRoomFormUtils.ts`; `client/src/components/common/entryParticipantStorage.ts`; `server/core/sessions.ts`; `server/core/sessionEntryParticipants.ts`; `server/core/persistentSessions.ts`; `server/persistentSessionRoutes.test.ts`; `.agent/plans/waiting-room-expansion.md`
- Follow-up action: The biggest remaining contract work is defining what happens after handoff: which server surface accepts a waiting-room-issued `participantId`, how reconnect is proven across activities, and whether the shared entry layer itself should become the authoritative place that persists reusable session-scoped reconnect identity instead of each activity writing its own `student-name-*` / `student-id-*` keys.
- Owner: Codex

- Date: 2026-03-14
- Surface: client | internal module
- Contract: Session-scoped reconnect identity now has a shared client storage shape in `sessionParticipantContext.ts`, keyed by `session-participant:${sessionId}`. Shared entry helpers and migrated activities may persist `{ studentName, studentId }` there, and entry resolution prefers that shared context before falling back to legacy `student-name-*` / `student-id-*` keys.
- Compatibility constraints: Legacy per-key storage remains readable and is still written by some compatibility paths while migration is incomplete. Activities that have not adopted the shared context helper may continue to rely on the older keys for now.
- Validation rules: Stored values are trimmed string-or-null fields; invalid or empty payloads are removed. The shared context may contain `studentId` without `studentName`, but when both exist they must describe the same session-scoped participant.
- Evidence (schema/tests/path): `client/src/components/common/sessionParticipantContext.ts`; `client/src/components/common/sessionParticipantContext.test.ts`; `client/src/components/common/entryParticipantIdentityUtils.ts`; `client/src/components/common/entryParticipantIdentityUtils.test.ts`; `activities/java-string-practice/client/student/JavaStringPractice.tsx`; `activities/java-format-practice/client/student/JavaFormatPractice.tsx`
- Follow-up action: Move the authoritative writes for this context closer to shared entry acceptance so activities do not need to decide when to persist reconnect identity themselves.
- Owner: Codex

- Date: 2026-02-23
- Surface: REST
- Contract: SyncDeck permalink creation/edit now participates in the shared canonical permalink signing flow. The activity-owned builder still performs SyncDeck-specific presentation validation and may call `POST /api/syncdeck/generate-url` for create-mode UX, but the durable permalink contract is the canonical persistent-link URL shape `/activity/:activity/:hash?...&entryPolicy=...&urlHash=...`, where `urlHash` signs `entryPolicy` plus canonicalized activity `deepLinkOptions`.
- Compatibility constraints: Activities without custom builders/generators continue using shared `/api/persistent-session/create` and `/api/persistent-session/update`. SyncDeck-specific manage recovery must use server/cookie-backed canonical permalink state instead of trusting raw manage-route query params after redirects.
- Validation rules: `activityName` must match `syncdeck`; `teacherCode` follows existing persistent-session constraints; `selectedOptions.presentationUrl` must be a valid `http`/`https` URL before URL generation.
- Evidence (schema/tests/path): `activities/syncdeck/client/components/SyncDeckPersistentLinkBuilder.tsx`; `activities/syncdeck/client/components/SyncDeckPersistentLinkBuilder.test.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `server/routes/persistentSessionRoutes.ts`; `.agent/plans/permalink-signing-plan.md`.
- Follow-up action: Continue aligning other permalink-capable activities with the same canonical launch/recovery expectations, especially where activity-owned recovery still needs to consume signed state after redirects.
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

- Date: 2026-03-14
- Surface: REST | websocket
- Contract: SyncDeck student identity is server-issued. `POST /api/syncdeck/:sessionId/register-student` is the authoritative source of `studentId`, and `/ws/syncdeck` student connects must present a previously registered `studentId`. Missing or unknown IDs are rejected with websocket close code `1008` and reason `missing studentId` or `unregistered student`.
- Compatibility constraints: SyncDeck still uses its own REST registration flow rather than the shared waiting-room accepted-entry service. The client may cache `studentId` in `sessionStorage`, but cached values are only valid if they still match a registered student record for that session.
- Validation rules: Server must not create a new SyncDeck student record from websocket query params alone. The client should clear stale cached registration and prompt for re-entry when websocket connect fails for missing or unknown student identity.
- Evidence (schema/tests/path): `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/studentParticipants.ts`; `activities/syncdeck/server/routes.test.ts`; `activities/syncdeck/server/studentParticipants.test.ts`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`
- Follow-up action: Keep this contract in place unless/until SyncDeck is moved onto a broader shared accepted-entry service that can authoritatively issue and validate participant context across presentation-linked flows.
- Owner: Codex

- Date: 2026-03-14
- Surface: REST
- Contract: SyncDeck now exposes `POST /api/syncdeck/:sessionId/embedded-context` as a parent-context proof surface for future embedded launches. A valid `instructorPasscode` resolves `{ resolvedRole: 'teacher' }`; a valid registered `studentId` resolves `{ resolvedRole: 'student', studentId, studentName }`; unknown identity resolves `403 { error: 'forbidden' }`.
- Compatibility constraints: This does not launch embedded activities yet and does not replace waiting-room entry. It is a narrow validation surface meant to prove inherited parent role from an existing SyncDeck session without prompting for teacher code again in the eventual child flow.
- Validation rules: Missing or invalid `sessionId` follows existing SyncDeck route patterns (`400` / `404`). Student inheritance must only succeed for an already registered SyncDeck student record. Teacher inheritance must only succeed for a valid instructor passcode for that session.
- Evidence (schema/tests/path): `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`
- Follow-up action: Wire the eventual embedded child-launch path to this validated parent context instead of re-deriving teacher/student role from client claims alone. The client-side fetch/request-resolution contract now lives in `activities/syncdeck/client/shared/embeddedContextUtils.ts`.
- Owner: Codex
