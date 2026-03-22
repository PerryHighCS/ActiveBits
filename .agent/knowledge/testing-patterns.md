# Testing Patterns

Capture reusable test setup patterns, common failure modes, and reliability guidance.

## Entry Template

- Date:
- Scope: unit | integration | e2e
- Pattern:
- Why it helps:
- Example (file/path):
- Failure signal:
- Follow-up action:
- Owner:

## Entries

- Date: 2026-03-04
- Scope: integration
- Pattern: Session-store mocks for route tests should return deep clones from `get()` and store clones on `set()` when production storage serializes records between calls.
- Why it helps: Returning the same object by reference can make normalization or projection tests appear to "persist" changes even when the route never calls `sessions.set(...)`, which hides real persistence bugs and diverges from Valkey-backed behavior.
- Example (file/path): `activities/video-sync/server/routes.test.ts`
- Failure signal: Tests that inspect the backing mock store pass despite zero `set()` calls after a read-only route mutates the fetched session object.
- Follow-up action: Pair cloned-store mocks with explicit `set()` call assertions when a test cares about persistence versus response-only normalization; for `video-sync` session reads, expect `set()` when normalization repairs persisted fields, but not for ordinary projection-only reads.
- Owner: Codex

- Date: 2026-03-14
- Scope: unit
- Pattern: For waiting-room entry logic, put the outcome matrix in small shared server/client helpers and test those helpers directly before relying on route/component integration coverage.
- Why it helps: The important regressions here are policy/output combinations (`wait`, `join-live`, `continue-solo`, `solo-unavailable`, `render-ui`, `pass-through`) and one-shot handoff semantics, which are easier to exercise exhaustively in helper tests than through brittle full-component flows.
- Example (file/path): `server/entryStatus.test.ts`; `server/sessionEntryParticipants.test.ts`; `client/src/components/common/entryParticipantStorage.test.ts`
- Failure signal: A new policy branch or handoff behavior changes the resolved outcome/presentation or token cleanup semantics without any route/component snapshot obviously failing.
- Follow-up action: Keep helper-level matrix coverage current as new entry outcomes or handoff semantics are added, then add integration tests only for the riskiest UI or API glue.
- Owner: Codex

- Date: 2026-03-14
- Scope: integration
- Pattern: When a server test intentionally triggers noisy warning/error output on waiting-room entry paths, add a short `[TEST]` console marker immediately before the trigger so expected parse/auth noise is distinguishable from real regressions in the test log.
- Why it helps: Waiting-room and permalink tests now intentionally exercise corrupted-cookie and similar failure paths; explicit markers make the resulting server logs legible during focused runs and in broader sandbox fallback gates.
- Example (file/path): `server/persistentSessionRoutes.test.ts`
- Failure signal: Test output includes scary-looking parse/auth error logs with no nearby indication that the noise was intentionally triggered by the test.
- Follow-up action: Add the same marker pattern to future waiting-room tests that intentionally produce console noise, especially around cookie parsing, auth failures, or storage fallbacks.
- Owner: Codex

- Date: 2026-03-14
- Scope: unit
- Pattern: For shared components that are hard to import in the Node test runner because their container pulls Vite-only activity loading, extract a pure presentational seam and test that seam with `react-dom/server` markup assertions first.
- Why it helps: This gives us real accessibility and control-state coverage without forcing a new browser harness or trying to mock `import.meta.glob` inside the existing Node-based client suite.
- Example (file/path): `client/src/components/common/WaitingRoomContent.tsx`; `client/src/components/common/WaitingRoomContent.test.tsx`
- Failure signal: Important ARIA wiring or disabled-state regressions slip through because the only directly testable surface is a low-level helper, while the container component remains too heavy for the current test runner.
- Follow-up action: Use this seam pattern sparingly for high-value shared containers, then add fuller interaction tests later if the runtime boundary becomes easier to exercise.
- Owner: Codex

