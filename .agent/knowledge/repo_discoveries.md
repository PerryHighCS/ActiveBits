# Repo Discoveries

Use this log for durable findings that future contributors and agents should reuse.

## Entry Template

- Date:
- Area: client | server | activities | tooling | docs
- Discovery:
- Why it matters:
- Evidence:
- Follow-up action:
- Owner:

## Discoveries

- Date: 2026-03-01
- Area: activities
- Discovery: `video-sync` telemetry now treats unsync as per-student live state (`sync.unsyncedStudents`) instead of a cumulative incident counter; student clients send a stable `studentId` with `unsync` and `sync-correction` events, and the server keeps a per-session unsynced-student map with stale-entry pruning.
- Why it matters: The instructor HUD can display “currently unsynced students” in real time, which is actionable during class playback, and stale tabs no longer keep the count inflated indefinitely.
- Evidence: `activities/video-sync/client/student/VideoSyncStudent.tsx`; `activities/video-sync/server/routes.ts`; `activities/video-sync/client/manager/VideoSyncManager.tsx`; `activities/video-sync/server/routes.test.ts`
- Follow-up action: If class sessions need stronger identity guarantees across reconnects, consider deriving/validating student identity from session auth rather than client-generated IDs.
- Owner: Codex

- Date: 2026-02-28
- Area: activities
- Discovery: The new `video-sync` activity uses a versioned websocket envelope (`version`, `activity`, `sessionId`, `type`, `timestamp`, `payload`) for all realtime traffic (`state-snapshot`, `state-update`, `heartbeat`, `telemetry-update`, `error`) so message parsing remains forward-compatible as payload shapes evolve.
- Why it matters: Activity clients can validate a stable outer contract while adding new message types or payload fields without brittle string/shape checks tied to one message body format.
- Evidence: `activities/video-sync/server/routes.ts`; `activities/video-sync/client/protocol.ts`; `activities/video-sync/server/routes.test.ts`
- Follow-up action: Reuse this envelope shape for future realtime activities and consider extracting a shared typed helper in `types/` if multiple activities adopt the same protocol wrapper.
- Owner: Codex

- Date: 2026-02-27
- Area: docs
- Discovery: Repository instructions now explicitly require frontend controls to include appropriate accessibility semantics and state attributes, with examples such as `aria-pressed`, `aria-expanded`, accessible names for icon-only controls, and preference for native interactive elements.
- Why it matters: This makes accessibility requirements part of the default implementation standard instead of a per-review afterthought, which should reduce repeated UI fixes across activities and shared client code.
- Evidence: `AGENTS.md`
- Follow-up action: When adding or reviewing frontend controls, check semantics and state exposure alongside behavior and styling.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck manager/student directional navigation is now host-overlaid on iframe edges (left/right/up/down) and driven by iframe `reveal-sync` `state/ready` payloads (`indices` + `capabilities.canNavigateBack/canNavigateForward`) rather than hardcoded deck assumptions.
- Why it matters: Navigation controls can be reused across decks without per-presentation edits, and student forward controls now disable at the effective sync boundary unless the student has opted out by backtracking.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: If reveal iframe protocol expands directional capability flags (`canNavigateLeft/Right/Up/Down`), wire those into button visibility to refine per-axis disable states beyond current back/forward capability fallback.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck manager instructor updates now relay to other instructors by default, and each manager has a local toolbar sync toggle (`🔗`) that disables both outbound instructor broadcasts and inbound instructor state application while still keeping the connection active for session metadata (for example student presence).
- Why it matters: Multiple instructors stay in lockstep by default, and any instructor can temporarily navigate independently without disrupting student/instructor shared state until they re-enable sync.
- Evidence: `activities/syncdeck/server/routes.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/server/routes.test.ts`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`
- Follow-up action: If instructors request independent viewing with read-only follow indicators, extend the toggle into explicit sync modes (follow-only, broadcast-only, fully detached) rather than introducing activity-specific behavior in shared modules.
- Owner: Codex

- Date: 2026-02-27
- Area: client
- Discovery: SyncDeck persistent teacher auth from `WaitingRoom` must send `selectedOptions` parsed from the permalink query (including decode-normalized `presentationUrl` for encoded/double-encoded values), and manager passcode hydration should replace invalid current `presentationUrl` state with the validated cookie-backed `persistentPresentationUrl`.
- Why it matters: Without `selectedOptions` in waiting-room auth, the refreshed `persistent_sessions` cookie loses `presentationUrl/urlHash`, making `/api/syncdeck/:sessionId/instructor-passcode` return null recovery fields; if query bootstrap is percent-encoded, manager state can remain invalid and block configure/start.
- Evidence: `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/sessionRouterUtils.ts`; `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `client/src/components/common/sessionRouterUtils.test.ts`
- Follow-up action: Remove temporary `[SYNCDECK-DEBUG]` logs after confirming production traces show decoded `selectedOptions.presentationUrl` and non-null `persistentPresentationUrl/persistentUrlHash` through waiting-room teacher startup.
- Owner: Codex

