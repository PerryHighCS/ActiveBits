# TypeScript Migration Plan for ActiveBits

## Project Overview

ActiveBits is currently a JavaScript monorepo using ES modules throughout.

Current migration scope (source-focused count, excluding `node_modules` and build outputs):
- **Frontend (`client`)**: React + Vite + Tailwind (~22 `.js/.jsx` files)
- **Backend (`server`)**: Express + WebSockets + Redis/Valkey (~20 `.js` files)
- **Activities (`activities`)**: Dynamic plugin system with client + server code (~175 `.js/.jsx` files)
- **Repo scripts (`scripts`)**: Runtime/verification utilities (~1 `.js` file)

This plan converts the repo to TypeScript while preserving behavior and keeping the codebase runnable at every phase boundary.

## Migration Strategy: Incremental, Compatibility-First

We use an incremental strategy with `allowJs: true` during migration.

High-level sequence:
1. **Phase 0**: Baseline verification before any migration work
2. **Phase 1**: Foundation (TypeScript configs, shared types, tooling)
3. **Phase 2**: Mixed-extension compatibility layer (critical before bulk renames)
4. **Phase 3**: Backend migration
5. **Phase 4**: Frontend migration
6. **Phase 5**: Activities migration (vertical slices)
7. **Phase 6**: Scripts and tooling migration
8. **Phase 7**: Cleanup and strictness hardening

Key defaults for this plan:
- Scope is **full repo migration** (app code + scripts/config where feasible)
- TypeScript strictness is **progressive** (strict baseline first, extra strict flags later)
- Production server runtime is **compiled JS output** (TypeScript compiled before start)
- Source maps are **enabled and public in production** (open-source repo policy)

---

## CI Rollout Strategy

CI should be hard-gated throughout migration. Do not use warn-only quality gates for typecheck or tests.

### CI Stage A: Baseline and Foundation (Phases 0-1)

Require these checks on every PR:
1. `npm --workspace client test`
2. `npm --workspace server test`
3. `npm --workspace activities test`
4. `npm run verify:deploy`
5. `npm run verify:server`
6. `npm run typecheck --workspaces --if-present`

### CI Stage B: Incremental Migration (Phases 2-6)

Keep all Stage A checks required and additionally enforce:
1. Mixed-extension test discovery remains enabled (`.test.js`, `.test.ts`, `.test.tsx`) so CI cannot silently skip tests.
2. Any temporary baseline exception must follow the documented allowlist policy in Phase 0.
3. No PR merges with failing required checks.

### CI Stage C: Post-Cleanup Enforcement (Phase 7+)

Keep all prior required checks and add:
1. Source extension guard to fail CI if `.js/.jsx` remain in migration scope (`client`, `server`, `activities`, `scripts`), excluding generated outputs (`node_modules`, `dist`, build artifacts).
2. Full workspace typecheck remains required.

---

## Phase 0: Baseline Verification (Blocking)

Before migration begins, establish a trusted test baseline in your local/CI environment.

### 0.1 Capture baseline status
Run:
```bash
npm --workspace client test
npm --workspace server test
npm --workspace activities test
npm run verify:deploy
npm run verify:server
```

### 0.2 Record baseline
Document results in `.claude/plans/typescript_review.md`:
- Command run
- Pass/fail
- Relevant failure snippets
- Known flaky behavior (if any)

Baseline gate policy:
- Default is **all green** for baseline commands.
- Start with **no failure allowlist**.
- Only create an allowlist for a clearly unrelated, pre-existing issue that appears after baseline capture, and record:
  - reason and reproducible evidence
  - owner
  - tracking issue link
  - planned removal date/condition
  - guardrail that migrated-file tests must still pass

### 0.3 Lock runtime assumptions
- Confirm Node major version used for migration and CI (recommended: Node 22).
- Ensure all developers and CI use the same major during migration.

### 0.4 Exit criteria
- Baseline results are documented.
- Baseline commands are green in the canonical environment (local + CI).
- No failure allowlist exists unless explicitly documented under the policy above.

---

## Phase 1: Foundation Setup

### 1.1 Install TypeScript dependencies

**Root workspace:**
```bash
npm install --save-dev typescript @types/node
```

