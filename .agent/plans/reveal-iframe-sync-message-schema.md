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
- Boundary is enforced only when role is `student`.
- With default plugin settings (`studentCanNavigateBack: true`, `studentCanNavigateForward: false`), student can move backward and forward only up to the granted boundary.
- `syncToBoundary: true` also jumps the student immediately to that location.

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

### `state`

Sent by instructor on deck changes and returned when host sends `requestState`.

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
    "studentBoundary": null,
    "revealState": {},
    "indices": { "h": 4, "v": 0, "f": 1 },
    "paused": false,
    "overview": false
  }
}
```

### `roleChanged`

```json
{
  "action": "roleChanged",
  "payload": { "role": "student" }
}
```

### `studentBoundaryChanged`

Emitted after `allowStudentForwardTo` / `setStudentBoundary` is applied.

```json
{
  "action": "studentBoundaryChanged",
  "payload": {
    "reason": "allowStudentForwardTo",
    "studentBoundary": { "h": 8, "v": 0, "f": 0 }
  }
}
```

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