- Date: 2026-03-14
- Scope: unit
- Pattern: For `WaitingRoom` carry-forward behavior, extract the persistence branch into a helper that owns the “store server-backed token or fall back to local values” decision, then test that helper directly instead of trying to drive the whole container through storage and network state.
- Why it helps: The riskiest regression in this area is not the visual shell, it is whether entry data is preserved correctly when the server handoff succeeds, fails, or returns malformed payload. A focused helper test covers that contract cheaply and keeps the current Node client suite sufficient without jumping to Playwright.
- Example (file/path): `client/src/components/common/waitingRoomHandoffUtils.ts`; `client/src/components/common/waitingRoomHandoffUtils.test.ts`
- Failure signal: Waiting-room carry-forward silently stops preserving data after a failed handoff write, or starts storing raw values when an opaque token should have been written, without any render-only test noticing.
- Follow-up action: Reuse this seam-first pattern for other `WaitingRoom` transition branches, especially websocket-driven wait-state decisions, before considering a heavier browser harness.
- Owner: Codex

- Date: 2026-03-14
- Scope: unit
- Pattern: For `WaitingRoom` websocket message handling, move the message-to-transition decision into a helper that returns navigation, error, submit-state, or waiter-count updates, then test that matrix directly.
- Why it helps: It covers the highest-risk wait-state behavior, like teacher-authenticated routing and teacher-code rejection recovery, without trying to spin up the full websocket lifecycle inside the shared component test.
- Example (file/path): `client/src/components/common/waitingRoomTransitionUtils.ts`; `client/src/components/common/waitingRoomTransitionUtils.test.ts`
- Failure signal: Wait-state routing regresses, but render-only and storage-only tests still pass because the bug lives in message interpretation rather than UI presentation.
- Follow-up action: Keep the remaining websocket-specific tests focused on lifecycle wiring, such as open/close/error behavior, and only escalate to a browser harness if those cases cannot be covered cleanly through helper seams plus existing route tests.
- Owner: Codex

- Date: 2026-03-14
- Scope: unit
- Pattern: For heavy submit handlers inside `WaitingRoom`, extract just the post-request decision matrix instead of the whole network flow. Cover the branch between manage redirect, websocket verification, and user-facing error states with a pure helper.
- Why it helps: It captures the real product risk in teacher-code submission without forcing the client suite to mock the entire fetch + websocket + navigation stack inside the shared container.
- Example (file/path): `client/src/components/common/waitingRoomTeacherSubmitUtils.ts`; `client/src/components/common/waitingRoomTeacherSubmitUtils.test.ts`
- Failure signal: Teacher-code submit starts routing to the wrong destination or leaves the wrong error/submitting state behind, while fetch/auth helper tests still pass.
- Follow-up action: Treat the remaining uncovered portion as container wiring. If that wiring becomes important enough to test, prefer one higher-level interaction layer instead of continuing to split out tiny helpers.
- Owner: Codex

- Date: 2026-03-14
- Scope: unit
- Pattern: For websocket `onopen` branches that recover remembered teacher auth, extract the “fetch remembered code then send verification” flow into a small helper and test success, missing-data, fetch-failure, and send-failure cases directly.
- Why it helps: This covers the last substantial async branch inside `WaitingRoom` without introducing a browser harness just to exercise cookie-backed teacher auto-auth.
- Example (file/path): `client/src/components/common/waitingRoomAutoAuthUtils.ts`; `client/src/components/common/waitingRoomAutoAuthUtils.test.ts`
- Failure signal: Teacher-cookie auto-auth silently stops sending verification, or starts throwing on fetch/send failures, while message-transition and render tests still pass.
- Follow-up action: After this seam, be cautious about further extraction. The remaining websocket lifecycle cases are likely better treated as either accepted container risk or a reason to add a higher-level harness later.
- Owner: Codex

- Date: 2026-03-14
- Scope: unit
- Pattern: When the remaining untested logic in a heavy shared component is the websocket handler wiring itself, extract one attachment helper that owns `onopen`, `onmessage`, `onerror`, and `onclose` setup and test that at the event-handler level.
- Why it helps: This is the last efficient seam before a higher-level harness. It verifies the actual lifecycle wiring while still avoiding a browser runner and without fragmenting the component into many smaller helpers that only mirror individual lines.
- Example (file/path): `client/src/components/common/waitingRoomSocketUtils.ts`; `client/src/components/common/waitingRoomSocketUtils.test.ts`
- Failure signal: The component’s websocket lifecycle behavior regresses even though the smaller decision helpers still pass, because handlers were attached incorrectly or navigation/error behavior changed at the wiring layer.
- Follow-up action: Treat the remaining uncovered behavior as true container integration. If confidence beyond this point is required, prefer an explicit interaction harness decision over more helper extraction.
- Owner: Codex

