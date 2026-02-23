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
