# TypeScript Migration Review Log

## Baseline Capture

- Captured at: `2026-02-07 02:03:37Z` (UTC)
- Environment: Codex sandbox (`/workspaces/ActiveBits`)
- Note: This sandbox cannot reliably bind listening ports, which affects some server tests and server smoke checks.

### Phase 0 Command Results

| Command | Result in Agent Sandbox | Notes |
|---|---|---|
| `npm --workspace client test` | Pass | Lint + unit tests passed. |
| `npm --workspace server test` | Fail (environment-limited) | Failed suites: `server/galleryWalkRoutes.test.js`, `server/sessionStore.test.js`, `server/statusRoute.test.js`. Failures are consistent with sandbox port-binding restrictions. |
| `npm --workspace activities test` | Pass | All activities tests passed. |
| `npm run verify:deploy` | Pass | Build succeeded. |
| `npm run verify:server` | Fail (environment-limited) | `EPERM` when binding to `0.0.0.0:4010` in `scripts/verify-server.js`. |

### Manual Intervention Record

- User verified `npm --workspace server test` passes in their local environment.
- Server-related checks that bind ports require manual/local verification when agent sandbox networking is restricted.

### Baseline Policy Outcome

- Canonical baseline source of truth remains local/CI (per plan).
- Agent sandbox failures above are recorded as environment constraints, not migration regressions.

## Phase 1 Progress (Foundation)

### Completed

- Added root/workspace TypeScript configs:
  - `tsconfig.base.json`
  - `client/tsconfig.json`
  - `server/tsconfig.json`
  - `server/tsconfig.build.json`
  - `activities/tsconfig.json`
- Added shared type scaffolding under `types/`.
- Added `client/src/vite-env.d.ts`.
- Renamed `client/vite.config.js` -> `client/vite.config.ts`.
- Added/updated scripts for transitional migration flow:
  - root `typecheck`
  - workspace `typecheck`
  - mixed-extension test discovery for `client` and `activities`
  - mixed-extension discovery + `build` script for `server`

### Validation Run

- `npm run typecheck --workspaces --if-present` -> pass
- `npm --workspace client test` -> pass
- `npm --workspace activities test` -> pass

### Note

- Client typecheck currently excludes `vite.config.ts` in `client/tsconfig.json` because this workspace has mixed Vite major versions (root and client), which causes plugin type mismatch during `tsc --noEmit`.
- Runtime/build behavior is unaffected; this is tracked for cleanup during tooling harmonization.

### Vite Version Alignment Update

- Updated package manifests to align on latest Vite line:
  - root `vite` -> `^7.2.2`
  - client `vite` -> `^7.2.2`
  - client `@vitejs/plugin-react` -> `^5.1.0`
- Updated `client/vite.config.ts` to use `tailwindcss()` with no args to match current plugin typing.

Validation status (historical):
- Initial validation was blocked in sandbox while dependency tree was stale.
- This was resolved by subsequent user alignment/install to Vite `7.3.1` (see next section).

### Vite Alignment Validation (User update)

User aligned Vite across root/client to `7.3.1` and plugin stack to matching versions.

Validation results:
- `npm run typecheck --workspaces --if-present` -> pass
- `npm --workspace client test` -> pass
- `npm --workspace client run build` -> pass

Outcome:
- Prior `vite.config.ts` plugin type-identity errors are resolved.
- Production client build still emits source maps as intended.

### Transitional Test Script Alignment

Updated workspace test scripts to use TypeScript-capable runtime while preserving mixed-extension discovery:
- `client` test unit runner: `node --import tsx --test`
- `server` test runner: `node --import tsx --test`
- `activities` test runner: `node --import tsx --test --import ../scripts/jsx-loader-register.mjs`

Validation:
- `npm --workspace client test` -> pass
- `npm --workspace activities test` -> pass
- `npm --workspace server test` -> fail in sandbox on known bind-related suites (`galleryWalkRoutes`, `sessionStore`, `statusRoute`), consistent with prior environment limitation.

### Phase 1 Closure Update

