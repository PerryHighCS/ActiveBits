# Reveal Iframe Sync Message Schema

This document defines the `postMessage` protocol used by `reveal-iframe-sync.js`.

## Envelope (all messages)

```json
{
  "type": "reveal-sync",
  "version": "2.1.0",
  "action": "ready",
  "deckId": "2d-arrays",
  "role": "student",
  "source": "reveal-iframe-sync",
  "ts": 1760000000000,
  "payload": {}
}
```

Fields:
- `type` (string): protocol channel. Default is `reveal-sync`.
- `version` (string): protocol/plugin version (semantic version).
- `action` (string): high-level message type (`command`, `state`, `ready`, `metadata`, etc.).
- `deckId` (string | null): optional logical deck identifier.
- `role` (string): sender role (`standalone`, `student`, or `instructor`).
  The runtime initializes in `standalone` mode until the host sends `setRole`, so
  early upward messages such as `ready` and `metadata` may legitimately carry
  `role: "standalone"`.
- `source` (string): fixed sender marker (`reveal-iframe-sync`).
- `ts` (number): unix timestamp in milliseconds.
- `payload` (object): action-specific data.

---

## Host → Iframe Messages

Use `action: "command"` with a command payload.

### Command wrapper

```json
{
  "type": "reveal-sync",
  "action": "command",
  "deckId": "2d-arrays",
  "payload": {
    "name": "next",
    "payload": {}
  }
}
```

### Supported command names

