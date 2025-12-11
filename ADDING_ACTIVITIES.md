# Quick Start: Adding a New Activity

This guide walks you through adding a new activity to ActiveBits with a complete working example.

> 💡 **Tip:** For architectural details and patterns, see [ARCHITECTURE.md](ARCHITECTURE.md)

## Example: Adding a "Quiz" Activity

### Step 1: Create the Activity Structure

```bash
mkdir -p activities/quiz/client/{manager,student}
mkdir -p activities/quiz/server
```

### Step 2: Create the Student Component

**File: `activities/quiz/client/student/QuizPage.jsx`**

```jsx
import React, { useState } from 'react';
import Button from '@src/components/ui/Button';

export default function QuizPage({ sessionData }) {
  const [answer, setAnswer] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    await fetch(`/api/quiz/${sessionData.sessionId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer }),
    });
    setSubmitted(true);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">Quiz</h2>
      <p className="mb-4">{sessionData.question}</p>
      
      {!submitted ? (
        <>
          <input
            type="text"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            className="border p-2 rounded w-full mb-4"
            placeholder="Your answer..."
          />
          <Button onClick={handleSubmit}>Submit Answer</Button>
        </>
      ) : (
        <p className="text-green-600">Answer submitted!</p>
      )}
    </div>
  );
}
```

### Step 3: Create the Manager Component

**File: `activities/quiz/client/manager/QuizManager.jsx`**

```jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SessionHeader from '@src/components/common/SessionHeader';
import Button from '@src/components/ui/Button';

export default function QuizManager() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [question, setQuestion] = useState('');
  const [responses, setResponses] = useState([]);

  useEffect(() => {
    if (!sessionId) return;
    
    // Poll for responses
    const interval = setInterval(async () => {
      const res = await fetch(`/api/quiz/${sessionId}/responses`);
      const data = await res.json();
      setResponses(data.responses || []);
    }, 2000);
    
    return () => clearInterval(interval);
  }, [sessionId]);

  const createQuiz = async () => {
    await fetch(`/api/quiz/${sessionId}/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
  };

  const handleEndSession = async () => {
    await fetch(`/api/session/${sessionId}`, { method: 'DELETE' });
    navigate('/manage');
  };

  return (
    <div className="p-6">
      <SessionHeader 
        activityName="Quiz"
        sessionId={sessionId}
        onEndSession={handleEndSession}
      />
      
      <div className="mb-4">
        <label className="block mb-2">Question:</label>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          className="border p-2 rounded w-full"
        />
        <Button onClick={createQuiz} className="mt-2">Set Question</Button>
      </div>
      
      <div>
        <h3 className="font-bold mb-2">Responses ({responses.length})</h3>
        <ul>
          {responses.map((r, i) => (
            <li key={i} className="border-b py-2">{r.answer}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

### Step 4: Create the Client Entry (components/footer only)

**File: `activities/quiz/client/index.js`** (or `.jsx` if using JSX in `footerContent`)

```javascript
import QuizManager from './manager/QuizManager';
import QuizPage from './student/QuizPage';

export default {
  ManagerComponent: QuizManager,
  StudentComponent: QuizPage,
  footerContent: null, // Set to JSX element for custom footer, or null for no footer
};
```

Keep metadata (id/name/description/color/soloMode) in `activity.config.js` to avoid dueling sources of truth. The loader merges `{...config, ...clientEntry}` at runtime.

### Step 5: Create Server Routes

**File: `activities/quiz/server/routes.js`**

```javascript
import { createSession } from '../../../server/core/sessions.js';

export default function setupQuizRoutes(app, sessions, ws) {
  // Create quiz session
  app.post('/api/quiz/create', async (req, res) => {
    const session = await createSession(sessions, { data: {} });
    session.type = 'quiz';
    session.data.question = '';
    session.data.responses = [];
    await sessions.set(session.id, session);
    res.json({ id: session.id });
  });

  // Set question
  app.post('/api/quiz/:sessionId/setup', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'quiz') {
      return res.status(404).json({ error: 'invalid session' });
    }
    
    session.data.question = req.body.question;
    await sessions.set(session.id, session);
    res.json({ success: true });
  });

  // Submit answer
  app.post('/api/quiz/:sessionId/submit', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'quiz') {
      return res.status(404).json({ error: 'invalid session' });
    }
    
    session.data.responses.push({
      answer: req.body.answer,
      timestamp: Date.now(),
    });
    
    await sessions.set(session.id, session);
    res.json({ success: true });
  });

  // Get responses
  app.get('/api/quiz/:sessionId/responses', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'quiz') {
      return res.status(404).json({ error: 'invalid session' });
    }
    
    res.json({ responses: session.data.responses });
  });
}
```

**Important:** Always use `await sessions.get()` and `await sessions.set()` - the session store is async.

### Step 5a: Register Session Data Normalization (Required for Valkey/Cache)

When using Valkey for session persistence, sessions loaded after a server restart may have incomplete or missing data structures. To prevent runtime errors, register activity-specific session normalizers inside your activity's server entry file.

**File: `activities/<your-activity>/server/routes.js` (or wherever you set up routes)**

```javascript
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js';

