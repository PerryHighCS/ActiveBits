# TypeScript Migration Plan for ActiveBits

## Project Overview

ActiveBits is a 100% JavaScript monorepo with:
- **Frontend**: React 19 + Vite + Tailwind CSS (~21 files, ~2,733 LOC)
- **Backend**: Express 5 + WebSockets + Redis/Valkey (~20 files, ~2,732 LOC)
- **Activities**: Dynamic plugin system with client + server code

Currently uses ES modules throughout. This plan will convert the entire project to TypeScript while maintaining functionality.

## Migration Strategy: Incremental Bottom-Up Approach

We'll use an incremental conversion strategy with `allowJs: true` to keep the codebase functional during migration. The order prioritizes:
1. Foundation (configs, shared types)
2. Backend (clearer boundaries, JSDoc already present)
3. Frontend (hooks → utilities → components)
4. Activities (hybrid client/server code)
5. Cleanup (disable `allowJs`, remove `.js` files)

---

## Phase 1: Foundation Setup

### 1.1 Install TypeScript Dependencies

**Root workspace:**
```bash
npm install --save-dev typescript @types/node
```

**Client workspace:**
```bash
npm install --save-dev --workspace client typescript @types/node @types/ws typescript-eslint
```

**Server workspace:**
```bash
npm install --save-dev --workspace server typescript @types/node @types/express @types/cookie-parser @types/ws tsx
```

**Activities workspace:**
```bash
npm install --save-dev --workspace activities typescript @types/node @types/react @types/react-dom
```

