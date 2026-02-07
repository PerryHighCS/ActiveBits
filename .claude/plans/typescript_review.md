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
