# Plan: `syncdeck` Activity

## Context

A new "SyncDeck" activity where one or more instructors drive an HTML presentation (Reveal.js + `reveal-iframe-sync` plugin) and all students follow along in their own iframes, synchronized via WebSocket — similar to Nearpod. Students enter their name before joining, then receive a server-issued student identity cookie so reconnects reattach to the same student record. The instructor creates a verified permanent link embedding the presentation URL. Embedded ActiveBits sub-activities are future work (schema reserved in v1).

Protocol reference: [`.agent/plans/reveal-iframe-sync-message-schema.md`](./reveal-iframe-sync-message-schema.md)

Checklist tracker: [`.agent/plans/syncdeck-checklist.md`](./syncdeck-checklist.md). Update it as tasks are completed.

---

## Architecture Overview

- **Activity ID / name**: `syncdeck` / `SyncDeck`
- **Permanent link format**: `/activity/syncdeck/{hash}?presentationUrl={url-encoded-url}&urlHash={signed-hash}`
  - `hash`: standard 20-char HMAC of activityName + teacherCode (existing infrastructure)
  - `urlHash`: 16-char HMAC of `hash + '|' + presentationUrl` using server HMAC secret. Implicitly salted because `hash` itself contains an 8-char random salt.
  - Verified link creation uses the existing ManageDashboard deep-link flow, but routes through an activity-specific URL generator endpoint for SyncDeck.
- `presentationUrl` query param is an optional instructor-only prefill input. `urlHash` is server-generated metadata for persistent links and is never trusted as a `configure` input. Students joining a session ignore both and always load from `session.data.presentationUrl`.
- **`presentationUrl` lives in `session.data`** — set by instructor after session start via REST. Students receive it from the server (not from URL params), enabling join via `/{sessionId}` as well as the full link.
- **State relay**: Instructor iframe → postMessage → Manager → WS → Server → broadcast → Student WS → postMessage → Student iframe
- **Iframe roles**: Manager iframe set to `role: instructor`; student iframes set to `role: student`
- **Instructor auth**: Any WS connection presenting the session's stable `instructorPasscode` gets instructor role. Handles multiple instructors, multiple devices, and reconnects.
- **Students provide a name** before the presentation view loads
- **No solo mode**

---

## Files to Create

```
activities/syncdeck/
├── activity.config.ts
├── client/
│   ├── index.tsx
│   ├── manager/SyncDeckManager.tsx
│   ├── manager/SyncDeckManager.test.tsx
│   ├── student/SyncDeckStudent.tsx
│   └── student/SyncDeckStudent.test.tsx
└── server/
    ├── routes.ts
    └── routes.test.ts
```

## Files to Modify

- `client/src/activities/index.test.ts` — add `'syncdeck'` to `EXPECTED_ACTIVITIES`
- `server/activities/activityRegistry.test.ts` — add `'syncdeck'` to `EXPECTED_ACTIVITIES`

---

## `activity.config.ts`

```typescript
import type { ActivityConfig } from '../../types/activity.js'

const syncdeckConfig: ActivityConfig = {
  id: 'syncdeck',
  name: 'SyncDeck',
  description: 'Host a synchronized Reveal.js presentation for your class',
  color: 'indigo',
  soloMode: false,
  deepLinkOptions: {
    presentationUrl: {
      label: 'Presentation URL',
      type: 'text',
    },
  },
  // Proposed extension to shared deep-link creation flow.
  // ManageDashboard uses this endpoint instead of generic
  // /api/persistent-session/create for this activity.
  deepLinkGenerator: {
    endpoint: '/api/syncdeck/generate-url',
  },
  clientEntry: './client/index.tsx',
  serverEntry: './server/routes.ts',
}

export default syncdeckConfig
```

---

## Session Data Schema