- Date: 2026-02-26
- Area: activities
- Discovery: SyncDeck `instructor-passcode` recovery for persistent sessions must normalize `selectedOptions.presentationUrl` from the cookie (including iterative `decodeURIComponent` fallback with up to 3 decode attempts when the stored value is percent-encoded) and recompute `urlHash` from the persistent hash when the cookie entry is missing `urlHash`.
- Why it matters: In the persistent-session teacher flow, the generic `persistent-session/authenticate` cookie rewrite can preserve or seed a cookie entry that lacks SyncDeck's `urlHash`, and encoded `presentationUrl` values fail URL validation, causing the manager to stall on the configure screen instead of auto-starting the presentation.
- Evidence: `activities/syncdeck/server/routes.ts` (`/api/syncdeck/:sessionId/instructor-passcode`); `activities/syncdeck/server/routes.test.ts` (encoded cookie URL + missing `urlHash` regression)
- Follow-up action: Investigate the upstream source of percent-encoded `presentationUrl` values entering persistent cookies (likely a double-encoded permalink copy/share path) and consider normalizing URL-validated deep-link options when persisting generic persistent-session auth cookies.
- Owner: Codex

- Date: 2026-02-26
- Area: tooling
- Discovery: GitHub Actions dependency install can intermittently fail during `esbuild` postinstall with `spawnSync .../node_modules/esbuild/bin/esbuild ETXTBSY`; switching CI to `npm ci` and retrying the install step mitigates the runner-side binary write/execute race.
- Why it matters: The failure occurs before tests run and is transient/infrastructure-related, causing flaky CI even when repository code is unchanged.
- Evidence: `.github/workflows/ci.yml` (install step retry loop + `npm ci`); CI error logs showing `node_modules/esbuild/install.js` `ETXTBSY`
- Follow-up action: If flakes continue, capture whether they cluster on a specific runner image and consider pinning npm version or adding a cache cleanup before retries.
- Owner: Codex

- Date: 2026-02-24
- Area: activities
- Discovery: SyncDeck chalkboard replay buffering now caps `chalkboard.delta` to the most recent 200 stroke commands during both runtime updates and persisted-session normalization.
- Why it matters: Prevents unbounded session-store growth and keeps replay payload size bounded when new instructor/student clients join long-running sessions with heavy drawing activity.
- Evidence: `activities/syncdeck/server/routes.ts` (`MAX_CHALKBOARD_DELTA_STROKES`, `normalizeChalkboardDelta`, `applyChalkboardBufferUpdate`); `activities/syncdeck/server/routes.test.ts`
- Follow-up action: If replay latency remains high in practice, add a size-based cap and/or server-triggered periodic `chalkboardState` snapshot refreshes so stroke deltas reset more aggressively.
- Owner: Codex

- Date: 2026-02-25
- Area: tooling
- Discovery: `client/tsconfig.json` and `activities/tsconfig.json` need `lib` aligned with the repo `ES2022` baseline (plus DOM libs) to avoid client/activity typecheck failures for newer standard APIs like `Array.prototype.at`.
- Why it matters: Mixed lib baselines let the same API typecheck in server/shared contexts (`ES2022`) but fail in client/activity code still using `ES2020` libs, causing inconsistent TS diagnostics during migration work.
- Evidence: `tsconfig.base.json`; `client/tsconfig.json`; `activities/tsconfig.json`
- Follow-up action: Keep workspace `lib` arrays aligned when raising the base TS target/lib to prevent drift between browser and server type environments.
- Owner: Codex