Additional Phase 1 completion work:
- Added workspace-level TypeScript-related dev dependencies:
  - `client`: `typescript`, `@types/node`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`
  - `server`: `typescript`, `tsx`, `@types/node`, `@types/express`, `@types/cookie-parser`, `@types/ws`
  - `activities`: `typescript`, `@types/node`, `@types/react`, `@types/react-dom`
- Updated `client/eslint.config.mjs` to include TS/TSX linting with `@typescript-eslint`.
- Adjusted `server` start/dev scripts to support current JS runtime and future TS runtime transition via fallback logic.

Validation results:
- `npm run typecheck --workspaces --if-present` -> pass
- `npm --workspace client test` -> pass
- `npm --workspace activities test` -> pass

Phase 1 status: complete (with known sandbox limitation for server bind-dependent runtime tests recorded earlier).

## Phase 2 Progress (Compatibility Layer)

### Completed

- Updated client activity loader (`client/src/activities/index.js`) to support mixed extension discovery:
  - configs: `@activities/*/activity.config.{js,ts}`
  - client entries: `@activities/*/client/index.{js,jsx,ts,tsx}`
- Added deterministic extension preference during overlap windows:
  - config preference: `.ts` over `.js`
  - client entry preference: `.tsx` over `.ts` over `.jsx` over `.js`
- Updated server registry (`server/activities/activityRegistry.js`) to:
  - discover both `activity.config.ts` and `activity.config.js` (prefers `.ts` when both exist)
  - resolve `serverEntry` across `.js`/`.ts` extension transitions when one side has already migrated
  - preserve existing production/development filtering and startup safety behavior
- Updated migration-sensitive tests to tolerate mixed extensions:
  - `client/src/activities/index.test.js`
  - `server/activities/activityRegistry.test.js`
- Added targeted server registry test covering TS config + TS route module with `.js` serverEntry fallback resolution.

### Validation

- `npm run typecheck --workspaces --if-present` -> pass
- `npm --workspace client test` -> pass
- `npm --workspace client run build` -> pass
- `npm --workspace activities test` -> pass
- `node --import tsx --test server/activities/activityRegistry.test.js` -> pass
- `npm --workspace server test` -> fail in sandbox on known bind-related suites (`galleryWalkRoutes`, `sessionStore`, `statusRoute`), unchanged from baseline limitation.

### Manual/local verification (user run)

- `npm --workspace server test` -> pass (`35` pass, `0` fail, user-reported local run)
- Added explicit `[TEST]` messages in `server/activities/activityRegistry.test.js` before intentionally noisy/error-path cases so expected output is clearly labeled.
- Expected noisy logs during tests:
  - `registerActivityRoutes` compatibility test intentionally uses minimal `app/ws` stubs, so non-target activity route registration logs `TypeError` warnings while still validating extension fallback behavior.
  - Config-failure tests intentionally create broken temporary configs and verify production/development error handling.

Phase 2 status: complete (sandbox + local canonical verification).

## Phase 3 Progress (Backend Migration)

### Kickoff Slice: Core utilities (transitional)

Completed:
- Added TypeScript counterparts for first Phase 3 utility targets:
  - `server/core/sessionNormalization.ts`
  - `server/core/broadcastUtils.ts`
- Kept existing JavaScript runtime modules in place:
  - `server/core/sessionNormalization.js`
  - `server/core/broadcastUtils.js`

Why transitional dual files were kept:
- Current runtime fallback path still executes `server/server.js` under plain Node when `server/dist/server.js` is absent.
- A rename-only move from `.js` to `.ts` for these utility modules breaks that fallback path before the backend entrypoint and runtime policy migration are complete.

Validation:
- `npm --workspace server run typecheck` -> pass
- `node --import tsx --test server/broadcastUtils.test.js` -> pass
- `node --import tsx --test server/activities/activityRegistry.test.js` -> pass
- `npm run typecheck --workspaces --if-present` -> pass
- `npm --workspace server test` -> pass (run outside sandbox; `35` pass, `0` fail)
- `npm run verify:server` -> pass (run outside sandbox; health check OK and smoke test passed)

Notes:
- In sandboxed execution, `verify:server` still requires escalation because binding to `0.0.0.0:4010` is restricted.
- Next Phase 3 slice should migrate additional backend modules and then remove dual-file compatibility once `server/server.ts` + compiled runtime path are the default.

### Slice 2: Session management core modules (transitional)

Completed:
- Added TypeScript counterparts for Phase 3 session-management modules:
  - `server/core/sessionCache.ts`
  - `server/core/valkeyStore.ts`
  - `server/core/sessions.ts`
- Kept existing JavaScript runtime modules in place for now:
  - `server/core/sessionCache.js`
  - `server/core/valkeyStore.js`
  - `server/core/sessions.js`

Implementation notes:
- `server/core/sessions.ts` now includes explicit session-shape normalization (`toSessionRecord`) when reading from Valkey-backed APIs.
- `server/core/valkeyStore.ts` uses a typed constructor cast for `ioredis` in this NodeNext setup so strict typecheck remains green.

Validation:
- `npm --workspace server run typecheck` -> pass
- `npm --workspace server test` -> pass (`35` pass, `0` fail)
- `npm run verify:server` -> pass
- `npm run typecheck --workspaces --if-present` -> pass
- `npm test` -> pass (run outside sandbox; full root flow green including `verify:deploy` and `verify:server`)

Notes:
- Running root `npm test` inside sandbox still reproduces known bind-limited failures on server suites that open sockets; escalated run is canonical in this environment.

### Slice 3: WebSocket + persistent-session core modules (transitional)

Completed:
- Added TypeScript counterparts for Phase 3 WebSocket/persistent-session core modules:
  - `server/core/wsRouter.ts`
  - `server/core/persistentSessions.ts`
  - `server/core/persistentSessionWs.ts`
- Kept existing JavaScript runtime modules in place for now:
  - `server/core/wsRouter.js`
  - `server/core/persistentSessions.js`
  - `server/core/persistentSessionWs.js`

Implementation notes:
- Exported `SessionRecord` and `SessionStore` types from `server/core/sessions.ts` so new TS modules can reference shared session-store contracts without duplicate-type incompatibilities.
- Added a typed adapter layer in `persistentSessions.ts` when initializing `ValkeyPersistentStore`, preserving runtime behavior while satisfying strict typing.
- In `wsRouter.ts`, explicit header nullability checks were added for forwarded-header parsing to satisfy strict null checks without behavior changes.

Validation:
- `npm --workspace server run typecheck` -> pass
- `npm --workspace server test` -> pass (`35` pass, `0` fail)
- `npm run verify:server` -> pass
- `npm run typecheck --workspaces --if-present` -> pass
- `npm test` -> pass (run outside sandbox; full root flow green)

Notes:
- Directly running some socket-opening server tests in sandbox still fails intermittently due environment port restrictions; the canonical `npm --workspace server test` and root `npm test` results were captured from successful full-suite runs and escalated root verification.

### Slice 4: Routes + activity registry modules (transitional)

Completed:
- Added TypeScript counterparts for Phase 3 route/registry modules:
  - `server/routes/statusRoute.ts`
  - `server/routes/persistentSessionRoutes.ts`
  - `server/activities/activityRegistry.ts`
- Added focused TS migration coverage:
  - `server/routesRegistry.contract.test.ts`
- Kept existing JavaScript runtime modules in place for now:
  - `server/routes/statusRoute.js`
  - `server/routes/persistentSessionRoutes.js`
  - `server/activities/activityRegistry.js`

Implementation notes:
- Typed cookie parsing and request/query guards were added in `persistentSessionRoutes.ts` to keep behavior stable under strict TypeScript checks.
- `statusRoute.ts` uses explicit route/store/client interfaces and typed status payload assembly (including Valkey telemetry parsing) without changing endpoint behavior.
- `activityRegistry.ts` preserves mixed-extension config discovery and server-entry extension fallback (`.ts`/`.js`) with strict-safe module loading.

Validation:
- `npm --workspace server run typecheck` -> pass
- `node --import tsx --test server/routesRegistry.contract.test.ts` -> pass
- `node --import tsx --test server/activities/activityRegistry.test.js` -> pass
- `npm --workspace server test` -> pass (outside sandbox; `38` pass, `0` fail)
- `npm run typecheck --workspaces --if-present` -> pass

Notes:
- Server tests executed with `tsx` now exercise TS counterparts when `.js` specifiers have colocated `.ts` files, which provides migration coverage before runtime entrypoint cutover.

### Slice 5: Server entrypoint migration (transitional runtime fallback retained)

Completed:
- Added TypeScript server entrypoint:
  - `server/server.ts`
- Aligned supporting TS interfaces to match runtime behavior used by shutdown/startup paths:
  - `server/core/wsRouter.ts` (`wss.close`, websocket `once/close`, broadcast payload narrowing)
  - `server/core/sessions.ts` (`sessionId` nullable in WebSocket client shape)
  - `server/core/persistentSessionWs.ts` (`sessionId` nullable socket field)
  - `server/core/valkeyStore.ts` (`pttl` client method for status route compatibility)

Implementation notes:
- `server/server.ts` preserves existing startup behavior (session store init, registry bootstrapping, persistent session routes, status route, Vite proxy in dev, graceful shutdown).
- Runtime remains transitional by design: `server/package.json` start script still prefers compiled `dist/server.js` and falls back to `server.js` when dist output is absent.
- Deployment/architecture docs were updated to reflect that `server/server.ts` now emits `server/dist/server.js` when server build runs.

Validation:
- `npm --workspace server run typecheck` -> pass
- `npm --workspace server test` -> pass (outside sandbox; `38` pass, `0` fail)
- `npm run verify:server` -> pass (outside sandbox; health check OK and smoke test passed)

Notes:
- Root `scripts/verify-server.js` still intentionally targets `server/server.js` during this migration window; compile-to-dist verification remains covered by server build + start script behavior and root `npm test` flow.

### Slice 6: Server utility scripts migration (transitional)

Completed:
- Added TypeScript counterparts for Valkey utility scripts:
  - `server/test-valkey.ts`
  - `server/monitor-valkey.ts`
- Updated server script commands to prefer TS versions with JS fallback:
  - `server/package.json` -> `test:valkey`, `monitor:valkey`

Implementation notes:
- Both scripts use typed constructor/client shims for `ioredis` in the NodeNext strict setup (matching Phase 3 `ioredis` typing strategy).
- JS script files remain in place as fallback during migration.

Validation:
- `npm --workspace server run typecheck` -> pass
- `npm --workspace server test` -> pass (outside sandbox; `38` pass, `0` fail)
- `npm test` -> pass (outside sandbox; full root flow green including `verify:server`)

### Slice 7: Backend test migration kickoff (partial)

Completed:
- Converted first backend test file from JS to TS:
  - `server/broadcastUtils.test.js` -> `server/broadcastUtils.test.ts`

Implementation notes:
- Preserved existing `[TEST]` noisy-output marker in converted test to keep expected send-error logging clearly labeled.
- Test discovery remains unchanged (`*.test.js` + `*.test.ts`) while migration proceeds file-by-file.

Validation:
- `npm --workspace server run typecheck` -> pass
- `npm --workspace server test` -> pass (outside sandbox; `38` pass, `0` fail)
- `npm test` -> pass (outside sandbox; full root flow green)

### Slice 7: Backend test migration completion

Completed:
- Converted remaining backend tests from JS to TS:
  - `server/statusRoute.test.js` -> `server/statusRoute.test.ts`
  - `server/sessionStore.test.js` -> `server/sessionStore.test.ts`
  - `server/persistentSessionRoutes.test.js` -> `server/persistentSessionRoutes.test.ts`
  - `server/galleryWalkRoutes.test.js` -> `server/galleryWalkRoutes.test.ts`
  - `server/activities/activityRegistry.test.js` -> `server/activities/activityRegistry.test.ts`

Implementation notes:
- Added typed response-body helpers in migrated HTTP route tests (`statusRoute`, `galleryWalkRoutes`) to satisfy strict `Response.json()` `unknown` behavior without changing assertions.
- Kept/retained explicit `[TEST]` log markers in expected noisy/error-path tests so intentional warning/error output remains distinguishable.
- In `activityRegistry.test.ts`, added typed dynamic-import helpers and removed unused test-context parameters to satisfy strict/no-unused TS settings.

Validation:
- `npm --workspace server run typecheck` -> pass
- `npm --workspace server test` -> pass (`38` pass, `0` fail)
- `npm run verify:server` -> pass
- `npm test` -> pass (root verification chain green)

Notes:
- Server backend test migration target for Phase 3 (`server/**/*.test.js` -> `.test.ts`) is now complete.

### Slice 8: Runtime cutover + backend JS fallback cleanup

Completed:
- Removed legacy backend JS source duplicates now covered by TS equivalents:
  - `server/server.js`
  - `server/activities/activityRegistry.js`
  - `server/core/{broadcastUtils,persistentSessionWs,persistentSessions,sessionCache,sessionNormalization,sessions,valkeyStore,wsRouter}.js`
  - `server/routes/{statusRoute,persistentSessionRoutes}.js`
  - `server/{test-valkey,monitor-valkey}.js`
- Updated runtime/start scripts to rely on TS entrypoint fallback instead of `server.js`:
  - `server/package.json`:
    - `start`: `dist/server.js` -> fallback `node --import tsx server.ts`
    - `dev`: direct TS runtime (`node --import tsx server.ts`)
    - `test:valkey` / `monitor:valkey`: TS-only script targets
    - `main`: `dist/server.js`
- Updated root server smoke verification script:
  - `scripts/verify-server.js` now boots `server/dist/server.js` when present, otherwise `node --import tsx server/server.ts`.

Documentation updates (runtime/deploy impact):
- `README.md` runtime note added for `npm run start` fallback behavior.
- `ARCHITECTURE.md` updated to remove `server.js` fallback entrypoint reference and point registry reference to `activityRegistry.ts`.
- `DEPLOYMENT.md` updated from transitional `server.js` fallback wording to current dist-first + TS fallback policy.

Validation:
- `npm --workspace server run typecheck` -> pass
- `npm --workspace server test` -> pass (`38` pass, `0` fail)
- `npm run verify:server` -> pass
- `npm test` -> pass (root verification chain green)

Notes:
- This slice supersedes earlier transitional notes that depended on keeping backend `.js` source fallbacks during Phase 3.

## Phase 4 Progress (Frontend Migration)

### Slice 1: CSV utility migration kickoff

Completed:
- Converted client utility module:
  - `client/src/utils/csvUtils.js` -> `client/src/utils/csvUtils.ts`
- Added utility test coverage:
  - `client/src/utils/csvUtils.test.js`

Implementation notes:
- Added explicit TS signatures for `escapeCsvCell`, `arrayToCsv`, and `downloadCsv` without changing runtime behavior.
- Added `downloadCsv` behavior test with lightweight `document`/`URL` mocks under Node test runtime.
- Kept the new test file as `.js` for this slice because client workspace TypeScript config currently scopes `types` to `vite/client`; converting Node runner tests to `.ts` will need either per-file Node type references or a test-type strategy update in a later frontend test-migration slice.

Validation:
- `npm --workspace client test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass

### Follow-up: WebSocket type canonicalization

Completed:
- Removed duplicate `ActiveBitsWebSocket`/`WsRouter` declarations from `server/core/wsRouter.ts`.
- Switched `wsRouter` to import canonical websocket contracts from `types/websocket.ts`.
- Expanded canonical `types/websocket.ts` to include:
  - shared `WsConnectionHandler` type
  - `wss.close(callback?)` support used by graceful shutdown paths

Validation:
- `npm --workspace server run typecheck` -> pass
- `npm --workspace server test` -> pass (`38` pass, `0` fail)

### Follow-up: Express locals session-store typing cleanup

Completed:
- Removed unsafe cast in server bootstrap:
  - `app.locals.sessions = sessions as unknown as never` -> `app.locals.sessions = sessions`
- Aligned shared session contracts with server runtime store capabilities:
  - Expanded `types/session.ts` `SessionStore` signature (ttl-aware `set`, boolean-returning `touch`/`delete`, required `getAll`/`close`, optional broadcast/cache hooks).
- Made backend store contract explicitly extend shared session contract:
  - `server/core/sessions.ts` now imports shared `Session`/`SessionStore` types and extends them for server-specific fields.

Validation:
- `npm --workspace server run typecheck` -> pass
- `npm run typecheck --workspaces --if-present` -> pass
- `npm --workspace server test` -> pass (`38` pass, `0` fail)

### Slice 2: Activity registry migration (`client/src/activities/index`)

Completed:
- Converted frontend activity registry module:
  - `client/src/activities/index.js` -> `client/src/activities/index.ts`
- Aligned shared activity typing with lazy-loaded registry behavior:
  - Added `ActivityRenderableComponent` in `types/activity.ts`
  - Updated `ActivityRegistryEntry` component fields to use canonical renderable component typing
  - Expanded `ActivityConfig` shape to cover currently used config metadata fields

Implementation notes:
- Preserved mixed-extension discovery behavior for migration overlap:
  - configs: `@activities/*/activity.config.{js,ts}` with `.ts` preference
  - client entries: `@activities/*/client/index.{js,jsx,ts,tsx}` with `.tsx`/`.ts` preference
- Kept existing runtime semantics for dev-only filtering, missing-module warnings, and lazy component loading.
- Added explicit `ActivityRegistryEntry | null` map typing before filter narrowing to satisfy strict type inference.

Validation:
- `npm --workspace client test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass
- `npm test` -> pass (full root verification chain green)

### Slice 3: Hook migration kickoff (`client/src/hooks/useClipboard`)

Completed:
- Converted clipboard hook:
  - `client/src/hooks/useClipboard.js` -> `client/src/hooks/useClipboard.ts`
- Added focused hook-logic unit tests:
  - `client/src/hooks/useClipboard.test.ts`

Implementation notes:
- Added explicit hook result and dependency typing (`UseClipboardResult`, `ClipboardCopyDependencies`).
- Extracted clipboard/timer mutation logic into `copyTextWithReset(...)` so behavior is testable under the existing Node test runtime (without adding browser-test tooling).
- Preserved runtime behavior:
  - no-op/false on missing text
  - write to clipboard + copied-state tracking
  - reset timer replacement when copying repeatedly
  - graceful error path with console logging

Validation:
- `npm --workspace client test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass
- `npm test` -> pass (full root verification chain green)

