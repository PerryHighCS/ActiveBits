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

Remaining note:
- ESLint warns about legacy `/* eslint-env node */` comment in `client/vite.config.ts`; non-blocking now, should be replaced with flat-config-compatible globals comment before ESLint v10.

Phase 1 status: complete (with known sandbox limitation for server bind-dependent runtime tests recorded earlier).