- Date: 2026-02-25
- Area: client
- Discovery: Upgrading `eslint-plugin-react-hooks` to `7.x` adds stricter lint rules (including `react-hooks/refs` and `react-hooks/immutability`) that flag render-time ref reads and callback self-reference patterns previously accepted by the repo.
- Why it matters: Major lint-plugin upgrades can require behavior-preserving code refactors (not just config/package changes) to keep `npm test` green.
- Evidence: `client/src/components/common/StatusDashboard.tsx`; `client/src/hooks/useResilientWebSocket.ts`; `client/package.json`
- Follow-up action: When upgrading React hooks lint tooling, run full lint early and budget time for small hook/ref refactors instead of assuming a lockfile-only change.
- Owner: Codex

- Date: 2026-02-25
- Area: activities
- Discovery: `java-format-practice` client-side formatter evaluator must support Java hex specifiers (`%x/%X`) because advanced challenge output validation relies on `%04X` in the mission badge clearance line.
- Why it matters: Missing `%x/%X` support leaves tokens like `%04X` uninterpreted in client validation/output previews, causing false negatives in otherwise correct advanced answers.
- Evidence: `activities/java-format-practice/client/utils/formatUtils.ts`; `activities/java-format-practice/client/evaluateFormatString.test.ts`
- Follow-up action: Add evaluator test cases whenever new Java `Formatter` specifiers are introduced in challenge content so challenge migrations cannot silently outpace parser support.
- Owner: Codex

- Date: 2026-02-25
- Area: activities
- Discovery: `java-format-practice` student difficulty/theme controls must be treated as solo-only; in managed sessions the student view should reflect manager broadcasts but not allow local changes.
- Why it matters: A TypeScript migration regression left the student selector interactive in teacher-managed sessions, allowing students to change session-wide difficulty/theme outside the manage dashboard.
- Evidence: `activities/java-format-practice/client/student/JavaFormatPractice.tsx`; `activities/java-format-practice/client/components/basicComponents.test.tsx`
- Follow-up action: When migrating activity student views, explicitly gate session-setting handlers and selector interactivity on `isSoloSession` to avoid reintroducing managed-mode control paths.
- Owner: Codex

- Date: 2026-02-24
- Area: server
- Discovery: `activity.config` files now have a shared runtime parser/schema (`types/activityConfigSchema.ts`) and the server activity registry validates configs during load before filtering/route registration.
- Why it matters: TypeScript annotations on activity configs do not protect runtime-loaded `.js` configs or malformed shared-contract fields; schema validation now fails fast in production with a config-path-specific error.
- Evidence: `types/activityConfigSchema.ts`; `server/activities/activityRegistry.ts`; `server/activityConfigSchema.test.ts`; `server/activities/activityRegistry.test.ts`
- Follow-up action: Consider reusing the same parser in `client/src/activities/index.ts` so the dashboard/client registry warns and skips invalid configs consistently in the browser build path too.
- Owner: Codex

- Date: 2026-02-24
- Area: client
- Discovery: Shared `ManageDashboard` now supports a generic `createSessionBootstrap.sessionStorage[]` activity-config contract for persisting create-session response fields (for example SyncDeck `instructorPasscode`) without activity-specific conditionals in shared code.
- Why it matters: Preserves the Activity Containment Boundary by keeping shared dashboard logic activity-agnostic while still allowing activities to bootstrap manager-only client state from create responses.
- Evidence: `types/activity.ts`; `client/src/components/common/manageDashboardUtils.ts`; `client/src/components/common/ManageDashboard.tsx`; `activities/syncdeck/activity.config.ts`; `client/src/components/common/manageDashboardUtils.test.ts`
- Follow-up action: Reuse this contract for future activities that need post-create client bootstrap values, and extend the contract (rather than branching in shared UI) if new storage targets are needed.
- Owner: Codex

- Date: 2026-02-24
- Area: server
- Discovery: `resolvePersistentSessionSecret()` now memoizes the first successfully resolved value for the process, so later calls return the same secret and do not repeat warning side effects.
- Why it matters: Multiple modules import persistent-session helpers at module init (including activity routes), and without memoization non-production warnings can duplicate while test/runtime env mutations could produce inconsistent HMAC secrets across call sites.
- Evidence: `server/core/persistentSessions.ts`; `server/persistentSessionsSecret.test.ts`
- Follow-up action: If future tests need to exercise multiple resolver scenarios in one process, continue using cache-busting dynamic imports (or add a test-only reset helper rather than mutating global process env mid-module).
- Owner: Codex

