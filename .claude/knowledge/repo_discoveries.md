# Repo Discoveries

Durable implementation notes and discoveries for future contributors and agents.

## How To Use

1. Append new entries; do not rewrite history.
2. Keep entries concise and evidence-backed.
3. Link to paths/commands/tests that support each claim.

## Entry Template

| Date | Area | Discovery | Why It Matters | Evidence | Follow-up | Owner |
|---|---|---|---|---|---|---|
| YYYY-MM-DD | client/server/activities/tooling/docs | <what was learned> | <impact/risk/value> | <file path, command, or test> | <next action> | <name> |

## Entries

| Date | Area | Discovery | Why It Matters | Evidence | Follow-up | Owner |
|---|---|---|---|---|---|---|
| 2026-02-07 | tooling/docs | `.gitignore` had `.claude/*` ignored with only `plans` re-included; knowledge files would have been dropped from git without explicit unignore rules. | Prevents loss of durable repo knowledge and agent context. | `.gitignore` entries `!.claude/knowledge/` and `!.claude/knowledge/**` | Keep new durable `.claude/*` folders explicitly unignored when introduced. | codex |
| 2026-02-07 | docs/process | `AGENTS.md` is the long-lived operational contract; TypeScript migration docs are now treated as historical context. | Separates permanent agent workflow from temporary migration planning artifacts. | `AGENTS.md` sections `Read First`, `Historical Discoveries`, `Evidence and Tracking` | Keep `AGENTS.md` current as workflows evolve; archive one-off plans under `.claude/plans/`. | codex |
| 2026-02-07 | server/build | Backend migration policy is compile TypeScript to `server/dist` and run Node on emitted JS; backend bundler is not required. | Avoids bundler complexity with dynamic activity loading and keeps runtime Node-native. | `.claude/plans/typescript.md` Phase 3 runtime policy, `server/tsconfig.build.json` plan block | Re-evaluate bundling only for concrete deploy constraints (single-file artifact/serverless). | codex |
| 2026-02-07 | client/server/deploy | Production source maps are intentionally public for this open-source repo (`client` and `server`). | Improves debugging and contributor transparency; must be reflected in deployment docs. | `.claude/plans/typescript.md` source map policy sections, `DEPLOYMENT.md` “Source Map Policy (Open-Source Repo)” | Verify `.map` artifacts in build/deploy checks (`client/dist`, `server/dist`). | codex |
| 2026-02-07 | activities/process | Activity migration batching rule is one activity directory per PR. | Reduces blast radius and simplifies rollback/review during high-volume migrations. | `.claude/plans/typescript.md` section `5.3 Activity batching policy (one activity per PR)` | Enforce in review template/checklist for Phase 5 PRs. | codex |
| 2026-02-07 | server/tests/tooling | In Codex sandbox, server tests and `verify:server` can fail with `EPERM` on socket bind even when local runs pass. | Prevents misclassifying environment limitations as repo regressions; requires explicit manual verification note. | `npm --workspace server test`, `npm run verify:server`, error `listen EPERM ... 0.0.0.0:4010`; user-confirmed local pass. | Treat local/CI as canonical for server bind-dependent checks; record manual verification in review logs. | codex |
| 2026-02-07 | client/tooling | Client `tsc --noEmit` can fail on `vite.config.ts` when root and client use different Vite majors, due plugin type mismatches. | Helps avoid false-negative typecheck failures during migration; informs tooling harmonization priority. | `npm run typecheck --workspaces --if-present`, error on `client/vite.config.ts` plugin types between root `vite@7` and client `vite@6`. | Harmonize Vite versions or isolate config typing strategy before strict config typecheck enforcement. | codex |
| 2026-02-07 | client/tooling | Vite type mismatch issue resolved by aligning root/client to Vite `7.3.1` and compatible plugin versions. | Confirms single-version toolchain removes cross-package type identity errors in `vite.config.ts` typecheck. | User-reported `npm ls vite` alignment + passing `npm run typecheck --workspaces --if-present` and `npm --workspace client run build`. | Keep root/client Vite and plugin versions in lockstep to prevent regression. | codex |
| 2026-02-07 | client/linting | Flat-config ESLint emits warning for `/* eslint-env node */` comment in `client/vite.config.ts`; this becomes an error target in ESLint v10. | Avoids future CI breaks on ESLint major upgrade. | `npm --workspace client test` warning output referencing `/client/vite.config.ts` line 1. | Replace with flat-config-compatible globals declaration or remove comment and rely on config-scoped globals. | codex |