- Date: 2026-03-14
- Scope: unit
- Pattern: For activity-owned reconnect/recovery behavior that hangs off websocket close events, extract the close-decision logic into a tiny activity-local helper and test that helper directly instead of trying to simulate the whole websocket lifecycle in the component test.
- Why it helps: It keeps the test focused on the product contract change, like “stale server-issued identity should clear cached registration and require rejoin,” without depending on browser WebSocket mocks or the full student component state machine.
- Example (file/path): `activities/syncdeck/client/student/reconnectUtils.ts`; `activities/syncdeck/client/student/reconnectUtils.test.ts`
- Failure signal: Recovery copy/state regressions slip through because the only available tests cover low-level URL builders or large render snapshots, not the close-event decision itself.
- Follow-up action: Reuse this pattern for other activity-owned reconnect paths when the decision surface is stable and the container wiring is much heavier than the rule being tested.
- Owner: Codex

- Date: 2026-03-13
- Scope: integration
- Pattern: In sandboxed agent environments where some server tests fail during local port binding or related host restrictions, use `npm run test:codex` as the validation gate and record the skipped full-suite limitation alongside targeted checks for the touched server surface.
- Why it helps: It preserves a strong merge gate (`typecheck`, `lint`, client tests, non-port server tests, activities tests) without misattributing environment-specific failures in unrelated server files to the active change.
- Example (file/path): `package.json` (`test:codex`); waiting-room entry-policy slice validated with `node --import tsx --test server/persistentSessionRoutes.test.ts`
- Failure signal: Full `npm test` fails in sandbox with unrelated server test files such as `server/galleryWalkRoutes.test.ts`, `server/sessionStore.test.ts`, or `server/statusRoute.test.ts`, while `npm run test:codex` passes.
- Follow-up action: When working outside the sandbox, rerun full `npm test`; inside the sandbox, keep adding focused tests for modified server files so behavior changes are still covered.
- Owner: Codex

- Date: 2026-03-05
- Scope: unit
- Pattern: Prefer behavior-driven assertions over source-text matching (for example, avoid `readFileSync` + regex checks against component source strings).
- Why it helps: Source-string tests are brittle under formatting/renaming and can fail without any runtime regression signal.
- Example (file/path): `activities/syncdeck/client/shared/syncDebug.test.ts`
- Failure signal: Tests fail after whitespace or symbol-name changes even though debug/tracing behavior is unchanged.
- Follow-up action: Keep checks at API/runtime boundary; place any unavoidable structural checks close to the owning component tests.
- Owner: Codex

- Date: 2026-02-26
- Scope: integration
- Pattern: When `server/activities/activityRegistry` is initialized during `node --test`, treat a discovered config file that disappears before import as a skippable race (`ERR_MODULE_NOT_FOUND` or loader-level `ENOENT`) instead of a fatal production config error.
- Why it helps: Server test files run concurrently and some tests create/remove temporary `activities/<id>` folders; registry initialization in another file can observe the directory during discovery and lose the config before load.
- Example (file/path): `server/activities/activityRegistry.ts`; `server/activities/activityRegistry.test.ts`
- Failure signal: CI fails with `[ERROR] Failed to load config for activity "...test-activity..."` followed by `ENOENT ... activity.config.js` and a fatal production exit during unrelated server tests.
- Follow-up action: Prefer temp fixtures outside the auto-discovered `activities/` root when possible, or mark them `isDev` and clean up deterministically.
- Owner: Codex

- Date: 2026-03-14
- Scope: e2e
- Pattern: Treat the `live/solo` permalink waiting-room transition as a strong first Playwright candidate if the repo adds browser-level coverage later, but do not block fixes on that harness while the seam suite still covers the logic reliably.
- Why it helps: This flow crosses the exact boundaries that are awkward in the current Node client runner: same-browser student/instructor reuse, teacher-code auth, websocket-driven state flips from solo to live join and back again, and permalink-specific router behavior while the same waiting-room screen stays mounted.
- Example (file/path): `client/src/components/common/WaitingRoom.tsx`; `client/src/components/common/SessionRouter.tsx`; `client/src/components/common/waitingRoomSocketUtils.test.ts`; `client/src/components/common/waitingRoomTeacherSubmitUtils.test.ts`
- Failure signal: Manual browser testing finds regressions in the `live/solo` permalink flow even though the helper/unit suite still passes, especially around teacher auth after a student has used the link, or around regaining solo/live actions after session state changes.
- Follow-up action: If or when Playwright is introduced, make this one of the first scenarios: student opens `live/solo` permalink, teacher starts live, student sees `Join Session`, teacher ends live before join, student regains solo action, and a second instructor can still reach the teacher-code path.
- Owner: Codex

