# ActiveBits Architecture

## Overview

ActiveBits is a modular, activity-based learning platform designed for classroom use. The architecture is organized around self-contained activities that can be easily added, removed, or modified.

## Directory Structure

```
ActiveBits/
├── activities/                      # Co-located activities (auto-discovered)
│   ├── raffle/
│   │   ├── activity.config.ts       # Metadata + client/server entry pointers
│   │   ├── client/                  # Manager/Student components and assets
│   │   └── server/                  # API/WebSocket routes and data
│   ├── syncdeck/
│   │   ├── dev-presentations/       # Optional dev-only sample decks, served locally only
│   │   ├── client/
│   │   └── server/
│   ├── resonance/
│   │   ├── activity.config.ts
│   │   ├── client/
│   │   └── server/
│   ├── www-sim/
│   │   ├── activity.config.ts
│   │   ├── client/
│   │   └── server/
│   ├── java-string-practice/
│   │   ├── activity.config.ts
│   │   ├── client/
│   │   └── server/
│   └  ...
├── client/
│   └── src/
│       ├── activities/              # Loader that imports from /activities configs
│       ├── components/              # Shared UI and common components
│       └── App.tsx                  # Main app component
└── server/
    ├── activities/                  # Activity discovery/registry loader
    ├── core/                        # Core server modules
    └── server.ts                    # Main TypeScript server entry point
```

## User Flow

### Teacher Flow - Temporary Sessions
1. Navigate to `/manage`
2. Click a button to create a new activity session
3. System creates session and redirects to `/manage/{activity-id}/{session-id}`
4. Teacher shares the session ID with students
5. Teacher manages the activity from the manager view

### Teacher Flow - Persistent Sessions
1. Navigate to `/manage`
2. Click "Make Permanent Link" for any activity
3. System creates a persistent session with HMAC-authenticated hash
4. Teacher creates a teacher code stored in httpOnly cookie
5. Permanent link is saved to teacher's session list
6. Teacher can access the session at any time via their link ( `/activity/{activityName}/{hash}` )
7. Auto-authentication using teacher code cookie
8. Download CSV backup of all permanent links
9. For `solo-allowed` links with no active live session, the waiting room remains visible so students can choose solo mode and instructors without a remembered cookie can still enter the teacher code to start a new live session

### Student Flow
1. Receive session ID or permanent link from teacher
2. Navigate to `/{session-id}` or enter ID at `/` or use permanent link ( `/activity/{activityName}/{hash}` )
3. System fetches session data and determines activity type
4. Student is shown the appropriate activity component
5. Student interacts with the activity

### Session Lifecycle
- **Temporary sessions**: Created on-demand, expire after inactivity
- **Persistent sessions**: Permanent URLs that create on-demand sessions and allow both teacher and student to enter
- **Session termination**: Teacher can end any session, broadcasting to all connected students
- **WebSocket notifications**: Students automatically redirected when session ends

## Activity Registration System

### Activity Containment Boundary

- Activities are self-contained by default. Activity-specific logic (validation rules, protocol handling, UI flow, and feature behavior) belongs in `activities/<id>/...`.
- Shared layers (`client/src/components/common`, `client/src/hooks`, shared server routes/core, etc.) should expose generic contracts only and remain activity-agnostic.
- Shared modules must not import activity-specific implementation files.
- If a shared capability is needed, add a generic interface/config contract in shared code and let each activity declare or implement its own behavior through that contract.

### Activity Configuration

Each activity owns a config at `/activities/<id>/activity.config.ts` that declares metadata plus pointers to the client and server entry files. The client auto-discovers these configs (and loads the client entries), and the server auto-discovers them to load route handlers. Adding a new activity only requires dropping a new folder with a config plus the corresponding client/server entry files—no central registry to update.

