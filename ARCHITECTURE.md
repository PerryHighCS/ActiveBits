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
  footerContent: 'Optional text', // Custom footer (optional)
  buttonColor: 'blue',           // Dashboard button color
};
```

### Automatic Route Generation

Routes are automatically generated in `App.jsx` based on registered activities:
- `/manage/{activity-id}` - Create new session
- `/manage/{activity-id}/{session-id}` - Manage existing session

### Adding a New Activity

1. **Create the activity directory structure:**
   ```bash
   mkdir -p client/src/activities/my-activity/{manager,student,components}
   mkdir -p server/activities/my-activity
   ```

2. **Create the client-side components:**
   - `manager/MyActivityManager.jsx` - Teacher view
   - `student/MyActivity.jsx` - Student view
   - `components/` - Activity-specific UI components (if needed)

3. **Create the activity configuration:**
   ```javascript
   // client/src/activities/my-activity/index.js
   import MyActivityManager from './manager/MyActivityManager';
   import MyActivity from './student/MyActivity';

   export const myActivity = {
     id: 'my-activity',
     name: 'My Activity',
     description: 'Description of my activity',
     ManagerComponent: MyActivityManager,
     StudentComponent: MyActivity,
     footerContent: null,
     buttonColor: 'purple',
   };

   export default myActivity;
   ```

4. **Register the activity:**
   ```javascript
   // client/src/activities/index.js
   import myActivity from './my-activity';
   
   export const activities = [
     raffleActivity,
     wwwSimActivity,
     myActivity,  // Add your activity here
   ];
   ```

5. **Create server routes:**
   ```javascript
   // server/activities/my-activity/routes.js
   import { createSession } from '../../core/sessions.js';

   export default function setupMyActivityRoutes(app, sessions, ws) {
     app.post('/api/my-activity/create', (req, res) => {
       const session = createSession(sessions, { data: {} });
       session.type = 'my-activity';
       // Initialize activity-specific data
       res.json({ id: session.id });
     });
     
     // Add more routes as needed
   }
   ```

6. **Register server routes:**
   ```javascript
   // server/server.js
   import setupMyActivityRoutes from './activities/my-activity/routes.js';
   
   // In the server setup:
   setupMyActivityRoutes(app, sessions, ws);
   ```

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

## Benefits of This Architecture

1. **Modularity** - Each activity is self-contained
2. **Scalability** - Easy to add new activities without modifying core code
3. **Maintainability** - Related code is grouped together
4. **Discoverability** - Clear structure makes it easy to find code
5. **Consistency** - Standardized patterns across all activities
6. **Type Safety** - Activity registry provides centralized configuration
7. **DRY Principle** - Routes and UI are generated from configuration

## Future Improvements

- TypeScript for better type safety
- Activity versioning
- Activity hot-reloading in development
- Activity marketplace/plugins
- Per-activity settings and preferences
