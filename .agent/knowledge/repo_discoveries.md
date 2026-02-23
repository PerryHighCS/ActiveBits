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
- Area: tooling
- Discovery: Client Tailwind stack can be upgraded from `4.2.0` to `4.2.1` (`tailwindcss`, `@tailwindcss/vite`) without regressions in this repo.
- Why it matters: Confirms a low-risk dependency refresh path for frontend styling/build tooling and reduces uncertainty for future version bumps in the same range.
- Evidence: `client/package.json`; `package-lock.json`; `npm --workspace client outdated tailwindcss @tailwindcss/vite`; `npm --workspace client run typecheck`; `npm --workspace client run lint`; `npm --workspace client test`; `npm --workspace client run build`; `npm test`
- Follow-up action: Keep patch-level Tailwind updates in regular dependency maintenance cadence; no immediate remediation needed.
- Owner: Codex
