# ActiveBits Architecture

## Overview

ActiveBits is a modular, activity-based learning platform designed for classroom use. The architecture is organized around self-contained activities that can be easily added, removed, or modified.

## Directory Structure

```
ActiveBits/
├── client/
│   └── src/
│       ├── activities/               # Activity modules
│       │   ├── index.js             # Activity registry
│       │   ├── raffle/              # Raffle activity
│       │   │   ├── index.js         # Activity configuration
│       │   │   ├── manager/         # Teacher/manager views
│       │   │   │   ├── RaffleManager.jsx
│       │   │   │   ├── RaffleLink.jsx
│       │   │   │   ├── TicketsList.jsx
│       │   │   │   └── WinnerMessage.jsx
│       │   │   └── student/         # Student views
│       │   │       └── TicketPage.jsx
│       │   ├── www-sim/             # WWW Simulation activity
│       │   │   ├── index.js         # Activity configuration
│       │   │   ├── manager/         # Teacher/manager views
│       │   │   │   └── WwwSimManager.jsx
│       │   │   ├── student/         # Student views
│       │   │   │   └── WwwSim.jsx
│       │   │   └── components/      # Activity-specific components
│       │   │       ├── DNSLookupTable.jsx
│       │   │       ├── StudentBrowserView.jsx
│       │   │       ├── StudentHostPalette.jsx
│       │   │       ├── StudentInfoPanel.jsx
│       │   │       └── WwwSimInstructions.jsx
│       │   └── java-string-practice/    # Java String methods activity
│       │       ├── index.js             # Activity configuration
│       │       ├── manager/             # Teacher/manager views
│       │       │   └── JavaStringPracticeManager.jsx
│       │       ├── student/             # Student views
│       │       │   └── JavaStringPractice.jsx
│       │       └── components/          # Activity-specific components
│       │           ├── challengeLogic.js
│       │           ├── ChallengeSelector.jsx
│       │           ├── StringDisplay.jsx
│       │           ├── AnswerSection.jsx
│       │           ├── FeedbackDisplay.jsx
│       │           ├── StatsPanel.jsx
│       │           └── styles.css
│       ├── components/
│       │   ├── ui/                  # Shared UI components
│       │   │   ├── Button.jsx
│       │   │   ├── Modal.jsx
│       │   │   └── RosterPill.jsx
│       │   └── common/              # Common app components
│       │       ├── ManageDashboard.jsx
│       │       └── SessionRouter.jsx
│       └── App.jsx                  # Main app component
└── server/
    ├── activities/                   # Activity server modules
    │   ├── raffle/
    │   │   └── routes.js            # Raffle API routes
    │   ├── www-sim/
    │   │   ├── routes.js            # WWW Sim API routes
    │   │   └── presetPassages.js    # Activity-specific data
    │   └── java-string-practice/
    │       └── routes.js            # Java String Practice API routes
    ├── core/                         # Core server modules
    │   ├── sessions.js              # Session management
    │   └── wsRouter.js              # WebSocket router
    └── server.js                     # Main server entry point
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
4. Teacher receives unique teacher code stored in httpOnly cookie
5. Permanent link is saved to teacher's session list
6. Teacher can access the session at any time via `/p/{hash}`
7. Auto-authentication using teacher code cookie
8. Download CSV backup of all permanent links

### Student Flow
1. Receive session ID or permanent link from teacher
2. Navigate to `/{session-id}` or `/p/{hash}` or enter ID at `/`
3. System fetches session data and determines activity type
4. Student is shown the appropriate activity component
5. Student interacts with the activity

### Session Lifecycle
- **Temporary sessions**: Created on-demand, expire after inactivity
- **Persistent sessions**: Permanent URLs that reset on each visit
- **Session termination**: Teacher can end any session, broadcasting to all connected students
- **WebSocket notifications**: Students automatically redirected when session ends

## Activity Registration System

### Activity Configuration

Each activity is defined by a configuration object in its `index.js` file:

```javascript
export const activityName = {
  id: 'activity-id',              // Unique identifier
  name: 'Display Name',           // Human-readable name
  description: 'Brief description', // Shown in dashboard
  ManagerComponent: ManagerComp,  // Teacher view component
  StudentComponent: StudentComp,  // Student view component
  footerContent: null,            // JSX element or null (use .jsx if JSX)
  color: 'blue',                 // Accent color for activity card
  soloMode: false,               // Allow solo practice without teacher
};
```

### Automatic Route Generation

Routes are automatically generated in `App.jsx` based on registered activities:
- `/manage/{activity-id}` - Create new session
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
2. **Session ID Format**: Solo sessions use the format `solo-{activity-id}` (e.g., `solo-java-string-practice`)
3. **No Teacher Required**: Students can start practicing immediately without a teacher-managed session
4. **Client-Side State**: Solo activities typically use `localStorage` for progress persistence

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
- **Hash Format**: `{hash}-{salt}` where hash = HMAC(activityType + salt)
- **Teacher Authentication**: Unique teacher codes stored in httpOnly cookies
- **URL Format**: `/p/{hash}` for permanent activity access
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
4. Teacher accesses `/p/{hash}` → checks cookie → authenticates via WebSocket
5. Server validates HMAC and teacher code, creates/resets session
6. Teacher auto-authenticated and redirected to manager view

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
import { useEffect, useRef } from 'react';
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler';

export default function MyActivityStudent({ sessionData, wsRef }) {
  const attachSessionEndedHandler = useSessionEndedHandler();
  
  useEffect(() => {
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    
    // Attach handler after creating WebSocket
    attachSessionEndedHandler(ws);
    
    // Activity WebSocket setup...
  }, [attachSessionEndedHandler]);
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

### Activity-Specific Components
Located within each activity's `components/` folder and imported with relative paths.

## Key Principles

1. **Modularity** - Each activity is self-contained
2. **Scalability** - Easy to add new activities without modifying core code
3. **Maintainability** - Related code is grouped together
4. **Discoverability** - Clear structure makes it easy to find code
5. **Consistency** - Standardized patterns across all activities
6. **DRY Principle** - Routes and UI are generated from configuration

For a detailed comparison of the old vs. new architecture, see [REFACTORING_SUMMARY.md](REFACTORING_SUMMARY.md).

## Security Considerations

### Authentication
- **Teacher Codes**: User-created codes (minimum 6 characters) stored in httpOnly cookies for convenience
- **HMAC Hashing**: SHA-256 with 8-character salt prevents URL tampering
- **Cookie Security**: httpOnly flag prevents XSS, secure flag for HTTPS in production
- **Secret Management**: Production deployments must set `PERSISTENT_SESSION_SECRET` environment variable
- **Security Note**: Teacher codes are NOT meant for cryptographic security - they're simple barriers for educational use

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
- Activity versioning
- Activity hot-reloading in development
- Activity marketplace/plugins
- Per-activity settings and preferences
- Database backend for true persistent storage
- Rate limiting on all API endpoints
- Activity-level permission system