- `next`
- `prev`
- `slide`
- `setState`
- `togglePause`
- `pause`
- `resume`
- `setRole`
- `allowStudentForwardTo`
- `setStudentBoundary` (alias for explicit boundary set)
- `clearBoundary` — removes explicit boundary; student reverts to "follow instructor" mode (boundary auto-captures from next sync)
- `syncToInstructor` — clears any explicit boundary, applies the supplied instructor state, and resumes follow-instructor mode in one command
- `toggleOverview` — opens/closes the custom storyboard strip (does **not** activate Reveal's built-in grid overview)
- `showOverview` — opens the custom storyboard strip
- `hideOverview` — closes the custom storyboard strip
- `chalkboardCall`
- `toggleChalkboard`
- `toggleNotesCanvas`
- `clearChalkboard`
- `resetChalkboard`
- `chalkboardStroke` — relay a single instructor draw/erase event to a student canvas
- `chalkboardState` — replace the student's full drawing storage and redraw
- `requestChalkboardState` — ask an instructor iframe for a full state snapshot (iframe responds with `chalkboardState` upward message)
- `ping`

### Command payload shapes

#### `slide`

```json
{
  "name": "slide",
  "payload": { "h": 3, "v": 0, "f": 1 }
}
```

#### `setState`

```json
{
  "name": "setState",
  "payload": { "state": { "indexh": 3, "indexv": 0 } }
}
```

#### `setRole`

```json
{
  "name": "setRole",
  "payload": { "role": "student" }
}
```

#### `pause` / `resume` / `togglePause`

When role is `student`, host-issued pause is treated as host-owned lock:

- After `pause` (or `togglePause` resolving to paused), local unpause attempts in the student iframe are immediately reverted.
- Only host `resume` (or `togglePause` resolving to unpaused) clears the lock.
- While host pause lock is active for students, the iframe shows a full-screen pause overlay and capture-phase input blocking prevents local keyboard/mouse/touch navigation until host resume.

This ensures only the instructor/host can unblank student screens after a host pause.

#### `allowStudentForwardTo` (recommended for temporary handoff)

Allows a student to move forward up to the specified boundary, even if instructor has not reached it.

```json
{
  "name": "allowStudentForwardTo",
  "payload": {
    "indices": { "h": 8, "v": 0, "f": -1 },
    "releaseStartH": 3
  }
}
```

Notes:
- Once an explicit boundary is set, instructor sync commands (`setState`, `slide`, `next`, `prev`) no longer auto-advance the boundary. Only a new `allowStudentForwardTo` / `setStudentBoundary` call will change it.
- If the student is already **past** the new boundary when it is received, they are immediately rubber-banded back to it.
- Boundary enforcement remains horizontally canonicalized for stored `studentBoundary` status (`{ h, v: 0, f: -1 }`), but the runtime may retain the requested `f` as an exact same-slide lock target when the student is on the top-level boundary slide (`v = 0`) so they do not reveal additional fragments ahead of the instructor at boundary `h`.
- Vertical child-slide movement inside a released stack remains locally navigable at the boundary `h` position. Fragment progression on the top-level boundary slide (`v = 0`) is instead tied to the instructor's exact released fragment position.
- Exception: when the boundary is pulled back behind a student and the host is intentionally snapping that student back to the instructor's exact current position, the runtime may temporarily retain the requested `v` / `f` as an exact lock target so the student cannot continue fragments independently after the pullback. This exact lock applies only to that snap-back case; normal released-region enforcement remains horizontal-only.
- Navigation enforcement (preventing forward travel) applies only when role is `student`.
- When sent to an **instructor** iframe, the boundary is stored and shown as a visual marker in the storyboard strip together with the released-range highlight (display only — the instructor can still navigate freely). A `studentBoundaryChanged` message is still emitted with `role: "instructor"`.
- With default plugin settings (`studentCanNavigateBack: true`, `studentCanNavigateForward: false`), student forward progress is limited to the granted instructor `h.f` boundary. Local movement within a released vertical stack may still remain available through `canGoUp` / `canGoDown`.
- `releaseStartH` (optional number) lets the host explicitly declare the horizontal start of the released region used for emitted `releasedRegion` status. When omitted, the iframe falls back to its local current `h` when the boundary is applied.
- To snap the student directly to the instructor's current location, use `syncToInstructor` instead of boundary-setting commands.

#### `setStudentBoundary` (explicit alias)

```json
{
  "name": "setStudentBoundary",
  "payload": {
    "indices": { "h": 5, "v": 0, "f": -1 },
    "releaseStartH": 2
  }
}
```

#### `clearBoundary`

Removes the explicit boundary. The student reverts to **follow-instructor mode**: the boundary auto-captures from the next `setState` / `slide` / `next` / `prev` sync command received from the host.

```json
{ "name": "clearBoundary" }
```

Host pattern for "turn off boundary, limit student to instructor's current position":
```js
// 1. Clear the explicit boundary (enables follow-instructor mode again)
studentIframe.postMessage({ type: 'reveal-sync', action: 'command',
  payload: { name: 'clearBoundary' } }, '*');
// 2. Send a sync so the first auto-capture sets the boundary at instructor's position
studentIframe.postMessage({ type: 'reveal-sync', action: 'command',
  payload: { name: 'setState', payload: { state: instructorState } } }, '*');
```

#### `syncToInstructor`

Atomically snaps a student back to the instructor's supplied Reveal state and re-enters follow-instructor mode. This is the single-command form of the `clearBoundary` + `setState` host pattern above.

```json
{
  "name": "syncToInstructor",
  "payload": {
    "state": { "indexh": 3, "indexv": 0, "indexf": 1 }
  }
}
```

Notes:
- For `student` role, any explicit boundary is cleared first without emitting an intermediate `studentBoundaryChanged: null` message.
- The provided `state` is then applied using the same student sync logic as `setState`, including same-`h` stack preservation and overview-to-storyboard routing.
- After the sync lands, follow-instructor capture immediately re-establishes the student's boundary at the synced instructor position.
- For `instructor` or `standalone` roles, this behaves like `setState`.

#### `toggleOverview` / `showOverview` / `hideOverview`

These commands drive the **custom storyboard strip** in the iframe (via `reveal-storyboard.js`).
They do **not** activate Reveal.js's built-in grid overview mode.

```json
{ "name": "toggleOverview" }
```
```json
{ "name": "showOverview" }
```
```json
{ "name": "hideOverview" }
```

Note: sending `setState` with `overview: true` has the same effect as `showOverview` — the `overview` flag is stripped from the Reveal state before it is applied, and the storyboard strip is opened instead.

#### `chalkboardCall`

```json
{
  "name": "chalkboardCall",
  "payload": {
    "method": "toggleChalkboard",
    "args": []
  }
}
```

#### `chalkboardStroke`

Relay a single draw or erase event from the instructor to a student iframe. Coordinates are in logical space (divided by canvas scale on the instructor side), so they replay correctly at any student viewport size.

```json
{
  "name": "chalkboardStroke",
  "payload": {
    "mode": 1,
    "slide": { "h": 3, "v": 0, "f": -1 },
    "event": {
      "type": "draw",
      "x1": 120.5, "y1": 80.0, "x2": 125.0, "y2": 83.2,
      "color": 0,
      "board": 0,
      "time": 4200
    }
  }
}
```

Erase variant:
```json
{
  "name": "chalkboardStroke",
  "payload": {
    "mode": 1,
    "slide": { "h": 3, "v": 0, "f": -1 },
    "event": { "type": "erase", "x": 120.5, "y": 80.0, "board": 0, "time": 4350 }
  }
}
```

- `mode` — `0` = notes canvas, `1` = chalkboard canvas
- `color` — integer index into the instructor's color palette (same index applies on the student side since palettes are identical)
- `board` — chalkboard page index (for mode 1 only; mode 0 ignores it)
- Strokes for slides not currently visible are stored and replayed when the student navigates to that slide

---

## Cross-Origin Ad Hoc Hosting Note

For a standalone presentation hosted on a different origin, "Host this deck in SyncDeck" should be modeled as an **ActiveBits session bootstrap handoff**, not as an in-iframe role flip.

Why:
- The iframe protocol's `setRole` command only changes runtime behavior inside the deck.
- A real instructor-hosted SyncDeck session also requires a server-created `sessionId`, a configured `presentationUrl`, and instructor authentication for the SyncDeck manager websocket.
- In the current ActiveBits ad hoc flow, `POST /api/syncdeck/create` returns both `sessionId` and `instructorPasscode`, and `POST /api/syncdeck/:sessionId/configure` requires that passcode.
- A cross-origin standalone page cannot safely seed ActiveBits browser storage directly for the manager route.

Recommended flow:
1. The standalone deck calls the ActiveBits ad hoc create/configure endpoints.
2. ActiveBits issues a short-lived, one-time bootstrap artifact tied to the created session and instructor authority.
3. The deck redirects to the hosted SyncDeck manager route on the ActiveBits origin.
4. The manager consumes that bootstrap artifact, persists the normal instructor bootstrap state on the ActiveBits origin, removes the artifact from the URL, and continues as a standard hosted SyncDeck session.

Security constraints:
- Do not place the raw `instructorPasscode` in the redirect URL.
- Treat the bootstrap artifact as one-time and short-lived.
- Keep the iframe sync protocol focused on deck/host coordination after the hosted manager page has assumed control.

### ActiveBits Contract For The Presentation Team

The presentation-side flow for cross-origin ad hoc hosting is:

1. Determine the canonical presentation URL that ActiveBits should host.
2. Create a SyncDeck session.
3. Configure that session with the presentation URL.
4. Request a redirect-safe manager bootstrap token.
5. Redirect the browser to the returned hosted manager URL on the ActiveBits origin.

Current deployment constraint:
- ActiveBits does not currently emit CORS headers for these SyncDeck API routes.
- That means browser `fetch` from an external presentation origin will be blocked unless the deck is effectively same-origin with ActiveBits or a reverse proxy/CDN layer adds a narrow CORS allowlist for the presentation origin.
- The fetch examples below assume one of those deployment conditions is true.

#### Step 1: Create session

`POST /api/syncdeck/create`

Response:

```json
{
  "id": "syncdeck-12345",
  "instructorPasscode": "32-char-hex-passcode"
}
```

Notes:
- The presentation app must treat `instructorPasscode` as secret instructor auth material.
- Do not place this passcode in query params, hash fragments, analytics logs, or postMessage payloads.

#### Step 2: Configure session

`POST /api/syncdeck/:sessionId/configure`

Request body:

```json
{
  "presentationUrl": "https://slides.example/deck",
  "instructorPasscode": "32-char-hex-passcode",
  "standaloneMode": false
}
```

Notes:
- Use `standaloneMode: false` when the goal is to transition into a hosted instructor-managed SyncDeck session.
- `presentationUrl` must be a valid absolute `http(s)` URL.

#### Step 3: Mint a redirect-safe manager bootstrap

`POST /api/syncdeck/:sessionId/manager-bootstrap`

Request body:

```json
{
  "instructorPasscode": "32-char-hex-passcode"
}
```

Response:

```json
{
  "sessionId": "syncdeck-12345",
  "bootstrapToken": "48-char-hex-token",
  "manageUrl": "/manage/syncdeck/syncdeck-12345#bootstrap=48-char-hex-token",
  "expiresInMs": 300000
}
```

Notes:
- `bootstrapToken` is a one-time short-lived redirect artifact, not a long-lived credential.
- The presentation app should prefer redirecting to `manageUrl` exactly as returned.
- The returned `manageUrl` intentionally carries bootstrap material in the URL fragment, not the query string, so normal cross-origin `Referer` forwarding does not include the token.

#### Step 4: Redirect

Presentation-side browser redirect target:

```text
https://<activebits-origin>/manage/syncdeck/:sessionId#bootstrap=...
```

What ActiveBits does after redirect:
- The hosted manager page consumes the bootstrap token with `POST /api/syncdeck/:sessionId/consume-manager-bootstrap`.
- ActiveBits persists the real instructor auth state on its own origin.
- ActiveBits removes `bootstrap` from the URL fragment after successful consumption.
- The manager then continues with the normal hosted SyncDeck websocket/auth flow.

#### Failure handling guidance

- If `create` fails, stay in the standalone deck and show a recoverable error.
- If `configure` fails, do not request a manager bootstrap token.
- If `manager-bootstrap` fails, do not redirect.
- If the redirect lands on ActiveBits but the bootstrap token is expired or already consumed, the hosted manager page will not be authenticated; the safest presentation-side response is to let the user retry from the standalone deck rather than trying to recover with URL-carried instructor secrets.

#### Important non-goals

- The presentation app should not try to switch the existing standalone iframe into full hosted instructor mode by sending `setRole: instructor` alone.
- The presentation app should not attempt to emulate ActiveBits manager storage on the cross-origin page.
- The presentation app should not cache bootstrap tokens for later reuse.

#### Example presentation-side implementation

```ts
interface CreateSyncDeckSessionResponse {
  id?: string
  instructorPasscode?: string
}

interface ManagerBootstrapResponse {
  sessionId?: string
  bootstrapToken?: string
  manageUrl?: string
  expiresInMs?: number
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing ${fieldName}`)
  }

  return value.trim()
}

