import { createSession } from 'activebits-server/core/sessions.js';
import { createBroadcastSubscriptionHelper } from 'activebits-server/core/broadcastUtils.js';
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js';

registerSessionNormalizer('java-string-practice', (session) => {
  const data = session.data;
  data.students = Array.isArray(data.students) ? data.students : [];
  data.selectedMethods = Array.isArray(data.selectedMethods) ? data.selectedMethods : ['all'];
});

/**
 * Java String Practice Routes
 * 
 * This activity uses client-side localStorage for student progress.
 * Teacher selections for methods are broadcast to students via WebSockets.
 */

/**
 * Validate and sanitize student name
 * @param {string} name - The student name to validate
 * @returns {string|null} - Sanitized name or null if invalid
 */
function validateStudentName(name) {
  if (!name || typeof name !== 'string') {
    return null;
  }
  
  // Trim whitespace and limit length
  const sanitized = name.trim().slice(0, 50);
  
  // Check if empty after trimming
  if (sanitized.length === 0) {
    return null;
  }
  
  // Only allow alphanumeric, spaces, hyphens, apostrophes, and periods
  const validPattern = /^[a-zA-Z0-9\s\-'.]+$/;
  if (!validPattern.test(sanitized)) {
    return null;
  }
  
  return sanitized;
}

/**
 * Validate and sanitize stats object
 * @param {object} stats - The stats object to validate
 * @returns {object|null} - Sanitized stats or null if invalid
 */
function validateStats(stats) {
  if (!stats || typeof stats !== 'object') {
    return null;
  }
  
  // Helper to validate a non-negative integer within reasonable bounds
  const validateInt = (value, max = 100000) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0 || num > max) {
      return 0;
    }
    return num;
  };
  
  // Validate and sanitize each field
  const sanitized = {
    total: validateInt(stats.total),
    correct: validateInt(stats.correct),
    streak: validateInt(stats.streak, 10000),
    longestStreak: validateInt(stats.longestStreak, 10000),
  };
  
  // Ensure correct doesn't exceed total
  if (sanitized.correct > sanitized.total) {
    sanitized.correct = sanitized.total;
  }
  
  // Ensure longestStreak is at least as large as current streak
  if (sanitized.longestStreak < sanitized.streak) {
    sanitized.longestStreak = sanitized.streak;
  }
  
  return sanitized;
}

/**
 * Validate methods array
 * @param {array} methods - The methods array to validate
 * @returns {array|null} - Sanitized methods array or null if invalid
 */
function validateMethods(methods) {
  if (!methods || !Array.isArray(methods)) {
    return null;
  }
  
  const validMethods = new Set(['all', 'substring', 'indexOf', 'equals', 'length', 'compareTo']);
  
  // Filter to only valid method strings
  const sanitized = methods
    .filter(method => typeof method === 'string' && validMethods.has(method))
    .slice(0, 10); // Limit array size to prevent abuse
  
  // If no valid methods, default to 'all'
  if (sanitized.length === 0) {
    return ['all'];
  }
  
  return sanitized;
}