`activity.config.ts` (metadata + entry pointers):
```typescript
export default {
  id: 'activity-id',            // Unique identifier
  name: 'Display Name',         // Human-readable name
  description: 'Brief description', // Shown in dashboard
  color: 'blue',                // Accent color for activity card
  standaloneEntry: {            // Explicit standalone-entry capabilities
    enabled: false,
    supportsDirectPath: false,  // Supports /solo/:activityId
    supportsPermalink: false,   // Supports standalone-capable permalinks
    showOnHome: false,          // Show in the home-page standalone section
    title: 'Standalone Card Title',
    description: 'Standalone entry description',
  },
  utilities: [                  // Optional: extra utility routes/actions
    {
      id: 'gallery-walk-review-copy',
      label: 'Copy Gallery Walk Review Link',
      action: 'copy-url',
      path: '/util/gallery-walk/viewer',
      description: 'Upload and review feedback that was left for you.',
      surfaces: ['manage'],
      standaloneSessionId: 'solo-gallery-walk',
    },
    {
      id: 'gallery-walk-review-home',
      label: 'Gallery Walk Review',
      action: 'go-to-url',
      path: '/util/gallery-walk/viewer',
      description: 'Upload and review feedback that was left for you.',
      surfaces: ['home'],
      standaloneSessionId: 'solo-gallery-walk',
    },
  ],
  // Optional: shared permanent-link modal options and server-side link generation
  deepLinkOptions: {
    presentationUrl: {
      label: 'Presentation URL',
      type: 'text',
      validator: 'url',
    },
  },
  deepLinkGenerator: {
    endpoint: '/api/my-activity/generate-url',
    mode: 'replace-url', // optional: 'replace-url' | 'append-query'
    expectsSelectedOptions: true, // optional
    preflight: { // optional
      type: 'reveal-sync-ping',
      optionKey: 'presentationUrl',
      timeoutMs: 4000,
    },
  },
  createSessionBootstrap: { // optional: persist create-session response fields for manager entry
    sessionStorage: [
      {
        keyPrefix: 'my_activity_instructor_',
        responseField: 'instructorPasscode',
      },
    ],
    historyState: [
      'instructorPasscode',
    ],
  },
  manageDashboard: { // optional shared dashboard hints/capabilities
    customPersistentLinkBuilder: true, // activity-owned persistent-link UI in dashboard modal
  },
  reportEndpoint: '/api/my-activity/:sessionId/report', // optional: activity-owned embedded report download route
  clientEntry: './client/index.ts',  // Component entry (TS/TSX)
  serverEntry: './server/routes.ts', // Server routes
};
```

`createSessionBootstrap` supports two persistence channels:

- `sessionStorage`: Array of `{ keyPrefix, responseField }` entries. Each matching string field from the create-session API response is written to browser sessionStorage using `${keyPrefix}${sessionId}` as the key.
- `historyState`: Array of response field names. Matching fields are attached to React Router navigation state when transitioning from `/manage/:activityId` to `/manage/:activityId/:sessionId`.

Use `historyState` when the value only needs to survive the immediate in-app navigation and should not be persisted in browser storage. Use `sessionStorage` when the value should still be recoverable after reloads or later manager re-entry in the same tab.

`reportEndpoint` is optional activity metadata for embedded-session reporting. When present, SyncDeck can treat it as the child activity's authoritative download surface during embedded end/report flows instead of hard-coding per-activity routes in shared code.

Embedded activity reports should be delivered as a single self-contained HTML document:

- inline the report data payload in the document itself
- inline any required CSS and JavaScript
- avoid external fonts, CDN assets, or follow-up API calls after download
- support multiple views inside the same file (for example class summary and per-student drill-down)
  rather than emitting separate report files for each perspective

These activity-level reports are building blocks for the higher-level SyncDeck session report.
The parent report should eventually aggregate all embedded activities launched during a session
into one self-contained export with:

- whole-session summary across activities
- activity-by-activity drill-down
- per-student drill-down that can span multiple embedded activities

For the aggregate path, SyncDeck should own the outer report container while activities own
their internal report rendering. The shared type contract should follow this split:

- SyncDeck chooses a report `scope` such as `activity-session`, `student-cross-activity`, or
  `session-summary`
- each child activity contributes structured report data for its child session
- each child activity may contribute generic structured report blocks (`scopeBlocks`,
  `studentScopeBlocks`) that the SyncDeck shell can render offline without understanding the
  child activity's raw session schema
- each activity may optionally provide a `ReportSectionComponent` later if richer client-side
  rendering is needed inside the SyncDeck session-report shell for the requested scope
- SyncDeck aggregates those sections through a parent-session manifest rather than trying to
  understand every activity's raw session schema directly

### Embedded Child Bootstrap

