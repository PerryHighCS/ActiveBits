# Reveal Iframe Sync Message Schema

This document defines the `postMessage` protocol used by `reveal-iframe-sync.js`.

## Envelope (all messages)

```json
{
  "type": "reveal-sync",
  "version": "1.1.0",
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
- `action` (string): high-level message type (`command`, `state`, `ready`, etc.).
- `deckId` (string | null): optional logical deck identifier.
- `role` (string): sender role (`student` or `instructor`).
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
    "indices": { "h": 8, "v": 0, "f": 0 },
    "syncToBoundary": false
  }
}
```

Notes:
- Once an explicit boundary is set, instructor sync commands (`setState`, `slide`, `next`, `prev`) no longer auto-advance the boundary. Only a new `allowStudentForwardTo` / `setStudentBoundary` call will change it.
- If the student is already **past** the new boundary when it is received, they are immediately rubber-banded back to it.
- Navigation enforcement (preventing forward travel) applies only when role is `student`.
- When sent to an **instructor** iframe, the boundary is stored and shown as a visual marker in the storyboard strip (display only — the instructor can still navigate freely). A `studentBoundaryChanged` message is still emitted with `role: "instructor"`.
- With default plugin settings (`studentCanNavigateBack: true`, `studentCanNavigateForward: false`), student can move backward and forward only up to the granted boundary.
- `syncToBoundary: true` also jumps the student immediately to that location (ignored for instructor role).

#### `setStudentBoundary` (explicit alias)

```json
{
  "name": "setStudentBoundary",
  "payload": {
    "indices": { "h": 5, "v": 0, "f": 0 },
    "syncToBoundary": true
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
    "studentBoundary": { "h": 2, "v": 0, "f": 0 },
    "navigation": {
      "current": { "h": 2, "v": 0, "f": 0 },
      "minIndices": null,
      "maxIndices": { "h": 2, "v": 0, "f": 0 },
      "canGoBack": true,
      "canGoForward": false
    },
    "revealState": {},
    "indices": { "h": 2, "v": 0, "f": 0 },
    "paused": false,
    "overview": false
  }
}
```

`overview` reflects whether the **custom storyboard strip** is currently open — not Reveal's native grid overview (which is always suppressed). `true` = strip is visible.

`navigation` provides host-ready arrow state derived from both Reveal's local route availability and SyncDeck boundary enforcement:
- `current`: current slide indices in the iframe.
- `minIndices`: effective lower bound (usually `null`; equals boundary when back nav is disallowed).
- `maxIndices`: effective upper bound (boundary when forward nav is restricted).
- `canGoBack`: final boolean for enabling/disabling a host "previous" arrow.
- `canGoForward`: final boolean for enabling/disabling a host "next" arrow.

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
    "studentBoundary": { "h": 5, "v": 0, "f": 0 },
    "navigation": {
      "current": { "h": 4, "v": 0, "f": 1 },
      "minIndices": null,
      "maxIndices": null,
      "canGoBack": true,
      "canGoForward": true
    },
    "revealState": {},
    "indices": { "h": 4, "v": 0, "f": 1 },
    "paused": false,
    "overview": false
  }
}
```

`overview` reflects whether the **custom storyboard strip** is currently open (`true` = strip is visible).

`studentBoundary` — `null` until a boundary has been established; `{ h, v, f }` once set. Non-null for **both student and instructor** roles once a boundary is in effect. For instructors this reflects the boundary currently displayed in the storyboard strip. Cleared to `null` when `clearBoundary` command is received.

`boundaryIsLocal` — `true` when this iframe set the boundary itself (via the storyboard ⚑ button) rather than receiving it from the host. The storyboard uses this to skip forward-navigation restrictions for the acting instructor even if their role hasn't been upgraded to `"instructor"` yet.

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
    "studentBoundary": { "h": 8, "v": 0, "f": 0 }
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
const HOST_SYNC_PROTOCOL = '1.1.0';
if (!isCompatibleProtocol(HOST_SYNC_PROTOCOL, data.version)) {
  // Ignore message or request iframe reload/update
  return;
}
```
