# Issue 323: Dark Mode / Light Mode

## Issue

GitHub issue: https://github.com/PerryHighCS/ActiveBits/issues/323

> The whole interface (including headers and borders) should respond to user's preference.

## Current State

Dark mode is not a real, app-wide system today. Tailwind v4 is used with the
default `dark:` variant, which only follows `prefers-color-scheme` — there is
no theme provider, no toggle, no persisted preference, and no design-token
layer. The only place `dark:` classes exist is `activities/resonance/*` plus
two shared components it happened to touch
(`activities/shared/client/components/ReactionSummary.tsx`,
`InstructorFeedbackControls.tsx`). Everything else — the root app shell,
`SessionHeader`, `ManageDashboard`, `StatusDashboard`, and ~10 other
activities — is light-only with hardcoded `bg-white` / `border-gray-*` /
inline hex colors. `StatusDashboard.tsx` is the worst offender, with ~80
inline `style={{ color: '#...' }}` literals that bypass Tailwind entirely.

## Product Decisions

- Three theme states: `system` (default) → `light` → `dark`, user-selectable.
- Default behavior with no stored preference: follow OS/browser
  `prefers-color-scheme`, and keep following it live if the OS setting
  changes, for as long as the user has never explicitly toggled.
- The moment the user explicitly picks Light or Dark, that choice is
  persisted (localStorage) and overrides OS preference from then on, across
  reloads and sessions. Picking "System" again clears the override and
  resumes following the OS.
- **No flash of the wrong theme on load is a hard requirement** — this is
  not a nice-to-have. The correct theme must be applied to the document
  before first paint, not after React mounts and an effect runs. This means
  the initial theme resolution (read localStorage → fall back to
  `matchMedia('(prefers-color-scheme: dark)')` → set an attribute on
  `<html>`) must happen in a small **synchronous, non-module inline
  `<script>` in `client/index.html`'s `<head>`**, before the stylesheet/app
  bundle paints anything. React-side state must then read that
  already-applied value on mount rather than recomputing and re-applying it,
  to avoid a hydration mismatch or a second flash.
- Add the toggle control early (Phase 0), before the shared-chrome and
  per-activity sweeps, specifically so the rest of the work can be tested
  manually against both themes as it lands, instead of only being verifiable
  at the very end.
- Toggle is a single global control rendered once in the app shell
  (`client/src/App.tsx`), not duplicated per activity header — it must be
  visible on every route, including ones without a `SessionHeader` (e.g.
  `StatusDashboard`, `ManageDashboard`, standalone/solo activity routes).
- **Suppress the toggle in embedded activity contexts.** Embedded launches
  (SyncDeck slides embedding an activity session, e.g. Raffle/Resonance) run
  through the same `AppShell`, so a naive global toggle would render inside
  every embedded iframe on a deck — a redundant floating control per slide,
  and a way for an embedded activity's theme to visually diverge from the
  presentation hosting it. Reuse the existing embedded-session detection
  (`isEmbeddedChildSessionId` in
  `client/src/components/common/sessionHeaderUtils.ts`, already used by
  `SessionHeader` to strip chrome for embedded sessions) to hide
  `ThemeToggle` there. Embedded activities still resolve and apply a theme
  (system preference, or a top-level stored preference if present in the
  same browser) — they just don't offer their own control to change it.

## Architecture

### Theme resolution mechanism

- Use Tailwind v4's `@custom-variant` to switch `dark:` from
  media-query-only to attribute-based:
  `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));`
  in `client/src/index.css`.
- `document.documentElement` carries `data-theme="light"` or
  `data-theme="dark"` — never `"system"`; system mode always resolves to a
  concrete value before it's applied to the DOM.
- Storage key: `activebits:theme`, values `"light" | "dark"` only. Absence of
  the key means "system" — do not write `"system"` as a stored value.

### Inline bootstrap script (`client/index.html`)

- A tiny inline script placed before `index.css`'s `<link>` (or immediately
  after it — order relative to the stylesheet link doesn't matter since it's
  render-blocking either way, but it must run before `<body>` paints):
  reads `localStorage.getItem('activebits:theme')`, falls back to
  `matchMedia('(prefers-color-scheme: dark)').matches`, and sets
  `document.documentElement.dataset.theme` synchronously. Wrap in try/catch
  so a `localStorage` access failure (private browsing, disabled storage)
  degrades to system preference rather than throwing.
