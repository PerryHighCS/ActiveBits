# Testing Coverage Review

## Purpose

Track the current test inventory, map critical flows to automated coverage, and make the remaining P0/P1/P2 gaps reviewable.

## Current Tooling Baseline

- Root/unit-contract gate: `npm test`
- Sandbox fallback gate for blocked port-binding environments: `npm run test:codex`
- Browser interaction gate for shared routed flows: `npm run test:e2e`
- Shared Playwright harness: `playwright.config.ts`
- Current Playwright projects: `chromium`, `webkit`

## Inventory Snapshot

### Root

| Area | Type | Evidence | Notes |
| --- | --- | --- | --- |
| Deploy/build smoke | smoke | `package.json` `verify:deploy` | Confirms client build path remains valid |
| Server runtime smoke | smoke | `package.json` `verify:server` | Validates server entry/runtime assumptions |
| Browser shared-surface smoke | e2e | `playwright/home-and-manage.spec.ts` | Confirms `/` and `/manage` card emission in real browser runtime |

### Client Shared

| Area | Type | Evidence | Notes |
| --- | --- | --- | --- |
| Activity loader contract | unit | `client/src/activities/index.test.ts` | Covers registry/module shape assumptions |
| Manage dashboard shared logic | unit | `client/src/components/common/manageDashboardUtils.test.ts` | Covers permalink option handling and helpers |
| Manage dashboard behavior seam | unit | `client/src/components/common/ManageDashboard.test.tsx` | Covers shared dashboard interactions in Node runner |
| Session router shared logic | unit | `client/src/components/common/sessionRouterUtils.test.ts` | Covers routing/persistent-link helper behavior |
| Waiting-room shared logic | unit | `client/src/components/common/waitingRoom*.test.ts`; `WaitingRoomContent.test.tsx` | Strong seam coverage for entry flow decisions |

### Server Shared

| Area | Type | Evidence | Notes |
| --- | --- | --- | --- |
| Activity registry | integration | `server/activities/activityRegistry.test.ts` | Covers activity discovery/registration edges |
| Persistent session routes | integration | `server/persistentSessionRoutes.test.ts` | Covers permalink auth and route contracts |
| Entry/session lifecycle helpers | unit/integration | `server/entryStatus.test.ts`; `server/sessionEntryRoutes.test.ts`; related files | Strong server-side waiting-room/session coverage |
| Status/report registries | unit/integration | `server/statusRoute.test.ts`; `server/activityReportRegistry.test.ts` | Covers shared operational/report wiring |

### Activities

| Area | Type | Evidence | Notes |
| --- | --- | --- | --- |
| Resonance | unit/integration | `activities/resonance/**/*.test.*` | Strong activity-local manager/student/server coverage |
| SyncDeck | unit/integration | `activities/syncdeck/**/*.test.*` | Strong embedded/runtime-specific coverage |
| Other active activities | unit/integration | `activities/*/**/*.test.*` | Most migrated activities already have focused local coverage |

## Flow-To-Test Mapping

| Flow | Current coverage | Status |
| --- | --- | --- |
| `/manage` activity card emission | `playwright/home-and-manage.spec.ts`; `client/src/activities/index.test.ts` | Covered |
| `/` standalone + utility card emission | `playwright/home-and-manage.spec.ts`; `client/src/components/common/sessionRouterUtils.test.ts` | Covered |
| Shared activity registry import/discovery contract | `client/src/activities/index.test.ts`; `server/activities/activityRegistry.test.ts` | Covered |
| Waiting-room entry outcome matrix | shared server/client helper tests across `entryStatus`, `waitingRoom*`, `sessionEntry*` | Covered |
| Permalink create/update shared dashboard flow | `ManageDashboard.test.tsx`; `manageDashboardUtils.test.ts` | Covered at seam/unit layer |
| `live/solo` permalink transition | helper/seam coverage only | Gap |
| Waiting-room name persistence and rejoin skip flow | helper/seam coverage only | Gap |
| Permalink role-auth split across student/teacher browsers | helper/seam coverage only | Gap |

## Uncovered Risk List

### P0

- `live/solo` permalink waiting-room transition across router + fetch + websocket + storage boundaries still lacks a browser test.
- Teacher/student permalink role-auth split still lacks a mounted browser flow that proves the end-to-end navigation/auth behavior.

### P1

- Waiting-room name persistence/rejoin skip behavior still relies on seam coverage rather than a full mounted browser interaction.
- Additional shared browser-visible routing surfaces beyond `/` and `/manage` do not yet have Playwright smoke coverage.

### P2

- Non-critical utility flows still rely mostly on unit/activity-local coverage.
- No visual/screenshot regression layer is planned in the first wave.

## First Proposed PR Slices

1. Add Playwright permalink `live/solo` transition coverage for the shared waiting-room flow.
2. Add Playwright waiting-room rejoin/name-persistence coverage.
3. Add Playwright permalink role-auth split coverage and then reassess whether any additional shared browser smoke is needed.

## Notes

- In environments that block local port binding, validate the Node-based suite with `npm run test:codex` and run `npm run test:e2e` in a canonical or escalated environment.
- Keep Playwright scoped to shared high-value flows; continue using seam/unit/contract tests for the fast inner loop.