**Client workspace:**
```bash
npm install --save-dev --workspace client typescript @types/node @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

**Server workspace:**
```bash
npm install --save-dev --workspace server typescript @types/node @types/express @types/cookie-parser @types/ws tsx
```

**Activities workspace:**
```bash
npm install --save-dev --workspace activities typescript @types/node @types/react @types/react-dom
```

### 1.2 Create TypeScript configurations

**Create `/workspaces/ActiveBits/tsconfig.base.json`:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "allowJs": true,
    "checkJs": false
  }
}
```

**Create `/workspaces/ActiveBits/client/tsconfig.json`:**
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "moduleResolution": "bundler",
    "types": ["vite/client"],
    "baseUrl": ".",
    "paths": {
      "@src/*": ["./src/*"],
      "@activities/*": ["../activities/*"]
    },
    "noEmit": true
  },
  "include": ["src/**/*", "vite.config.ts", "../types/**/*.d.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Create `/workspaces/ActiveBits/server/tsconfig.json`:**
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "types": ["node"],
    "noEmit": true
  },
  "include": ["**/*.ts", "**/*.js", "../types/**/*.d.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Create `/workspaces/ActiveBits/server/tsconfig.build.json`:**
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "./dist",
    "declaration": false,
    "sourceMap": true
  },
  "include": ["**/*.ts"]
}
```

**Create `/workspaces/ActiveBits/activities/tsconfig.json`:**
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "moduleResolution": "bundler",
    "types": ["node", "vite/client"],
    "baseUrl": ".",
    "paths": {
      "activebits-server/*": ["../server/*"]
    },
    "noEmit": true
  },
  "include": ["*/client/**/*", "*/server/**/*", "*/activity.config.*", "../types/**/*.d.ts"],
  "exclude": ["node_modules"]
}
```

### 1.3 Create shared types directory

Create `/workspaces/ActiveBits/types/` with:
- [types/session.ts](types/session.ts) - `Session`, `SessionStore`, activity session generics
- [types/activity.ts](types/activity.ts) - `ActivityConfig`, `ActivityClientModule`, `ActivityRegistryEntry`
- [types/websocket.ts](types/websocket.ts) - `ActiveBitsWebSocket`, `WsRouter`, `WebSocketMessage`
- [types/api.ts](types/api.ts) - API request/response types
- [types/express.d.ts](types/express.d.ts) - Express augmentation for `app.locals`
- [types/ambient.d.ts](types/ambient.d.ts) - ambient declarations for modules without types
- [types/index.ts](types/index.ts) - central re-exports

### 1.4 Update build tools and linting

**Rename and update Vite config:** [client/vite.config.js](client/vite.config.js) -> `client/vite.config.ts`
- Add TypeScript imports and typings.
- Preserve existing aliases and Codespaces behavior.
- Set `build.sourcemap: true` for production client builds.

**Update ESLint:** [client/eslint.config.js](client/eslint.config.js) -> `client/eslint.config.mjs`
- Add TypeScript ESLint support.
- Keep mixed JS/TS rules during migration.

### 1.5 Transitional script updates (mixed JS/TS support)

Do **not** switch to TS-only test discovery in this phase.

**Server package scripts (transitional):**
```json
{
  "scripts": {
    "start": "node dist/server.js",
    "dev": "node --import tsx server.ts --trace-warnings",
    "build": "tsc -p tsconfig.build.json",
    "test": "sh -c 'set -e; files=$(find . -not -path "./node_modules/*" \\( -name "*.test.js" -o -name "*.test.ts" \\) -print); if [ -z "$files" ]; then echo "No server tests found"; exit 0; fi; node --import tsx --test $files'",
    "typecheck": "tsc --noEmit"
  }
}
```

**Client package scripts (transitional):**
```json
{
  "scripts": {
    "test": "sh -c 'set -e; files=$(find src \\( -name "*.test.js" -o -name "*.test.ts" -o -name "*.test.tsx" \\) -print); if [ -z "$files" ]; then echo "No client tests found"; exit 0; fi; node --import tsx --test $files'",
    "typecheck": "tsc --noEmit"
  }
}
```

