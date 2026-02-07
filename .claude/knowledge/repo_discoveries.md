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