export async function hostDeckInSyncDeck(params: {
  activeBitsOrigin: string
  presentationUrl: string
}): Promise<void> {
  const activeBitsOrigin = params.activeBitsOrigin.replace(/\/+$/, '')
  const presentationUrl = params.presentationUrl.trim()

  // 1. Create a SyncDeck session.
  const createResponse = await fetch(`${activeBitsOrigin}/api/syncdeck/create`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!createResponse.ok) {
    throw new Error('Unable to create SyncDeck session')
  }

  const createPayload = (await createResponse.json()) as CreateSyncDeckSessionResponse
  const sessionId = readRequiredString(createPayload.id, 'session id')
  const instructorPasscode = readRequiredString(createPayload.instructorPasscode, 'instructor passcode')

  // 2. Configure the created session to host this presentation.
  const configureResponse = await fetch(`${activeBitsOrigin}/api/syncdeck/${encodeURIComponent(sessionId)}/configure`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      presentationUrl,
      instructorPasscode,
      standaloneMode: false,
    }),
  })
  if (!configureResponse.ok) {
    throw new Error('Unable to configure SyncDeck session')
  }

  // 3. Mint a one-time redirect-safe bootstrap token for the hosted manager.
  const bootstrapResponse = await fetch(`${activeBitsOrigin}/api/syncdeck/${encodeURIComponent(sessionId)}/manager-bootstrap`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      instructorPasscode,
    }),
  })
  if (!bootstrapResponse.ok) {
    throw new Error('Unable to create SyncDeck manager bootstrap')
  }

  const bootstrapPayload = (await bootstrapResponse.json()) as ManagerBootstrapResponse
  const manageUrl = readRequiredString(bootstrapPayload.manageUrl, 'manage URL')

  // 4. Redirect the browser to the hosted manager page on the ActiveBits origin.
  window.location.assign(new URL(manageUrl, activeBitsOrigin).toString())
}
```

Implementation notes:
- Keep `instructorPasscode` only in local function scope if possible.
- Prefer `window.location.assign(...)` or an equivalent full-page navigation rather than trying to iframe the hosted manager.
- If the presentation app has multiple candidate URLs for the same deck, choose the canonical one before calling `configure`.

#### `chalkboardState`

Full state sync. Replace the target iframe's entire drawing storage with a snapshot and immediately redraw the current slide.

Sent to **student** iframes to propagate instructor drawings. Also sent back to the **instructor** iframe after a reload — the host uses its cached snapshot to restore drawings that would otherwise be lost when the instructor's in-memory state is reset on page load.

```json
{
  "name": "chalkboardState",
  "payload": {
    "storage": "[{\"width\":960,\"height\":700,\"data\":[...]}]"
  }
}
```

`storage` is the JSON string returned by `RevealChalkboard.getData()` on the instructor side.

#### `requestChalkboardState`

Ask the instructor iframe for a full state snapshot. The iframe responds with a `chalkboardState` upward message.

```json
{ "name": "requestChalkboardState" }
```

### Request current state

Host can request a status snapshot via `action: "requestState"`.

```json
{
  "type": "reveal-sync",
  "action": "requestState",
  "deckId": "2d-arrays",
  "payload": {}
}
```

---

## Iframe → Host Messages

### `activityRequest`

Sent when slide metadata requests an embedded activity launch (for example on slide enter).
This message is emitted by `reveal-iframe-sync` and consumed by SyncDeck host surfaces,
which may prompt the instructor before launching.

Recommended slide metadata contract for library-side emission:

```html
<section
  data-activity-id="video-sync"
  data-activity-trigger="slide-enter"
  data-activity-options='{"mode":"conversion-smoke"}'