- Date: 2026-02-24
- Area: activities
- Discovery: SyncDeck persistent-link cookie entries must persist the signed `urlHash` alongside `presentationUrl` (or equivalent full query params), because the generic dashboard list/CSV/copy flow reconstructs share links from cookie `selectedOptions`.
- Why it matters: If only `presentationUrl` is stored, previously created SyncDeck links copied/exported from `/manage` lose `urlHash`, causing tamper-protection bypass/failure and broken links.
- Evidence: `activities/syncdeck/server/routes.ts` (`/api/syncdeck/generate-url` cookie write); `server/routes/persistentSessionRoutes.ts` (`/api/persistent-session/list` returns cookie `selectedOptions`); `client/src/components/common/ManageDashboard.tsx` + `client/src/components/common/manageDashboardUtils.ts` (copy/CSV append query from `selectedOptions`)
- Follow-up action: Keep signed/generated query params in sync with any future SyncDeck deep-link integrity fields and add migration handling if cookie entry shape changes again.
- Owner: Codex

- Date: 2026-02-23
- Area: tooling
- Discovery: Upgrading `client`/`server` to `eslint@10` is currently blocked by `eslint-plugin-react-hooks`. The latest published `eslint-plugin-react-hooks@7.0.1` still declares a peer dependency range that supports ESLint up to `^9.0.0`, so `npm install` fails with `ERESOLVE` before lint can run.
- Why it matters: Future dependency update attempts may incorrectly assume ESLint 10 is ready because `npm outdated` shows newer `eslint` and `@eslint/js` versions. This saves time and avoids forced installs on the main branch.
- Evidence: `client/package.json`; `server/package.json`; `npm install --include=dev --workspaces --include-workspace-root` (ERESOLVE peer conflict); `npm view eslint-plugin-react-hooks@latest version peerDependencies --json`
- Follow-up action: Re-check `eslint-plugin-react-hooks` peer support for ESLint 10 on the next dependency refresh, then retry the ESLint 10 bump in a separate commit.
- Owner: Codex

- Date: 2026-02-23
- Area: client
- Discovery: `deepLinkOptions` is currently UI/query metadata only; the generic permanent-link flow appends selected options as query params and does not cryptographically bind them. A safer extension path is to keep the shared modal UX in `ManageDashboard` but allow an activity-configured deep-link generator endpoint to return the authoritative URL.
- Why it matters: Activities that require integrity-protected deep-link params (for example SyncDeck `presentationUrl` + `urlHash`) should not rely on unsigned query strings from the generic create route.
- Evidence: `activities/algorithm-demo/activity.config.ts`; `client/src/components/common/manageDashboardUtils.ts`; `client/src/components/common/ManageDashboard.tsx`; `server/routes/persistentSessionRoutes.ts`; `client/src/components/common/SessionRouter.tsx`
- Follow-up action: Implement optional `deepLinkGenerator` in `ActivityConfig`, branch `ManageDashboard` create-link calls to that endpoint when configured, and keep legacy `/api/persistent-session/create` behavior as fallback.
- Owner: Codex

- Date: 2026-02-23
- Area: client
- Discovery: `deepLinkOptions` now supports an explicit per-field validator contract (`validator: 'url'`) that is parsed by dashboard utilities and enforced in ManageDashboard modals with inline field errors and disabled actions.
- Why it matters: Activity configs can require valid URL inputs before link creation/copy/open actions, reducing malformed deep-link generation and improving teacher feedback in the modal UX.
- Evidence: `types/activity.ts`; `client/src/components/common/manageDashboardUtils.ts`; `client/src/components/common/ManageDashboard.tsx`; `activities/syncdeck/activity.config.ts`; `client/src/components/common/manageDashboardUtils.test.ts`; `npm --workspace client test`
- Follow-up action: Reuse `validator: 'url'` for any future deep-link text fields that represent external links; add additional validator types only when there is a concrete activity need.
- Owner: Codex

- Date: 2026-02-23
- Area: server
- Discovery: SyncDeck now validates `presentationUrl` format in both deep-link generation (`/api/syncdeck/generate-url`) and runtime configure (`/api/syncdeck/:sessionId/configure`) so the configure path no longer accepts non-http(s) URLs.
- Why it matters: Prevents bypass where malformed or unsafe URLs could be injected at configure time even if deep-link generation validates correctly.
- Evidence: `activities/syncdeck/server/routes.ts`; `activities/syncdeck/server/routes.test.ts`; `npm --workspace activities run test:activity --activity=syncdeck`; `npm test`
- Follow-up action: Keep validation helpers aligned if URL policy is tightened (for example hostname allowlists), and mirror policy in both generation and configure endpoints.
- Owner: Codex

