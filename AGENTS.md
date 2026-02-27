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
5. All API endpoints must include proper error handling and logging.
6. Use structured logging for all server-side events.
7. Never expose, log, or commit secrets, API keys, or other sensitive information.

## Preflight Checklist

Before making code changes:

1. Confirm branch and working tree status. NEVER commit to `main`.
2. If unexpected unrelated file changes are discovered, pause and ask how to proceed.
3. Read relevant docs (`README.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`).
4. Identify change scope (docs-only, client, server, activities, cross-workspace).
5. If requirements conflict with repository safety or deployment guarantees, escalate before continuing.

## Verification Matrix

Run these minimum checks based on scope:

1. Docs-only changes
   - Verify links/commands in changed docs are accurate.
2. Workspace specific changes
   - Run the appropriate npm workspace tests, be sure to include lint and typecheck
3. Cross-workspace changes
   - `npm test` (runs unit tests + typecheck + linting across all workspaces)
4. Sandbox/agent environments that block local port binding
   - Keep `npm test` as the primary merge gate when available.
   - If port-binding tests fail due environment constraints (for example `EPERM` on listen), run `npm run test:codex` and record the limitation in validation notes.

## Destructive Command Policy

1. Do not run destructive commands (for example: `git reset --hard`, broad `rm -rf`, forced history rewrites) unless explicitly requested.
2. If a potentially destructive action is required, ask for confirmation first.

## Import Conventions

1. Backend/runtime imports must be directly runtime-resolvable. Do not rely on bundler-only features for runtime-critical code paths unless runtime support is explicitly configured.
2. Keep cross-workspace import boundaries explicit (prefer package/export boundaries over deep ad-hoc paths).

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

## Release-Impact Rule

If a change affects runtime, build, or deployment behavior:

1. Update `DEPLOYMENT.md` in the same PR.
2. Update `README.md` quick-start/build/run commands as needed.
3. Update `ARCHITECTURE.md` if system boundaries or runtime flow changed.

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
2. Documentation is updated for any workflow/runtime/build change.
3. Notes are recorded in the appropriate log files.