registerSessionNormalizer('quiz', (session) => {
    session.data.question = typeof session.data.question === 'string' ? session.data.question : '';
    session.data.responses = Array.isArray(session.data.responses) ? session.data.responses : [];
});
```

**Key points:**
- Always `import { registerSessionNormalizer }` from `activebits-server/core/sessionNormalization.js` within your activity server module.
- The normalizer receives the live session object. Mutate `session.data` directly to ensure required fields exist.
- Use `Array.isArray(...)` before assuming an array, and treat plain objects defensively (`value && typeof value === 'object' && !Array.isArray(value)`).
- You only need to register the normalizer once per activity; the activity module is loaded during server startup.
- These normalizers are applied automatically whenever sessions are loaded from Valkey or from the in-memory store, so you don't have to touch `server/core/sessions.js`.

### Step 6: Add the Activity Config (auto-discovery)

**File: `activities/quiz/activity.config.js`**

```javascript
export default {
  id: 'quiz',
  name: 'Quiz',
  description: 'Ask students questions and collect responses',
  color: 'purple',
  soloMode: false,
  clientEntry: './client/index.js',  // or .jsx if using JSX in footerContent
  serverEntry: './server/routes.js',
};
```

Activities are auto-discovered from `activities/*/activity.config.js`; no central registry needs updating.

### Step 7: Update the Activity Tests

**File: `client/src/activities/index.test.js`**

Add your new activity to the `EXPECTED_ACTIVITIES` array to ensure it's properly discovered on the client side:

```javascript
const EXPECTED_ACTIVITIES = [
  "java-string-practice",
  "python-list-practice",
  "quiz",  // Add your new activity here
  "raffle",
  "www-sim",
];
```

**File: `server/activities/activityRegistry.test.js`**

Also add your new activity to the `EXPECTED_ACTIVITIES` array in the server-side test:

```javascript
const EXPECTED_ACTIVITIES = [
  "java-string-practice",
  "python-list-practice",
  "quiz",  // Add your new activity here
  "raffle",
  "www-sim",
];
```

These tests verify that:
- All expected activities exist with the required file structure
- Activity configs have all required fields (server test)
- No unexpected activities have been added
- Activity count matches expectations

Run the tests to verify your activity is properly set up:

```bash
npm run test:unit --workspace client
npm test --workspace server
# Or run all tests from the root:
npm test
```

### Done! 🎉

Your new activity is now fully integrated:
- ✅ Automatically appears in the management dashboard
- ✅ Routes are automatically generated
- ✅ Students can join using the session ID
- ✅ Tests verify the activity is properly discovered
- ✅ Fully functional and ready to use

## File Checklist

When adding a new activity, create these files:

**Client (inside `activities/{name}/client/`):**
- [ ] `index.js` (or `.jsx`) - Activity config (exports id/name/description/etc. plus ManagerComponent/StudentComponent)
- [ ] `manager/Manager.jsx` - Teacher view (use SessionHeader)
- [ ] `student/Student.jsx` - Student view (use useSessionEndedHandler)
- [ ] `components/` - Activity-specific UI (optional)

**Server (inside `activities/{name}/server/`):**
- [ ] `routes.js` - API endpoints/WebSocket setup

**Tests:**
- [ ] Add activity ID to `EXPECTED_ACTIVITIES` in `client/src/activities/index.test.js`
- [ ] Add activity ID to `EXPECTED_ACTIVITIES` in `server/activities/activityRegistry.test.js`

No central registry updates are needed; activities are auto-discovered from `activities/*/activity.config.js`.

## Tips

1. **Use existing activities as templates** - Copy structure from `raffle` or `www-sim`
2. **Test incrementally** - Build and test as you add each component
3. **Follow naming conventions** - Use kebab-case for folder names, PascalCase for components
4. **Keep activities self-contained** - All activity code should live in its folder
5. **Reuse shared UI** - Import from `@src/components/ui/` when possible
6. **Use SessionHeader** - All manager components should use the unified SessionHeader
7. **Handle session termination** - Student components should use useSessionEndedHandler hook

## Solo Mode Activities

Solo mode allows students to practice activities independently without a teacher managing a session. Activities with `soloMode: true` appear in the "Solo Bits" section on the join page.

### When to Use Solo Mode

Enable solo mode (`soloMode: true`) for activities that:
- Focus on individual practice and skill building
- Don't require teacher orchestration or real-time management
- Can function entirely client-side or with minimal server interaction
- Track progress locally (e.g., using localStorage)

### Example: Solo-Only Activity

```javascript
export const practiceActivity = {
  id: 'practice',
  name: 'Practice Mode',
  description: 'Individual skill practice',
  ManagerComponent: () => <div>This activity is solo-only</div>,
  StudentComponent: PracticeComponent,
  soloMode: true,  // Shows in Solo Bits
  color: 'green',
  footerContent: null,
};
```

**Key Points:**
- Solo sessions use sessionId format: `solo-{activityId}` (e.g., `solo-java-string-practice`)
- No teacher dashboard needed - ManagerComponent can be a stub
- Store state in localStorage if persistence is needed
- Server routes are optional for fully client-side activities

### Solo Mode Best Practices

1. **Use localStorage for progress tracking**:
```javascript
const sessionId = 'solo-my-activity';
const stats = JSON.parse(localStorage.getItem(`my-activity-stats-${sessionId}`));
localStorage.setItem(`my-activity-stats-${sessionId}`, JSON.stringify(newStats));
```

2. **Make the student experience self-contained** - no external state needed
3. **Provide clear instructions** - no teacher to guide students
4. **Consider adding a "reset progress" option** for solo activities

## Common Patterns

For detailed information on component patterns, session management, and API design, see [ARCHITECTURE.md](ARCHITECTURE.md).

### Polling for Updates (Manager Side)
```javascript
useEffect(() => {
  if (!sessionId) return;
  
  const interval = setInterval(async () => {
    const res = await fetch(`/api/${activityId}/${sessionId}/data`);
    const data = await res.json();
    setData(data);
  }, 2000);
  
  return () => clearInterval(interval);
}, [sessionId]);
```

### Session Data Validation (Server)
```javascript
app.post('/api/my-activity/:sessionId/action', (req, res) => {
  const session = sessions[req.params.sessionId];
  if (!session || session.type !== 'my-activity') {
    return res.status(404).json({ error: 'invalid session' });
  }
  
  // Your logic here
});
```

### WebSocket Support (Advanced)

For activities that need real-time bidirectional communication, use WebSocket. See `www-sim` and `java-string-practice` for complete examples.

**Example WebSocket setup with session-ended handling:**

```jsx
import React, { useCallback, useEffect, useState } from 'react';
import { useResilientWebSocket } from '@src/hooks/useResilientWebSocket';
import { useSessionEndedHandler } from '@src/hooks/useSessionEndedHandler';

