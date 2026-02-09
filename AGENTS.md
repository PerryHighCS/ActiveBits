# AGENTS.md

This file defines the default execution contract for human and AI agents working in this repository.

## Goals

1. Keep work safe, incremental, and reviewable.
2. Preserve runtime behavior unless behavior changes are explicitly requested.
3. Leave reusable context for future contributors and agents.

## Read First

Before making changes, read these files when relevant:

1. `README.md` (project commands and structure)
2. `ARCHITECTURE.md` (system boundaries and runtime model)
3. `DEPLOYMENT.md` (production/deploy constraints)
4. `.claude/knowledge/react-best-practices.md` (React patterns and optimization guidance)

## Working Rules

1. Run baseline checks before large refactors or migrations.
2. Prefer small, phase-scoped commits and PRs.
3. Always run `npm test` before committing.
4. From the package root you can call `npm test`; the commit should pass all tests before merge.
5. Fix any test or type errors until the whole suite is green.
6. Do not rely on TypeScript path aliases for backend runtime resolution unless runtime support exists.
7. Treat generated outputs (`dist`, caches, `node_modules`) as out of scope for manual edits.
8. Add or update tests for the code you change, even if nobody asked.
9. For tests that intentionally exercise failure/error paths, add explicit `[TEST]` log messages so expected noisy output is clearly distinguishable from real regressions.

## Preflight Checklist

Before making code changes:

1. Confirm branch and working tree status.
2. Read relevant docs (`README.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`).
3. Identify change scope (docs-only, client, server, activities, cross-workspace).
4. Run at least the relevant baseline command(s) for touched areas.

## Verification Matrix

Run these minimum checks based on scope:

1. Docs-only changes
   - Verify links/commands in changed docs are accurate.
2. Client-only code changes
   - `npm --workspace client test`
   - `npm --workspace client run build` (when build/runtime paths are affected)
3. Server-only code changes
   - `npm --workspace server test`
   - `npm run verify:server` (when runtime/startup behavior is affected)
4. Activities-only changes
   - `npm --workspace activities test`
5. Cross-workspace changes
   - `npm run typecheck --workspaces --if-present`
   - `npm test`
6. Sandbox/agent environments that block local port binding
   - Keep `npm test` as the primary merge gate when available.
   - If port-binding tests fail due environment constraints (for example `EPERM` on listen), run `npm run test:codex` and record the limitation in validation notes.

## Destructive Command Policy

1. Do not run destructive commands (for example: `git reset --hard`, broad `rm -rf`, forced history rewrites) unless explicitly requested.
2. If a potentially destructive action is required, ask for confirmation first.

## Import and Specifier Conventions

1. Backend/runtime imports must be Node-resolvable (NodeNext/ESM-safe).
2. Treat `tsconfig` path aliases as compile-time/editor aids unless runtime support is explicitly configured.
3. Keep cross-workspace import boundaries explicit (prefer package/export boundaries over deep ad-hoc paths).

## Temporary Workaround Policy

1. New `@ts-ignore`, temporary `any`, compatibility shim, or migration workaround must include:
   - inline reason
   - owner
   - cleanup condition or target date
2. Prefer `@ts-expect-error` over `@ts-ignore` when applicable.

## PR Metadata Standard

Each PR should include:

1. Scope summary (what changed and why).
2. Risk level and likely regression areas.
3. Validation commands run and outcomes.
4. Docs updated (or explicit `none required` rationale).
5. Rollback approach.

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

1. `.claude/knowledge/repo_discoveries.md`
   - Durable notes/discoveries for future work.
2. `.claude/knowledge/react-best-practices.md`
   - React patterns, optimizations, and accessibility guidance.

If a log file is missing, create it when first needed.

## Historical Discoveries

These files capture migration-era decisions and evidence. Treat them as historical context, not required day-to-day operating docs:

1. `.claude/plans/typescript.md`
2. `.claude/plans/typescript_review.md`

## Repo Discoveries Format

When adding an entry to `.claude/knowledge/repo_discoveries.md`, include:

1. Date
2. Area (client/server/activities/tooling/docs)
3. Discovery
4. Why it matters
5. Evidence (file path and/or command)
6. Follow-up action
7. Owner

## Definition of Done (General)

1. Relevant tests pass.
2. Typecheck passes where applicable.
3. Documentation is updated for any workflow/runtime/build change.
4. Notes are recorded in the appropriate log files.