```typescript
// session.data for type 'syncdeck'
{
  presentationUrl: string | null,

  // Random 32-hex-char token generated at session creation.
  // Stable for session lifetime — not single-use. Handles multiple instructors + reconnects.
  instructorPasscode: string,

  instructorState: {
    indices: { h: number; v: number; f: number } | null
    paused: boolean
    overview: boolean
    updatedAt: number  // Server-stamped; never trusted from client
  } | null,            // null = instructor hasn't sent state yet

  students: Array<{
    studentId: string
    name: string
    joinedAt: number
    lastSeenAt: number
    lastIndices: { h: number; v: number; f: number } | null
    lastStudentStateAt: number | null
  }>,

  embeddedActivities: EmbeddedActivityEntry[]
}

// Future subsession entry
interface EmbeddedActivityEntry {
  embeddedId: string        // UUID assigned at attach time; stable for session lifetime
  activityType: string      // e.g. 'raffle', 'algorithm-demo'
  sessionId: string | null  // Real ActiveBits sub-session ID; null until launched
  slideIndex: { h: number; v: number } | null
  displayName: string
  createdAt: number
  status: 'planned' | 'active' | 'ended' // Future phase lifecycle state
  startedAt: number | null                // Future phase
  endedAt: number | null                  // Future phase; represents end-embedded-activity
}
```

**Normalizer** (`registerSessionNormalizer('syncdeck', ...)`) enforces: `instructorPasscode` is a non-empty string (re-generates if missing); `presentationUrl` is string or null; `instructorState` is null or a fully-formed object; `students` is array of `{ studentId, name, joinedAt, lastSeenAt, lastIndices, lastStudentStateAt }`; `embeddedActivities` is array.

**Student identity**: `students[]` is keyed by `studentId` (not `name`). Duplicate display names are allowed. Reconnect dedupe uses a signed student cookie, not name matching.

**Embedded activities (future phase)**: `embeddedActivities` is reserved in v1 and should remain `[]` unless future-phase functionality is explicitly enabled. The schema includes future lifecycle fields (`status`, `startedAt`, `endedAt`) so `end-embedded-activity` can be represented cleanly later.

---

## `server/routes.ts`

### urlHash helpers

```typescript
const HMAC_SECRET = process.env.PERSISTENT_SESSION_SECRET || 'default-secret-change-in-production'

function computeUrlHash(persistentHash: string, presentationUrl: string): string {
  return createHmac('sha256', HMAC_SECRET)
    .update(`${persistentHash}|${presentationUrl}`)
    .digest('hex')
    .substring(0, 16)
}

function verifyUrlHash(persistentHash: string, presentationUrl: string, candidate: string): boolean {
  if (candidate.length !== 16) return false
  const expected = computeUrlHash(persistentHash, presentationUrl)
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(candidate, 'hex'))
  } catch { return false }
}
```

### REST endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/syncdeck/create` | none | Dashboard "Start Session Now". Creates session with `instructorPasscode`. Returns `{ id, instructorPasscode }`. |
| `POST` | `/api/syncdeck/generate-url` | teacher code in body | SyncDeck deep-link generator used by the shared ManageDashboard flow. Accepts `{ activityName, teacherCode, selectedOptions }`, validates supported options (including `presentationUrl`), creates persistent hash, computes `urlHash`, sets `persistent_sessions` cookie, returns `{ hash, url }`. |
| `GET` | `/api/syncdeck/:sessionId/instructor-passcode` | `persistent_sessions` cookie | For persistent sessions: verifies teacher via `findHashBySessionId` + cookie lookup. Returns `{ instructorPasscode }` from session.data. |
| `POST` | `/api/syncdeck/:sessionId/register-student` | none | Student join/rejoin. Validates name and issues/refreshes signed `syncdeck_student_<sessionId>` cookie. Reuses existing `studentId` from cookie when valid; otherwise creates a new student (with empty `lastIndices`). Returns `{ studentId, name }`. |
| `POST` | `/api/syncdeck/:sessionId/configure` | `instructorPasscode` in body | Post-create session configuration step that binds the live session to a `presentationUrl`. Client always sends `presentationUrl` + `instructorPasscode`; client also sends `urlHash` for persistent-link startup path. Server derives `persistentHash` from `sessionId` (`findHashBySessionId`) when `urlHash` is present and verifies URL integrity before storing. Reject if `urlHash` is present but no persistent mapping exists. |

### WebSocket `/ws/syncdeck`

Query params: `sessionId` (required), `instructorPasscode` (optional)