export default function setupJavaStringPracticeRoutes(app, sessions, ws) {
  const ensureBroadcastSubscription = createBroadcastSubscriptionHelper(sessions, ws);
  // Helper to generate unique student ID
  const generateStudentId = (name, sessionId) => {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 6);
    return `${name}-${timestamp}-${random}`;
  };

  function closeDuplicateStudentSockets(currentSocket) {
    if (!currentSocket.sessionId || !currentSocket.studentId) return;
    for (const client of ws.wss.clients) {
      if (
        client !== currentSocket &&
        client.readyState === 1 &&
        client.sessionId === currentSocket.sessionId &&
        client.studentId === currentSocket.studentId
      ) {
        client.ignoreDisconnect = true;
        try {
          client.close(4000, 'Replaced by new connection');
        } catch (err) {
          console.error('Failed to close duplicate student socket', err);
        }
      }
    }
  }

  // Register WebSocket namespace
  ws.register("/ws/java-string-practice", (socket, qp) => {
    socket.sessionId = qp.get("sessionId") || null;
    ensureBroadcastSubscription(socket.sessionId);
    const rawStudentName = qp.get("studentName") || null;
    socket.studentName = validateStudentName(rawStudentName);
    const studentId = qp.get("studentId") || null; // Check for existing ID
    
    console.log(`WebSocket connection: sessionId=${socket.sessionId}, studentName=${socket.studentName}, studentId=${studentId}`);
    
    // If student name is provided and valid, add/update student in session
    if (socket.sessionId && socket.studentName) {
      (async () => {
        const session = await sessions.get(socket.sessionId);
        console.log(`Found session:`, session ? 'yes' : 'no');
        if (session && session.type === 'java-string-practice') {
          // Try to find by ID first, then by name for backwards compatibility
          let existing = studentId 
            ? session.data.students.find(s => s.id === studentId)
            : session.data.students.find(s => s.name === socket.studentName && !s.id);
          
          if (existing) {
            console.log(`Reconnecting student: ${socket.studentName} (${existing.id})`);
            existing.connected = true;
            existing.lastSeen = Date.now();
            socket.studentId = existing.id;
            closeDuplicateStudentSockets(socket);
          } else {
            console.log(`New student joining: ${socket.studentName}`);
            const newId = generateStudentId(socket.studentName, socket.sessionId);
            socket.studentId = newId;
            session.data.students.push({
              id: newId,
              name: socket.studentName,
              connected: true,
              joined: Date.now(),
              lastSeen: Date.now(),
              stats: { total: 0, correct: 0, streak: 0, longestStreak: 0 }
            });
            closeDuplicateStudentSockets(socket);
          }
          await sessions.set(session.id, session);
          console.log(`Total students in session:`, session.data.students.length);
          // Broadcast updated student list to manager
          await broadcast('studentsUpdate', { students: session.data.students }, session.id);
          // Send the student ID back to the client
          socket.send(JSON.stringify({ type: 'studentId', payload: { studentId: socket.studentId } }));
        }
      })().catch(err => console.error('Error in student join:', err));
    }

    socket.on('close', () => {
      if (socket.ignoreDisconnect) return;
      if (socket.sessionId && socket.studentId) {
        (async () => {
          const session = await sessions.get(socket.sessionId);
          if (session && session.type === 'java-string-practice') {
            const student = session.data.students.find(s => s.id === socket.studentId);
            if (student) {
              student.connected = false;
              await sessions.set(session.id, session);
              await broadcast('studentsUpdate', { students: session.data.students }, session.id);
            }
          }
        })().catch(err => console.error('Error in student disconnect:', err));
      }
    });
  });

  // Broadcast helper - sends updates to all students in a session
  async function broadcast(type, payload, sessionId) {
    const msg = JSON.stringify({ type, payload });
    
    // Valkey mode: publish to all instances via pub/sub
    if (sessions.publishBroadcast) {
      await sessions.publishBroadcast(`session:${sessionId}:broadcast`, { type, payload });
    }
    
    // Always broadcast to local WebSocket clients (both modes)
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
  
  // Subscribe to broadcasts from other instances if using Valkey
  if (sessions.subscribeToBroadcast) {
    // We'll subscribe to all session broadcasts dynamically,
    // but for simplicity we can handle this at the WebSocket level
    // The broadcast function above will publish and local clients will receive
  }

  // Create session
  app.post('/api/java-string-practice/create', async (req, res) => {
    const session = await createSession(sessions, { data: {} });
    session.type = 'java-string-practice';
    session.data.students = [];
    session.data.selectedMethods = ['all']; // Default to all methods
    await sessions.set(session.id, session);
    ensureBroadcastSubscription(session.id);
    res.json({ id: session.id });
  });

  // Get session data
  app.get('/api/java-string-practice/:sessionId', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
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
  app.post('/api/java-string-practice/:sessionId/methods', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'java-string-practice') {
      return res.status(404).json({ error: 'invalid session' });
    }
    
    const { methods: rawMethods } = req.body;
    const methods = validateMethods(rawMethods);
    
    if (!methods) {
      return res.status(400).json({ error: 'valid methods array required' });
    }
    
    console.log(`Updating methods for session ${session.id}:`, methods);
    session.data.selectedMethods = methods;
    await sessions.set(session.id, session);
    
    // Broadcast the update to all connected students
    await broadcast('methodsUpdate', { selectedMethods: methods }, session.id);
    
    res.json({ success: true, selectedMethods: methods });
  });

  // Submit student progress
  app.post('/api/java-string-practice/:sessionId/progress', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'java-string-practice') {
      return res.status(404).json({ error: 'invalid session' });
    }
    
    const { studentId, studentName: rawStudentName, stats: rawStats } = req.body;
    
    const stats = validateStats(rawStats);
    if (!stats) {
      return res.status(400).json({ error: 'valid stats object required' });
    }
    
    // Try to find student by ID first (new approach), then by name (backwards compatibility)
    let student;
    if (studentId) {
      student = session.data.students.find(s => s.id === studentId);
    } else {
      // Fallback to name-based lookup for backwards compatibility
      const studentName = validateStudentName(rawStudentName);
      if (studentName) {
        student = session.data.students.find(s => s.name === studentName && !s.id);
      }
    }
    
    if (student) {
      student.stats = stats;
      student.lastSeen = Date.now();
      await sessions.set(session.id, session);
      
      // Broadcast updated student list to manager
      await broadcast('studentsUpdate', { students: session.data.students }, session.id);
    }
    
    res.json({ success: true });
  });

  // Get students for a session
  app.get('/api/java-string-practice/:sessionId/students', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'java-string-practice') {
      return res.status(404).json({ error: 'invalid session' });
    }
    
    res.json({ students: session.data.students || [] });
  });
}
