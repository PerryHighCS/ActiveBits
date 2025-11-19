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
│       │   └── www-sim/             # WWW Simulation activity
│       │       ├── index.js         # Activity configuration
│       │       ├── manager/         # Teacher/manager views
│       │       │   └── WwwSimManager.jsx
│       │       ├── student/         # Student views
│       │       │   └── WwwSim.jsx
│       │       └── components/      # Activity-specific components
│       │           ├── DNSLookupTable.jsx
│       │           ├── StudentBrowserView.jsx
│       │           ├── StudentHostPalette.jsx
│       │           ├── StudentInfoPanel.jsx
│       │           └── WwwSimInstructions.jsx
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
    │   └── www-sim/
    │       ├── routes.js            # WWW Sim API routes
    │       └── presetPassages.js    # Activity-specific data
    ├── core/                         # Core server modules
    │   ├── sessions.js              # Session management
    │   └── wsRouter.js              # WebSocket router
    └── server.js                     # Main server entry point
```

## User Flow

### Teacher Flow
1. Navigate to `/manage`
2. Click a button to create a new activity session
3. System creates session and redirects to `/manage/{activity-id}/{session-id}`
4. Teacher shares the session ID with students
5. Teacher manages the activity from the manager view

### Student Flow
1. Receive session ID from teacher
2. Navigate to `/{session-id}` or enter ID at `/`
3. System fetches session data and determines activity type
4. Student is shown the appropriate activity component
5. Student interacts with the activity

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

Sessions are stored in-memory with a TTL (time-to-live). Each session has:
- `id` - Unique session identifier
- `type` - Activity type (e.g., 'raffle', 'www-sim')
- `created` - Timestamp of creation
- `lastActivity` - Timestamp of last access
- `data` - Activity-specific data

## API Patterns

### Common Endpoints
- `POST /api/{activity-id}/create` - Create new session
- `GET /api/session/{session-id}` - Get session data (any type)
- `DELETE /api/session/{session-id}` - Delete session (any type)

### Activity-Specific Endpoints
Each activity defines its own endpoints under `/api/{activity-id}/...`

## Component Patterns

### Manager Component
Receives `sessionId` from URL params via `useParams()`.

### Student Component
Receives `sessionData` prop from `SessionRouter`.

### Shared UI Components
Located in `components/ui/` and imported with `@src/components/ui/ComponentName`.

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

## Future Improvements

- TypeScript for better type safety
- Activity versioning
- Activity hot-reloading in development
- Activity marketplace/plugins
- Per-activity settings and preferences
