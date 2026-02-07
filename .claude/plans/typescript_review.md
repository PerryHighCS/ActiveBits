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
  - `server/phase3RoutesRegistryTs.test.ts`
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
- `node --import tsx --test server/phase3RoutesRegistryTs.test.ts` -> pass
- `node --import tsx --test server/activities/activityRegistry.test.js` -> pass
- `npm --workspace server test` -> pass (outside sandbox; `38` pass, `0` fail)
- `npm run typecheck --workspaces --if-present` -> pass

Notes:
- Server tests executed with `tsx` now exercise TS counterparts when `.js` specifiers have colocated `.ts` files, which provides migration coverage before runtime entrypoint cutover.
