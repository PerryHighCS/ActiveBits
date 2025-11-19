import { createSession } from '../../core/sessions.js';

/**
 * Java String Practice Routes (Stub)
 * 
 * This activity uses client-side localStorage for student progress.
 * Server routes are minimal stubs for future enhancement.
 */
export default function setupJavaStringPracticeRoutes(app, sessions, ws) {
  // Create session
  app.post('/api/java-string-practice/create', (req, res) => {
    const session = createSession(sessions, { data: {} });
    session.type = 'java-string-practice';
    session.data.students = [];
    res.json({ id: session.id });
  });

  // Get session data
  app.get('/api/java-string-practice/:sessionId', (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session || session.type !== 'java-string-practice') {
      return res.status(404).json({ error: 'invalid session' });
    }
    res.json({ session });
  });

  // TODO: Future endpoints for tracking student progress
  // app.post('/api/java-string-practice/:sessionId/submit', ...)
  // app.get('/api/java-string-practice/:sessionId/students', ...)
}