**Activities package scripts (transitional):**
```json
{
  "scripts": {
    "test": "sh -c 'set -e; files=$(find . -path "./node_modules" -prune -o \\( -name "*.test.js" -o -name "*.test.ts" -o -name "*.test.tsx" \\) -print); if [ -z "$files" ]; then echo "No activities tests found"; exit 0; fi; node --import tsx --test --import ../scripts/jsx-loader-register.mjs $files'",
    "typecheck": "tsc --noEmit"
  }
}
```

> **Note:** Keep `scripts/jsx-loader-register.mjs` until JSX-based tests and modules no longer depend on it.

### 1.6 Root script policy

Root `package.json` should retain deploy/server verification semantics while adding typecheck:
```json
{
  "scripts": {
    "typecheck": "npm run typecheck --workspaces --if-present",
    "build": "npm run typecheck && npm run build --workspace client",
    "test": "npm run typecheck && npm --workspace client test && npm --workspace server test && npm --workspace activities test && npm run verify:deploy && npm run verify:server"
  }
}
```

### 1.7 Create Vite environment types

**Create [client/src/vite-env.d.ts](client/src/vite-env.d.ts):**
```typescript
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MODE: string
  readonly DEV: boolean
  readonly PROD: boolean
  readonly SSR: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
  glob<T = any>(
    pattern: string,
    options?: { eager?: boolean }
  ): Record<string, T | (() => Promise<T>)>
}
```

---

## Phase 2: Compatibility Layer for Mixed Extensions (Critical)

This phase protects dynamic loading while `.js/.jsx` and `.ts/.tsx` coexist.

### 2.1 Client activity loader compatibility
Update [client/src/activities/index.js](client/src/activities/index.js) to support:
- `@activities/*/activity.config.{js,ts}`
- `@activities/*/client/index.{js,jsx,ts,tsx}`

This avoids broken discovery as activity entries are renamed.

### 2.2 Server activity registry compatibility
Update [server/activities/activityRegistry.js](server/activities/activityRegistry.js) to:
- discover both `activity.config.js` and `activity.config.ts`
- resolve `serverEntry` during mixed-extension transition
- preserve `isDev` filtering and startup safety behavior

### 2.3 Validation before bulk renames
Add compatibility checks:
1. Existing JS activities still load
2. Pilot-converted TS activity loads
3. Mixed JS/TS tests are discovered and run

### 2.4 Exit criteria
- Dynamic imports/globs work with mixed extensions.
- No regressions in activity loading before backend/frontend bulk conversion begins.

---

## Phase 3: Backend Migration

Convert backend in dependency order (utilities -> core -> routes -> registry -> entrypoint).

### 3.1 Core utilities
1. [server/core/sessionNormalization.js](server/core/sessionNormalization.js) -> `.ts`
2. [server/core/broadcastUtils.js](server/core/broadcastUtils.js) -> `.ts`

### 3.2 Session management
3. [server/core/sessionCache.js](server/core/sessionCache.js) -> `.ts`
4. [server/core/valkeyStore.js](server/core/valkeyStore.js) -> `.ts`
5. [server/core/sessions.js](server/core/sessions.js) -> `.ts`

### 3.3 WebSocket and persistent sessions
6. [server/core/wsRouter.js](server/core/wsRouter.js) -> `.ts`
7. [server/core/persistentSessions.js](server/core/persistentSessions.js) -> `.ts`
8. [server/core/persistentSessionWs.js](server/core/persistentSessionWs.js) -> `.ts`

### 3.4 Routes and registry
9. [server/routes/statusRoute.js](server/routes/statusRoute.js) -> `.ts`
10. [server/routes/persistentSessionRoutes.js](server/routes/persistentSessionRoutes.js) -> `.ts`
11. [server/activities/activityRegistry.js](server/activities/activityRegistry.js) -> `.ts`

### 3.5 Entry point
12. [server/server.js](server/server.js) -> `.ts`

### 3.6 Backend tests
13. Convert all [server/**/*.test.js](server/**/*.test.js) -> `.test.ts`

### 3.7 Operational scripts
14. [server/test-valkey.js](server/test-valkey.js) -> `.ts` (or documented temporary exception)
15. [server/monitor-valkey.js](server/monitor-valkey.js) -> `.ts` (or documented temporary exception)