**On connect:**
1. Look up session; close 1008 if not found or `type !== 'syncdeck'`; tag `socket.sessionId`
2. If `instructorPasscode` provided: `timingSafeEqual` against `session.data.instructorPasscode`. Valid → `socket.isInstructor = true`, send `{ type: 'instructor-ack' }`. Invalid → student (no error — prevents enumeration).
3. If student (non-instructor): parse `syncdeck_student_<sessionId>` cookie from WS upgrade request. If signature is valid and `studentId` exists in `session.data.students`, tag `socket.studentId` and update that student's `lastSeenAt`.
4. Touch session (`lastActivity`) to prevent TTL expiry
5. Send role-scoped catch-up:
   - Instructor socket: `{ type: 'session-state', payload: { instructorState, presentationUrl, students, embeddedActivities } }` where each `students[]` item includes transient `isConnected` (derived from active WS sockets; not persisted in session data)
   - Student socket: `{ type: 'session-state', payload: { instructorState, presentationUrl, studentSelf, studentCount, embeddedActivities } }` where `studentSelf` includes the reconnecting student's `lastIndices`/timestamps (no other students' names)

**On reconnect:** Client-side `useResilientWebSocket` reconnects; server treats as new connection and re-sends catch-up.

**Privacy rule**: Student sockets never receive other students' names in `session-state` catch-up or incremental messages. Name-bearing student roster data is instructor-only.

**Presence tracking**: Server tracks active student sockets by `studentId` per session and emits instructor-only presence updates on student connect/disconnect so toolbar counts/panel status stay live.

**Client → Server (instructor socket only; silently ignored from students):**

| `type` | Payload | Server action |
|--------|---------|--------------|
| `instructor-state` | `{ indices, paused, overview }` | Validate, stamp `updatedAt`, save, broadcast to all |
| `force-sync-students` | `{ indices }` | Validate against current instructor state, set all `students[].lastIndices = indices` (and `lastStudentStateAt`), broadcast `force-sync-students` to student sockets only |

**Client → Server (student socket only; silently ignored from instructors/unknown students):**

| `type` | Payload | Server action |
|--------|---------|--------------|
| `student-position` | `{ indices }` | Requires `socket.studentId`; validate indices, update matching `students[]` entry `lastIndices` + `lastStudentStateAt` |

**Server → All clients:**

| `type` | Payload | Trigger |
|--------|---------|---------|
| `instructor-state` | `InstructorState \| null` | Every instructor state update |

**Server → Student sockets only:** `force-sync-students` with `{ indices }` (instructor explicitly forces all students to instructor page)

**Server → Instructor sockets only:** `student-joined` with `{ studentId, name, totalStudents }` (only for first-time joins; reconnects do not emit `student-joined`)

**Server → Instructor sockets only:** `student-presence` with `{ studentId, connected, connectedCount }` on student socket connect/disconnect (including reconnects)

---

## Reveal-sync Envelope Validation

Used for all postMessage events (ping/pong, state relay, slide triggers):

```typescript
const HOST_PROTOCOL_VERSION = '1.0.0'

function isCompatibleRevealVersion(messageVersion: string): boolean {
  const [hostMajor] = HOST_PROTOCOL_VERSION.split('.').map(Number)
  const [msgMajor] = String(messageVersion ?? '').split('.').map(Number)
  if (!Number.isFinite(hostMajor) || !Number.isFinite(msgMajor)) return false
  return hostMajor === msgMajor
}

function isValidRevealEnvelope(data: unknown): data is RevealSyncEnvelope {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return (
    d.type === 'reveal-sync' &&
    d.source === 'reveal-iframe-sync' &&
    typeof d.version === 'string' &&
    isCompatibleRevealVersion(d.version) &&
    typeof d.action === 'string'
  )
}
```

Ping validation: `isValidRevealEnvelope(data) && data.action === 'pong'`
State relay: `isValidRevealEnvelope(data) && data.action === 'state'`
Slide trigger: `isValidRevealEnvelope(data) && data.action === 'embedded-activity-trigger'` (future phase; ignored in v1)

---

## `client/manager/SyncDeckManager.tsx`

### Manager reads

- `sessionId` from `useParams()`
- `presentationUrl` from `useSearchParams().get('presentationUrl')` (optional instructor prefill for initial setup)
- `instructorPasscode` from `sessionStorage` (survives reload; set after create/fetch)

### Rendering branches

| `sessionId` | Behaviour |
|-------------|-----------|
| absent | Pre-session two-panel UI (see below) |
| present | Active session (URL from session.data via catch-up WS) |

### Pre-session UI