### 1.2 Create TypeScript Configurations

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
  "include": ["src/**/*", "vite.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Create `/workspaces/ActiveBits/server/tsconfig.json`:**
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "noEmit": true
  },
  "include": ["**/*.ts", "**/*.js"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.test.js"]
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
  "include": ["*/client/**/*", "*/server/**/*", "*/activity.config.*"],
  "exclude": ["node_modules"]
}
```

### 1.3 Create Shared Types Directory

**Create `/workspaces/ActiveBits/types/` directory with shared type definitions:**

Files to create:
- [types/session.ts](types/session.ts) - Session, SessionStore interface, activity-specific session types
- [types/activity.ts](types/activity.ts) - ActivityConfig, ActivityClientModule, ActivityRegistryEntry
- [types/websocket.ts](types/websocket.ts) - ActiveBitsWebSocket, WsRouter, WebSocketMessage types
- [types/api.ts](types/api.ts) - API request/response types
- [types/express.d.ts](types/express.d.ts) - Express augmentation with custom Locals
- [types/ambient.d.ts](types/ambient.d.ts) - Ambient module declarations for packages without types
- [types/index.ts](types/index.ts) - Re-exports all types

### 1.4 Update Build Tools

**Rename and update Vite config:** [client/vite.config.js](client/vite.config.js) → `client/vite.config.ts`
- Add proper TypeScript imports
- Vite natively supports TypeScript - no plugin changes needed

**Update server package.json scripts:**
```json
{
  "scripts": {
    "start": "node --import tsx server.ts",
    "dev": "node --import tsx server.ts --trace-warnings",
    "test": "sh -c 'set -e; files=$(find . -name \"*.test.ts\" -not -path \"./node_modules/*\" -print); if [ -z \"$files\" ]; then echo \"No server tests found\"; exit 0; fi; node --import tsx --test $files'",
    "typecheck": "tsc --noEmit"
  }
}
```

**Update client package.json scripts:**
```json
{
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

**Update ESLint:** [client/eslint.config.js](client/eslint.config.js) → `client/eslint.config.mjs`
- Add `typescript-eslint` support
- Configure for both `.ts`/`.tsx` and `.js`/`.jsx` during migration

### 1.5 Create Vite Environment Types

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

## Phase 2: Backend Migration

Convert backend files in dependency order (utilities → core → routes → entry point).

### 2.1 Core Utilities
1. [server/core/sessionNormalization.js](server/core/sessionNormalization.js) → `.ts`
2. [server/core/broadcastUtils.js](server/core/broadcastUtils.js) → `.ts`

### 2.2 Session Management
3. [server/core/sessionCache.js](server/core/sessionCache.js) → `.ts`
4. [server/core/valkeyStore.js](server/core/valkeyStore.js) → `.ts`
5. [server/core/sessions.js](server/core/sessions.js) → `.ts`

### 2.3 WebSocket & Persistent Sessions
6. [server/core/wsRouter.js](server/core/wsRouter.js) → `.ts`
7. [server/core/persistentSessions.js](server/core/persistentSessions.js) → `.ts`
8. [server/core/persistentSessionWs.js](server/core/persistentSessionWs.js) → `.ts`

### 2.4 Routes & Registry
9. [server/routes/statusRoute.js](server/routes/statusRoute.js) → `.ts`
10. [server/routes/persistentSessionRoutes.js](server/routes/persistentSessionRoutes.js) → `.ts`
11. [server/activities/activityRegistry.js](server/activities/activityRegistry.js) → `.ts`

### 2.5 Entry Point
12. [server/server.js](server/server.js) → `.ts`

### 2.6 Tests
13. Convert all [server/**/*.test.js](server/**/*.test.js) → `.test.ts`

**Key typing patterns for backend:**
- Use `Session<TData>` generic for activity-specific session data
- Implement `SessionStore` interface for both InMemory and Valkey stores
- Type Express middleware with augmented `app.locals.sessions`
- Type WebSocket with `ActiveBitsWebSocket` interface
- Use `ActivityRouteRegistration` type for activity route handlers

---

## Phase 3: Frontend Migration

Convert frontend files in dependency order (utilities → hooks → components → entry points).

### 3.1 Utilities & Activity System
1. [client/src/utils/csvUtils.js](client/src/utils/csvUtils.js) → `.ts`
2. [client/src/activities/index.js](client/src/activities/index.js) → `.ts` (complex - uses `import.meta.glob()`)

### 3.2 Custom Hooks
3. [client/src/hooks/useClipboard.js](client/src/hooks/useClipboard.js) → `.ts`
4. [client/src/hooks/useSessionEndedHandler.js](client/src/hooks/useSessionEndedHandler.js) → `.ts`
5. [client/src/hooks/useResilientWebSocket.js](client/src/hooks/useResilientWebSocket.js) → `.ts`

### 3.3 UI Components
6. [client/src/components/ui/Button.jsx](client/src/components/ui/Button.jsx) → `.tsx`
7. [client/src/components/ui/Modal.jsx](client/src/components/ui/Modal.jsx) → `.tsx`
8. [client/src/components/ui/RosterPill.jsx](client/src/components/ui/RosterPill.jsx) → `.tsx`

### 3.4 Common Components (smallest to largest)
9. [client/src/components/common/LoadingFallback.jsx](client/src/components/common/LoadingFallback.jsx) → `.tsx`
10. [client/src/components/common/SessionEnded.jsx](client/src/components/common/SessionEnded.jsx) → `.tsx`
11. [client/src/components/common/QrScannerPanel.jsx](client/src/components/common/QrScannerPanel.jsx) → `.tsx`
12. [client/src/components/common/ActivityRoster.jsx](client/src/components/common/ActivityRoster.jsx) → `.tsx`
13. [client/src/components/common/SessionHeader.jsx](client/src/components/common/SessionHeader.jsx) → `.tsx`
14. [client/src/components/common/WaitingRoom.jsx](client/src/components/common/WaitingRoom.jsx) → `.tsx`
15. [client/src/components/common/StatusDashboard.jsx](client/src/components/common/StatusDashboard.jsx) → `.tsx`
16. [client/src/components/common/ManageDashboard.jsx](client/src/components/common/ManageDashboard.jsx) → `.tsx`
17. [client/src/components/common/SessionRouter.jsx](client/src/components/common/SessionRouter.jsx) → `.tsx`

### 3.5 Entry Points
18. [client/src/App.jsx](client/src/App.jsx) → `.tsx`
19. [client/src/main.jsx](client/src/main.jsx) → `.tsx`

### 3.6 Tests
20. Convert all [client/**/*.test.js](client/**/*.test.js) → `.test.ts` or `.test.tsx`

**Key typing patterns for frontend:**
- Define prop interfaces for all components (extend HTML element props where appropriate)
- Type `useResilientWebSocket` with options interface and return type
- Type React Router with proper route params
- Use `ActivityRegistryEntry` for activity map
- Type WebSocket message handlers with `WebSocketMessage` union

---

## Phase 4: Activities Migration

Convert activity modules (both client and server code).

### 4.1 Activity Configs
1. [activities/*/activity.config.js](activities/*/activity.config.js) → `.ts` for all activities

### 4.2 Activity Server Routes
2. [activities/*/server/routes.js](activities/*/server/routes.js) → `.ts` for all activities

### 4.3 Activity Client Code
3. [activities/*/client/**/*.jsx](activities/*/client/**/*.jsx) → `.tsx` for all activity components
4. [activities/*/client/**/*.js](activities/*/client/**/*.js) → `.ts` for all activity utilities

### 4.4 Tests
5. Convert all [activities/**/*.test.js](activities/**/*.test.js) → `.test.ts` or `.test.tsx`

**Key typing patterns for activities:**
- Use `ActivityConfig` interface for config files
- Implement `ActivityRouteRegistration` type for server routes
- Export `ActivityClientModule` shape from client index files
- Define activity-specific session data types extending `Session<TData>`

---

## Phase 5: Cleanup & Finalization

### 5.1 Disable JavaScript
Update all `tsconfig.json` files:
```json
{
  "compilerOptions": {
    "allowJs": false,
    "checkJs": false
  }
}
```

### 5.2 Remove JavaScript Files
Delete all `.js` and `.jsx` files (keep only `.ts` and `.tsx`).

### 5.3 Stricter Type Checking
Optionally enable stricter compiler options:
```json
{
  "compilerOptions": {
    "noPropertyAccessFromIndexSignature": true,
    "exactOptionalPropertyTypes": true
  }
}
```

### 5.4 Update Root Scripts
Add typecheck to root [package.json](package.json):
```json
{
  "scripts": {
    "typecheck": "npm run typecheck --workspaces --if-present",
    "build": "npm run typecheck && npm run build --workspace client",
    "test": "npm run typecheck && npm --workspace client test && npm --workspace server test && npm --workspace activities test"
  }
}
```

---

## Critical Files

The following files are most critical for establishing the TypeScript foundation:

1. **[tsconfig.base.json](tsconfig.base.json)** - Root configuration that all workspace configs extend
2. **[types/index.ts](types/index.ts)** - Central type definitions hub for shared types
3. **[server/core/sessions.ts](server/core/sessions.ts)** - Core session management with SessionStore interface
4. **[client/src/activities/index.ts](client/src/activities/index.ts)** - Client activity registry with complex `import.meta.glob()` typing
5. **[server/activities/activityRegistry.ts](server/activities/activityRegistry.ts)** - Server activity registry with dynamic imports

---

## Verification & Testing

After each phase, verify the changes:

### During Migration (Per Phase)
```bash
# Type-check all workspaces
npm run typecheck --workspaces

# Run all tests
npm test

# Start dev server and verify functionality
npm run dev
# Visit http://localhost:5173 and test:
# - Create a session
# - Join as a student
# - Test WebSocket communication
# - Test activity loading
# - Test persistent sessions
```

### Final Verification (After Phase 5)
```bash
# Full build verification
npm run verify:deploy

# Production build test
npm run build
npm start
# Test production build functionality

# Check for remaining .js/.jsx files
find . -name "*.js" -o -name "*.jsx" | grep -v node_modules | grep -v dist

# Verify no type errors
npm run typecheck --workspaces
```

### Manual Testing Checklist
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

## Risk Mitigation

**Incremental approach benefits:**
- Code remains functional throughout migration
- Each conversion can be tested independently
- Can rollback specific files if issues arise
- Team learns TypeScript gradually

**If issues arise:**
1. Revert the specific commit
2. Investigate the type error
3. Fix and re-attempt conversion
4. Keep commits small and focused

---

## Estimated Effort

- **Phase 1 (Foundation)**: 4-6 hours
- **Phase 2 (Backend)**: 10-15 hours
- **Phase 3 (Frontend)**: 15-20 hours
- **Phase 4 (Activities)**: 8-12 hours
- **Phase 5 (Cleanup)**: 3-5 hours

**Total**: ~40-58 hours

Time can vary based on:
- Number of activities to convert
- Strictness level desired
- Team familiarity with TypeScript
- Amount of testing/refinement