### Slice 4: Hook migration (`client/src/hooks/useSessionEndedHandler`)

Completed:
- Converted session-ended handler hook:
  - `client/src/hooks/useSessionEndedHandler.js` -> `client/src/hooks/useSessionEndedHandler.ts`
- Added focused parsing helper tests:
  - `client/src/hooks/useSessionEndedHandler.test.ts`

Implementation notes:
- Added explicit hook/websocket typing:
  - `WebSocketMessageEventLike`, `WebSocketMessageTargetLike`, `SessionEndedWebSocketRef`
- Extracted `isSessionEndedMessageData(...)` helper to isolate message parsing behavior for Node-based unit testing.
- Preserved hook behavior:
  - attach/remove `message` listeners per socket instance
  - navigate to `/session-ended` on `{"type":"session-ended"}`
  - ignore non-JSON messages while retaining dev-only debug logging via `import.meta.env?.DEV`

Validation:
- `npm --workspace client test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass

### Slice 5: Hook migration (`client/src/hooks/useResilientWebSocket`)

Completed:
- Converted resilient websocket hook:
  - `client/src/hooks/useResilientWebSocket.js` -> `client/src/hooks/useResilientWebSocket.ts`
- Added focused helper coverage:
  - `client/src/hooks/useResilientWebSocket.test.ts`

Implementation notes:
- Added explicit options/return typing:
  - `UseResilientWebSocketOptions`, `UseResilientWebSocketResult`
- Extracted pure helper functions:
  - `resolveWebSocketUrl(...)`
  - `getReconnectDelay(...)`
- Preserved runtime behavior:
  - optional URL builder callback or static URL
  - reconnect backoff with max delay cap
  - manual close suppression of reconnect
  - callback refs for `onOpen`/`onMessage`/`onClose`/`onError`

Validation:
- `npm --workspace client test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass
- `npm --workspace client run build` -> pass

### Slice 6: UI component migration (`Button`, `Modal`, `RosterPill`)

Completed:
- Converted shared UI components:
  - `client/src/components/ui/Button.jsx` -> `client/src/components/ui/Button.tsx`
  - `client/src/components/ui/Modal.jsx` -> `client/src/components/ui/Modal.tsx`
  - `client/src/components/ui/RosterPill.jsx` -> `client/src/components/ui/RosterPill.tsx`
- Added focused component tests:
  - `client/src/components/ui/Button.test.tsx`
  - `client/src/components/ui/Modal.test.tsx`
  - `client/src/components/ui/RosterPill.test.tsx`
- Added helper module for button variant styling:
  - `client/src/components/ui/buttonStyles.ts`

Implementation notes:
- Preserved existing runtime behavior and props semantics for all three components.
- Added explicit props typing for button HTML attributes, modal open/close contract, and roster rename/remove callbacks.
- Moved `resolveButtonVariantClass(...)` into `buttonStyles.ts` to avoid `react-refresh/only-export-components` lint warning in `Button.tsx`.

Validation:
- Baseline preflight: `npm --workspace client test` -> pass
- `npm --workspace client test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass
- `npm --workspace client run build` -> pass

### Slice 7: Common component migration (`LoadingFallback`, `SessionEnded`)

Completed:
- Converted common components:
  - `client/src/components/common/LoadingFallback.jsx` -> `client/src/components/common/LoadingFallback.tsx`
  - `client/src/components/common/SessionEnded.jsx` -> `client/src/components/common/SessionEnded.tsx`
- Added focused component tests:
  - `client/src/components/common/LoadingFallback.test.tsx`
  - `client/src/components/common/SessionEnded.test.tsx`

Implementation notes:
- Added explicit prop typing for fallback message and modal-like session-ended content.
- Preserved existing SessionEnded route behavior (`navigate('/')` on button click) while typing `useNavigate` flow.
- SessionEnded test uses `MemoryRouter` so `useNavigate` works in a static render test environment.

Validation:
- `npm --workspace client test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass
- `npm --workspace client run build` -> pass

### Slice 8: Common component migration (`QrScannerPanel`, `ActivityRoster`)

Completed:
- Converted common components:
  - `client/src/components/common/QrScannerPanel.jsx` -> `client/src/components/common/QrScannerPanel.tsx`
  - `client/src/components/common/ActivityRoster.jsx` -> `client/src/components/common/ActivityRoster.tsx`
- Added scanner utility module + tests:
  - `client/src/components/common/qrScannerUtils.ts`
  - `client/src/components/common/qrScannerUtils.test.ts`
- Added roster component tests:
  - `client/src/components/common/ActivityRoster.test.tsx`

Implementation notes:
- Extracted scanner error mapping/message logic to `qrScannerUtils.ts` so camera-error behavior is testable without running camera/web scanner hooks in Node.
- Added explicit types for roster rows/columns, sort handlers, and accent/sort-direction options.
- Preserved runtime behavior for focus trap, escape-close handling, and QR scanner fallback message rendering.

Validation:
- `npm --workspace client test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass
- `npm --workspace client run build` -> pass

### Slice 9: Common component migration (`SessionHeader`)

Completed:
- Converted common component:
  - `client/src/components/common/SessionHeader.jsx` -> `client/src/components/common/SessionHeader.tsx`
- Added component tests:
  - `client/src/components/common/SessionHeader.test.tsx`

Implementation notes:
- Added explicit props typing for `activityName`, optional `sessionId`, `simple`, and async/sync `onEndSession`.
- Kept existing end-session behavior (DELETE request then optional callback then navigate to `/manage`).
- Added a safe `window` guard for join URL derivation to avoid SSR/test runtime crashes when `window` is unavailable.

Validation:
- `npm --workspace client test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass
- `npm --workspace client run build` -> pass

### Slice 10: Common component migration (`WaitingRoom`)

Completed:
- Converted common component:
  - `client/src/components/common/WaitingRoom.jsx` -> `client/src/components/common/WaitingRoom.tsx`
- Added waiting-room utility module + tests:
  - `client/src/components/common/waitingRoomUtils.ts`
  - `client/src/components/common/waitingRoomUtils.test.ts`

Implementation notes:
- Added explicit prop typing for persistent-session waiting room inputs.
- Extracted reusable logic for:
  - waiter-count copy generation
  - websocket URL construction
  - websocket message parsing + shape validation (`isWaitingRoomMessage`)
- Preserved behavior for teacher auto-auth, one-time navigation flow, and websocket lifecycle handling.

Validation:
- `npm --workspace client test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass
- `npm --workspace client run build` -> pass

### Slice 11: Common component migration (`StatusDashboard`)

Completed:
- Converted common component:
  - `client/src/components/common/StatusDashboard.jsx` -> `client/src/components/common/StatusDashboard.tsx`
- Added extracted utility module + tests:
  - `client/src/components/common/statusDashboardUtils.ts`
  - `client/src/components/common/statusDashboardUtils.test.ts`

Implementation notes:
- Added explicit `StatusPayload` typing for `/api/status` response handling in the dashboard component.
- Moved formatting/session-row derivation logic to typed pure helpers (`fmtInt`, `fmtBytes`, `buildByTypeEntries`, `buildSessionRows`) for deterministic Node-runner test coverage.
- Preserved runtime behavior for polling cadence, pause/resume controls, Valkey summary rendering, and sessions table sorting.

Validation:
- `npm --workspace client test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass

### Slice 12: Common component migration (`ManageDashboard`)

Completed:
- Converted common component:
  - `client/src/components/common/ManageDashboard.jsx` -> `client/src/components/common/ManageDashboard.tsx`
- Added extracted utility module + tests:
  - `client/src/components/common/manageDashboardUtils.ts`
  - `client/src/components/common/manageDashboardUtils.test.ts`

Implementation notes:
- Added explicit typing for persistent-session API payloads (`list`, `create`, session creation) and dashboard state.
- Extracted deep-link parsing/normalization/serialization helpers (`parseDeepLinkOptions`, `normalizeSelectedOptions`, `buildQueryString`, `describeSelectedOptions`) to keep the component focused on UI state transitions.
- Preserved existing behavior for session creation, persistent-link creation, teacher-code visibility toggling, solo-link generation, and CSV export.

Validation:
- `npm --workspace client test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass

### Slice 13: Common component migration (`SessionRouter`)

Completed:
- Converted common component:
  - `client/src/components/common/SessionRouter.jsx` -> `client/src/components/common/SessionRouter.tsx`
- Added extracted utility module + tests:
  - `client/src/components/common/sessionRouterUtils.ts`
  - `client/src/components/common/sessionRouterUtils.test.ts`

Implementation notes:
- Added explicit route/session/persistent payload typing for the mixed route flow (`/:sessionId`, `/activity/:activityName/:hash`, `/solo/:soloActivityId`).
- Extracted localStorage cache maintenance and persistent-query helpers (`cleanExpiredSessions`, `readCachedSession`, `getPersistentQuerySuffix`, `isJoinSessionId`) to keep component logic focused on navigation/render decisions.
- Preserved existing behavior for persistent-session waiting-room flow, teacher-auth fallback, session cache reuse, and solo-mode launch cards.

Validation:
- `npm --workspace client test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass

### Slice 14: Frontend entrypoint migration (`App`, `main`)

Completed:
- Converted frontend entrypoints:
  - `client/src/App.jsx` -> `client/src/App.tsx`
  - `client/src/main.jsx` -> `client/src/main.tsx`
- Added route/footer helper module + tests:
  - `client/src/appUtils.ts`
  - `client/src/appUtils.test.ts`

Implementation notes:
- Added typed footer activity selection (`findFooterActivity`) so route/footer rendering logic is validated outside the component shell.
- Preserved dynamic activity route generation and lazy manager/footer rendering behavior while adding explicit component casts for unknown-prop registry components.
- Added explicit root-element null guard in `main.tsx` before `createRoot(...)`.

Validation:
- `npm --workspace client test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass

### Slice 15: Client test migration completion (`*.test.js` -> `*.test.ts`)

Completed:
- Converted remaining client JS tests:
  - `client/src/activities/index.test.js` -> `client/src/activities/index.test.ts`
  - `client/src/utils/csvUtils.test.js` -> `client/src/utils/csvUtils.test.ts`

Implementation notes:
- Added explicit typing for activity config dynamic imports and filesystem path helpers in `activities/index.test.ts`.
- Tightened CSV download test mocks with typed document/URL stubs while preserving existing behavior assertions.
- Client test discovery script remains mixed-extension-compatible, but client `src` now contains no `.js/.jsx` files.

Validation:
- `npm --workspace client test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass

## Phase 5 Progress (Activities Migration)

### Slice 1: Activity migration (`activities/raffle`)

Completed:
- Migrated raffle activity config/client/server files to TypeScript:
  - `activities/raffle/activity.config.js` -> `activities/raffle/activity.config.ts`
  - `activities/raffle/client/index.jsx` -> `activities/raffle/client/index.tsx`
  - `activities/raffle/client/manager/RaffleLink.jsx` -> `activities/raffle/client/manager/RaffleLink.tsx`
  - `activities/raffle/client/manager/RaffleManager.jsx` -> `activities/raffle/client/manager/RaffleManager.tsx`
  - `activities/raffle/client/manager/TicketsList.jsx` -> `activities/raffle/client/manager/TicketsList.tsx`
  - `activities/raffle/client/manager/WinnerMessage.jsx` -> `activities/raffle/client/manager/WinnerMessage.tsx`
  - `activities/raffle/client/student/TicketPage.jsx` -> `activities/raffle/client/student/TicketPage.tsx`
  - `activities/raffle/server/routes.js` -> `activities/raffle/server/routes.ts`