**Panel A — Start a live session:**
URL input → validate → `POST /api/syncdeck/create` → store `instructorPasscode` in sessionStorage → `POST /api/syncdeck/{id}/configure` with `{ presentationUrl, instructorPasscode }` → navigate to `/manage/syncdeck/{id}`

Panel A configures **before** navigation. This avoids an unnecessary second configure call after the manager view mounts.

**Panel B — Create a permanent link:**
Managed by the shared ManageDashboard deep-link modal using SyncDeck's activity-configured generator endpoint (`POST /api/syncdeck/generate-url`) with `selectedOptions.presentationUrl`.

### Active session flow

1. If no `instructorPasscode` in sessionStorage: call `GET /api/syncdeck/{sessionId}/instructor-passcode` (persistent-session cookie path) → store
2. Connect: `/ws/syncdeck?sessionId={id}&instructorPasscode={passcode}` via `useResilientWebSocket`
3. On `session-state`: update local `presentationUrl` and state
4. `configure` endpoint usage (bind session to deck URL after session exists):
   - Panel A ("Start a live session") path: configure is already called **before** navigation; manager view should not call configure again unless session still has no `presentationUrl`
   - Persistent-link startup path (teacher came from permanent link): manager calls `POST /api/syncdeck/{sessionId}/configure` with `{ presentationUrl, instructorPasscode, urlHash }`
   - Manual/fallback manager setup path (session exists but no `presentationUrl`): manager may call `configure` with `{ presentationUrl, instructorPasscode }`
   - Client never sends `persistentHash`; server derives it from `sessionId` when verifying `urlHash`
   - If `urlHash` is present but no persistent hash mapping exists for `sessionId`, server rejects configure
   - Idempotency guard: manager only attempts configure when `session-state.presentationUrl` is empty/null
5. Once `presentationUrl` known: mount iframe
6. On iframe `load` / `ready` postMessage: send `setRole: instructor` command

### Manager toolbar (top of active session view)

Persistent top toolbar above the iframe with:
- `Students` button: toggles a side panel listing connected students (instructor-only data from `session-state.students`)
- `Sync All To Me` button: sends `force-sync-students` with current instructor indices
- `Chalkboard` button: toggles chalkboard in the manager iframe (`chalkboardCall` / `toggleChalkboard`)
- Status text: `{behindCount} behind / {connectedCount} connected`

Toolbar state/behavior:
- `connectedCount` uses live presence (`isConnected === true`), updated from instructor `session-state` + `student-presence`
- `behindCount` computed client-side from instructor roster data:
  - Count only students with `isConnected === true` whose `lastIndices` is non-null and lexicographically behind `instructorState.indices` by `(h, v, f)`
  - If `instructorState.indices` is null, show `0 behind`
  - Connected students with `lastIndices === null` count as behind until their first state event (conservative UX)
- `Sync All To Me` is disabled until instructor indices are known
- Chalkboard toggle is optimistic UI state (resynced on iframe reload/ready)

### Students panel (manager)

Toggleable panel showing instructor-only roster details:
- Student display name
- Connection status (`connected` / `disconnected`) from server-provided presence (`isConnected` + `student-presence` updates)
- Last known position (`h.v.f`) or `unknown`
- Relative status badge (`with instructor`, `behind`, `ahead`) based on lexicographic comparison to instructor indices

### postMessage → WS relay

Origin-guard: `event.origin !== new URL(presentationUrl).origin → return`
Envelope guard: `if (!isValidRevealEnvelope(event.data)) return`

- `action === 'state'` → send `instructor-state` WS message
- `action === 'embedded-activity-trigger'` → no-op in v1 (reserved for future embedded activity launch flow)

### Toolbar actions → iframe commands (manager)

- `Chalkboard` button sends reveal-sync command to manager iframe:
  - Prefer `chalkboardCall` with `{ method: 'toggleChalkboard', args: [] }`
  - Fallback acceptable: `toggleChalkboard`

### TODO: Chalkboard drawing propagation (future)

- Current schema supports chalkboard **control commands** only (`toggleChalkboard`, `toggleNotesCanvas`, etc.).
- Real-time stroke mirroring (instructor drawings appearing on student canvases) is **not yet defined** in the reveal-sync protocol.
- Add protocol events for drawing data (snapshot + incremental delta) and relay them manager → server → students.
- Implement/extend a presentation-side plugin to emit and apply chalkboard drawing updates deterministically.
- Keep controls (`toggle*`, `clear*`, `reset*`) backward compatible while adding drawing sync events.