Some parent activities launch other activities as embedded child sessions instead of routing
through the normal dashboard create-session flow. In that case, launch options should be
persisted on the child session itself in a generic bootstrap envelope rather than passed
through activity-specific props.

- Parent launchers store embedded bootstrap metadata on `session.data.embeddedLaunch`.
- The bootstrap payload is activity-agnostic and should include the parent session identity,
  the embedded `instanceKey`, and `selectedOptions` for the child activity.
- Child managers should read that payload through shared bootstrap helpers in the same spirit
  as `createSessionBootstrap` or permalink `selectedOptions`, so reloads and redeploys keep
  the launch intent intact.
- Activity-owned session normalizers should also stabilize any runtime session state that the
  embedded manager or student depends on after reload, such as manager auth credentials or
  authoritative “live run” fields. For example, Resonance now normalizes multi-question runs
  with `activeQuestionIds` plus a shared `activeQuestionDeadlineAt`, while still backfilling
  `activeQuestionId` for compatibility with older snapshots.

`client/index.ts` (components/footer only, lazy-loaded chunk):
```typescript
import ManagerComp from './manager/ManagerComp';
import StudentComp from './student/StudentComp';

export default {
  ManagerComponent: ManagerComp,
  StudentComponent: StudentComp,
  PersistentLinkBuilderComponent: null, // optional: activity-owned permanent-link modal UI
  footerContent: null, // JSX if desired (use .tsx if footerContent includes JSX)
};
```

The loader merges `{...config, ...clientEntry}`; keeping metadata in `activity.config.ts` avoids dueling sources of truth.

Client entries are lazy-loaded with `React.lazy` so each activity ships in its own Vite chunk, named `activity-<id>-<hash>.js` via `manualChunks` in `client/vite.config.ts`.

### Automatic Route Generation

Routes are automatically generated in `App.tsx` based on registered activities:
- `/manage/{activity-id}` - Manager view without a sessionId (manager components should create sessions via dashboard APIs)
- `/manage/{activity-id}/{session-id}` - Manage existing session

### Adding a New Activity

See **[ADDING_ACTIVITIES.md](ADDING_ACTIVITIES.md)** for a complete step-by-step tutorial with working code examples.

## Standalone Entry

Standalone entry enables students to use certain activities without requiring a teacher-managed live session. Shared config now distinguishes between:
- direct standalone routes at `/solo/:activityId`
- standalone-capable permalinks
- utility routes that are not normal student-entry flows

### Configuration

Declare standalone capabilities in the activity configuration:

```typescript
export const myActivity = {
  id: 'my-activity',
  name: 'My Activity',
  standaloneEntry: {
    enabled: true,
    supportsDirectPath: true,
    supportsPermalink: true,
    showOnHome: true,
  },
  // ... other config
};
```

### How It Works

1. **Display**: Activities with `standaloneEntry.showOnHome: true` and `supportsDirectPath: true` appear as clickable cards in the standalone section on the join page (`/`)
   - Cards display in a responsive 3-column grid on medium screens and larger (1 column on mobile)
   - Each card shows the activity name, description, and clickable area to launch the activity
2. **Session ID Format**: Solo sessions use the format `solo-{activity-id}` (e.g., `solo-java-string-practice`)
3. **No Teacher Required**: Students can start practicing immediately without a teacher-managed session
4. **Client-Side State**: Solo activities typically use `localStorage` for progress persistence
5. **Utilities**: Optional top-level `utilities` lets an activity expose dashboard and home-page tools without overloading permalink or standalone-entry semantics
6. **Deep Linking Support**: Direct standalone routes can still support query parameters for pre-configuration, e.g., `/solo/algorithm-demo?algorithm=merge-sort`

Activities can also support standalone via permalink without supporting `/solo/:activityId`. SyncDeck is the motivating example for that split.

