import { createSession } from '../../core/sessions.js';

/**
 * Java String Practice Routes
 * 
 * This activity uses client-side localStorage for student progress.
 * Teacher selections for methods are broadcast to students via WebSockets.
 */
export default function setupJavaStringPracticeRoutes(app, sessions, ws) {
  // Register WebSocket namespace
  ws.register("/ws/java-string-practice", (socket, qp) => {
    socket.sessionId = qp.get("sessionId") || null;
    socket.studentName = qp.get("studentName") || null;
    
    console.log(`WebSocket connection: sessionId=${socket.sessionId}, studentName=${socket.studentName}`);
    
    // If student name is provided, add/update student in session
    if (socket.sessionId && socket.studentName) {
      const session = sessions[socket.sessionId];
      console.log(`Found session:`, session ? 'yes' : 'no');
      if (session && session.type === 'java-string-practice') {
        const existing = session.data.students.find(s => s.name === socket.studentName);
        if (existing) {
          console.log(`Reconnecting student: ${socket.studentName}`);
          existing.connected = true;
          existing.lastSeen = Date.now();
        } else {
          console.log(`New student joining: ${socket.studentName}`);
          session.data.students.push({
            name: socket.studentName,
            connected: true,
            joined: Date.now(),
            lastSeen: Date.now(),
            stats: { total: 0, correct: 0, streak: 0 }
          });
        }
        console.log(`Total students in session:`, session.data.students.length);
        // Broadcast updated student list to manager
        broadcast('studentsUpdate', { students: session.data.students }, session.id);
      }
    }

    socket.on('close', () => {
      if (socket.sessionId && socket.studentName) {
        const session = sessions[socket.sessionId];
        if (session && session.type === 'java-string-practice') {
          const student = session.data.students.find(s => s.name === socket.studentName);
          if (student) {
            student.connected = false;
            broadcast('studentsUpdate', { students: session.data.students }, session.id);
          }
        }
      }
    });
  });

  // Broadcast helper - sends updates to all students in a session
  function broadcast(type, payload, sessionId) {
    const msg = JSON.stringify({ type, payload });
    let clientCount = 0;
    for (const s of ws.wss.clients) {
      if (s.readyState === 1 && s.sessionId === sessionId) {
        try { 
          s.send(msg);
          clientCount++;
        } catch (err) {
          console.error('Failed to send to client:', err);
        }
      }
    }
    console.log(`Broadcast ${type} to ${clientCount} clients in session ${sessionId}`);
  }

  // Create session
  app.post('/api/java-string-practice/create', (req, res) => {
    const session = createSession(sessions, { data: {} });
    session.type = 'java-string-practice';
    session.data.students = [];
    session.data.selectedMethods = ['all']; // Default to all methods
    res.json({ id: session.id });
  });

  // Get session data
  app.get('/api/java-string-practice/:sessionId', (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session || session.type !== 'java-string-practice') {
      return res.status(404).json({ error: 'invalid session' });
    }
    res.json({ 
      sessionId: session.id,
      type: session.type,
      selectedMethods: session.data.selectedMethods || ['all'],
    });
  });

  // Update selected methods (teacher sets which methods students should practice)
  app.post('/api/java-string-practice/:sessionId/methods', (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session || session.type !== 'java-string-practice') {
      return res.status(404).json({ error: 'invalid session' });
    }
    
    const { methods } = req.body;
    if (!methods || !Array.isArray(methods)) {
      return res.status(400).json({ error: 'methods array required' });
    }
    
    console.log(`Updating methods for session ${session.id}:`, methods);
    session.data.selectedMethods = methods;
    
    // Broadcast the update to all connected students
    broadcast('methodsUpdate', { selectedMethods: methods }, session.id);
    
    res.json({ success: true, selectedMethods: methods });
  });

  // Submit student progress
  app.post('/api/java-string-practice/:sessionId/progress', (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session || session.type !== 'java-string-practice') {
      return res.status(404).json({ error: 'invalid session' });
    }
    
    const { studentName, stats } = req.body;
    if (!studentName || !stats) {
      return res.status(400).json({ error: 'studentName and stats required' });
    }
    
    const student = session.data.students.find(s => s.name === studentName);
    if (student) {
      student.stats = stats;
      student.lastSeen = Date.now();
      
      // Broadcast updated student list to manager
      broadcast('studentsUpdate', { students: session.data.students }, session.id);
    }
    
    res.json({ success: true });
  });

  // Get students for a session
  app.get('/api/java-string-practice/:sessionId/students', (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session || session.type !== 'java-string-practice') {
      return res.status(404).json({ error: 'invalid session' });
    }
    
    res.json({ students: session.data.students || [] });
  });
}