### 3.8 Runtime policy after backend conversion
- **Dev/Test:** TS runtime (`tsx`) is acceptable.
- **Production:** compile TS (`tsc -p server/tsconfig.build.json`) and run emitted JS (`node dist/server.js`).
- **Source maps:** keep server `sourceMap: true` and deploy emitted `.map` files.

### 3.9 Key typing patterns for backend
- Use `Session<TData>` generic for activity-specific data.
- Implement `SessionStore` for InMemory and Valkey stores.
- Type Express middleware with augmented `app.locals.sessions`.
- Type WebSocket with `ActiveBitsWebSocket`.
- Use `ActivityRouteRegistration` for route modules.

---

## Phase 4: Frontend Migration

Convert frontend files in dependency order (utilities -> hooks -> components -> entry points).

### 4.1 Utilities and activity system
1. [client/src/utils/csvUtils.js](client/src/utils/csvUtils.js) -> `.ts`
2. [client/src/activities/index.js](client/src/activities/index.js) -> `.ts` (complex - `import.meta.glob()`)

### 4.2 Custom hooks
3. [client/src/hooks/useClipboard.js](client/src/hooks/useClipboard.js) -> `.ts`
4. [client/src/hooks/useSessionEndedHandler.js](client/src/hooks/useSessionEndedHandler.js) -> `.ts`
5. [client/src/hooks/useResilientWebSocket.js](client/src/hooks/useResilientWebSocket.js) -> `.ts`

### 4.3 UI components
6. [client/src/components/ui/Button.jsx](client/src/components/ui/Button.jsx) -> `.tsx`
7. [client/src/components/ui/Modal.jsx](client/src/components/ui/Modal.jsx) -> `.tsx`
8. [client/src/components/ui/RosterPill.jsx](client/src/components/ui/RosterPill.jsx) -> `.tsx`

### 4.4 Common components (smallest to largest)
9. [client/src/components/common/LoadingFallback.jsx](client/src/components/common/LoadingFallback.jsx) -> `.tsx`
10. [client/src/components/common/SessionEnded.jsx](client/src/components/common/SessionEnded.jsx) -> `.tsx`
11. [client/src/components/common/QrScannerPanel.jsx](client/src/components/common/QrScannerPanel.jsx) -> `.tsx`
12. [client/src/components/common/ActivityRoster.jsx](client/src/components/common/ActivityRoster.jsx) -> `.tsx`
13. [client/src/components/common/SessionHeader.jsx](client/src/components/common/SessionHeader.jsx) -> `.tsx`
14. [client/src/components/common/WaitingRoom.jsx](client/src/components/common/WaitingRoom.jsx) -> `.tsx`
15. [client/src/components/common/StatusDashboard.jsx](client/src/components/common/StatusDashboard.jsx) -> `.tsx`
16. [client/src/components/common/ManageDashboard.jsx](client/src/components/common/ManageDashboard.jsx) -> `.tsx`
17. [client/src/components/common/SessionRouter.jsx](client/src/components/common/SessionRouter.jsx) -> `.tsx`

### 4.5 Entry points
18. [client/src/App.jsx](client/src/App.jsx) -> `.tsx`
19. [client/src/main.jsx](client/src/main.jsx) -> `.tsx`

### 4.6 Frontend tests
20. Convert all [client/**/*.test.js](client/**/*.test.js) -> `.test.ts` or `.test.tsx`

### 4.7 Key typing patterns for frontend
- Define prop interfaces for components (extending DOM props where appropriate).
- Type `useResilientWebSocket` options and return value.
- Type React Router params/navigation usage.
- Use `ActivityRegistryEntry` for activity map.
- Type WebSocket handlers with `WebSocketMessage` unions.

---

## Phase 5: Activities Migration (Vertical Slice Approach)

Migrate activities one by one end-to-end, rather than all configs first then all components.

### 5.1 Recommended activity order
1. `activities/raffle`
2. `activities/www-sim`
3. `activities/java-string-practice`
4. `activities/algorithm-demo`
5. `activities/java-format-practice`
6. `activities/traveling-salesman`
7. `activities/gallery-walk`
8. `activities/python-list-practice`

