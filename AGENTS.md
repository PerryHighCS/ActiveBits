# ./AGENTS.md

## Goals

1. Keep work safe, incremental, and reviewable.
2. Preserve runtime behavior unless behavior changes are explicitly requested.
3. Leave reusable context for future contributors and agents.
4. Treat TypeScript as a required project standard for new and modified application code.

## Read First

Before making changes, read these files when relevant:

1. `README.md` (project commands and structure)
2. `ARCHITECTURE.md` (system boundaries and runtime model)
3. `DEPLOYMENT.md` (production/deploy constraints)
4. `.agent/knowledge/*.md` (discovered patterns and optimization guidance)

## Working Rules

1. From the package root you can call `npm test`; all tests must pass before commit.
2. Treat generated outputs (`dist`, caches, `node_modules`) as out of scope for manual edits.
3. Add or update tests for the code you change, even if nobody asked.
4. For tests that intentionally exercise failure/error paths, add explicit `[TEST]` log messages so expected noisy output is clearly distinguishable from real regressions.
5. Add Playwright tests where appropriate for browser-level coverage that crosses routing, fetch, storage, websocket/runtime, popup, or other real-browser boundaries. Use the shared Playwright harness and run tests with the root `npm run test:e2e` scripts rather than ad hoc browser commands. Keep shared browser specs under the repo-root `playwright/` directory, and keep activity-specific browser specs with the activity they test under `activities/<activity-id>/playwright/`.
6. Frontend controls must include appropriate accessibility semantics for their role and state. Use native elements when possible, and add relevant attributes such as `aria-label`, `aria-labelledby`, `aria-describedby`, `aria-controls`, `aria-expanded`, `aria-pressed`, `aria-selected`, and `disabled` when the control behavior requires them.
7. All API endpoints must include proper error handling and logging.
8. Use structured logging for all server-side events.
9. Never expose, log, or commit secrets, API keys, or other sensitive information.
10. Never write instructor passcodes or manager credentials to `sessionStorage`, `localStorage`, IndexedDB, or other browser storage. Use same-tab router state, in-memory handoff, httpOnly cookies, or short-lived server-issued recovery tokens instead.
11. Plans should be iterative and include checklists of steps for the plan. Checklists must be updated as tasks are created and completed.
12. When adding or changing SyncDeck-embedded activity launch formats, update `skills/syncdeck/references/ACTIVITY_PAYLOADS.md` in the same branch so the shared skill docs stay aligned with the real payloads used by the repo.
13. If a `skills/syncdeck/...` doc change is intended to be shared across repos, push the updated subtree back to `syncdeck-agent-skills` as part of the completion flow.
14. Always perform `git subtree pull` and other subtree sync operations on a non-`main` branch. Keep local `main` aligned with `origin/main`, and branch first before pulling subtree updates.
15. For stateful behavior that crosses module, request, process, or asynchronous boundaries, make the contract explicit and keep its implementation cohesive:
   - Centralize a shared decision or derivation in one named, exported, tested function instead of duplicating it across callers.
   - Test semantic rules with a decision table or equivalence matrix that covers ordinary, boundary, missing/legacy, and conflicting inputs.
   - Keep related mutable state for one entity in a single record, type, or explicitly owned state machine rather than parallel structures that can drift.
   - Before introducing a non-trivial invariant (for example ordering, reconciliation,
     deduplication, or retry semantics), document its owner, invariant, and failure
     behavior in the relevant active `.agent/plans/<name>.md`; create a new plan only
     when no relevant active plan exists. Promote the final contract to `ARCHITECTURE.md`
     or `.agent/knowledge/data-contracts.md` when future changes must preserve it.
16. If three or more review rounds on the same PR expose related defects, stop and perform root-cause analysis against the relevant contract rather than continuing to patch symptoms.
17. Resonance has no legacy-session migration requirement: it is a single-operator deployment with a direct cutover, and no pre-existing session data needs to be read by new code. Do not add legacy-shape fallbacks, dual-representation identity bridges, or "what if an old client/session sends the old shape" branches to Resonance. If a past design decision seems to require one, treat that as a signal to simplify the design rather than to add a compatibility path.

## Preflight Checklist

Before making code changes:

1. Confirm branch and working tree status. NEVER commit to `main`.
2. If unexpected unrelated file changes are discovered, pause and ask how to proceed.
3. Read relevant docs (`README.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`).
4. Identify change scope (docs-only, client, server, activities, cross-workspace).
5. If requirements conflict with repository safety or deployment guarantees, escalate before continuing.

## Verification Matrix

Tee and cache test output to a temp file, then inspect or tail that file instead of streaming long test logs directly.

Run these minimum checks based on scope:

1. Docs-only changes
   - Verify links/commands in changed docs are accurate.
2. Workspace specific changes
   - Run the appropriate npm workspace tests, be sure to include lint and typecheck
   - If browser-visible shared flows or routing surfaces changed, include `npm run test:e2e`