SyncDeck also supports a cross-origin ad hoc promotion path from a standalone deck into a hosted manager session. In that flow, the standalone presentation creates and configures a SyncDeck session first, then redirects to `/manage/syncdeck/:sessionId#bootstrap=...` using a short-lived one-time bootstrap token minted by ActiveBits. The hosted manager consumes that token on the ActiveBits origin, persists the normal instructor bootstrap state locally, strips the bootstrap token from the URL fragment, and then proceeds through the standard manager websocket/auth path. Using the fragment keeps the bootstrap token out of normal cross-origin `Referer` forwarding while still allowing external presentation hosts to hand off into a real SyncDeck session. Important constraint: ActiveBits does not currently emit browser CORS headers for the SyncDeck API routes, so the standalone deck can only call `/api/syncdeck/create`, `/configure`, and `/manager-bootstrap` directly when it is effectively same-origin with ActiveBits or when a reverse proxy adds an explicit allowlist for that presentation origin.

### Solo Mode vs. Teacher Mode

| Aspect | Solo Mode | Teacher Mode |
|--------|-----------|--------------|
| **Session Creation** | Automatic (`solo-{id}`) | Teacher creates via dashboard |
| **State Management** | localStorage (client) | Server-side sessions |
| **Teacher Dashboard** | Not used | Active management |
| **Use Case** | Self-paced practice | Classroom activities |

### Implementation Tips

- **Manager Component**: Can be a simple stub for solo-only activities
- **Persistence**: Use localStorage with session-specific keys
- **Instructions**: Provide clear, self-explanatory UI since no teacher is present
- **Server Routes**: Optional if activity is fully client-side

## Session Management

### Temporary Sessions
Sessions are stored in-memory with a TTL (time-to-live). Each session has:
- `id` - Unique session identifier
- `type` - Activity type (e.g., 'raffle', 'www-sim')
- `created` - Timestamp of creation
- `lastActivity` - Timestamp of last access
- `data` - Activity-specific data

### Persistent Sessions
Permanent sessions use HMAC-SHA256 authentication:
- **Hash Format**: 20 characters of `salt(8 hex) + hmac(12 hex)` derived from `activityName|hashedTeacherCode|salt`
- **Generic permalink URL state**: persistent links carry one canonical signed permalink state via a short `urlHash`. That canonical state is `entryPolicy` plus the activity's declared deep-link options (`deepLinkOptions`) after normalization. Missing or invalid signed state falls back to `instructor-required` / "Live Only".
- **Teacher Authentication**: Unique teacher codes stored in httpOnly cookies
- **Activity Manager Credentials**: Activities that expose manager-only controls should derive any session-scoped manager credential from create-session bootstrap data and/or teacher-cookie-validated recovery routes instead of trusting a client-selected websocket/API role
- **URL Format**: `/activity/{activityName}/{hash}` for permanent activity access
- **Query Parameters**: For persistent links, only canonical selected options represented in activity `deepLinkOptions` are authoritative and signed (for example `/activity/algorithm-demo/abc123?algorithm=merge-sort&entryPolicy=solo-allowed&urlHash=...`).
  - Unknown query params remain unsigned and must not influence persistent-link runtime behavior.
  - Persistent-session metadata routes expose only the canonical signed option subset via `queryParams`.
  - Activities that need recovered bootstrap values after redirects should use server-recovered/session-backed data instead of re-reading raw manage-route query params.
- **Auto-reset**: Session data resets each time teacher visits
- **Security**: 
  - httpOnly cookies prevent XSS attacks
  - Secure flag enabled in production (HTTPS only)
  - HMAC prevents URL tampering
  - Cookie size limit (20 sessions max with FIFO eviction)
  - Production startup fails when `PERSISTENT_SESSION_SECRET` is missing or weak

### Session Termination
When a teacher ends a session:
1. DELETE request to `/api/session/:sessionId`
2. Server broadcasts `session-ended` via WebSocket to all connected clients
3. Students receive message and redirect to `/session-ended` page
4. Persistent sessions reset (teacher code remains valid)
5. Teacher navigates to activity selection page

## API Patterns

### Common Endpoints
- `POST /api/{activity-id}/create` - Create new session
- `GET /api/session/{session-id}` - Get session data (any type)
- `DELETE /api/session/{session-id}` - Delete session and broadcast to clients
- `POST /api/persistent-session/create` - Create permanent session link
- `GET /api/persistent-session/list` - Get all permanent sessions (requires teacher codes in cookies)
- `POST /api/persistent-session/authenticate` - Verify teacher code for persistent session

### Activity-Specific Endpoints
Each activity defines its own endpoints under `/api/{activity-id}/...`