- Keep this script minimal and dependency-free — it cannot import any app
  code since it must run before the module graph loads.

### `useTheme` hook (`client/src/hooks/useTheme.ts`)

- Global, shared-chrome-level (not activity-specific), alongside
  `useResilientWebSocket` etc.
- On mount, reads the current `data-theme` attribute already set by the
  inline script (does not recompute independently) plus whether a stored
  preference exists, to derive `{ mode: 'system' | 'light' | 'dark', resolved: 'light' | 'dark' }`.
- Subscribes to `matchMedia('(prefers-color-scheme: dark)')` changes while
  `mode === 'system'`, updating `resolved` and `data-theme` live.
- `setMode(mode)`:
  - `'system'` → remove the localStorage key, resolve from `matchMedia`.
  - `'light' | 'dark'` → write the key, set `data-theme` immediately.
- Single instance — either export a context provider or rely on the DOM
  attribute + a `storage`/custom event as the source of truth if multiple
  components call the hook. Decide during implementation based on how many
  consumers actually need live reactivity (likely just the toggle itself).

### `ThemeToggle` component (`client/src/components/ui/ThemeToggle.tsx`)

- Three-way control (System / Light / Dark), not a binary switch, since
  "system until explicitly toggled" is a real third state the user can
  return to.
- Accessible per `AGENTS.md` frontend rules: use `role="radiogroup"` with
  `role="radio"` + `aria-checked`, or a native approach with
  `aria-pressed` per button — pick whichever maps most directly to a
  three-option exclusive choice. Icon-only buttons need `aria-label`.
- Rendered once in `client/src/App.tsx`'s `AppShell`, positioned so it's
  visible on every route (fixed corner placement, or integrated into a
  slot that already renders on every page).
- `AppShell` must not render `ThemeToggle` when `isEmbeddedChildSessionId`
  indicates the current route is an embedded child session (see Product
  Decisions above). Determine the embedded flag the same way
  `SessionHeader` does today, rather than inventing a second detection
  path.

## Implementation Checklist

### Phase 0 — Theme infrastructure + toggle (do first, unblocks manual testing)

- [ ] Add `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));` to `client/src/index.css`.
- [ ] Add the synchronous inline bootstrap script to `client/index.html` (try/catch around `localStorage`, fallback to `matchMedia`).
- [ ] Add `client/src/hooks/useTheme.ts` (+ `useTheme.test.ts`) covering: no stored preference follows system and live-updates on system change; explicit `light`/`dark` persists and stops following system; returning to `system` clears the stored key; `localStorage` throwing (private mode) degrades gracefully.
- [ ] Add `client/src/components/ui/ThemeToggle.tsx` (+ `ThemeToggle.test.tsx`) with correct ARIA state semantics for the three modes.
- [ ] Wire `ThemeToggle` into `client/src/App.tsx`'s `AppShell` so it renders globally on every route, except embedded child-session routes (check via `isEmbeddedChildSessionId`, matching how `SessionHeader` already detects embedded sessions).
- [ ] Add baseline dark tokens to `client/src/App.tsx`'s own shell classes (background, footer) so the toggle has something visible to prove out immediately.
- [ ] Manually verify in a browser: hard reload with system dark and no stored preference shows dark with no light-then-dark flash; toggling to Light persists across reload; toggling back to System resumes following OS; toggling OS preference live updates the page while in System mode.
- [ ] Manually verify an embedded child-session route (e.g. a SyncDeck-embedded activity URL) renders with no `ThemeToggle` visible while still resolving to the correct theme.

### Phase 1 — Shared chrome retrofit

