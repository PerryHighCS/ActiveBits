# Quick Start: Adding a New Activity

This guide walks you through adding a new activity to ActiveBits with a complete working example.

> 💡 **Tip:** For architectural details and patterns, see [ARCHITECTURE.md](ARCHITECTURE.md)

## Example: Adding a "Quiz" Activity

### Step 1: Create the Activity Structure

```bash
mkdir -p client/src/activities/quiz/{manager,student}
mkdir -p server/activities/quiz
```

### Step 2: Create the Student Component

**File: `client/src/activities/quiz/student/QuizPage.jsx`**

```jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSessionEndedHandler from '@src/hooks/useSessionEndedHandler';
import Button from '@src/components/ui/Button';

export default function QuizPage({ sessionData, wsRef }) {
  const navigate = useNavigate();
  const [answer, setAnswer] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // Handle session termination
  useSessionEndedHandler(wsRef, navigate);

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

**File: `client/src/activities/quiz/manager/QuizManager.jsx`**

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

### Step 4: Create the Activity Configuration

**File: `client/src/activities/quiz/index.js`** (or `index.jsx` if using JSX in footerContent)

```javascript
import QuizManager from './manager/QuizManager';
import QuizPage from './student/QuizPage';

export const quizActivity = {
  id: 'quiz',
  name: 'Quiz',
  description: 'Ask students questions and collect responses',
  ManagerComponent: QuizManager,
  StudentComponent: QuizPage,
  footerContent: null, // Set to JSX element for custom footer, or null for no footer
  color: 'purple',
  soloMode: false, // Set to true if activity supports solo practice without teacher
};

export default quizActivity;
```

> 💡 **Note:** If your `footerContent` contains JSX (e.g., links with `<a>` tags), the file must have a `.jsx` extension and import React.

### Step 5: Register the Activity

**File: `client/src/activities/index.js`**

```javascript
import raffleActivity from './raffle';
import wwwSimActivity from './www-sim';
import quizActivity from './quiz';  // Add this

export const activities = [
  raffleActivity,
  wwwSimActivity,
  quizActivity,  // Add this
];

// ... rest of file
```

### Step 6: Create Server Routes

**File: `server/activities/quiz/routes.js`**

```javascript
import { createSession } from '../../core/sessions.js';

export default function setupQuizRoutes(app, sessions, ws) {
  // Create quiz session
  app.post('/api/quiz/create', (req, res) => {
    const session = createSession(sessions, { data: {} });
    session.type = 'quiz';
    session.data.question = '';
    session.data.responses = [];
    res.json({ id: session.id });
  });

  // Set question
  app.post('/api/quiz/:sessionId/setup', (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session || session.type !== 'quiz') {
      return res.status(404).json({ error: 'invalid session' });
    }
    
    session.data.question = req.body.question;
    res.json({ success: true });
  });

  // Submit answer
  app.post('/api/quiz/:sessionId/submit', (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session || session.type !== 'quiz') {
      return res.status(404).json({ error: 'invalid session' });
    }
    
    session.data.responses.push({
      answer: req.body.answer,
      timestamp: Date.now(),
    });
    
    res.json({ success: true });
  });

  // Get responses
  app.get('/api/quiz/:sessionId/responses', (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session || session.type !== 'quiz') {
      return res.status(404).json({ error: 'invalid session' });
    }
    
    res.json({ responses: session.data.responses });
  });
}
```

### Step 7: Register Activity in Server Registry

**File: `server/activities/activityRegistry.js`**

```javascript
export const ALLOWED_ACTIVITIES = [
  'raffle',
  'www-sim', 
  'java-string-practice',
  'quiz',  // Add your activity here
];

export function isValidActivity(activityType) {
  return ALLOWED_ACTIVITIES.includes(activityType);
}
```

### Step 8: Register Server Routes

**File: `server/server.js`**

```javascript
// Add import at top
import setupQuizRoutes from './activities/quiz/routes.js';

// Add after other route setups
setupQuizRoutes(app, sessions, ws);
```

### Done! 🎉

Your new activity is now fully integrated:
- ✅ Automatically appears in the management dashboard
- ✅ Routes are automatically generated
- ✅ Students can join using the session ID
- ✅ Fully functional and ready to use

## File Checklist

When adding a new activity, create these files:

**Client:**
- [ ] `client/src/activities/{name}/index.js` (or `.jsx`) - Activity config
- [ ] `client/src/activities/{name}/manager/Manager.jsx` - Teacher view (use SessionHeader)
- [ ] `client/src/activities/{name}/student/Student.jsx` - Student view (use useSessionEndedHandler)
- [ ] Update `client/src/activities/index.js` - Register activity

**Server:**
- [ ] `server/activities/{name}/routes.js` - API endpoints
- [ ] Update `server/activities/activityRegistry.js` - Add to ALLOWED_ACTIVITIES array
- [ ] Update `server/server.js` - Import and setup routes

**Optional:**
- [ ] `client/src/activities/{name}/components/` - Activity-specific UI
- [ ] `server/activities/{name}/` - Activity-specific data files

## Tips

1. **Use existing activities as templates** - Copy structure from `raffle` or `www-sim`
2. **Test incrementally** - Build and test as you add each component
3. **Follow naming conventions** - Use kebab-case for folder names, PascalCase for components
4. **Keep activities self-contained** - All activity code should live in its folder
5. **Reuse shared UI** - Import from `@src/components/ui/` when possible
6. **Use SessionHeader** - All manager components should use the unified SessionHeader
7. **Handle session termination** - Student components should use useSessionEndedHandler hook
8. **Update activity registry** - Don't forget to add your activity to `activityRegistry.js`

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
See `www-sim` activity for examples of real-time WebSocket communication.