### Persistent Session Flow
1. Teacher clicks "Make Permanent Link" → enters custom teacher code → POST `/api/persistent-session/create`
2. Server generates HMAC hash from activity name + teacher code + salt
3. Teacher code stored in httpOnly cookie, hash returned to client
4. Teacher accesses `/activity/{activityName}/{hash}` → checks cookie → authenticates via WebSocket
5. Server validates HMAC and teacher code, creates/resets session
6. Teacher auto-authenticated and redirected to manager view

Activities can override the default link-generation endpoint using `activity.config.ts > deepLinkGenerator.endpoint`.

For simple permanent-link UX, shared `ManageDashboard` can render generic fields from `deepLinkOptions` and submit to the configured generator endpoint.

For advanced or protocol-specific UX (for example iframe preview, upload-driven validation, or custom previews), an activity can set `activity.config.ts > manageDashboard.customPersistentLinkBuilder = true` and export `PersistentLinkBuilderComponent` from its client entry.

In that mode, the activity owns only activity-specific UI, validation, and `selectedOptions` preparation. Shared `ManageDashboard` still owns teacher-code input, entry-mode selection, and the final `/api/persistent-session/create|update` request.

`deepLinkGenerator.preflight` remains activity metadata, but shared dashboard code should not interpret activity-specific preflight protocol names directly.

### Deep Linking with Query Parameters
Activities can use URL query parameters for direct deep linking to specific content or configurations. This allows instructors to create presentation-ready links that automatically configure the activity.

**How it works:**
1. URL format: `/activity/{activityName}/{hash}?param1=value1&param2=value2`
2. Server extracts all query params (except reserved routing params) and returns them as `queryParams` object
3. Client components receive `queryParams` via props:
   - Managers: Read from `useSearchParams()` hook
   - Students: Receive via `persistentSessionInfo.queryParams` prop
4. Each activity decides which parameters to handle

**Example implementations:**
- **algorithm-demo**: `?algorithm=merge-sort` - Auto-selects merge sort on session start
- **gallery-walk**: `?preset=brainstorm` - Loads predefined brainstorming template
- **java-practice**: `?challenge=intermediate` - Starts with intermediate difficulty

**Implementation pattern (Manager):**
```typescript
import { useSearchParams } from 'react-router-dom';

export default function MyActivityManager() {
  const [searchParams] = useSearchParams();
  const presetParam = searchParams.get('preset');
  
  useEffect(() => {
    if (presetParam && !hasLoaded) {
      loadPreset(presetParam);
    }
  }, [presetParam, hasLoaded]);
}
```

**Implementation pattern (Student):**
```typescript
export default function MyActivityStudent({ sessionData, persistentSessionInfo }) {
  const presetParam = persistentSessionInfo?.queryParams?.preset;
  
  useEffect(() => {
    if (presetParam) {
      console.log(`Activity configured with preset: ${presetParam}`);
    }
  }, [presetParam]);
}
```

## Status & Metrics

The server exposes runtime status for troubleshooting and monitoring.

- `/api/status` (JSON)
  - `storage`: `{ mode: 'valkey'|'in-memory', ttlMs, valkeyUrl? }` (URL masked)
  - `process`: `{ pid, node, uptimeSeconds, memory, loadavg }`
  - `websocket`: `{ connectedClients }`
  - `sessions`: `{ count, approxTotalBytes, byType, list: [...] }`
    - `list[*]`: `{ id, type, created, lastActivity, ttlRemainingMs, expiresAt, socketCount, approxBytes }`
  - `valkey`: `{ ping, dbsize, memory }` or `{ error }` when unavailable
    - `memory` includes selected metrics parsed from `INFO memory` (e.g., `used_memory`, `used_memory_rss`, humanized variants)

- `/status` (HTML)
  - Lightweight dashboard that polls `/api/status` on an interval (2s/5s/10s/30s)
  - Summary cards: mode/TTL, uptime, RSS/heap, connected sockets, session count/size
  - Sessions-by-type breakdown, Valkey info block
  - Table of active sessions (ID, type, sockets, last activity, expiry, TTL, approx size)

Notes
- Per-session TTL uses Valkey `PTTL` when available; otherwise derived from `lastActivity + ttlMs` in memory mode
- Valkey URL is masked to avoid credential leaks
- Endpoint is designed to be low-overhead; avoids heavy `INFO` sections beyond memory