export default function RealtimeActivity({ sessionData }) {
  const { sessionId } = sessionData;
  const attachSessionEndedHandler = useSessionEndedHandler();
  const [messages, setMessages] = useState([]);

  const buildWsUrl = useCallback(() => {
    if (!sessionId) return null;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    return `${protocol}//${host}/ws/my-activity?sessionId=${sessionId}`;
  }, [sessionId]);

  const { connect, disconnect } = useResilientWebSocket({
    buildUrl: buildWsUrl,
    shouldReconnect: Boolean(sessionId),
    onMessage: (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'update') {
        setMessages(prev => [...prev, msg.payload]);
      }
    },
    attachSessionEndedHandler,
  });

  useEffect(() => {
    if (!sessionId) return undefined;
    connect();
    return () => disconnect();
  }, [sessionId, connect, disconnect]);

  return (
    <div>
      {messages.map((msg, i) => <div key={i}>{msg}</div>)}
    </div>
  );
}
```

**Key points:**
- Call `useSessionEndedHandler()` and pass `attachSessionEndedHandler` into `useResilientWebSocket`
- Build your WS URL lazily; returning `null` keeps the hook idle until a session exists
- `useResilientWebSocket` handles reconnection, cleanup, and StrictMode double-mount behavior automatically
- The session-ended handler still redirects students to `/session-ended` when the teacher ends the session
