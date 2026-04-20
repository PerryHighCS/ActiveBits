# Standalone Activity Launcher Plan

## Status: Design / Pre-Implementation

This document sketches a standalone activity launcher route that lets an instructor
start a normal ActiveBits activity session from a link, including a link embedded in a
SyncDeck presentation. This is intentionally separate from SyncDeck embedded activities:
the launched activity opens in its own browser tab and uses the standard activity manage
page, join code, QR code, and student entry flow.

---

## Problem Statement

Today an instructor can start a standalone activity only by navigating to the ActiveBits
home/manage surface, choosing the activity, and clicking "Start session now". That flow
already performs the correct runtime behavior:

1. POST to create a new activity session.
2. Receive the new `sessionId`.
3. Redirect to the activity manager route.

Instructors also want to place a button/link inside a SyncDeck presentation that opens a
new standalone activity in a separate tab. That link should not create a SyncDeck embedded
child session, should not pull students into the activity automatically, and should not
depend on SyncDeck activity-specific code.

---

## Goals

- Provide a URL-addressable launcher for standalone activity sessions.
- Support links authored into SyncDeck presentations, for example:

  ```html
  <a href="https://bits.mycode.run/launch/raffle?start=1" target="_blank">
    Start raffle
  </a>
  ```

- Reuse the same server/session creation behavior as the existing "Start session now"
  button.
- Allow activity-specific launch options through query params where the activity already
  supports a safe selected-options/deep-link contract.
- Keep the launcher activity-agnostic in shared routing code.
- Preserve a safe non-mutating page load by default; session creation should happen only
  after explicit user action or an explicit `start=1` opt-in.

## Non-Goals

- Do not create SyncDeck embedded child sessions.
- Do not automatically route SyncDeck students into the launched activity.
- Do not replace persistent/permalink session flows.
- Do not introduce one-off shared logic keyed to a specific activity.
- Do not make a GET request itself create a session as an unavoidable side effect.

---

## Proposed Route

Primary route:

```text
/launch/:activityId
```

Examples:

```text
/launch/raffle
/launch/raffle?start=1
/launch/video-sync?sourceUrl=https%3A%2F%2Fyoutu.be%2Fabc123&start=1
/launch/resonance?questionSetId=warmup-1
```

The route renders a small instructor-facing launcher page. The launcher knows the target
activity from `:activityId`, validates any supported query params, and then starts a
normal standalone session using the same creation path as the home-page activity card.

### Default Mode

Without `start=1`, the launcher should not create a session on load. It should show a
confirmation page:

```text
Start Raffle
This opens a new standalone session.
[Start session]
```

The button performs the existing session-creation POST and redirects to the manager route.

### Auto-Start Mode

With `start=1`, the launcher may immediately start the session after the page loads and
then redirect to the manager route:

```text
/launch/raffle?start=1
```

This mode is useful for trusted instructor-authored presentation buttons. It is still a
client-side POST from an ActiveBits page, not a server-side session created by the GET
request itself.

If auto-start fails, the page should render the error and offer a retry button rather than
looping or repeatedly creating sessions.

---

## Query Param Contract

The launcher should treat query params as requested launch options, not as arbitrary
session data. Shared launcher code should only pass through options that the activity
declares as supported.

Preferred shape:

```ts
interface StandaloneLaunchConfig {
  selectedOptions?: {
    [queryParamName: string]: {
      responseField: string
      validator?: 'url' | 'string'
    }
  }
}
```

Possible reuse:

- If existing `deepLinkOptions` + `createSessionBootstrap.selectedOptionsToSessionData`
  already express the needed fields, prefer reusing that contract instead of creating a
  new parallel one.
- If a new contract is needed, keep it activity-owned in config and generic in shared
  launcher code.

Rules:

- Unknown query params must not affect runtime behavior.
- `start=1` is a launcher control param, not activity data.
- Activity options should be normalized before being sent to the create-session endpoint.
- URL-like fields should use the same URL normalization/validation rules as persistent
  links where possible.
- If an option is invalid, the launcher should show a validation error before creating a
  session.

---

## Runtime Flow

### Manual Start

1. Instructor opens `/launch/:activityId`.
2. Client resolves the activity config.
3. Client validates supported query params.
4. Client renders a confirmation button.
5. Instructor clicks "Start session".
6. Client POSTs to the existing session creation API.
7. Server creates a normal standalone session.
8. Client receives `sessionId`.
9. Client redirects to `/manage/:activityId/:sessionId`.

### Auto-Start

1. Instructor opens `/launch/:activityId?start=1`.
2. Client resolves the activity config.
3. Client validates supported query params.
4. Client performs the existing session creation POST once.
5. Client redirects to `/manage/:activityId/:sessionId`.
6. If the request fails, client shows an error and a retry button.

### SyncDeck Presentation Button

Presentation markup can open the launcher in a new tab:

```html
<a href="https://bits.mycode.run/launch/raffle?start=1" target="_blank" rel="noopener">
  Start raffle
</a>
```

This launches a separate standalone session. SyncDeck continues running in the original
tab, and the instructor can return to the deck when ready.

---

## Safety And UX Constraints

- Never create a session purely from handling a GET request on the server.
- Prevent double-submission in the launcher UI with disabled/loading state.
- For `start=1`, guard the client effect so React re-renders do not create duplicate
  sessions.
- Show a clear distinction between "standalone activity" and "embedded in this deck".
- If the activity is unknown or does not support standalone launch, render a friendly
  error.
- If the activity requires additional data not supplied by query params, render the
  existing/manual start affordance or activity-specific preflight UI rather than guessing.
- Use semantic buttons and expose loading/error state accessibly.

---

## Open Questions

- Should `start=1` be enough for auto-start, or should the param be more explicit, such
  as `autostart=1`?
- Should the launcher preserve extra non-behavioral params such as `utm_source` only for
  analytics, or ignore them completely?
- Should the manager route receive launch options through session `data`, history state,
  or the existing create-session bootstrap payload?
- Should there be a copied-link builder UI inside SyncDeck tools for generating launcher
  links, or is hand-authored HTML enough for the first version?

---

## Implementation Checklist

- [ ] Audit the current "Start session now" client/server path and identify the exact
  reusable create-session API call.
- [ ] Add a shared route for `/launch/:activityId`.
- [ ] Build a small `ActivityLauncher` component with manual and `start=1` modes.
- [ ] Reuse existing activity registry/config data to resolve the activity and manager
  destination.
- [ ] Define or reuse an activity-owned selected-options contract for launch query params.
- [ ] Validate query params before creating a session.
- [ ] POST to the existing create-session endpoint and redirect to
  `/manage/:activityId/:sessionId`.
- [ ] Add unit coverage for launcher utility parsing, unknown activity handling,
  invalid query params, and `start=1` single-submit behavior.
- [ ] Add browser-level coverage if routing/fetch/storage behavior differs from the
  existing home-page start flow.
- [ ] Update `README.md`, `ARCHITECTURE.md`, and `DEPLOYMENT.md` if the launcher changes
  documented runtime behavior.
- [ ] Add or update SyncDeck authoring docs with example presentation links.