></section>
```

Metadata attributes:
- `data-activity-id` (required): registered activity ID to request.
- `data-activity-trigger` (optional): request reason. Current expected values are `slide-enter` and `manual-button`; default `slide-enter`.
- `data-activity-options` (optional JSON object): opaque metadata forwarded to the host unchanged.

When the current slide is part of a vertical stack, the library should also inspect sibling
vertical slides under the same horizontal parent and include any sibling activity anchors as
`stackRequests`. This lets the host launch the full embedded stack up front instead of waiting
for the instructor to visit each sibling slide individually.

```json
{
  "type": "reveal-sync",
  "action": "activityRequest",
  "payload": {
    "activityId": "video-sync",
    "indices": { "h": 3, "v": 0, "f": 0 },
    "instanceKey": "video-sync:3:0",
    "activityOptions": {},
    "trigger": "slide-enter",
    "stackRequests": [
      {
        "activityId": "raffle",
        "indices": { "h": 3, "v": 1, "f": -1 },
        "instanceKey": "raffle:3:1",
        "activityOptions": {},
        "trigger": "slide-enter"
      }
    ]
  }
}
```

Payload fields:
- `activityId` (string): registered activity ID requested by slide metadata.
- `indices` (object): Reveal indices for the requested anchor. Hosts currently expect concrete `h` and `v`; `f` should be included and may be normalized to `0` or `-1` depending on when the request is emitted.
- `instanceKey` (string): stable host-facing identifier for this request. For anchored launches use `${activityId}:${h}:${v}`. If a future host/library flow needs a non-slide-anchored launch, the host may instead provide its own explicit key or fall back to `${activityId}:global`.
- `activityOptions` (object): optional config payload from slide metadata.
- `trigger` (string): request source reason (initial value: `slide-enter`).
- `stackRequests` (array): optional sibling requests for the same horizontal stack. Each entry uses the same payload shape as the primary request (`activityId`, `indices`, `instanceKey`, optional `activityOptions`, optional `trigger`).

Library implementation expectations:
- Emit `activityRequest` only when the current slide actually declares `data-activity-id`.
- Derive `instanceKey` from the emitted `activityId` and the resolved `h:v` anchor, not from fragment position.
- When emitting a primary request for a vertically stacked slide, include sibling activity anchors from the same stack in `stackRequests`, excluding the primary request itself.
- Preserve slide metadata payloads as opaque host input; do not make activity-specific decisions in the library.
- Hosts may de-duplicate by `instanceKey`, so repeated emissions for the same anchored slide are expected to be idempotent.

### `ready`

Sent on init (if `autoAnnounceReady`) and when role changes.

```json
{
  "action": "ready",
  "payload": {
    "reason": "init",
    "role": "student",
    "capabilities": {
      "canNavigateBack": true,
      "canNavigateForward": false
    },
    "studentBoundary": { "h": 2, "v": 0, "f": -1 },
    "releasedRegion": { "startH": 0, "endH": 2 },
    "navigation": {
      "current": { "h": 2, "v": 0, "f": -1 },
      "minIndices": null,
      "maxIndices": { "h": 2, "v": 0, "f": -1 },
      "canGoBack": true,
      "canGoForward": false,
      "canGoLeft": true,
      "canGoRight": false,
      "canGoUp": false,
      "canGoDown": true
    },
    "revealState": {},
    "indices": { "h": 2, "v": 0, "f": -1 },
    "paused": false,
    "overview": false
  }
}
```

### `metadata`

Sent when the iframe wants to publish presentation-level descriptive fields that the host can
use without reading iframe DOM directly.

```json
{
  "action": "metadata",
  "payload": {
    "title": "Bridge Critique Day"
  }
}
```

Payload fields:
- `title` (string, optional): human-readable presentation title. Hosts should trim whitespace and ignore empty values.

Library implementation expectations:
- Emit `metadata` opportunistically when a stable presentation title is known, such as during init or after deck load.
- `metadata` should not be treated as a readiness/handshake replacement; continue emitting `ready`/`state` for sync bootstrap.
- Additional metadata fields may be added later, but hosts must ignore unknown keys.

`overview` reflects whether the **custom storyboard strip** is currently open — not Reveal's native grid overview (which is always suppressed). `true` = strip is visible.

`navigation` provides host-ready arrow state derived from both Reveal's local route availability and SyncDeck boundary enforcement:
- `current`: current slide indices in the iframe.
- `minIndices`: effective lower bound (usually `null`; equals boundary when back nav is disallowed).
- `maxIndices`: effective upper bound (boundary when forward nav is restricted).
- `canGoBack`: final boolean for allowed backward movement from the current position. This may include fragment rewind and vertical stack ascent when those are valid local moves.
- `canGoForward`: final boolean for forward progress along the released instructor boundary, interpreted as `h.f`. It means the student is still behind the currently released horizontal/fragment position and may advance toward it. It does not mean vertical descent within the current stack is available.
- `canGoLeft` / `canGoRight`: strictly horizontal movement availability for left/right arrows, host controls, and horizontal swipe gestures. These exclude fragment progression and vertical stack movement.
- `canGoUp` / `canGoDown`: vertical stack movement availability inside the current horizontal position after SyncDeck back/forward policy is applied. These are independent of `canGoForward`; a student may be unable to advance further along `h.f` while still being allowed to move locally within a released vertical stack.

`releasedRegion` is the stored instructor/storyboard-facing horizontal min/max range between the release start `h` captured when the boundary was granted/applied and the current boundary `h`. It does not automatically recompute from the viewer's current slide position on every status emission. It is primarily used to highlight the active released range in the storyboard.

### `state`

Sent by **any role** on: slide change, fragment shown/hidden, pause, resume, overview shown/hidden, **storyboard strip opened/closed**. Also returned when host sends `requestState`. Students emit state so the host can track their position.

```json
{
  "action": "state",
  "payload": {
    "reason": "requestState",
    "role": "instructor",
    "capabilities": {
      "canNavigateBack": true,
      "canNavigateForward": true
    },
    "studentBoundary": { "h": 5, "v": 0, "f": -1 },
    "releasedRegion": { "startH": 4, "endH": 5 },
    "navigation": {
      "current": { "h": 4, "v": 0, "f": 1 },
      "minIndices": null,
      "maxIndices": null,
      "canGoBack": true,
      "canGoForward": true,
      "canGoLeft": true,
      "canGoRight": true,
      "canGoUp": false,
      "canGoDown": false
    },
    "revealState": {},
    "indices": { "h": 4, "v": 0, "f": 1 },
    "paused": false,
    "overview": false
  }
}
```

`overview` reflects whether the **custom storyboard strip** is currently open (`true` = strip is visible).

`studentBoundary` — defaults to the title-slide boundary `{ h: 0, v: 0, f: -1 }` when an iframe is promoted to `student`, so status is non-null from startup even before the instructor has progressed. For instructors it remains `null` until an explicit boundary is set. After `clearBoundary`, the value becomes `null` until the next instructor-follow capture or explicit boundary command establishes a new one. When non-null, this reflects the canonical stored boundary for students and the boundary marker currently shown in the instructor storyboard strip. The stored boundary is normalized to `{ h, v: 0, f: -1 }`, while effective forward permission on the top-level slide at that `h` (`v = 0`) may be further refined by the instructor's currently released fragment `f`.

`boundaryIsLocal` — `true` when this iframe set the boundary itself (via the storyboard ⚑ button) rather than receiving it from the host. The storyboard uses this to skip forward-navigation restrictions for the acting instructor even if their role hasn't been upgraded to `"instructor"` yet.

Storyboard note: `reveal-storyboard.js` now renders vertical stacks as grouped horizontal entries with child-slide buttons so the active child slide remains visible while the boundary and released region still operate on the parent horizontal `h`.

### `roleChanged`

```json
{
  "action": "roleChanged",
  "payload": { "role": "student" }
}
```

### `studentBoundaryChanged`

Emitted after `allowStudentForwardTo` / `setStudentBoundary` is applied, or when the instructor moves the boundary by clicking a storyboard thumbnail.

```json
{
  "action": "studentBoundaryChanged",
  "payload": {
    "reason": "allowStudentForwardTo",
    "studentBoundary": { "h": 8, "v": 0, "f": -1 }
  }
}
```

Valid `reason` values: `"allowStudentForwardTo"`, `"setStudentBoundary"`, `"instructorSet"`.

`"instructorSet"` means the instructor clicked a boundary button in the storyboard strip. The host should relay this to the student iframe as a `setStudentBoundary` command. Check `role` in the message envelope to distinguish instructor-originated changes from student-side updates.

### `pong`

```json
{
  "action": "pong",
  "payload": { "ok": true }
}
```

### `chalkboardStroke`

Sent by the **instructor** iframe on every draw or erase event. The host should relay this as a `chalkboardStroke` command to all student iframes.

```json
{
  "action": "chalkboardStroke",
  "payload": {
    "mode": 1,
    "slide": { "h": 3, "v": 0, "f": -1 },
    "event": {
      "type": "draw",
      "x1": 120.5, "y1": 80.0, "x2": 125.0, "y2": 83.2,
      "color": 0, "board": 0, "time": 4200
    }
  }
}
```

The host relays this verbatim as a `chalkboardStroke` **command** to student iframes:
```js
studentIframe.postMessage({
  type: 'reveal-sync', action: 'command',
  payload: { name: 'chalkboardStroke', ...msg.payload }
}, '*');
```

### `chalkboardState`

Sent by the **instructor** iframe in two situations:

1. **In response to `requestChalkboardState`** — explicit host request for a full snapshot.
2. **Automatically on `setRole: instructor`** — the iframe posts its current state immediately after being promoted to instructor. On a fresh load this will be an empty storage blob; on a reload within the same session the in-memory state from before the reload will have been lost (sessionStorage is not used — the host is the source of truth). The host should relay this to all connected student iframes.

The host should relay this as a `chalkboardState` command to student iframes.

```json
{
  "action": "chalkboardState",
  "payload": {
    "storage": "[{\"width\":960,\"height\":700,\"data\":[...]}]"
  }
}
```

### `warn`

```json
{
  "action": "warn",
  "payload": {
    "message": "Unknown command: xyz"
  }
}
```

---

## Host Integration Notes

- Validate both `origin` and `type` before processing messages.
- Prefer strict `allowedOrigins`/`hostOrigin` values in production instead of `*`.
- After sending `setRole: student`, send `allowStudentForwardTo` to define handoff range.
- Keep command ordering deterministic (role first, then boundary/state commands).

### Chalkboard session state (snapshot + delta)

The host should maintain a per-session chalkboard buffer with two parts:

```js
session.chalkboard = {
  snapshot: null,  // string — last getData() blob from the instructor
  delta:    [],    // array  — ordered chalkboardStroke payloads since the snapshot
}
```

**When to update the buffer:**

| Upward message from instructor | Action |
|---|---|
| `chalkboardState` (on `setRole: instructor` or slide change) | Replace `snapshot` with `payload.storage`; clear `delta` |
| `chalkboardStroke` | Append `payload` to `delta` |
| `clearChalkboard` / `resetChalkboard` relayed upward* | Clear `delta`; optionally request a fresh snapshot via `requestChalkboardState` |

\* These are not currently relayed upward by the iframe; the host clears its buffer when it sends these commands downward.

**When to send state to a student** (on join, reload, or explicit request):

```js
// 1. Send the snapshot (restores all drawings up to last slide change)
if (session.chalkboard.snapshot) {
  student.postMessage({ ..., payload: { name: 'chalkboardState',
    storage: session.chalkboard.snapshot } });
}
// 2. Replay the delta (applies strokes drawn since the last slide change)
for (const stroke of session.chalkboard.delta) {
  student.postMessage({ ..., payload: { name: 'chalkboardStroke', ...stroke } });
}
```

**Why this works without gaps:**

- On `setRole: instructor` the iframe auto-broadcasts a full `chalkboardState`. The host stores this as the initial snapshot and starts with an empty delta.
- Each instructor stroke arrives as a `chalkboardStroke`. The host relays it to connected students immediately and appends it to the delta.
- On every slide change the iframe sends a fresh `chalkboardState`. The host replaces the snapshot and clears the delta — the new snapshot already incorporates all strokes from the previous slide, so the delta is always short (only strokes on the *current* slide).
- If the instructor reloads, the iframe starts with empty in-memory storage and auto-broadcasts an empty `chalkboardState` on `setRole`. The host should respond by immediately sending a `chalkboardState` command back to the instructor (with its cached snapshot) to restore the drawings, then relay the same snapshot to all students.

### Compatibility policy (recommended)

Use semantic-version compatibility on the host:

- Reject messages when `version` is missing.
- Reject messages when major versions differ.
- Log (but allow) messages when major matches and minor/patch differ.

Example host-side check:

```js
function isCompatibleProtocol(hostVersion, messageVersion) {
  if (!hostVersion || !messageVersion) return false;

  const [hostMajor] = String(hostVersion).split('.').map(Number);
  const [msgMajor] = String(messageVersion).split('.').map(Number);

  if (!Number.isFinite(hostMajor) || !Number.isFinite(msgMajor)) return false;
  return hostMajor === msgMajor;
}

// Usage in message handler
const HOST_SYNC_PROTOCOL = '2.1.0';
if (!isCompatibleProtocol(HOST_SYNC_PROTOCOL, data.version)) {
  // Ignore message or request iframe reload/update
  return;
}
```