### 5.2 Per-activity conversion pattern
For each activity:
1. Convert `activity.config.js` -> `.ts`
2. Convert `server/routes*.js` -> `.ts`
3. Convert `client/index.js|jsx` -> `.ts|.tsx`
4. Convert `client/**/*.jsx` -> `.tsx`
5. Convert `client/**/*.js` -> `.ts`
6. Convert tests (`*.test.js`) -> `.test.ts|.test.tsx`

### 5.3 Activity batching policy (one activity per PR)
Use one activity directory per migration PR.

Rules:
1. Each PR migrates exactly one `activities/<id>` directory.
2. Shared changes (types/tooling) are allowed only if required for that single activity migration.
3. Avoid cross-activity refactors in activity migration PRs.
4. Keep each PR independently reversible.

Required checks for each activity PR:
1. `npm --workspace activities test`
2. `npm run typecheck --workspaces --if-present`
3. Manual smoke check for that activity's manager and student flows

### 5.4 Activity-specific notes
- **traveling-salesman**: nested server route files under `server/routes/` need coordinated conversion.
- **gallery-walk**: shared modules under `shared/` are cross-boundary and should get early typing.
- **python-list-practice**: highest file count; keep commits smaller than other activities.
- **algorithm-demo**: preserve existing algorithm registry semantics while typing module maps.

### 5.5 Key typing patterns for activities
- Use `ActivityConfig` for config files.
- Implement `ActivityRouteRegistration` for server routes.
- Export `ActivityClientModule` shape from client index files.
- Define activity-specific session data types via `Session<TData>`.

---

## Phase 6: Scripts and Tooling Migration

### 6.1 Repo scripts
- Convert [scripts/verify-server.js](scripts/verify-server.js) -> `.ts` (or keep JS with explicit tool-compatibility rationale).

### 6.2 Tooling configs
- Convert additional config files to TS only where runtime support is stable.
- Keep `.mjs/.js` where required by tools; document each exception.

### 6.3 Root script finalization
Ensure root scripts keep full verification coverage:
- workspace tests
- `verify:deploy`
- `verify:server`
- workspace typecheck

### 6.4 Documentation updates (required)
Update documentation to reflect TypeScript-first conventions and examples.

Required docs to update:
1. [ADDING_ACTIVITIES.md](ADDING_ACTIVITIES.md)
2. [ALGORITHM_DEMO_IMPLEMENTATION.md](ALGORITHM_DEMO_IMPLEMENTATION.md)
3. [activities/algorithm-demo/README.md](activities/algorithm-demo/README.md)
4. [activities/algorithm-demo/QUICKSTART.md](activities/algorithm-demo/QUICKSTART.md)
5. [activities/algorithm-demo/EXTENSION_GUIDE.md](activities/algorithm-demo/EXTENSION_GUIDE.md)
6. [ARCHITECTURE.md](ARCHITECTURE.md)
7. [DEPLOYMENT.md](DEPLOYMENT.md)
8. [README.md](README.md)

Required doc changes:
1. Replace JavaScript-centric examples with TypeScript equivalents (`.ts`/`.tsx`).
2. Update import guidance to match runtime-safe cross-workspace resolution policy.
3. Update test command examples to mixed-extension or final TS-only commands by phase.
4. Document strictness end-state and suppression policy (`@ts-ignore` justification rules).
5. Add migration notes where both JS and TS are temporarily supported.
6. Update architecture docs for TypeScript module boundaries, shared types, and cross-workspace import policy.
7. Update deployment docs for backend compile step (`tsc -p server/tsconfig.build.json`) and compiled runtime (`node dist/server.js`).
8. Update top-level README commands/examples so contributor quick-start reflects TS migration state.

Exit criteria:
1. New contributor can add an activity/algorithm using only documented TS examples.
2. No stale JavaScript-only setup instructions remain in the listed docs.
3. Architecture and deployment docs accurately describe build and runtime behavior after migration.

---

## Phase 7: Cleanup and Finalization

### 7.1 Disable JavaScript (workspace by workspace)
After each workspace is fully converted:
```json
{
  "compilerOptions": {
    "allowJs": false,
    "checkJs": false
  }
}
```

### 7.2 Remove JavaScript source files
Delete migrated `.js/.jsx` **source** files in scope.
Do not delete:
- generated assets
- `node_modules`
- tool-required `.mjs/.js` exceptions