- Date: 2026-03-17
- Scope: unit
- Pattern: Avoid mutating `process.env` inside individual `node:test` cases unless the file is explicitly serialized; when timeout/config overrides are needed, prefer direct event simulation or function parameters.
- Why it helps: Node test files run concurrently by default, so one test's temporary env override can leak into unrelated websocket/auth tests and create flaky failures that look like product regressions.
- Example (file/path): `activities/syncdeck/server/routes.test.ts`
- Failure signal: Seemingly unrelated tests start timing out or taking alternate auth paths only when a specific env-mutating test is present.
- Follow-up action: Replace env overrides with local simulation (`emit('close')`, explicit timeout args where exposed), or mark the suite/test non-concurrent only when unavoidable.
- Owner: Codex

- Date: 2026-03-18
- Scope: unit | integration
- Pattern: For `activities` workspace scoped lint/test scripts, pass the target via npm config (`npm_config_target=... npm --workspace activities run lint:scope|test:scope`) instead of forwarding `-- --target=...`.
- Why it helps: The scripts read `npm_config_target` internally. Forwarded CLI args can leak through to `eslint` as an invalid `--target` flag, and `test:scope` may fall back to `.` and run the full activities suite instead of the intended folder.
- Example (file/path): `activities/package.json`
- Failure signal: `eslint` exits with `Invalid option '--target'`, or a supposedly scoped activities test run starts executing unrelated activity suites.
- Follow-up action: Prefer the env-style invocation in agent notes, docs, and future validation commands until the script interface is changed.
- Owner: Codex

- Date: 2026-03-22
- Scope: e2e
- Pattern: For first-pass Playwright coverage in this repo, run the shared root harness against the real built app on `http://127.0.0.1:3100` via the isolated `playwright.config.ts` web server, and start with registry-backed smoke checks for `/` and `/manage` before deeper flows.
- Why it helps: The join page and manage dashboard are both driven by the shared activity registry, so browser assertions on their rendered cards catch whole-app regressions like missing emitted activity cards that unit tests around individual helpers can miss, while avoiding the dev-server `localhost:3000` launch behavior.
- Example (file/path): `playwright.config.ts`; `playwright/home-and-manage.spec.ts`; `package.json`
- Failure signal: An activity silently drops out of the join page or dashboard in the browser even though local unit tests for its helpers and config parsing still pass, or the Playwright harness starts depending on the interactive dev server instead of the isolated browser-test startup path.
- Follow-up action: Expand from these registry smoke checks into higher-value browser flows next, especially permalink waiting-room transitions and teacher/student handoff paths, while keeping browser runs on the shared root scripts (`npm run test:e2e`, `test:e2e:headed`, `test:e2e:ui`).
- Owner: Codex

- Date: 2026-03-22
- Scope: e2e
- Pattern: In Playwright config, derive `webServer.env.HOST` and `PORT` from the shared `baseURL` and keep the start command free of inline `HOST=... PORT=...` assignments.
- Why it helps: The browser harness then has one source of truth for the server bind address and the URL Playwright probes, which prevents silent drift when the test port or host changes later.
- Example (file/path): `playwright.config.ts`
- Failure signal: `webServer.url` and the actual server bind target diverge after a port/host edit, leading to startup timeouts or tests probing the wrong address.
- Follow-up action: Reuse the same pattern for any future Playwright projects or alternate browser configs in this repo.
- Owner: Codex

- Date: 2026-03-22
- Scope: e2e | CI
- Pattern: In GitHub Actions, prefer running browser smoke tests inside a version-matched Playwright container image rather than calling `npx playwright install --with-deps` during the job.
- Why it helps: The job starts with browsers and OS dependencies already present, which removes a network-heavy install step and keeps CI closer to a fixed, reproducible browser runtime.
- Example (file/path): `.github/workflows/ci.yml`
- Failure signal: CI spends time reinstalling Playwright browsers every run or flakes in the browser-install step despite the JS dependencies already being locked.
- Follow-up action: Keep the container tag aligned with the repo's `@playwright/test` version when upgrading Playwright.
- Owner: Codex