- Added typed raffle selection utilities and tests:
  - `activities/raffle/client/manager/raffleUtils.ts`
  - `activities/raffle/client/manager/raffleUtils.test.ts`

Implementation notes:
- Preserved existing raffle session lifecycle behavior (create session, ticket generation/listing, websocket subscriber updates).
- Extracted winner-selection logic to `raffleUtils.ts` so group/pair/standard draw rules are tested directly.
- Added `@src/*` alias in `activities/tsconfig.json` for TS activity files that import shared client hooks/components.

Validation:
- `npm --workspace activities test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass

### Slice 5: Activity migration follow-up (`activities/java-format-practice`, client utility modules)

Completed:
- Migrated Java Format Practice client utility modules to TypeScript:
  - `activities/java-format-practice/client/utils/safeEvaluator.js` -> `activities/java-format-practice/client/utils/safeEvaluator.ts`
  - `activities/java-format-practice/client/utils/validationUtils.js` -> `activities/java-format-practice/client/utils/validationUtils.ts`
  - `activities/java-format-practice/client/utils/stringUtils.js` -> `activities/java-format-practice/client/utils/stringUtils.ts`
  - `activities/java-format-practice/client/utils/formatUtils.js` -> `activities/java-format-practice/client/utils/formatUtils.ts`
- Updated dependent imports to extensionless paths where needed during mixed JS/TS migration:
  - `activities/java-format-practice/client/challenges.js`
  - `activities/java-format-practice/client/utils/formatUtils.test.js`
  - `activities/java-format-practice/client/utils/stringUtils.test.js`

Implementation notes:
- Utility conversions kept runtime behavior intact while adding strict-safe parameter/return typing and `noUncheckedIndexedAccess` handling for tokenizer/format-parser loops.
- Existing JS tests for format/string utility behavior were intentionally retained and continue running through the mixed-extension activities test command.

Validation:
- `npm --workspace activities run typecheck` -> pass
- `npm --workspace activities test` -> pass
- `npm --workspace client test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass

### Slice 5: Activity migration follow-up (`activities/java-format-practice`, small client components)

Completed:
- Migrated small reusable client components to TSX:
  - `activities/java-format-practice/client/components/ChallengeQuestion.jsx` -> `activities/java-format-practice/client/components/ChallengeQuestion.tsx`
  - `activities/java-format-practice/client/components/ChallengeSelector.jsx` -> `activities/java-format-practice/client/components/ChallengeSelector.tsx`
  - `activities/java-format-practice/client/components/StatsPanel.jsx` -> `activities/java-format-practice/client/components/StatsPanel.tsx`
  - `activities/java-format-practice/client/components/ReferenceModal.jsx` -> `activities/java-format-practice/client/components/ReferenceModal.tsx`
- Added focused component regression coverage:
  - `activities/java-format-practice/client/components/basicComponents.test.tsx`

Implementation notes:
- Components now consume shared activity type contracts (`JavaFormatDifficulty`, `JavaFormatTheme`, `JavaFormatStats`) and keep behavior unchanged.
- `ReferenceModal.tsx` now uses explicit section/item typing for table/list reference content and includes typed click handling for modal propagation.
- Under current activities test runtime (`node --import tsx --import ../scripts/jsx-loader-register.mjs`), converted TSX files still require `React` in scope; explicit `React` imports were retained in converted components for runtime compatibility.