### 7.3 TypeScript strictness end-state
After migration is complete and stable, enforce this strictness end-state across workspaces:

Required compiler settings:
1. `strict: true`
2. `allowJs: false`
3. `noUncheckedIndexedAccess: true`
4. `noImplicitReturns: true`
5. `noFallthroughCasesInSwitch: true`
6. `noUnusedLocals: true`
7. `noUnusedParameters: true`
8. `noPropertyAccessFromIndexSignature: true`
9. `exactOptionalPropertyTypes: true`
10. `noImplicitOverride: true`

Pragmatic setting retained:
1. `skipLibCheck: true` (to avoid third-party type noise blocking migration progress)

Policy guardrails:
1. Typecheck must pass in CI with no new `@ts-ignore` unless justified inline.
2. Any temporary suppression must include a reason and a cleanup follow-up.

### 7.4 Final root scripts
Target final root scripts:
```json
{
  "scripts": {
    "typecheck": "npm run typecheck --workspaces --if-present",
    "build": "npm run typecheck && npm run build --workspace client && npm run build --workspace server",
    "test": "npm run typecheck && npm --workspace client test && npm --workspace server test && npm --workspace activities test && npm run verify:deploy && npm run verify:server"
  }
}
```

### 7.5 Production source map policy (open-source)
1. Client: keep `build.sourcemap: true` in Vite and publish generated source maps with assets.
2. Server: keep `sourceMap: true` in `server/tsconfig.build.json` and deploy `.map` files with `server/dist`.
3. Documentation: architecture/deployment docs must explicitly state that source maps are intentionally public for debugging.

---

## Critical Files

Most critical files for migration success:

1. **[tsconfig.base.json](tsconfig.base.json)** - baseline compiler contract
2. **[server/tsconfig.build.json](server/tsconfig.build.json)** - production server emit
3. **[types/index.ts](types/index.ts)** - shared type hub
4. **[client/src/activities/index.ts](client/src/activities/index.ts)** - mixed-extension client activity loading
5. **[server/activities/activityRegistry.ts](server/activities/activityRegistry.ts)** - mixed-extension server activity loading
6. **[server/core/sessions.ts](server/core/sessions.ts)** - typed session/store core
7. **[scripts/verify-server.ts](scripts/verify-server.ts)** - deployment/server verification continuity

---

## Contract and Invariant Tests

Add or strengthen these tests during migration:

### WebSocket message contract tests
Create `server/core/wsRouter.contract.test.ts`:
- Validate representative `WebSocketMessage` payload handling.
- Cover malformed payloads and unknown message types.

### Session store invariant tests
Create `server/core/sessionStore.invariant.test.ts`:
- Test InMemory and Valkey `SessionStore` lifecycle.
- Verify TTL/expiry behavior and normalization.

### Activity registry contract tests
Create `server/activities/activityRegistry.contract.test.ts`:
- Validate config loading and expected shape.
- Validate missing/invalid config behavior.
- Validate mixed extension support during migration.

### Client activity loader contract tests
Create `client/src/activities/index.contract.test.ts`:
- Validate glob map to `ActivityClientModule` shape.
- Enforce required exports.
- Reject unsupported module shapes early.

### Root typecheck in test flow
Ensure `npm run typecheck --workspaces --if-present` is part of root test verification.

---

## Verification and Testing

### Pre-migration baseline (Phase 0)
```bash
npm --workspace client test
npm --workspace server test
npm --workspace activities test
npm run verify:deploy
npm run verify:server
```

### During migration (per phase)
```bash
# Type-check workspaces
npm run typecheck --workspaces --if-present

# Run test suites
npm --workspace client test
npm --workspace server test
npm --workspace activities test

# Full root flow (recommended on phase boundaries)
npm test
```

### Runtime verification during migration
```bash
npm run dev
# Visit http://localhost:5173 and test:
# - create a session
# - join as a student
# - websocket communication
# - activity loading
# - persistent session behavior
```

### Final verification (post-cleanup)
```bash
# full verification
npm run verify:deploy
npm run verify:server

# production build/start
npm run build
npm start

# check remaining JS/JSX source files in migration scope
find client server activities scripts -path '*/node_modules/*' -prune -o -path '*/dist/*' -prune -o \( -name "*.js" -o -name "*.jsx" \) -print

# final typecheck
npm run typecheck --workspaces --if-present
```