## Component Patterns

### Manager Component
Receives `sessionId` from URL params via `useParams()`. Should use `SessionHeader` component for consistent UI:

```tsx
import SessionHeader from '@src/components/common/SessionHeader';

export default function MyActivityManager() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  
  const handleEndSession = async () => {
    // Optional: cleanup before ending
    await fetch(`/api/session/${sessionId}`, { method: 'DELETE' });
    navigate('/manage');
  };
  
  return (
    <div>
      <SessionHeader 
        activityName="My Activity"
        sessionId={sessionId}
        onEndSession={handleEndSession}
      />
      {/* Activity content */}
    </div>
  );
}
```

### Student Component
Receives `sessionData` prop from `SessionRouter`. Should handle session termination:

```tsx
import { useCallback, useEffect } from 'react';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler';

export default function MyActivityStudent({ sessionData }) {
  const attachSessionEndedHandler = useSessionEndedHandler();

  const buildWsUrl = useCallback(() => {
    if (!sessionData?.sessionId) return null;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws/my-activity?sessionId=${sessionData.sessionId}`;
  }, [sessionData?.sessionId]);

  const { connect, disconnect } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(sessionData?.sessionId),
    onMessage: handleIncomingMessage,
    attachSessionEndedHandler,
  });

  useEffect(() => {
    if (!sessionData?.sessionId) return undefined;
    connect();
    return () => disconnect();
  }, [sessionData?.sessionId, connect, disconnect]);
}
```

### Shared UI Components
Located in `components/ui/` and imported with `@src/components/ui/ComponentName`.

- **Button** - Consistent button styling with variants
- **Modal** - Confirmation dialogs and overlays
- **RosterPill** - Student count display

### Common Session Components
Located in `components/common/`:

- **SessionHeader** - Unified header with join code, copy URL, end session button
- **SessionEnded** - Page shown when teacher ends session
- **WaitingRoom** - Lobby for persistent sessions before teacher arrives
- **ManageDashboard** - Main teacher dashboard with persistent session list

### Custom Hooks
Located in `hooks/`:

- **useSessionEndedHandler** - Centralized WebSocket listener for session termination
- **useResilientWebSocket** - Shared reconnection + lifecycle manager for all activity WebSockets (handles retries, cleanup, and integrates with `useSessionEndedHandler`)

### Activity-Specific Components
Located within each activity's `components/` folder and imported with relative paths.

## Key Principles

1. **Modularity** - Each activity is self-contained
2. **Scalability** - Easy to add new activities without modifying core code
3. **Maintainability** - Related code is grouped together
4. **Discoverability** - Clear structure makes it easy to find code
5. **Consistency** - Standardized patterns across all activities
6. **DRY Principle** - Routes and UI are generated from configuration

## Security Considerations

### Authentication
This is not for true authentication - there are no users, no persistent storage. Activities are not gated, but
to allow for convenience teachers can create persistent links that will get them and their students into an activity
that contain a hash that allows teachers to use a code to enter the management dashboard.

- **Teacher Codes**: User-created codes (minimum 6 characters) stored in httpOnly cookies for convenience
- **HMAC Hashing**: SHA-256 with 8-character salt prevents URL tampering
- **Cookie Security**: httpOnly flag prevents XSS, secure flag for HTTPS in production
- **Secret Management**: Production deployments must set `PERSISTENT_SESSION_SECRET` environment variable

### Input Validation
- Activity names validated against centralized registry (`activityRegistry.ts`)
- Teacher code length validated (6-100 characters) to prevent DoS attacks
- Session IDs sanitized before database/session lookups
- Cookie size limits prevent abuse (max 20 sessions per browser)
- Rate limiting on teacher code attempts (5 attempts per minute per IP+hash)

### Data Privacy
- Teacher codes never exposed in URLs or client-side JavaScript
- Session data cleared when teacher ends session
- Persistent sessions reset on each visit (no data persistence between uses)

## Future Improvements

- TypeScript for better type safety
- Activity marketplace/plugins
- Per-activity settings and preferences
- Rate limiting on all API endpoints
- Activity-level permission system

## Rejected Ideas
- Database backend for true persistent storage - no persistent storage allowed