Validation:
- `npm --workspace activities run typecheck` -> pass
- `npm --workspace activities test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass

### Slice 5: README simplification (human-facing index)

Completed:
- Rewrote root README to be a simple, human-facing project description with documentation links only:
  - `README.md`

Implementation notes:
- Removed operational command blocks, implementation details, and long runtime/deployment specifics from `README.md`.
- Removed code snippets and technical deep-dives from `README.md` in favor of linking to canonical docs (`ADDING_ACTIVITIES.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`, and algorithm-demo docs).
- Preserved the public student/instructor access URLs in a short access section.
- `activities/algorithm-demo/QUICKSTART.md` was intentionally left unchanged for this slice.

Validation:
- Documentation path/link spot-checks for all linked local docs -> pass.
- README content scan confirms no code blocks or command snippets remain.

## Phase 5 Progress (Activities Migration)

### Slice 8: Activity hardening follow-up (`activities/algorithm-demo`, algorithmState normalization)

Completed:
- Hardened algorithm-demo session/request normalization to reject array `algorithmState` payloads:
  - `activities/algorithm-demo/server/routes.ts`
- Added regression coverage for array payload coercion:
  - `activities/algorithm-demo/server/routes.test.ts`

Implementation notes:
- Added `normalizeAlgorithmState(value)` helper requiring a plain object (`typeof === 'object' && !Array.isArray(...)`) and defaulting to `{}`.
- Applied helper in:
  - session normalization (`getSessionData`)
  - select route (`POST /api/algorithm-demo/:sessionId/select`)
  - state route (`POST /api/algorithm-demo/:sessionId/state`)
- This keeps runtime shape aligned with declared `Record<string, unknown>` intent and avoids array-to-record coercion side effects.

Validation:
- `npm --workspace activities test` -> pass (`54` pass, `0` fail).

### Slice 9: Activity hardening follow-up (`activities/java-format-practice`, safe evaluator string-literal guards)

Completed:
- Fixed expression validation to avoid false array/object-literal rejection when `[` or `{` appear only inside quoted strings:
  - `activities/java-format-practice/client/utils/safeEvaluator.ts`
- Added focused regression tests:
  - `activities/java-format-practice/client/utils/safeEvaluator.test.ts`

Implementation notes:
- `validateExpressionSyntax` now checks the array/object literal regex against `exprToCheck` (string literals stripped), not the raw `expr`.
- New tests assert quoted bracket/brace characters are allowed while actual array/object literal inputs are still rejected.

Validation:
- `npm --workspace activities run typecheck` -> pass.
- `npm --workspace activities test` -> pass (`55` pass, `0` fail).

## Phase 6 Progress (Scripts and Tooling Migration)

### Slice 4: Documentation hardening (runtime/tooling policy clarity)

Completed:
- Tightened deployment/runtime documentation for post-migration conventions:
  - `DEPLOYMENT.md`
  - `README.md`
- Standardized remaining architecture/docs code fences to TypeScript-first where examples describe TS modules:
  - `ARCHITECTURE.md`
  - `ADDING_ACTIVITIES.md`
  - `ALGORITHM_DEMO_IMPLEMENTATION.md`
  - `activities/algorithm-demo/README.md`
  - `activities/algorithm-demo/EXTENSION_GUIDE.md`

Implementation notes:
- `DEPLOYMENT.md` now presents one TypeScript-first Render build/start command pair and no longer includes a legacy JS-era build command example.
- Deployment prerequisites now align with migration baseline (`Node.js 22+`).
- `README.md` now explicitly calls out intentional tooling exceptions (`server/eslint.config.js`, `activities/eslint.config.js`) for ESLint config compatibility.
- Architecture and algorithm-demo docs no longer use `javascript`/`jsx` fences for TypeScript-oriented examples.

Validation:
- `rg -n 'activity\.config\.js|client/index\.js|client/index\.jsx|server/routes\.js|algorithms/index\.js|index\.test\.js|utils\.test\.js|SelectionSort\.jsx|BinarySearch\.jsx|Factorial\.jsx|BinarySearchGame\.jsx|App\.jsx|vite\.config\.js|verify-server\.js|```javascript|```jsx' README.md DEPLOYMENT.md ARCHITECTURE.md ADDING_ACTIVITIES.md ALGORITHM_DEMO_IMPLEMENTATION.md activities/algorithm-demo/README.md activities/algorithm-demo/QUICKSTART.md activities/algorithm-demo/EXTENSION_GUIDE.md` -> no matches.
- Root script references used in docs remain valid:
  - `node -e "...required scripts present..."` for `deploy,start,test,verify:server,typecheck` -> pass.
- Concrete path spot-check for referenced files -> pass.

### Slice 2: Documentation alignment (TypeScript-first examples)

Completed:
- Updated required migration docs to replace stale JS/JSX path references with current TS/TSX equivalents:
  - `ADDING_ACTIVITIES.md`
  - `ALGORITHM_DEMO_IMPLEMENTATION.md`
  - `activities/algorithm-demo/README.md`
  - `activities/algorithm-demo/EXTENSION_GUIDE.md`
  - `ARCHITECTURE.md`
- Kept runtime-safe backend import guidance in examples where NodeNext resolution expects `.js` specifiers at runtime (for example `activebits-server/core/sessions.js` and `activebits-server/core/sessionNormalization.js` in `.ts` route modules).

Implementation notes:
- `ADDING_ACTIVITIES.md` now uses TypeScript-first example filenames (`.ts`/`.tsx`) for activity config, client entry, manager/student components, and server routes.
- `ARCHITECTURE.md` now references `activity.config.ts`, `App.tsx`, and `client/vite.config.ts`, and updates client/server entry examples to TS filenames.
- Algorithm-demo docs now reflect current repository structure (`index.tsx`, `utils.ts`, `algorithms/index.ts`, `server/routes.ts`, `*.test.ts` / `*.test.tsx`) instead of pre-migration JS filenames.

Validation:
- `rg -n \"activity\\.config\\.js|client/index\\.js|client/index\\.jsx|server/routes\\.js|algorithms/index\\.js|index\\.test\\.js|utils\\.test\\.js|SelectionSort\\.jsx|BinarySearch\\.jsx|Factorial\\.jsx|BinarySearchGame\\.jsx|App\\.jsx|vite\\.config\\.js|server/core/sessions\\.ts\" ADDING_ACTIVITIES.md ALGORITHM_DEMO_IMPLEMENTATION.md activities/algorithm-demo/README.md activities/algorithm-demo/QUICKSTART.md activities/algorithm-demo/EXTENSION_GUIDE.md ARCHITECTURE.md DEPLOYMENT.md README.md` -> no stale migration-era file references found.
- Path spot-check for concrete referenced files -> pass (`client/src/activities/index.test.ts`, `server/activities/activityRegistry.test.ts`, and current `activities/algorithm-demo` TS paths).

## Phase 6 Progress (Scripts and Tooling Migration)

### Slice 1: Repo script migration (`scripts/verify-server`)

Completed:
- Migrated root server smoke verification script to TypeScript:
  - `scripts/verify-server.js` -> `scripts/verify-server.ts`
- Updated root script wiring to execute the TS script with `tsx`:
  - `package.json` (`verify:server` -> `node --import tsx scripts/verify-server.ts`)

Implementation notes:
- `verify-server.ts` preserves existing smoke-test behavior:
  - starts server on test port (default `4010`)
  - polls `/health-check` until ready timeout
  - prints buffered server output on early exit/failure
  - shuts down server with `SIGTERM` and exits non-zero on failure
- Remaining `.js` files in migration scope are tooling configs that currently require JS runtime compatibility:
  - `server/eslint.config.js`
  - `activities/eslint.config.js`

Validation:
- `npm run typecheck --workspaces --if-present` -> pass
- `npm test` -> pass (full root verification chain green, including `verify:deploy` and TS `verify:server`)

### Slice 5: Activity migration follow-up (`activities/java-format-practice`, server routes + shared types)

Completed:
- Migrated Java Format Practice server route modules to TypeScript:
  - `activities/java-format-practice/server/routes.js` -> `activities/java-format-practice/server/routes.ts`
  - `activities/java-format-practice/server/presetChallenges.js` -> `activities/java-format-practice/server/presetChallenges.ts`
- Added activity-local shared type contracts:
  - `activities/java-format-practice/javaFormatPracticeTypes.ts`
- Extracted typed route validation helpers and tests:
  - `activities/java-format-practice/server/routeUtils.ts`
  - `activities/java-format-practice/server/routeUtils.test.ts`
- Updated activity config server entry to TypeScript route module:
  - `activities/java-format-practice/activity.config.ts` (`serverEntry` -> `./server/routes.ts`)

Implementation notes:
- `routes.ts` now uses typed session normalization (`registerSessionNormalizer`) so existing persisted session payloads are safely coerced to expected defaults (`students`, `selectedDifficulty`, `selectedTheme`) without changing endpoint behavior.
- Student join/reconnect/disconnect websocket logic was kept behavior-equivalent while adding explicit socket/session typings and safe request-body guards.
- `presetChallenges.ts` remains behavior-equivalent to the former JS module; only strict-TS parameter typing was added for exported filter helpers.

Validation:
- `npm --workspace activities test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass
- `npm --workspace client test` -> pass
- `npm --workspace client run build` -> pass

### Slice 2: Activity migration kickoff (`activities/www-sim`, partial)

Completed:
- Migrated activity config and client entry module:
  - `activities/www-sim/activity.config.js` -> `activities/www-sim/activity.config.ts`
  - `activities/www-sim/client/index.jsx` -> `activities/www-sim/client/index.tsx`
- Added module-shape regression test:
  - `activities/www-sim/client/index.test.tsx`

Implementation notes:
- `www-sim` entry now exports typed `ActivityClientModule` with explicit component casts (`ComponentType<unknown>`) to align with shared registry contracts.
- This kickoff intentionally leaves `www-sim` manager/student/server route modules on JS for the next slice; runtime behavior is unchanged.

Validation:
- `npm --workspace activities test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass
- `npm --workspace client test` -> pass
- `npm --workspace client run build` -> pass

### Slice 2: Activity migration completion (`activities/www-sim`)

Completed:
- Completed `www-sim` activity migration from JS/JSX to TS/TSX:
  - `activities/www-sim/activity.config.ts` (server entry now points to TS route module)
  - `activities/www-sim/client/manager/WwwSimManager.jsx` -> `activities/www-sim/client/manager/WwwSimManager.tsx`
  - `activities/www-sim/client/student/WwwSim.jsx` -> `activities/www-sim/client/student/WwwSim.tsx`
  - `activities/www-sim/client/components/DNSLookupTable.jsx` -> `activities/www-sim/client/components/DNSLookupTable.tsx`
  - `activities/www-sim/client/components/StudentBrowserView.jsx` -> `activities/www-sim/client/components/StudentBrowserView.tsx`
  - `activities/www-sim/client/components/StudentHostPalette.jsx` -> `activities/www-sim/client/components/StudentHostPalette.tsx`
  - `activities/www-sim/client/components/StudentInfoPanel.jsx` -> `activities/www-sim/client/components/StudentInfoPanel.tsx`
  - `activities/www-sim/client/components/WwwSimInstructions.jsx` -> `activities/www-sim/client/components/WwwSimInstructions.tsx`
  - `activities/www-sim/server/presetPassages.js` -> `activities/www-sim/server/presetPassages.ts`
  - `activities/www-sim/server/routes.js` -> `activities/www-sim/server/routes.ts`
- Added shared activity-local type contracts:
  - `activities/www-sim/wwwSimTypes.ts`
- Added extracted server route helpers + tests:
  - `activities/www-sim/server/routeUtils.ts`
  - `activities/www-sim/server/routeUtils.test.ts`

Implementation notes:
- `www-sim` client manager/student/components now share explicit session/template/fragment contracts via `wwwSimTypes.ts` to reduce shape drift between UI and server payload handling.
- `www-sim` server route logic now normalizes request/session data with explicit guards in TS before mutating session state, while preserving existing endpoint and websocket behavior.
- Route helper extraction (`routeUtils.ts`) provides direct test coverage for hostname validation, passage splitting, hosting-map generation, and HTML template URL assignment behavior.

Validation:
- `npm --workspace activities test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass
- `npm --workspace client test` -> pass
- `npm --workspace client run build` -> pass
- `npm test` -> pass (full root verification chain green, including `verify:deploy` and `verify:server`)

### Slice 3: Activity migration (`activities/java-string-practice`)

Completed:
- Migrated Java String Practice activity config/client/server files to TypeScript:
  - `activities/java-string-practice/activity.config.js` -> `activities/java-string-practice/activity.config.ts`
  - `activities/java-string-practice/client/index.js` -> `activities/java-string-practice/client/index.ts`
  - `activities/java-string-practice/client/student/JavaStringPractice.jsx` -> `activities/java-string-practice/client/student/JavaStringPractice.tsx`
  - `activities/java-string-practice/client/manager/JavaStringPracticeManager.jsx` -> `activities/java-string-practice/client/manager/JavaStringPracticeManager.tsx`
  - `activities/java-string-practice/client/components/ChallengeQuestion.jsx` -> `activities/java-string-practice/client/components/ChallengeQuestion.tsx`
  - `activities/java-string-practice/client/components/AnswerSection.jsx` -> `activities/java-string-practice/client/components/AnswerSection.tsx`
  - `activities/java-string-practice/client/components/challengeLogic.js` -> `activities/java-string-practice/client/components/challengeLogic.ts`
  - `activities/java-string-practice/client/components/ChallengeSelector.jsx` -> `activities/java-string-practice/client/components/ChallengeSelector.tsx`
  - `activities/java-string-practice/client/components/StringDisplay.jsx` -> `activities/java-string-practice/client/components/StringDisplay.tsx`
  - `activities/java-string-practice/client/components/FeedbackDisplay.jsx` -> `activities/java-string-practice/client/components/FeedbackDisplay.tsx`
  - `activities/java-string-practice/client/components/StatsPanel.jsx` -> `activities/java-string-practice/client/components/StatsPanel.tsx`
  - `activities/java-string-practice/server/routes.js` -> `activities/java-string-practice/server/routes.ts`
- Added activity-local shared type contracts:
  - `activities/java-string-practice/javaStringPracticeTypes.ts`
- Added focused tests for migrated challenge/server logic:
  - `activities/java-string-practice/client/components/challengeLogic.test.ts`
  - `activities/java-string-practice/client/index.test.tsx`
  - `activities/java-string-practice/server/routeUtils.ts`
  - `activities/java-string-practice/server/routeUtils.test.ts`

Implementation notes:
- Manager/student UI now share typed challenge, stats, method-selection, and roster contracts through `javaStringPracticeTypes.ts`.
- Server route validation helpers were extracted into `routeUtils.ts` for direct unit coverage while preserving existing API and websocket behavior.
- `activity.config.ts` now points to TS entry modules (`client/index.ts`, `server/routes.ts`) while retaining solo-mode behavior and existing endpoint semantics.

Validation:
- `npm --workspace activities test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass
- `npm --workspace client test` -> pass
- `npm --workspace client run build` -> pass
- `npm test` -> pass (full root verification chain green, including `verify:deploy` and `verify:server`)

### Slice 4: Activity migration kickoff (`activities/algorithm-demo`, partial)

Completed:
- Converted activity config and client entry module to TypeScript:
  - `activities/algorithm-demo/activity.config.js` -> `activities/algorithm-demo/activity.config.ts`
  - `activities/algorithm-demo/client/index.jsx` -> `activities/algorithm-demo/client/index.tsx`
- Converted shared client utility and algorithm-registry modules with existing test coverage:
  - `activities/algorithm-demo/client/utils.js` -> `activities/algorithm-demo/client/utils.ts`
  - `activities/algorithm-demo/client/utils.test.js` -> `activities/algorithm-demo/client/utils.test.ts`
  - `activities/algorithm-demo/client/algorithms/index.js` -> `activities/algorithm-demo/client/algorithms/index.ts`
  - `activities/algorithm-demo/client/algorithms/index.test.js` -> `activities/algorithm-demo/client/algorithms/index.test.ts`
- Added client-module shape regression test:
  - `activities/algorithm-demo/client/index.test.ts`

Implementation notes:
- `activity.config.ts` now points `clientEntry` to `./client/index.tsx` while keeping `serverEntry` on `./server/routes.js` during this kickoff slice.
- `client/index.tsx` now exports typed `ActivityClientModule` with `ComponentType<unknown>` casts for manager/student components to match shared registry contracts.
- Shared utility/registry conversion keeps runtime behavior unchanged while adding strict TypeScript coverage around message envelope, state normalization/hydration, and algorithm registry validation.
- Manager/student views, individual algorithm JSX modules, and server routes remain JavaScript for the next `algorithm-demo` completion slice.

Validation:
- `npm --workspace activities run typecheck` -> pass
- `npm --workspace activities test` -> pass

### Slice 5: Activity migration kickoff (`activities/java-format-practice`, partial)

Completed:
- Migrated activity config and client entry module to TypeScript:
  - `activities/java-format-practice/activity.config.js` -> `activities/java-format-practice/activity.config.ts`
  - `activities/java-format-practice/client/index.js` -> `activities/java-format-practice/client/index.ts`
- Added client-module shape regression test:
  - `activities/java-format-practice/client/index.test.ts`

Implementation notes:
- `activity.config.ts` now points `clientEntry` to `./client/index.ts` while leaving `serverEntry` on `./server/routes.js` for this kickoff slice.
- `client/index.ts` now exports a typed `ActivityClientModule` with explicit `ComponentType<unknown>` casts for manager/student components, matching shared activity registry contracts.
- Remaining Java Format Practice client/server files stay on JS/JSX for the next completion slice.

Validation:
- `npm --workspace activities test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass

### Slice 4: Activity migration follow-up (`activities/algorithm-demo`, merge sort)

Completed:
- Converted merge sort visualizer module to TypeScript:
  - `activities/algorithm-demo/client/algorithms/sorting/MergeSort.jsx` -> `activities/algorithm-demo/client/algorithms/sorting/MergeSort.tsx`
- Updated algorithm registry import for merge sort module:
  - `activities/algorithm-demo/client/algorithms/index.ts`

Implementation notes:
- Merge sort conversion used incremental boundary typing (`AlgorithmViewProps` typing, typed event signature, typed refs, typed map/filter callbacks, CSS custom-property casts) while preserving the existing step machine and rendering behavior.
- Existing direct merge sort module-state regression tests remained green and continue to validate `initState` and `reduceEvent` behavior after conversion.
- With this slice, all algorithm-demo sorting/search/recursion/guessing visualizer modules are now on TS/TSX.

Validation:
- `npm --workspace activities run typecheck` -> pass
- `npm --workspace activities test` -> pass
- `npm test` -> pass (full root verification chain green, including `verify:deploy` and `verify:server`)

### Slice 4: Activity migration follow-up (`activities/algorithm-demo`, recursion/guessing + selection sort)

Completed:
- Converted recursion and guessing visualizer modules to TypeScript:
  - `activities/algorithm-demo/client/algorithms/recursion/Factorial.jsx` -> `activities/algorithm-demo/client/algorithms/recursion/Factorial.tsx`
  - `activities/algorithm-demo/client/algorithms/recursion/Fibonacci.jsx` -> `activities/algorithm-demo/client/algorithms/recursion/Fibonacci.tsx`
  - `activities/algorithm-demo/client/algorithms/guessing/BinarySearchGame.jsx` -> `activities/algorithm-demo/client/algorithms/guessing/BinarySearchGame.tsx`
- Converted selection sort visualizer module to TypeScript:
  - `activities/algorithm-demo/client/algorithms/sorting/SelectionSort.jsx` -> `activities/algorithm-demo/client/algorithms/sorting/SelectionSort.tsx`
- Updated algorithm registry imports for migrated modules:
  - `activities/algorithm-demo/client/algorithms/index.ts`
- Added focused regression tests for recursion/guessing modules:
  - `activities/algorithm-demo/client/algorithms/recursion/Factorial.test.ts`
  - `activities/algorithm-demo/client/algorithms/recursion/Fibonacci.test.ts`
  - `activities/algorithm-demo/client/algorithms/guessing/BinarySearchGame.test.ts`

Implementation notes:
- Recursion and guessing modules now use explicit state/event contracts while preserving existing step sequencing, pseudocode highlighting, and manager/student interaction behavior.
- `SelectionSort.tsx` now has strict-safe state and view typings (including CSS custom property typing for swap animation offsets) without behavior changes.
- The algorithm registry now resolves migrated selection/recursion/guessing modules through TS extensionless imports during the mixed-extension window.

Validation:
- `npm --workspace activities run typecheck` -> pass
- `npm --workspace activities test` -> pass
- `npm test` -> pass (full root verification chain green, including `verify:deploy` and `verify:server`)

### Slice 4: Activity migration follow-up (`activities/algorithm-demo`, insertion sort + sorting tests)

Completed:
- Converted insertion sort visualizer module to TypeScript:
  - `activities/algorithm-demo/client/algorithms/sorting/InsertionSort.jsx` -> `activities/algorithm-demo/client/algorithms/sorting/InsertionSort.tsx`
- Updated algorithm registry imports for insertion module:
  - `activities/algorithm-demo/client/algorithms/index.ts`
- Added focused sorting module-state tests:
  - `activities/algorithm-demo/client/algorithms/sorting/InsertionSort.test.ts`
  - `activities/algorithm-demo/client/algorithms/sorting/MergeSort.test.ts`

Implementation notes:
- `InsertionSort.tsx` now uses typed state/event/view contracts and typed CSS custom-property helpers for move/tmp animations while preserving step-by-step behavior.
- `MergeSort` remains `.jsx` in this slice to avoid bundling a very large strict-typing change; coverage still improved by adding direct `initState`/`reduceEvent` regression tests.
- Remaining algorithm-demo sorting migration work is now primarily `MergeSort.jsx` -> `MergeSort.tsx`.

Validation:
- `npm --workspace activities run typecheck` -> pass
- `npm --workspace activities test` -> pass
- `npm test` -> pass (full root verification chain green, including `verify:deploy` and `verify:server`)

### Slice 4: Activity migration follow-up (`activities/algorithm-demo`, search visualizers)

Completed:
- Converted search visualizer modules to TypeScript:
  - `activities/algorithm-demo/client/algorithms/search/LinearSearch.jsx` -> `activities/algorithm-demo/client/algorithms/search/LinearSearch.tsx`
  - `activities/algorithm-demo/client/algorithms/search/BinarySearch.jsx` -> `activities/algorithm-demo/client/algorithms/search/BinarySearch.tsx`
- Updated algorithm registry imports for migrated search modules:
  - `activities/algorithm-demo/client/algorithms/index.ts`
- Added focused regression tests for migrated search modules:
  - `activities/algorithm-demo/client/algorithms/search/LinearSearch.test.ts`
  - `activities/algorithm-demo/client/algorithms/search/BinarySearch.test.ts`

Implementation notes:
- Both search modules now use typed state/event/view contracts while preserving existing step progression, pseudocode highlighting, and manager/student interactions.
- Input parsing was normalized to explicit numeric parsing helpers to keep TS state updates predictable without changing runtime behavior.
- `initState` exports are cast to the shared `AlgorithmModule` contract to keep mixed algorithm signatures compatible during migration.
- Remaining algorithm visualizer modules (`sorting`, `recursion`, `guessing`) remain JavaScript for the next completion slice.

Validation:
- `npm --workspace activities run typecheck` -> pass
- `npm --workspace activities test` -> pass

### Slice 4: Activity migration follow-up (`activities/algorithm-demo`, server routes)

Completed:
- Converted activity server routes to TypeScript:
  - `activities/algorithm-demo/server/routes.js` -> `activities/algorithm-demo/server/routes.ts`
- Updated activity config server entry:
  - `activities/algorithm-demo/activity.config.ts` (`serverEntry` -> `./server/routes.ts`)
- Added focused route regression tests:
  - `activities/algorithm-demo/server/routes.test.ts`

Implementation notes:
- Route registration now uses typed request/session helpers (`readSessionId`, typed request body contracts) while preserving existing HTTP and websocket behavior.
- Session normalization remains registered for `algorithm-demo`, with typed defaults for `algorithmId`, `algorithmState`, and `history`.
- Test mocks were tightened to Express/WebSocket-compatible handler shapes so `activities` workspace strict typecheck remains green.
- Manager/student views and individual algorithm visualizer modules remain JavaScript for the next completion slice.

Validation:
- `npm --workspace activities run typecheck` -> pass
- `npm --workspace activities test` -> pass
- `npm test` -> pass (full root verification chain green, including `verify:deploy` and `verify:server`)

### Slice 4: Activity migration follow-up (`activities/algorithm-demo`, manager/student shells)

Completed:
- Converted manager and student shell components to TypeScript:
  - `activities/algorithm-demo/client/manager/DemoManager.jsx` -> `activities/algorithm-demo/client/manager/DemoManager.tsx`
  - `activities/algorithm-demo/client/student/DemoStudent.jsx` -> `activities/algorithm-demo/client/student/DemoStudent.tsx`
- Tightened shared registry typing used by manager/student:
  - `activities/algorithm-demo/client/algorithms/index.ts` (typed `AlgorithmState`, `AlgorithmViewProps`, `AlgorithmSession`)
- Added focused tests for newly typed shell logic:
  - `activities/algorithm-demo/client/manager/DemoManager.test.tsx`
  - `activities/algorithm-demo/client/student/DemoStudent.test.tsx`

Implementation notes:
- Manager/student websocket message handling now uses typed parse helpers and normalized algorithm state guards before updating React state.
- Manager/student view rendering now checks for missing `ManagerView`/`StudentView` exports and returns explicit fallback errors instead of relying on `unknown` component types.
- Activity-local imports to shared client hooks/components were switched from `@src/*` aliases to explicit relative paths to ensure activities workspace test runtime resolves modules consistently.
- Individual algorithm visualizer modules (`search`, `sorting`, `recursion`, `guessing`) remain JavaScript for the next completion slice.

Validation:
- `npm --workspace activities run typecheck` -> pass
- `npm --workspace activities test` -> pass
- `npm test` -> pass (full root verification chain green, including `verify:deploy` and `verify:server`)
- `npm run typecheck --workspaces --if-present` -> pass

### Slice 4: Activity migration follow-up (`activities/algorithm-demo`, shared client components/utils)

Completed:
- Converted shared client component and utility files to TypeScript:
  - `activities/algorithm-demo/client/components/AlgorithmPicker.jsx` -> `activities/algorithm-demo/client/components/AlgorithmPicker.tsx`
  - `activities/algorithm-demo/client/components/PseudocodeRenderer.jsx` -> `activities/algorithm-demo/client/components/PseudocodeRenderer.tsx`
  - `activities/algorithm-demo/client/utils/pseudocodeUtils.jsx` -> `activities/algorithm-demo/client/utils/pseudocodeUtils.tsx`
- Added focused regression tests for converted modules:
  - `activities/algorithm-demo/client/components/AlgorithmPicker.test.tsx`
  - `activities/algorithm-demo/client/components/PseudocodeRenderer.test.tsx`
  - `activities/algorithm-demo/client/utils/pseudocodeUtils.test.tsx`

Implementation notes:
- `AlgorithmPicker.tsx` now enforces typed algorithm card props, uses `type="button"`, and safely disables cards with missing ids.
- `PseudocodeRenderer.tsx` now uses typed highlight/overlay contracts while preserving backward compatibility with both `highlightedLines` and legacy `highlightedIds`.
- `pseudocodeUtils.tsx` now exports typed token/render helpers used by renderer and tests, with no behavior changes to markdown-style bold parsing.
- Manager/student views, remaining algorithm visualizer modules, and `server/routes.js` remain JavaScript for the next completion slice.

Validation:
- `npm --workspace activities run typecheck` -> pass
- `npm --workspace activities test` -> pass

### Slice 5: Activity migration completion (`activities/java-format-practice`, remaining client surface)

Completed:
- Converted remaining Java Format Practice client files to TypeScript:
  - `activities/java-format-practice/client/challenges.js` -> `activities/java-format-practice/client/challenges.ts`
  - `activities/java-format-practice/client/student/JavaFormatPractice.jsx` -> `activities/java-format-practice/client/student/JavaFormatPractice.tsx`
  - `activities/java-format-practice/client/manager/JavaFormatPracticeManager.jsx` -> `activities/java-format-practice/client/manager/JavaFormatPracticeManager.tsx`
  - `activities/java-format-practice/client/components/AnswerSection.jsx` -> `activities/java-format-practice/client/components/AnswerSection.tsx`
  - `activities/java-format-practice/client/components/CharacterGrid.jsx` -> `activities/java-format-practice/client/components/CharacterGrid.tsx`
  - `activities/java-format-practice/client/components/ExpectedOutputGrid.jsx` -> `activities/java-format-practice/client/components/ExpectedOutputGrid.tsx`
  - `activities/java-format-practice/client/components/InterleavedOutputGrid.jsx` -> `activities/java-format-practice/client/components/InterleavedOutputGrid.tsx`
  - `activities/java-format-practice/client/components/FeedbackDisplay.jsx` -> `activities/java-format-practice/client/components/FeedbackDisplay.tsx`
  - `activities/java-format-practice/client/data/referenceData.js` -> `activities/java-format-practice/client/data/referenceData.ts`
- Converted Java Format Practice script-style tests to `.ts`:
  - `activities/java-format-practice/client/evaluateFormatString.test.ts`
  - `activities/java-format-practice/client/integration.test.ts`
  - `activities/java-format-practice/client/utils/formatUtils.test.ts`
  - `activities/java-format-practice/client/utils/stringUtils.test.ts`
- Expanded shared activity types to cover challenge definitions, feedback payloads, output rows, and reference-modal sections:
  - `activities/java-format-practice/javaFormatPracticeTypes.ts`

Implementation notes:
- `JavaFormatPractice.tsx` now uses explicit state/feedback/output typing to avoid `never` inference under strict TS + `noUncheckedIndexedAccess` while preserving existing classroom behavior.
- `referenceData.ts` now uses `satisfies JavaFormatReferenceData` so table/list section literals remain type-safe and compatible with `ReferenceModal` rendering.
- Script-style tests were kept as script runners and temporarily annotated with `@ts-nocheck` plus owner/cleanup notes to avoid blocking migration on a full `node:test` rewrite in this slice.

Validation:
- `npm --workspace activities run typecheck` -> pass
- `npm --workspace activities test` -> pass
- `npm test` -> pass (full root verification chain green, including `verify:deploy` and `verify:server`)

### Slice 6: Activity migration kickoff (`activities/traveling-salesman`, partial)

Completed:
- Migrated activity config and client entry module to TypeScript:
  - `activities/traveling-salesman/activity.config.js` -> `activities/traveling-salesman/activity.config.ts`
  - `activities/traveling-salesman/client/index.js` -> `activities/traveling-salesman/client/index.ts`
- Added client-module shape regression test:
  - `activities/traveling-salesman/client/index.test.ts`

Implementation notes:
- `activity.config.ts` now points `clientEntry` to `./client/index.ts` while leaving `serverEntry` on `./server/routes.js` for this kickoff slice.
- `client/index.ts` now exports a typed `ActivityClientModule` with explicit `ComponentType<unknown>` casts for manager/student components, matching shared activity registry contracts.
- Remaining Traveling Salesman client/server files stay on JS/JSX for the next completion slices.

Validation:
- `npm --workspace activities run typecheck` -> pass
- `npm --workspace activities test` -> pass
- `npm --workspace client test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass

### Slice 6: Activity migration follow-up (`activities/traveling-salesman`, server routes + validation)

Completed:
- Migrated activity server routing modules to TypeScript:
  - `activities/traveling-salesman/server/routes.js` -> `activities/traveling-salesman/server/routes.ts`
  - `activities/traveling-salesman/server/routes/session.js` -> `activities/traveling-salesman/server/routes/session.ts`
  - `activities/traveling-salesman/server/routes/students.js` -> `activities/traveling-salesman/server/routes/students.ts`
  - `activities/traveling-salesman/server/routes/instructor.js` -> `activities/traveling-salesman/server/routes/instructor.ts`
  - `activities/traveling-salesman/server/routes/algorithms.js` -> `activities/traveling-salesman/server/routes/algorithms.ts`
  - `activities/traveling-salesman/server/routes/shared.js` -> `activities/traveling-salesman/server/routes/shared.ts`
  - `activities/traveling-salesman/server/validation.js` -> `activities/traveling-salesman/server/validation.ts`
- Added activity-local shared type contracts for server migration:
  - `activities/traveling-salesman/travelingSalesmanTypes.ts`
- Converted server route tests to TypeScript:
  - `activities/traveling-salesman/server/routes.test.js` -> `activities/traveling-salesman/server/routes.test.ts`
- Updated activity config server entry to TypeScript route module:
  - `activities/traveling-salesman/activity.config.ts` (`serverEntry` -> `./server/routes.ts`)

Implementation notes:
- Shared session normalization and typed session narrowing now flow through `normalizeTravelingSalesmanSessionData(...)` and `asTravelingSalesmanSession(...)` in `travelingSalesmanTypes.ts`, reducing repeated route-level casting while keeping runtime defaults unchanged.
- `shared.ts` keeps broadcast forwarding/overlay behavior identical, with typed helper outputs for instructor, student, heuristic, and brute-force route payload variants.
- Route tests keep the same behavior assertions as the prior JS suite (`set-problem` validation, student submit edge case, instructor route validation, and primitive validation helpers) under strict TS mocks.

Validation:
- `npm --workspace activities run typecheck` -> pass
- `npm --workspace activities test` -> pass
- `npm --workspace client test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass

### Slice 6: Activity migration follow-up (`activities/traveling-salesman`, client utilities + tests)

Completed:
- Migrated client utility modules to TypeScript:
  - `activities/traveling-salesman/client/utils/algorithmRunner.js` -> `activities/traveling-salesman/client/utils/algorithmRunner.ts`
  - `activities/traveling-salesman/client/utils/bruteForce.js` -> `activities/traveling-salesman/client/utils/bruteForce.ts`
  - `activities/traveling-salesman/client/utils/cityGenerator.js` -> `activities/traveling-salesman/client/utils/cityGenerator.ts`
  - `activities/traveling-salesman/client/utils/distanceCalculator.js` -> `activities/traveling-salesman/client/utils/distanceCalculator.ts`
  - `activities/traveling-salesman/client/utils/formatters.js` -> `activities/traveling-salesman/client/utils/formatters.ts`
  - `activities/traveling-salesman/client/utils/leaderboardBuilders.js` -> `activities/traveling-salesman/client/utils/leaderboardBuilders.ts`
  - `activities/traveling-salesman/client/utils/mapRenderConfig.js` -> `activities/traveling-salesman/client/utils/mapRenderConfig.ts`
  - `activities/traveling-salesman/client/utils/mathHelpers.js` -> `activities/traveling-salesman/client/utils/mathHelpers.ts`
  - `activities/traveling-salesman/client/utils/nearestNeighbor.js` -> `activities/traveling-salesman/client/utils/nearestNeighbor.ts`
  - `activities/traveling-salesman/client/utils/progressHelpers.js` -> `activities/traveling-salesman/client/utils/progressHelpers.ts`
  - `activities/traveling-salesman/client/utils/routeLegend.js` -> `activities/traveling-salesman/client/utils/routeLegend.ts`
  - `activities/traveling-salesman/client/utils/routeTypes.js` -> `activities/traveling-salesman/client/utils/routeTypes.ts`
  - `activities/traveling-salesman/client/utils/terrainGenerator.js` -> `activities/traveling-salesman/client/utils/terrainGenerator.ts`
- Added shared utility type contracts:
  - `activities/traveling-salesman/client/utils/tspUtilsTypes.ts`
- Converted existing utility tests to TypeScript:
  - `activities/traveling-salesman/client/utils/cityGenerator.test.js` -> `activities/traveling-salesman/client/utils/cityGenerator.test.ts`
  - `activities/traveling-salesman/client/utils/distanceCalculator.test.js` -> `activities/traveling-salesman/client/utils/distanceCalculator.test.ts`
- Added focused tests for newly typed helpers:
  - `activities/traveling-salesman/client/utils/leaderboardBuilders.test.ts`
  - `activities/traveling-salesman/client/utils/routeLegend.test.ts`
- Updated client imports that consumed utility modules to extensionless paths for mixed JS/TS compatibility:
  - `activities/traveling-salesman/client/manager/TSPManager.jsx`
  - `activities/traveling-salesman/client/student/TSPStudent.jsx`
  - `activities/traveling-salesman/client/components/CityMap.jsx`
  - `activities/traveling-salesman/client/components/Leaderboard.jsx`
  - `activities/traveling-salesman/client/components/RouteLegend.jsx`
  - `activities/traveling-salesman/client/hooks/useRouteBuilder.js`

Implementation notes:
- Utility type coverage now includes city/route/distance contracts, algorithm run/result payloads, leaderboard row shapes, and terrain element unions via `tspUtilsTypes.ts`.
- `distanceCalculator.ts` now uses a typed route-step parser to safely support both `city-*` string routes and numeric index routes under `noUncheckedIndexedAccess`, preserving existing distance behavior.
- `leaderboardBuilders.ts` and `routeLegend.ts` now use explicit typed array/object defaults to avoid strict-mode `never[]` inference while retaining existing ordering/merge behavior.

Validation:
- `npm --workspace activities run typecheck` -> pass
- `npm --workspace activities test` -> pass
- `npm --workspace client test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass

### Slice 6: Activity migration follow-up (`activities/traveling-salesman`, client hooks + shared components)

Completed:
- Migrated remaining client hooks to TypeScript:
  - `activities/traveling-salesman/client/hooks/useBroadcastToggles.js` -> `activities/traveling-salesman/client/hooks/useBroadcastToggles.ts`
  - `activities/traveling-salesman/client/hooks/useRouteBuilder.js` -> `activities/traveling-salesman/client/hooks/useRouteBuilder.ts`
  - `activities/traveling-salesman/client/hooks/useTspSession.js` -> `activities/traveling-salesman/client/hooks/useTspSession.ts`
- Migrated shared client components to TSX:
  - `activities/traveling-salesman/client/components/ProgressBar.jsx` -> `activities/traveling-salesman/client/components/ProgressBar.tsx`
  - `activities/traveling-salesman/client/components/Leaderboard.jsx` -> `activities/traveling-salesman/client/components/Leaderboard.tsx`
  - `activities/traveling-salesman/client/components/RouteLegend.jsx` -> `activities/traveling-salesman/client/components/RouteLegend.tsx`
  - `activities/traveling-salesman/client/components/CityMap.jsx` -> `activities/traveling-salesman/client/components/CityMap.tsx`
- Added focused hook and component tests:
  - `activities/traveling-salesman/client/hooks/useBroadcastToggles.test.ts`
  - `activities/traveling-salesman/client/hooks/useRouteBuilder.test.ts`
  - `activities/traveling-salesman/client/hooks/useTspSession.test.ts`
  - `activities/traveling-salesman/client/components/ProgressBar.test.tsx`
  - `activities/traveling-salesman/client/components/Leaderboard.test.tsx`
  - `activities/traveling-salesman/client/components/RouteLegend.test.tsx`
  - `activities/traveling-salesman/client/components/CityMap.test.tsx`

Implementation notes:
- Hook modules now expose small pure helpers (`nextBroadcastSnapshot`, `resolveHydratedDistances`, `shouldRefreshForMessageType`) to keep behavior testable under the existing Node test runner.
- Shared route/message/session contracts were centralized in `tspUtilsTypes.ts` and reused across hooks/components to remove `unknown`/`never` inference paths.
- Manager/student imports were switched to extensionless hook/component paths to keep mixed-extension resolution stable while files moved from JS/JSX to TS/TSX.

Validation:
- `npm --workspace activities run typecheck` -> pass
- `npm --workspace activities test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass

### Slice 6: Activity migration completion (`activities/traveling-salesman`, manager + student shells)

Completed:
- Migrated remaining activity client shells to TSX:
  - `activities/traveling-salesman/client/manager/TSPManager.jsx` -> `activities/traveling-salesman/client/manager/TSPManager.tsx`
  - `activities/traveling-salesman/client/student/TSPStudent.jsx` -> `activities/traveling-salesman/client/student/TSPStudent.tsx`
- Updated activity client entry imports for TSX modules:
  - `activities/traveling-salesman/client/index.ts`
- Added targeted regression tests for extracted shell helpers:
  - `activities/traveling-salesman/client/manager/TSPManager.test.ts`
  - `activities/traveling-salesman/client/student/TSPStudent.test.ts`

Implementation notes:
- Large shell files now use explicit local state/session types (`SoloAlgorithmsState`, `SoloProgressState`, `TspDisplayRoute`, `TspSessionData`) to avoid strict-mode `never` inference in route, algorithm, and websocket message state.
- `TSPStudent.tsx` now uses typed websocket payload narrowing and extracted pure helpers (`sortRoutesByDistance`, `buildSoloDisplayedRoutes`) for deterministic test coverage.
- `mapRenderConfig.ts` now models `terrainSeed` as optional `number` (instead of `number | null`) to match `CityMap` props and avoid nullability mismatches during TSX conversion.

Validation:
- `npm --workspace activities run typecheck` -> pass
- `npm --workspace activities test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass

### Slice 7: Activity migration kickoff (`activities/gallery-walk`, partial)

Completed:
- Migrated activity config and client entry module to TypeScript:
  - `activities/gallery-walk/activity.config.js` -> `activities/gallery-walk/activity.config.ts`
  - `activities/gallery-walk/client/index.js` -> `activities/gallery-walk/client/index.ts`
- Added client-module shape regression test:
  - `activities/gallery-walk/client/index.test.ts`

Implementation notes:
- `activity.config.ts` now points `clientEntry` to `./client/index.ts` while leaving `serverEntry` on `./server/routes.js` for this kickoff slice.
- `client/index.ts` now exports a typed `ActivityClientModule` with explicit `ComponentType<unknown>` casts for manager/student components, matching current shared activity registry contracts during mixed migration.
- Remaining gallery-walk client/server internals stay on JS/JSX for follow-up slices.

Validation:
- `npm --workspace activities run typecheck` -> pass
- `npm --workspace activities test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass

### Slice 7: Activity migration follow-up (`activities/gallery-walk`, shared helpers + server routes)

Completed:
- Migrated shared and server modules to TypeScript:
  - `activities/gallery-walk/shared/id.js` -> `activities/gallery-walk/shared/id.ts`
  - `activities/gallery-walk/shared/noteStyles.js` -> `activities/gallery-walk/shared/noteStyles.ts`
  - `activities/gallery-walk/server/routes.js` -> `activities/gallery-walk/server/routes.ts`
- Updated activity config server entry to TypeScript route module:
  - `activities/gallery-walk/activity.config.ts` (`serverEntry` -> `./server/routes.ts`)
- Updated gallery-walk client imports to extensionless shared-module paths so JSX files resolve migrated TS modules during mixed mode.
- Added shared helper regression tests:
  - `activities/gallery-walk/shared/sharedUtils.test.ts`
- Updated server route test typing for stricter ws/router contracts:
  - `server/galleryWalkRoutes.test.ts`

Implementation notes:
- `routes.ts` now normalizes gallery-walk session state under strict typing and keeps websocket broadcast behavior unchanged.
- `server/galleryWalkRoutes.test.ts` now uses typed ws stubs (`WsRouter`, `ActiveBitsWebSocket`) so compile-time checks match runtime route-handler expectations.
- This follow-up completes the kickoff plan item to migrate gallery-walk `shared/*.js` and `server/routes.js` before client component/hooks conversion.

Validation:
- `npm --workspace activities run typecheck` -> pass
- `npm --workspace activities test` -> pass
- `npm --workspace server test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass
- `npm test` -> pass

### Slice 7: Activity migration follow-up (`activities/gallery-walk`, client utilities + session hook)

Completed:
- Migrated gallery-walk manager utility modules to TypeScript:
  - `activities/gallery-walk/client/manager/feedbackUtils.js` -> `activities/gallery-walk/client/manager/feedbackUtils.ts`
  - `activities/gallery-walk/client/manager/managerUtils.js` -> `activities/gallery-walk/client/manager/managerUtils.ts`
- Migrated gallery-walk session hook to TypeScript:
  - `activities/gallery-walk/client/hooks/useGalleryWalkSession.js` -> `activities/gallery-walk/client/hooks/useGalleryWalkSession.ts`
- Added focused helper tests for typed websocket/session hook behavior:
  - `activities/gallery-walk/client/hooks/useGalleryWalkSession.test.ts`
- Updated consuming imports to extensionless paths for mixed JS/TS compatibility:
  - `activities/gallery-walk/client/student/StudentPage.jsx`
  - `activities/gallery-walk/client/manager/ManagerPage.jsx`
  - `activities/gallery-walk/client/components/GalleryWalkFeedbackTable.jsx`
  - `activities/gallery-walk/client/manager/ManagerPage.test.js`

Implementation notes:
- `useGalleryWalkSession.ts` now exports typed helpers for websocket URL building, message parsing, and feedback entry merging so high-risk state transitions remain directly testable under the existing Node runner.
- Utility modules now expose typed sort/timestamp contracts while preserving existing runtime behavior and call sites in JSX components.
- Gallery-walk manager/student shells remain JS/JSX in this slice; this change is limited to utility and hook layers to keep migration scope incremental.

Validation:
- `npm --workspace activities run typecheck` -> pass
- `npm --workspace activities test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass

### Slice 7: Activity migration follow-up (`activities/gallery-walk`, client shared components)

Completed:
- Migrated gallery-walk shared client components from JSX to TSX:
  - `activities/gallery-walk/client/components/FeedbackCards.jsx` -> `activities/gallery-walk/client/components/FeedbackCards.tsx`
  - `activities/gallery-walk/client/components/FeedbackView.jsx` -> `activities/gallery-walk/client/components/FeedbackView.tsx`
  - `activities/gallery-walk/client/components/FeedbackViewSwitcher.jsx` -> `activities/gallery-walk/client/components/FeedbackViewSwitcher.tsx`
  - `activities/gallery-walk/client/components/GalleryWalkFeedbackTable.jsx` -> `activities/gallery-walk/client/components/GalleryWalkFeedbackTable.tsx`
  - `activities/gallery-walk/client/components/LocalReviewerForm.jsx` -> `activities/gallery-walk/client/components/LocalReviewerForm.tsx`
  - `activities/gallery-walk/client/components/NoteStyleSelect.jsx` -> `activities/gallery-walk/client/components/NoteStyleSelect.tsx`
  - `activities/gallery-walk/client/components/ProjectStationCard.jsx` -> `activities/gallery-walk/client/components/ProjectStationCard.tsx`
  - `activities/gallery-walk/client/components/RegistrationForm.jsx` -> `activities/gallery-walk/client/components/RegistrationForm.tsx`
  - `activities/gallery-walk/client/components/ReviewerFeedbackForm.jsx` -> `activities/gallery-walk/client/components/ReviewerFeedbackForm.tsx`
  - `activities/gallery-walk/client/components/ReviewerIdentityForm.jsx` -> `activities/gallery-walk/client/components/ReviewerIdentityForm.tsx`
  - `activities/gallery-walk/client/components/ReviewerPanel.jsx` -> `activities/gallery-walk/client/components/ReviewerPanel.tsx`
  - `activities/gallery-walk/client/components/ReviewerScanner.jsx` -> `activities/gallery-walk/client/components/ReviewerScanner.tsx`
  - `activities/gallery-walk/client/components/StageControls.jsx` -> `activities/gallery-walk/client/components/StageControls.tsx`
  - `activities/gallery-walk/client/components/TitleEditor.jsx` -> `activities/gallery-walk/client/components/TitleEditor.tsx`
- Updated gallery-walk imports in remaining JS/JSX files to extensionless paths for converted TSX modules:
  - `activities/gallery-walk/client/student/StudentPage.jsx`
  - `activities/gallery-walk/client/manager/ManagerPage.jsx`
  - `activities/gallery-walk/client/components/GalleryWalkSoloViewer.jsx`
  - `activities/gallery-walk/client/components/GalleryWalkNotesView.jsx`
- Added component-module shape regression test:
  - `activities/gallery-walk/client/components/galleryWalkComponents.test.ts`

Implementation notes:
- The conversion intentionally keeps large `GalleryWalkSoloViewer.jsx`, `GalleryWalkNotesView.jsx`, `ManagerPage.jsx`, and `StudentPage.jsx` on JS/JSX for the next slice while moving their shared UI dependencies to typed TSX modules.
- `NoteStyleSelect.tsx` now uses typed refs/keyboard handlers and typed option inference from `NOTE_STYLE_OPTIONS` without changing dropdown behavior.
- `FeedbackView.tsx` now supplies the existing required `onSelectReviewee` prop to `GalleryWalkNotesView` with a no-op handler, preserving previous all-reviewee rendering behavior.

Validation:
- `npm --workspace activities run typecheck` -> pass
- `npm --workspace activities test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass

### Slice 7: Activity migration completion (`activities/gallery-walk`, remaining manager/student shells)

Completed:
- Migrated remaining gallery-walk JSX files to TSX:
  - `activities/gallery-walk/client/components/GalleryWalkNotesView.jsx` -> `activities/gallery-walk/client/components/GalleryWalkNotesView.tsx`
  - `activities/gallery-walk/client/components/GalleryWalkSoloViewer.jsx` -> `activities/gallery-walk/client/components/GalleryWalkSoloViewer.tsx`
  - `activities/gallery-walk/client/manager/ManagerPage.jsx` -> `activities/gallery-walk/client/manager/ManagerPage.tsx`
  - `activities/gallery-walk/client/student/StudentPage.jsx` -> `activities/gallery-walk/client/student/StudentPage.tsx`
- Updated cross-component imports to extensionless TS/TSX paths for mixed-extension compatibility.
- Tightened TS component prop contracts across converted gallery-walk components to align nullability and optional ids with existing runtime payloads (`projectTitle?: string | null`, optional feedback `id`, nullable reviewer/reviewee lookups).

Implementation notes:
- `StudentPage.tsx` now consumes typed websocket message helpers from `useGalleryWalkSession.ts` (`getMessageReviewees`, `getMessageFeedbackEntry`) to avoid ad-hoc payload narrowing in the largest activity shell.
- `GalleryWalkSoloViewer.tsx` keeps existing file-upload/view-toggle behavior but now validates JSON shape through typed normalizers before deriving teacher/student render state.
- With this slice, gallery-walk source migration is functionally complete: the only remaining JS file under `activities/gallery-walk` is the manager utility test file `client/manager/ManagerPage.test.js`.

Validation:
- `npm --workspace activities run typecheck` -> pass
- `npm --workspace activities test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass

### Slice 7: Activity migration cleanup (`activities/gallery-walk`, final test conversion)

Completed:
- Converted the remaining gallery-walk JS test file to TypeScript:
  - `activities/gallery-walk/client/manager/ManagerPage.test.js` -> `activities/gallery-walk/client/manager/ManagerPage.test.ts`
- Updated strict-null-safe assertion in the converted test (`result[0]?.message`) to satisfy TS checks under strict mode.

Implementation notes:
- With this cleanup, `activities/gallery-walk` no longer contains `.js`/`.jsx` source files.
- Existing behavior checks for feedback sorting/insertion and timestamp formatting remain unchanged.

Validation:
- `npm --workspace activities run typecheck` -> pass
- `npm --workspace activities test` -> pass
- `npm run typecheck --workspaces --if-present` -> pass