### URL Validation (before session create or link generate)

1. Parse URL — reject non-http(s)
2. Mount hidden iframe; on `load`, send ping:
   ```json
   { "type": "reveal-sync", "version": "1.0.0", "action": "command",
     "role": "instructor", "source": "reveal-iframe-sync",
     "ts": <unix-ms>, "payload": { "name": "ping", "payload": {} } }
   ```
3. Listen 4s for response passing `isValidRevealEnvelope` with `action === 'pong'` from that origin
4. Pong received → proceed; timeout → yellow warning banner, allow proceeding
5. Remove hidden iframe

### Iframe sandbox

`allow-scripts allow-same-origin allow-popups allow-forms` (no `allow-top-navigation`)

---

## `client/student/SyncDeckStudent.tsx`

### Name collection

Before WS connect or iframe load, show name entry form (pre-filled from localStorage).
On submit: store in localStorage, call `POST /api/syncdeck/{sessionId}/register-student` (server sets signed student cookie), then connect WS.

### `presentationUrl` source

From WS `session-state` message (`session.data.presentationUrl`) — never from URL params. Works for both direct join (`/{sessionId}`) and persistent link. Students joining a session do not provide or verify the presentation URL.

### WS behavior

- Connects to `/ws/syncdeck?sessionId={id}` (no passcode — student role)
- Uses `useResilientWebSocket` with `attachSessionEndedHandler`
- On reconnect: auto-reconnects; browser presents the student cookie automatically; server reattaches socket to the original `studentId` and sends fresh `session-state` catch-up (no duplicate student)

### WS → postMessage relay

On `instructor-state` or initial `session-state`:
- Send `slide` command with `{ h, v, f }` indices (matches reveal-sync schema)
- Send `pause`/`resume` command
- All postMessages to `new URL(presentationUrl).origin`

On `force-sync-students`:
- Send `slide` command with forced `{ h, v, f }` indices
- Update local resume baseline by sending `student-position` on the next iframe `state` event (or immediately if a client-side state cache is maintained)

On iframe `load`: re-send last known state + `setRole: student`

### postMessage → WS relay (student local resume state)

Listen for reveal-sync `action === 'state'` from the student iframe (same origin/envelope guards as manager path). When role is `student`, send `student-position` WS message with `{ indices: { h, v, f } }` so the server can persist per-student position for reconnect resume.

### Reconnect restore behavior

After reconnect catch-up:
1. Apply current instructor sync state (`instructorState`) to ensure pause/overview state is current.
2. If `studentSelf.lastIndices` exists, send `slide` to that saved student position.
3. If saved indices are invalid/unusable, fall back to instructor position.

Result: a student who navigated backward and reconnects resumes their own last page (when valid) instead of always snapping to the instructor.

**Interaction with "Sync All To Me"**: forcing sync updates each student's persisted `lastIndices` to the instructor page, so reconnect resume uses the forced page as the new baseline until the student navigates again.

### Student UI states

| State | UI |
|-------|-----|
| No name yet | Name entry form |
| Name entered, no URL (session not configured yet) | "Waiting for the presentation to start..." |
| URL known, no state | Iframe + "Waiting for presenter..." overlay |
| State received | Full-screen iframe |
| Embedded activity active (future phase) | Inline sub-activity student view |

---

## Embedded Activities Notes (Future Phase)

- `embeddedActivities[]` reserved; multiple instances of same type distinguished by `embeddedId`
- v1 does not implement embedded activity launch/end WS messages or UI transitions; `embeddedActivities[]` remains reserved and typically empty
- Launch (future): `createSession` for the sub-activity → store `sessionId`, set lifecycle fields (`status`, `startedAt`) → broadcast
- End (future): set `status = 'ended'` and `endedAt` (do not delete entry), then broadcast
- Students (future) check embedded activity events → switch to inline activity view
- Sub-sessions never auto-deleted; preserved for `GET /api/syncdeck/{sessionId}/report`
- Slides can trigger launches via `embedded-activity-trigger` postMessage in a future phase (same path as manual UI)

---

## Key Infrastructure Reuse

