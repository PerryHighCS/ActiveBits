# Reveal Iframe Sync Message Schema

This document defines the `postMessage` protocol used by `js/reveal-iframe-sync.js`.

## Envelope (all messages)

```json
{
  "type": "reveal-sync",
  "version": "1.0.0",
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
    "revealState": {},
    "indices": { "h": 2, "v": 0, "f": 0 },
    "paused": false,
    "overview": false
  }
}
```

`overview` reflects whether the **custom storyboard strip** is currently open — not Reveal's native grid overview (which is always suppressed). `true` = strip is visible.

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
const HOST_SYNC_PROTOCOL = '1.0.0';
if (!isCompatibleProtocol(HOST_SYNC_PROTOCOL, data.version)) {
  // Ignore message or request iframe reload/update
  return;
}
```