- Date: 2026-03-22
- Scope: CI
- Pattern: Guard Playwright container drift with a repo script that compares `package.json` `devDependencies["@playwright/test"]` against the Playwright image tag in `.github/workflows/ci.yml`, and run it both in CI and the root `npm test` chain.
- Why it helps: Version alignment becomes an enforced contract instead of a tribal-memory task, so Playwright upgrades fail fast if only the npm package or only the CI container tag is changed.
- Example (file/path): `scripts/verify-playwright-version-sync.mjs`; `package.json`; `.github/workflows/ci.yml`
- Failure signal: A Playwright dependency bump lands without the matching CI image tag update, or the workflow image tag changes independently and browser behavior drifts from the locked test runner version.
- Follow-up action: If additional workflows start using Playwright containers, either extend the verifier to cover them too or centralize the image tag in one reusable workflow path.
- Owner: Codex

- Date: 2026-03-22
- Scope: e2e | CI
- Pattern: When CI already built `client/dist` earlier in the job, let the Playwright `webServer.command` reuse that output and skip the Vite build; keep the command able to build on demand for local runs when `client/dist` is missing.
- Why it helps: Browser smoke tests stay self-sufficient for local development while avoiding a redundant client rebuild in CI after `verify:deploy` already produced production assets.
- Example (file/path): `playwright.config.ts`; `package.json`
- Failure signal: CI spends time rebuilding the same production client bundle right before `npm run test:e2e`, or local Playwright runs fail because the harness assumes a prebuilt client dist exists.
- Follow-up action: If the server build also becomes part of the pre-e2e pipeline later, apply the same “reuse existing artifact when present” rule there rather than baking more unconditional rebuilds into Playwright startup.
- Owner: Codex

- Date: 2026-03-22
- Scope: CI
- Pattern: When the root `npm test` chain is much slower than browser smoke tests, split GitHub Actions into parallel jobs for checks, workspace test suites, deploy/server verification, and Playwright smoke instead of running `npm test` serially in one job.
- Why it helps: The workflow wall clock becomes bounded by the slowest suite rather than by the sum of all suites, which is usually a larger gain than shaving a few seconds off an already-fast smoke test.
- Example (file/path): `.github/workflows/ci.yml`
- Failure signal: CI runtime is dominated by one long serialized job even though the underlying checks are independent and already cached well enough to run concurrently.
- Follow-up action: If repeated `npm ci` time starts to dominate after parallelizing, consider a reusable setup action or dependency/build artifact sharing as a second-stage optimization.
- Owner: Codex

- Date: 2026-03-22
- Scope: CI
- Pattern: After splitting the main test workflow, prefer one combined check job per workspace (`client`, `server`, `activities`) that runs lint and typecheck together, rather than doubling job count with separate lint and typecheck jobs for each workspace.
- Why it helps: This keeps the major workspace-level parallelism while reducing workflow overhead and visual noise in GitHub Actions, which is often a better tradeoff unless lint and typecheck durations are independently dominant.
- Example (file/path): `.github/workflows/ci.yml`; `client/package.json`; `server/package.json`; `activities/package.json`
- Failure signal: CI has many tiny check jobs with repeated setup cost and cluttered status output, but the wall-clock improvement over one-per-workspace check jobs is marginal.
- Follow-up action: If the combined `activities` test job remains the next bottleneck afterward, split that suite by activity or by a small matrix of the slowest activity groups.
- Owner: Codex

- Date: 2026-03-22
- Scope: CI
- Pattern: Keep activity test bucketing in one checked-in manifest (`ci/activity-test-groups.json`), validate that every `activities/*` directory appears exactly once, and have GitHub Actions derive the matrix from that manifest instead of hard-coding activity names in workflow YAML.
- Why it helps: New activities fail loudly until they are assigned to a bucket, duplicate assignments are caught automatically, and rebalancing only touches one data file instead of duplicating fragile lists across workflow expressions.
- Example (file/path): `ci/activity-test-groups.json`; `scripts/verify-activity-test-groups.mjs`; `scripts/run-activity-test-group.mjs`; `.github/workflows/ci.yml`
- Failure signal: A new activity lands without CI coverage because its name was never added to a hard-coded workflow list, or activity names drift between multiple duplicated YAML lists.
- Follow-up action: Rebalance the manifest buckets when timing shifts, but keep the verifier strict so coverage remains complete as activities are added.
- Owner: Codex