| Need | Existing utility |
|------|-----------------|
| Persistent session hash | `generatePersistentHash` — `server/core/persistentSessions.ts` |
| Teacher cookie verification | `findHashBySessionId` + cookie parse — `server/core/persistentSessions.ts` + `server/routes/persistentSessionRoutes.ts` |
| Session normalizer | `registerSessionNormalizer` — `server/core/sessionNormalization.ts` |
| WS hook | `useResilientWebSocket` — `client/src/hooks/useResilientWebSocket.ts` |
| Session ended hook | `useSessionEndedHandler` — `client/src/hooks/useSessionEndedHandler.ts` |
| Session header | `SessionHeader` — `client/src/components/common/SessionHeader.tsx` |
| Session create | `createSession` — `server/core/sessions.ts` |

---

## Automated Test Plan (Required)

Add automated tests for SyncDeck v1. Manual verification remains useful for iframe/chalkboard UX, but is not the primary quality gate.

### Server tests (`activities/syncdeck/server/routes.test.ts`)

Test style:
- Route-level tests using in-memory session store + fake app/fake WS router (same style as existing activity route tests where possible)
- Simulated sockets for `/ws/syncdeck` role/auth behavior and broadcast assertions
- Cookie parsing/signing tests include both valid and tampered cookies
- For tests that intentionally trigger expected validation errors/noisy logs, prefix explicit logs with `[TEST]` per repo policy

Required cases:
- `registerSessionNormalizer('syncdeck', ...)`
  - regenerates missing/invalid `instructorPasscode`
  - normalizes malformed `students[]` entries (missing fields, invalid indices)
  - preserves valid `studentId` + `lastIndices`
- `POST /api/syncdeck/create`
  - creates session with `type = 'syncdeck'`
  - returns `{ id, instructorPasscode }`
  - initializes session data shape (`presentationUrl`, `students`, `embeddedActivities`)
- `POST /api/syncdeck/generate-url`
  - accepts `{ activityName, teacherCode, selectedOptions }`
  - validates `selectedOptions.presentationUrl` as required http(s) URL
  - returns `hash`, `url` (where `url` includes `presentationUrl` + `urlHash` query params)
  - sets `persistent_sessions` cookie
- `POST /api/syncdeck/:sessionId/configure`
  - acts as the post-create "bind session to presentation URL" step
  - accepts valid `instructorPasscode` and stores `presentationUrl`
  - rejects invalid `instructorPasscode`
  - accepts `urlHash` only for the persistent-link startup path; rejects client-supplied `persistentHash`
  - when `urlHash` is present, derives `persistentHash` from `sessionId` and verifies `urlHash` against `presentationUrl`
  - rejects when `urlHash` is present but no persistent hash mapping exists for `sessionId`
  - accepts direct configure with only `presentationUrl` + `instructorPasscode` (non-persistent live session flow)
- `GET /api/syncdeck/:sessionId/instructor-passcode`
  - returns passcode with valid teacher cookie for matching persistent session
  - rejects missing/invalid cookie
- `POST /api/syncdeck/:sessionId/register-student`
  - creates new student, sets signed `syncdeck_student_<sessionId>` cookie
  - reuses existing `studentId` from valid cookie (no duplicate row)
  - allows duplicate names with distinct `studentId`s when no valid cookie is present
  - rejects invalid names (empty/too long/whitespace-only, per chosen validation limits)
  - rejects tampered student cookie and creates a new student instead of trusting it
- WS connect auth/roles
  - valid `instructorPasscode` gets instructor role + `instructor-ack`
  - forged `instructorPasscode` is treated as student (no instructor privileges)
  - valid student cookie attaches `socket.studentId`
  - missing/invalid student cookie does not attach `socket.studentId`
- WS catch-up payload privacy
  - instructor `session-state` includes full `students[]` with names + presence
  - student `session-state` excludes roster names and includes only `studentSelf` + `studentCount`
- WS message enforcement
  - student sending `instructor-state` is ignored
  - instructor sending `force-sync-students` updates all students `lastIndices` and broadcasts to student sockets only
  - student sending `student-position` updates only their own row (requires matching `socket.studentId`)
  - student cannot update another student by spoofing payload fields
- WS reconnect/presence
  - reconnect with same student cookie does not create duplicate student
  - instructor receives `student-presence` connect/disconnect events with updated `connectedCount`

### Client student tests (`activities/syncdeck/client/student/SyncDeckStudent.test.tsx`)