Also verify source maps are present in production artifacts:
```bash
find client/dist -name "*.map" -print
find server/dist -name "*.map" -print
```

### Manual testing checklist
- [ ] Home page loads correctly
- [ ] Can create a new session
- [ ] Can join session as student
- [ ] WebSocket connection works (real-time updates)
- [ ] Activity selection works
- [ ] Activity manager interface functions
- [ ] Activity student interface functions
- [ ] Persistent sessions work (bookmark and return)
- [ ] QR code generation/scanning works
- [ ] Status dashboard shows correct data
- [ ] Session roster updates in real-time
- [ ] Session cleanup/ending works

---

## Migration Chores Checklist

These chores should be tracked alongside migration phases to reduce regressions and cleanup work.

1. Import specifier policy (Phase 1)
   - Define Node ESM import rules for TS (`NodeNext`) and apply consistently.
   - Document runtime-safe cross-workspace import rules (no typecheck-only alias assumptions at runtime).

2. Migration debt tracker (Phases 1-7)
   - Track temporary `any`, `@ts-ignore`, and compatibility shims.
   - Require owner + removal milestone for each entry.

3. Rename and import codemods (Phases 2-5)
   - Add lightweight scripts for `.js/.jsx` to `.ts/.tsx` renames and import-specifier rewrites.
   - Use automation for repetitive edits to reduce manual mistakes.

4. Workspace package boundary hygiene (Phases 2-6)
   - Update package `exports`/`types` fields where needed for stable cross-workspace imports.
   - Keep import boundaries explicit and aligned with runtime resolution.

5. TypeScript lint policy rollout (Phases 3-7)
   - Gradually enforce TS-focused lint rules (`any` usage, suppression comments, unused vars/params).
   - Avoid introducing strict lint changes before baseline migration stability.

6. CI performance and reliability (Phases 1-7)
   - Cache dependency installs and typecheck/build artifacts where possible.
   - Keep CI required checks fast enough for one-activity-per-PR batching.

7. Source map and debugging validation (Phases 3 and 6)
   - Verify backend source maps and stack traces work in dev and production builds.
   - Confirm deployment troubleshooting flow still works after compile-to-dist server runtime.

8. Source extension guardrail (Phase 7)
   - Add CI check that fails if source `.js/.jsx` remain in migration scope (`client`, `server`, `activities`, `scripts`), excluding generated outputs.

9. Dependency and shim cleanup (Phases 6-7)
   - Remove transitional loaders/shims and obsolete JS-only tooling when no longer needed.
   - Reconcile TS and runtime dependencies after final migration.

10. Contributor tooling updates (Phases 1 and 6)
    - Update editor/workspace settings for TypeScript-first workflows.
    - Ensure onboarding docs match final TS commands and expected IDE behavior.

---

## Risk Mitigation

### Why this sequence reduces risk
- Baseline validation prevents attributing pre-existing failures to TS migration.
- Compatibility layer prevents activity-loader regressions during mixed extension states.
- Vertical activity migration isolates failures and rollback points.
- Compiled production runtime reduces startup/runtime surprises from on-the-fly transpilation.

### If issues arise
1. Revert the specific phase commit.
2. Isolate whether issue is type-level, runtime-level, or test-discovery-level.
3. Fix and re-run phase verification.
4. Keep commits small and focused.

---

## Estimated Effort (Revised)

- **Phase 0 (Baseline verification):** 2-4 hours
- **Phase 1 (Foundation):** 8-14 hours
- **Phase 2 (Compatibility layer):** 6-10 hours
- **Phase 3 (Backend):** 14-24 hours
- **Phase 4 (Frontend):** 15-24 hours
- **Phase 5 (Activities):** 35-60 hours
- **Phase 6 (Scripts/tooling):** 5-10 hours
- **Phase 7 (Cleanup/hardening):** 6-10 hours

**Total:** ~91-156 hours

Effort varies with:
- Number of activities fully converted in a single sprint
- Strictness hardening target
- Team familiarity with TypeScript
- CI constraints and regression triage time