3. Cross-workspace changes
   - `npm test` (runs unit tests + typecheck + linting across all workspaces)
   - Add `npm run test:e2e` when the change affects shared client routing, activity-card surfacing, waiting-room/permalink flow, or other browser-level interaction seams
4. Sandbox/agent environments that block local port binding
   - Keep `npm test` as the primary merge gate when available.
   - If port-binding tests fail due environment constraints (for example `EPERM` on listen), run `npm run test:codex` and record the limitation in validation notes.
   - If Playwright needs real local port binding, run `npm run test:e2e` in a canonical environment or with the required escalation, and record that limitation/exception in validation notes.

## Destructive Command Policy

1. Do not run destructive commands (for example: `git reset --hard`, broad `rm -rf`, forced history rewrites) unless explicitly requested.
2. If a potentially destructive action is required, ask for confirmation first.

## Import Conventions

1. Backend/runtime imports must be directly runtime-resolvable. Do not rely on bundler-only features for runtime-critical code paths unless runtime support is explicitly configured.
2. Keep cross-workspace import boundaries explicit (prefer package/export boundaries over deep ad-hoc paths).

## Frontend Accessibility

1. Prefer semantic HTML elements that already expose the correct accessibility role and keyboard behavior.
2. Treat visual-only state as insufficient. If a control has expanded/collapsed, pressed, selected, active, disabled, invalid, or busy state, expose that state with the appropriate native or ARIA attribute.
3. Icon-only controls must have an accessible name.
4. When creating or changing custom interactive components, verify keyboard interaction and screen-reader semantics along with visual behavior.

## Activity Containment Policy

1. Treat each activity as self-contained by default: activity-specific behavior, validation, protocol details, and UI flow should live under `activities/<activity-id>/...`.
2. Shared modules (for example dashboard, routing, common hooks, shared utilities) must remain activity-agnostic and must not import activity-specific implementation files.
3. If multiple activities need the same capability, define a generic contract in shared code (types/interfaces/callbacks/config declarations), and let each activity provide its own implementation/data through that contract.
4. Do not add one-off conditionals in shared modules keyed to a specific activity unless explicitly approved as a temporary workaround.
5. When introducing a temporary compatibility path that touches shared modules, document owner + cleanup condition and schedule removal.

## Temporary Workaround Policy

1. Any temporary compatibility shim or workaround must include:
   - inline reason
   - owner
   - cleanup condition or target date

## Documentation and Release-Impact Rule

When a change affects production behavior, update the authoritative documentation in
the same PR. Choose the document by audience:

1. Update `DEPLOYMENT.md` only when operators must change or verify something:
   environment variables, build/start commands, deploy artifacts, hosting/platform
   configuration, network/proxy/TLS/cookie requirements, data migrations or rollback,
   scaling topology, monitoring, or incident response.

2. Put system design, concurrency, cache/session behavior, and cross-workspace runtime
   flow in `ARCHITECTURE.md`.

3. Put activity-specific behavior, client/server protocol details, and compatibility
   rules in the activity documentation, `skills/...` reference, or
   `.agent/knowledge/data-contracts.md` as appropriate.

4. Put security rationale and credential/capability design details in
   `.agent/knowledge/security-notes.md`; put dated operational risks, evidence, and
   rollback notes in `.agent/knowledge/deployment-notes.md`.

5. Do not add implementation narratives, state-machine histories, review findings, or
   activity-specific protocol details to `DEPLOYMENT.md`. Each entry there must state
   an operator action, constraint, verification, or incident response. Link to the
   authoritative technical document when additional detail is needed.

## Ownership and Escalation

1. If unexpected unrelated file changes are discovered, pause and ask how to proceed.
2. If requirements conflict with repository safety or deployment guarantees, escalate before continuing.

## Evidence and Tracking

Use these logs to keep work auditable:

1. `.agent/knowledge/repo_discoveries.md`
   - Durable notes/discoveries for future work.
2. `.agent/knowledge/react-best-practices.md`
   - React patterns, optimizations, and accessibility guidance.
3. `.agent/knowledge/testing-patterns.md`
   - Shared testing setups, failure patterns, and reliability guidance.
4. `.agent/knowledge/deployment-notes.md`
   - Environment/runtime deployment constraints and operational learnings.
5. `.agent/knowledge/data-contracts.md`
   - API contracts, payload assumptions, and compatibility expectations.
6. `.agent/knowledge/performance-notes.md`
   - Profiling findings, bottlenecks, and optimization tradeoffs.
7. `.agent/knowledge/security-notes.md`
   - Security boundaries, validation rules, and sensitive-data handling guidance.

If a log file is missing, create it when first needed.
If a discovery does not fit an existing knowledge file, create a new `.agent/knowledge/<category>.md` file and define its purpose at the top. Prefer extending an existing category first; create a new category only when the topic is durable and likely to be reused.

## Definition of Done (General)

1. Relevant tests pass.
2. Relevant authoritative documentation is updated for any workflow, runtime, build, or deployment change, following the Documentation and Release-Impact Rule.
3. Notes are recorded in the appropriate log files.
4. If following a plan, appropriate step(s) are marked as complete.