- Date: 2026-02-23
- Area: activities
- Discovery: SyncDeck student sync requires translating iframe-origin `reveal-sync` `action: "state"` messages into plugin-compatible host commands (`action: "command"`, `payload.name: "setState"`) before posting into the student iframe.
- Why it matters: Forwarding raw state envelopes does not reliably apply navigation in the custom `reveal-iframe-sync` plugin contract; command-form messages are the stable host→iframe control surface.
- Evidence: `.agent/plans/reveal-iframe-sync-message-schema.md`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/server/routes.ts`.
- Follow-up action: Keep all new SyncDeck relay commands aligned to the schema doc and add explicit tests when introducing additional command names beyond `setState`.
- Owner: Codex

- Date: 2026-02-23
- Area: activities
- Discovery: In SyncDeck manager, websocket URL builders passed to `useResilientWebSocket` must be memoized (`useCallback`) to prevent reconnect churn and visible status-dot flicker.
- Why it matters: Recreated URL builder functions can trigger repeated connect/disconnect cycles, which can interrupt message relay and make connection state indicators unstable.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx` (`buildInstructorWsUrl` + indicator debounce); observed red/green flashing resolved after memoization.
- Follow-up action: For future activities using `useResilientWebSocket`, memoize `buildUrl` callbacks and debounce transient disconnected indicators in UI status elements.
- Owner: Codex

- Date: 2026-02-23
- Area: server
- Discovery: Persistent-session HMAC secret validation is now strict in production. `PERSISTENT_SESSION_SECRET` must be present, at least 32 characters, and not in the weak/default denylist; otherwise process startup throws.
- Why it matters: Prevents running production with a known/default key that would allow forged persistent hashes and offline teacher-code guessing against HMAC-derived link checks.
- Evidence: `server/core/persistentSessions.ts` (`resolvePersistentSessionSecret`); `activities/syncdeck/server/routes.ts` (SyncDeck urlHash now uses shared resolver).
- Follow-up action: Ensure deployment environments set a strong random secret before rollout; keep test/dev environments on non-production mode unless intentionally validating startup failures.
- Owner: Codex

- Date: 2026-02-24
- Area: client
- Discovery: `ManageDashboard` now supports an activity-owned persistent-link builder UI slot via client-module export (`PersistentLinkBuilderComponent`), gated by `activity.config.manageDashboard.customPersistentLinkBuilder`, while generic activities continue using shared `deepLinkOptions` form handling.
- Why it matters: Keeps shared dashboard code activity-agnostic and moves complex preflight/protocol-specific permalink UX (like SyncDeck reveal-sync validation/preview) into the owning activity without losing a standardized modal placement.
- Evidence: `types/activity.ts`; `types/activityConfigSchema.ts`; `client/src/activities/index.ts`; `client/src/components/common/ManageDashboard.tsx`; `activities/syncdeck/activity.config.ts`; `activities/syncdeck/client/index.tsx`; `activities/syncdeck/client/components/SyncDeckPersistentLinkBuilder.tsx`
- Follow-up action: Focus future changes on evolving `ActivityPersistentLinkBuilderProps` (only if multiple activities need more shared callbacks/state) rather than adding protocol-specific branches back into `ManageDashboard`.
- Owner: Codex