- [ ] `client/src/components/common/SessionHeader.tsx` (all three render branches: simple, embedded-child, full) — the header the issue explicitly names.
- [ ] `client/src/components/common/ManageDashboard.tsx`
- [ ] `client/src/components/common/StatusDashboard.tsx` — rewrite the ~80 inline hex `style={{ color: ... }}` literals to Tailwind utility classes with `dark:` variants as part of this, not as a follow-up; inline styles cannot pick up theme changes at all as they stand.
- [ ] `client/src/components/common/WaitingRoomContent.tsx`, `SessionRouter.tsx`, `StudentPresence.tsx`, `ActivityRoster.tsx`, `SessionEnded.tsx`, `ActivityLauncher.tsx`, `HomeTeacherJoinControls.tsx`
- [ ] `VirtualFileExplorer.tsx` / `VirtualFileExplorerItem.tsx`, `QrScannerPanelView.tsx`
- [ ] `client/src/components/ui/Modal.tsx`, `RosterPill.tsx`, `Button.tsx` / `buttonStyles.ts` (button variants need dark-aware colors since every activity depends on them)
- [ ] Sweep for any remaining hardcoded `bg-white` / `border-gray-*` / inline hex in `client/src/**` not covered above.

### Phase 2 — Per-activity sweep

Each activity is self-contained per the repo's Activity Containment Policy,
so these can land as independent PRs/commits in any order once Phase 0's
tokens/conventions exist:

- [ ] `activities/resonance/*` — already partial; finish remaining gaps and confirm consistency with the new shared conventions from Phase 0/1.
- [ ] `activities/gallery-walk/*` (16 files)
- [ ] `activities/www-sim/*` (8 files)
- [ ] `activities/mobcode/*` (6 files, plus CSS with hardcoded hex)
- [ ] `activities/raffle/*` (5 files)
- [ ] `activities/syncdeck/*` (5 files — host/manager/student UI)
- [ ] `activities/java-string-practice/*` (2 files)
- [ ] `activities/video-sync/*` (2 files)
- [ ] `activities/python-list-practice/*` (1 file)
- [ ] CSS files with hardcoded hex/rgb outside the Tailwind utility system: `traveling-salesman`, `algorithm-demo`, `java-format-practice`, `postboard`, `binary-breach`.

### Phase 3 — Testing

- [ ] Unit tests from Phase 0 (`useTheme.test.ts`, `ThemeToggle.test.tsx`) passing.
- [ ] Add a shared Playwright spec under root `playwright/` covering: default page load with system dark preference emulated shows the dark attribute applied on first paint (no visible light frame — assert `data-theme` is correct at `domcontentloaded`, before any app JS has had a chance to run); toggling to Light/Dark persists across a reload; toggling back to System resumes following an emulated OS change. Use `npm run test:e2e`.
- [ ] Spot-check keyboard and screen-reader semantics of `ThemeToggle` per `AGENTS.md` frontend accessibility rules.
- [ ] For each activity touched in Phase 2, add or extend that activity's own Playwright/unit coverage only if the activity's existing tests assert on light-only class names that would now be wrong — otherwise no new per-activity test is required beyond a visual spot check.

### Phase 4 — Docs

- [ ] Add a theming section to `ARCHITECTURE.md` describing the `data-theme` attribute mechanism, the inline bootstrap script and why it exists (no-flash requirement), and the shared/activity token convention.
- [ ] Add an entry to `.agent/knowledge/react-best-practices.md` documenting the dark-mode class convention (`dark:` usage, no inline hex styles) for future activity work.
- [ ] Update `README.md` only if any new commands/build steps are introduced (not expected — this is Tailwind config + component-level, no build changes).

## Verification Notes

- `npm --workspace client run test:unit`
- `npm --workspace client run lint`
- `npm --workspace client run typecheck`
- `npm_config_target=activities/<activity> npm --workspace activities run test:scope` for each activity touched in Phase 2
- `npm run test:e2e` once the Playwright theme spec exists
- `npm test` before final commit (full cross-workspace gate per `AGENTS.md`)

## Non-Goals

- Per-activity custom color themes/branding beyond light/dark — out of scope for this issue.
- A settings/profile page — the toggle lives in the app shell, not a separate settings surface.
- Server-side rendering of the initial theme (no SSR exists in this app; the inline script handles the client-only no-flash requirement).
- Forwarding the SyncDeck/presentation host's own theme into embedded activity iframes (e.g. via `activityOptions` or a `postMessage`) so an embedded activity visually matches the deck around it. Out of scope here; embedded activities fall back to system/stored preference for now. Worth a future issue if presentation-matching becomes a real ask.