- Date: 2026-03-22
- Scope: CI
- Pattern: Rebalance activity test buckets using observed per-bucket wall time from CI, not just test-file counts; a slightly uneven file-count split can still be the faster real-world matrix.
- Why it helps: Activities vary a lot in runtime cost, so grouping by actual measured duration keeps the matrix balanced better than counting files alone.
- Example (file/path): `ci/activity-test-groups.json`; `.github/workflows/ci.yml`
- Failure signal: One activity bucket consistently dominates CI even though the manifest looks numerically balanced by file count or raw test count.
- Follow-up action: When timings drift, adjust only the manifest grouping and keep the verifier untouched.
- Owner: Codex

- Date: 2026-03-22
- Scope: CI
- Pattern: When multiple activities run inside one matrix bucket, wrap each activity run in GitHub log groups and print per-activity elapsed time from the bucket runner script.
- Why it helps: You keep the lower job count of grouped buckets while still being able to see which specific activity is dominating a bucket's runtime without rerunning everything as one-activity-per-job.
- Example (file/path): `scripts/run-activity-test-group.mjs`
- Failure signal: A grouped activity bucket is slow in CI, but the logs do not show which activity consumed the time, so rebalancing remains guesswork.
- Follow-up action: If one activity still dominates after logging, move only that activity between manifest buckets instead of expanding the whole matrix unnecessarily.
- Owner: Codex

- Date: 2026-03-22
- Scope: CI
- Pattern: Use the Playwright container image only for browser-facing jobs, and run lint, typecheck, unit/integration tests, and server/build verification on plain `ubuntu-latest` unless they truly need browser binaries or Playwright system packages.
- Why it helps: Non-browser jobs avoid heavier container startup and keep the workflow intent clearer, while the Playwright-specific environment remains pinned exactly where browser coverage needs it.
- Example (file/path): `.github/workflows/ci.yml`; `scripts/verify-playwright-version-sync.mjs`
- Failure signal: Most CI jobs run inside the Playwright image even though only browser smoke tests exercise Playwright, increasing runtime or making container-specific workflow issues harder to reason about.
- Follow-up action: If another job later gains a real browser dependency, move just that job onto the Playwright image and keep the version verifier aligned with the remaining image references.
- Owner: Codex

- Date: 2026-03-22
- Scope: CI
- Pattern: For Playwright image drift checks, compare the workflow image tag against the lockfile-resolved `@playwright/test` version rather than the semver range in `package.json`.
- Why it helps: A caret range like `^1.58.2` can still resolve to a newer installed Playwright version after lockfile updates, so the lockfile is the actual source of truth for the browser build CI should match.
- Example (file/path): `scripts/verify-playwright-version-sync.mjs`; `package-lock.json`; `.github/workflows/ci.yml`
- Failure signal: The verifier still passes after a lockfile-only Playwright bump within the same semver range, leaving the CI browser image on an older Playwright build than the installed test runner expects.
- Follow-up action: If the repo ever pins `@playwright/test` exactly in `package.json`, keep the verifier on the lockfile anyway so install reality remains the guardrail.
- Owner: Codex

- Date: 2026-03-22
- Scope: CI
- Pattern: When browser smoke runs on plain `ubuntu-latest` with `npx playwright install --with-deps` instead of a Playwright container image, let the Playwright version verifier succeed with a clear “no image configured” message rather than treating the missing image tag as drift.
- Why it helps: The same verifier still protects image-based setups, but runtime-install experiments do not fail spuriously just because the workflow has no Playwright image reference to compare.
- Example (file/path): `scripts/verify-playwright-version-sync.mjs`; `.github/workflows/ci.yml`
- Failure signal: Switching browser smoke away from the Playwright container immediately breaks metadata checks because the verifier insists an image tag must exist even though the workflow intentionally installs browsers at runtime.
- Follow-up action: If the repo settles permanently on runtime installs, keep the verifier message explicit so future contributors understand why image drift checks are skipped.
- Owner: Codex
