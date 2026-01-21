# ActiveBits Architecture

## Overview

ActiveBits is a modular, activity-based learning platform designed for classroom use. The architecture is organized around self-contained activities that can be easily added, removed, or modified.

## Directory Structure

```
ActiveBits/
├── activities/                      # Co-located activities (auto-discovered)
│   ├── raffle/
│   │   ├── activity.config.js       # Metadata + client/server entry pointers
│   │   ├── client/                  # Manager/Student components and assets
│   │   └── server/                  # API/WebSocket routes and data
│   ├── www-sim/
│   │   ├── activity.config.js
│   │   ├── client/
│   │   └── server/
│   ├── java-string-practice/
│   │   ├── activity.config.js
│   │   ├── client/
│   │   └── server/
│   └  ...
├── client/
│   └── src/
│       ├── activities/              # Loader that imports from /activities configs
│       ├── components/              # Shared UI and common components
│       └── App.jsx                  # Main app component
└── server/
    ├── activities/                  # Activity discovery/registry loader
    ├── core/                        # Core server modules
    └── server.js                    # Main server entry point
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

### Activity Configuration

Each activity owns a config at `/activities/<id>/activity.config.js` that declares metadata plus pointers to the client and server entry files. The client auto-discovers these configs (and loads the client entries), and the server auto-discovers them to load route handlers. Adding a new activity only requires dropping a new folder with a config plus the corresponding client/server entry files—no central registry to update.

`activity.config.js` (metadata + entry pointers):
```javascript
export default {
  id: 'activity-id',            // Unique identifier
  name: 'Display Name',         // Human-readable name
  description: 'Brief description', // Shown in dashboard
  color: 'blue',                // Accent color for activity card
  soloMode: false,              // Allow solo practice without teacher
  soloModeMeta: {               // Optional: customize Solo Bits/manager labels
    title: 'Solo Card Title',
    description: 'Solo mode description',
    buttonText: 'Copy Solo Link',
  },
  clientEntry: './client/index.js',  // Component entry (JS/JSX)
  serverEntry: './server/routes.js', // Server routes
};
```

`client/index.js` (components/footer only, lazy-loaded chunk):
```javascript
import ManagerComp from './manager/ManagerComp';
import StudentComp from './student/StudentComp';

export default {
  ManagerComponent: ManagerComp,
  StudentComponent: StudentComp,
  footerContent: null, // JSX if desired (use .jsx + import React)
};
```

The loader merges `{...config, ...clientEntry}`; keeping metadata in `activity.config.js` avoids dueling sources of truth.

Client entries are lazy-loaded with `React.lazy` so each activity ships in its own Vite chunk, named `activity-<id>-<hash>.js` via `manualChunks` in `client/vite.config.js`.

### Automatic Route Generation

Routes are automatically generated in `App.jsx` based on registered activities:
- `/manage/{activity-id}` - Manager view without a sessionId (manager components should create sessions via dashboard APIs)
- `/manage/{activity-id}/{session-id}` - Manage existing session

### Adding a New Activity

See **[ADDING_ACTIVITIES.md](ADDING_ACTIVITIES.md)** for a complete step-by-step tutorial with working code examples.

## Solo Mode

Solo mode enables students to practice activities independently without requiring a teacher to manage a session. This feature provides self-paced learning opportunities directly from the join page.

### Configuration

Enable solo mode by setting `soloMode: true` in the activity configuration:

```javascript
export const myActivity = {
  id: 'my-activity',
  name: 'My Activity',
  soloMode: true,  // Appears in "Solo Bits" section
  // ... other config
};
```

### How It Works

1. **Display**: Activities with `soloMode: true` appear as clickable cards in the "Solo Bits" section on the join page (`/`)
   - Cards display in a responsive 3-column grid on medium screens and larger (1 column on mobile)
   - Each card shows the activity name, description, and clickable area to launch the activity
2. **Session ID Format**: Solo sessions use the format `solo-{activity-id}` (e.g., `solo-java-string-practice`)
3. **No Teacher Required**: Students can start practicing immediately without a teacher-managed session
4. **Client-Side State**: Solo activities typically use `localStorage` for progress persistence
5. **Custom Labels**: Optional `soloModeMeta` lets each activity override the Solo Bits card title/description and the dashboard "Copy Solo…" button text
6. **Deep Linking Support**: Solo mode supports query parameters for pre-configuration, e.g., `/solo/algorithm-demo?algorithm=merge-sort` auto-selects the merge sort algorithm

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
- **Teacher Authentication**: Unique teacher codes stored in httpOnly cookies
- **URL Format**: `/activity/{activityName}/{hash}` for permanent activity access
- **Query Parameters**: Activities can use URL query params for deep linking (e.g., `/activity/algorithm-demo/abc123?algorithm=merge-sort`)
  - Server passes all query params to activities via `queryParams` object
  - Each activity decides which parameters to handle
  - Examples: `algorithm` (algorithm-demo), `preset` (gallery-walk), `challenge` (java-practice)
- **Auto-reset**: Session data resets each time teacher visits
- **Security**: 
  - httpOnly cookies prevent XSS attacks
  - Secure flag enabled in production (HTTPS only)
  - HMAC prevents URL tampering
  - Cookie size limit (20 sessions max with FIFO eviction)
  - Production warnings for default HMAC secret

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
```javascript
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
```javascript
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

```jsx
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

```jsx
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
- Activity names validated against centralized registry (`activityRegistry.js`)
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