Test style:
- React component tests with mocked `fetch`, mocked `WebSocket`, and mocked iframe `contentWindow.postMessage`
- Simulate WS `session-state`, `instructor-state`, and `force-sync-students` messages
- Assert outbound reveal-sync commands use schema-correct command names/payload shapes

Required cases:
- Name submit calls `POST /api/syncdeck/{sessionId}/register-student` before opening WS
- Student waits for `presentationUrl` from `session-state` (does not read URL query params)
- Initial/ongoing instructor sync sends `slide` command with `{ h, v, f }` and `pause`/`resume`
- Student local iframe `state` events relay `student-position` WS messages (only when envelope/origin valid)
- Reconnect resume:
  - applies instructor pause/overview state
  - restores `studentSelf.lastIndices` when present/valid
  - falls back to instructor indices when `studentSelf.lastIndices` missing/invalid
- `force-sync-students` message jumps student to forced indices
- Privacy assumption in client state shape:
  - component tolerates student catch-up payload without `students[]` roster

### Client manager tests (`activities/syncdeck/client/manager/SyncDeckManager.test.tsx`)

Required cases:
- Active-session toolbar renders:
  - `Students` toggle
  - `Sync All To Me`
  - `Chalkboard` toggle
  - `{behindCount} behind / {connectedCount} connected`
- `behindCount` computation from roster vs instructor indices (`behind`, `with instructor`, `ahead`, `unknown`)
- `Sync All To Me` disabled when instructor indices missing
- Clicking `Sync All To Me` sends WS `force-sync-students` with current instructor indices
- Clicking `Chalkboard` sends reveal-sync command (`chalkboardCall` preferred) to manager iframe
- Students panel uses instructor-only roster + presence updates (`student-presence`) to reflect connect/disconnect

### Registry/loader tests (existing)

- `client/src/activities/index.test.ts`: add `'syncdeck'`
- `server/activities/activityRegistry.test.ts`: add `'syncdeck'`

---

## Implementation Checklist: Shared Deep-Link Generator Flow

### A) Type and config contract

1. Extend `types/activity.ts`:
  - Add optional `deepLinkGenerator` on `ActivityConfig`:
    - `endpoint: string` (required when object present)
    - `mode?: 'replace-url' | 'append-query'` (default `'replace-url'`)
    - `expectsSelectedOptions?: boolean` (default true)
  - Keep all existing `deepLinkOptions` behavior backward compatible.

2. Update SyncDeck config in `activities/syncdeck/activity.config.ts`:
  - Add `deepLinkOptions.presentationUrl` as text field.
  - Add `deepLinkGenerator.endpoint = '/api/syncdeck/generate-url'`.

### B) ManageDashboard integration

3. Update `client/src/components/common/ManageDashboard.tsx` create-link flow:
  - If selected activity has `deepLinkGenerator.endpoint`, call that endpoint.
  - Else fall back to `/api/persistent-session/create` unchanged.
  - Send payload:
    - `activityName`
    - `teacherCode`
    - `selectedOptions` (normalized by existing deep-link utilities)
  - Use returned `url` as authoritative URL to display/copy.

4. Keep utility behavior in `client/src/components/common/manageDashboardUtils.ts`:
  - No API changes required for parsing/normalizing deep-link options.
  - Continue to build option query strings for legacy activities.

### C) SyncDeck URL generator endpoint

5. Implement in `activities/syncdeck/server/routes.ts`:
  - `POST /api/syncdeck/generate-url`.
  - Validate:
    - `activityName === 'syncdeck'`
    - `teacherCode` (same length policy as persistent-session route)
    - `selectedOptions.presentationUrl` is valid http(s) URL.
  - Generate persistent hash via shared helper.
  - Compute `urlHash` from `hash + '|' + presentationUrl`.
  - Persist teacher cookie entry in `persistent_sessions` (same structure as generic flow, including `selectedOptions`).
  - Return `{ hash, url }` where `url` includes both `presentationUrl` and `urlHash` query params.

6. Keep generic route untouched in `server/routes/persistentSessionRoutes.ts`:
  - No SyncDeck-specific logic added there.
  - Existing activities continue using `/api/persistent-session/create`.

### D) Runtime verification path