- Date: 2026-02-26
- Area: client
- Discovery: Shared HTTP(S) URL validation used by `ManageDashboard` deep-link parsing and `SessionRouter` teacher redirect parsing now lives in `client/src/components/common/urlValidationUtils.ts` (`isValidHttpUrl`), and `SessionRouter`'s async manage-path resolver is memoized with `useCallback` so `react-hooks/exhaustive-deps` can include it without warnings.
- Why it matters: Prevents duplicate URL-policy drift across client parsers and keeps hook dependency arrays both correct and lint-clean when async helpers are referenced from effects.
- Evidence: `client/src/components/common/urlValidationUtils.ts`; `client/src/components/common/manageDashboardUtils.ts`; `client/src/components/common/sessionRouterUtils.ts`; `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/sessionRouterUtils.test.ts`
- Follow-up action: Reuse `urlValidationUtils.ts` for future client-side URL validation instead of re-implementing `new URL(...)` checks in feature files.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck index extraction now accepts `reveal-sync` `action: "ready"` envelopes in both manager and student clients, not only `state`, so first-message index snapshots are retained.
- Why it matters: Some decks publish navigation indices in the initial ready handshake, so keeping the parsers action-tolerant preserves first-message state if host-side navigation or diagnostics are reintroduced later.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: Keep reveal-sync parsing helpers action-tolerant when payload schema matches, and add tests whenever new actions can carry `indices`.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck manager restore conversion now treats restorable `reveal-sync` `ready` envelopes like `state` by translating `indices` or `navigation.current` into a `command/setState` restore before restore suppression is armed.
- Why it matters: Without this alignment, a `ready` message could contribute indices to suppression tracking while being posted back to the iframe unchanged, causing outbound state to be dropped until timeout with no actual restore applied.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`
- Follow-up action: Keep `extractIndicesFromRevealPayload()` and `buildRestoreCommandFromPayload()` behavior in sync whenever new inbound reveal actions become restorable.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck manager no longer relays outbound `reveal-sync` `ready` envelopes to the sync server; only meaningful state-bearing updates should drive cross-instructor synchronization.
- Why it matters: Initial iframe `ready` messages often report default indices before a pending restore is applied, and broadcasting them can make peer instructors jump backward by restoring from stale startup coordinates.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/shared/revealSyncRelayPolicy.ts`; `activities/syncdeck/client/shared/revealSyncRelayPolicy.test.ts`
- Follow-up action: If a future multi-instructor feature genuinely needs `ready` propagation, add an explicit opt-in relay path instead of falling back to generic outbound state relay.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck no longer exports unused `extractNavigationCapabilities()` helpers from the manager or student clients; dormant host-navigation parsing was removed because the shipped shells do not render overlay arrow controls that consume those values.
- Why it matters: Keeps the SyncDeck client modules aligned with actual runtime behavior, removes duplicated parser code, and avoids implying a supported host-navigation API surface that is not part of the shipped UI.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: If host-side navigation returns, reintroduce protocol parsing only alongside a real runtime consumer and keep the implementation shared instead of duplicating manager/student helpers.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck manager no longer exports the unused `buildDirectionalSlideIndices()` helper or its direction type; those test-only artifacts were removed because the host shell does not ship directional navigation controls.
- Why it matters: Keeps the production module surface aligned with actual runtime behavior and avoids implying a supported host-navigation API that the manager does not use.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`
- Follow-up action: If host-side directional navigation returns, add the helper back only alongside a real runtime caller rather than exporting test-only code from the manager module.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck student no longer exports the unused `isForwardNavigationLocked()` helper; forward-lock calculation remained only in unit tests after student forward-lock UI was left out of the shipped shell.
- Why it matters: Keeps `SyncDeckStudent.tsx` focused on active runtime behavior and avoids preserving a dead API surface that suggests the student shell currently enforces host-side forward-lock UI.
- Evidence: `activities/syncdeck/client/student/SyncDeckStudent.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
- Follow-up action: If student forward-lock UI returns, add the calculation back alongside a real runtime caller rather than exporting it solely for tests.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck manager restore suppression now drops the first outbound `reveal-sync` `state` emitted when an inbound restore reaches target indices, then releases suppression.
- Why it matters: Prevents instructor-to-instructor echo loops where a relayed inbound state triggers a local `setState` restore, then re-broadcasts that same state back through the server.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`
- Follow-up action: Reuse `evaluateRestoreSuppressionForOutboundState` if additional restore paths are added so echo prevention remains consistent.
- Owner: Codex

- Date: 2026-02-27
- Area: activities
- Discovery: SyncDeck host-side iframe overlay arrow controls were removed from both manager and student shells; navigation is now expected to use presentation-native controls inside the deck.
- Why it matters: Avoids duplicate/competing navigation UI at the host layer and removes schema-coupled host arrow-state complexity.
- Evidence: `activities/syncdeck/client/manager/SyncDeckManager.tsx`; `activities/syncdeck/client/student/SyncDeckStudent.tsx`
- Follow-up action: Keep host shell focused on sync/session controls; add navigation affordances in deck content/plugins if needed.
- Owner: Codex