7. Ensure SyncDeck configure path still validates integrity:
  - `POST /api/syncdeck/:sessionId/configure` accepts `urlHash` only for persistent-startup path.
  - Server derives persistent hash from `sessionId` and verifies `urlHash` against provided `presentationUrl`.

8. Optional hardening follow-up:
  - Add per-option validators in SyncDeck route file so future options are validated centrally.
  - Keep validator map local to activity server module.

### E) Tests

9. `activities/syncdeck/server/routes.test.ts`:
  - Add generate-url tests (valid payload, invalid URL, invalid teacher code, cookie set, returned URL includes `urlHash`).
10. `client/src/components/common/manageDashboardUtils.test.ts` and/or `ManageDashboard` tests:
  - Add branch coverage for custom generator endpoint path.
11. Run `npm --workspace activities test` and `npm test`.

---

## Implementation Sequence

1. `activities/syncdeck/activity.config.ts`
2. `activities/syncdeck/server/routes.ts`
3. `activities/syncdeck/server/routes.test.ts` (normalizer + REST + WS auth/privacy baseline)
4. `activities/syncdeck/client/index.tsx`
5. `activities/syncdeck/client/student/SyncDeckStudent.tsx`
6. `activities/syncdeck/client/student/SyncDeckStudent.test.tsx`
7. `activities/syncdeck/client/manager/SyncDeckManager.tsx`
8. `activities/syncdeck/client/manager/SyncDeckManager.test.tsx`
9. `client/src/activities/index.test.ts` — add `'syncdeck'`
10. `server/activities/activityRegistry.test.ts` — add `'syncdeck'`

---

## Verification

### Automated checks (minimum)

1. `npm --workspace activities test` — SyncDeck server/client tests pass
2. `npm test` from root — workspace tests + registry `EXPECTED_ACTIVITIES` checks pass

### Manual checks (focused integration/UX)

3. `/manage` → SyncDeck card visible; "Create Permanent Link" modal includes `presentationUrl` deep-link option
4. Click "Start Session Now" → manager pre-session; enter URL; validate (ping passes envelope check); session created; passcode in sessionStorage; active manager view
5. In ManageDashboard persistent-link modal for SyncDeck: enter teacher code + `presentationUrl` → custom generator endpoint returns link with `presentationUrl` + `urlHash`
6. Visit generated link as instructor (with cookie) → `GET /api/syncdeck/{sessionId}/instructor-passcode` → WS connects → `instructor-ack` received
7. Visit same link in another tab (no cookie) → waiting room → teacher starts → student receives `session-started` → name entry form (no URL entry required)
8. Student enters name → `POST /api/syncdeck/{sessionId}/register-student` sets student cookie + returns `studentId` → student WS connects → instructor sees student count
9. Navigate slides in instructor iframe → state events pass envelope validation → relayed via WS → student iframe follows
9a. Manager toolbar shows `{behindCount} behind / {connectedCount} connected` and updates as students navigate
9b. Click `Students` → panel opens with names, connection status, and relative positions
9c. Click `Chalkboard` → manager iframe toggles chalkboard overlay
9d. Click `Sync All To Me` → student clients jump to instructor page and persisted `lastIndices` are updated to that page
10. Instructor disconnects / reconnects → `instructorPasscode` re-presented → instructor role re-granted → catch-up sent
11. Student navigates backward, then disconnects / reconnects → browser presents `syncdeck_student_<sessionId>` cookie → server reattaches to original `studentId` (no duplicate in `students[]`) and returns `studentSelf.lastIndices` → student resumes prior page (falls back to instructor position only if saved indices are invalid)
12. Non-persistent live session configure path → manager calls `POST /api/syncdeck/{sessionId}/configure` with only `presentationUrl` + `instructorPasscode`; session URL is stored
13. Persistent-link startup configure path → manager calls `POST /api/syncdeck/{sessionId}/configure` with `presentationUrl` + `instructorPasscode` + `urlHash`; server derives `persistentHash` from `sessionId` and verifies before storing
14. `POST /api/syncdeck/{sessionId}/configure` rejects client-supplied `persistentHash` (server-only derived value)
15. Provide `presentationUrl`/`urlHash` on a session with no persistent mapping (`findHashBySessionId` returns null) → configure rejects
16. Connect with forged `instructorPasscode` → treated as student; `instructor-state` messages silently ignored
17. End session → students redirected to `/session-ended`
