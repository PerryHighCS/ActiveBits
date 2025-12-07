import { createSession } from 'activebits-server/core/sessions.js';
import { createBroadcastSubscriptionHelper } from 'activebits-server/core/broadcastUtils.js';

/**
 * Java Format Practice Routes
 * 
 * This activity uses client-side localStorage for student progress.
 * Teacher selections for difficulty and theme are broadcast to students via WebSockets.
 */

/**
 * Validate and sanitize student name
 */
function validateStudentName(name) {
  if (!name || typeof name !== 'string') {
    return null;
  }

  const sanitized = name.trim().slice(0, 50);

  if (sanitized.length === 0) {
    return null;
  }

  const validPattern = /^[a-zA-Z0-9\s\-'.]+$/;
  if (!validPattern.test(sanitized)) {
    return null;
  }

  return sanitized;
}

/**
 * Validate and sanitize stats object
 */
function validateStats(stats) {
  if (!stats || typeof stats !== 'object') {
    return null;
  }

  const validateInt = (value, max = 100000) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0 || num > max) {
      return 0;
    }
    return num;
  };

  const sanitized = {
    total: validateInt(stats.total),
    correct: validateInt(stats.correct),
    streak: validateInt(stats.streak, 10000),
    longestStreak: validateInt(stats.longestStreak, 10000),
  };

  if (sanitized.correct > sanitized.total) {
    sanitized.correct = sanitized.total;
  }

  if (sanitized.longestStreak < sanitized.streak) {
    sanitized.longestStreak = sanitized.streak;
  }

  return sanitized;
}

/**
 * Validate difficulty level
 */
function validateDifficulty(difficulty) {
  const validDifficulties = ['beginner', 'intermediate', 'advanced'];
  if (validDifficulties.includes(difficulty)) {
    return difficulty;
  }
  return 'beginner';
}

/**
 * Validate theme
 */
function validateTheme(theme) {
  const validThemes = ['all', 'wanted-poster', 'fantasy-menu', 'spy-badge'];
  if (validThemes.includes(theme)) {
    return theme;
  }
  return 'all';
}

export default function setupJavaFormatPracticeRoutes(app, sessions, ws) {
  const ensureBroadcastSubscription = createBroadcastSubscriptionHelper(sessions, ws);

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
  ws.register('/ws/java-format-practice', (socket, qp) => {
    socket.sessionId = qp.get('sessionId') || null;
    ensureBroadcastSubscription(socket.sessionId);
    const rawStudentName = qp.get('studentName') || null;
    socket.studentName = validateStudentName(rawStudentName);
    const studentId = qp.get('studentId') || null;

    console.log(`WebSocket connection: sessionId=${socket.sessionId}, studentName=${socket.studentName}, studentId=${studentId}`);

    // If student name is provided and valid, add/update student in session
    if (socket.sessionId && socket.studentName) {
      (async () => {
        const session = await sessions.get(socket.sessionId);
        console.log(`Found session:`, session ? 'yes' : 'no');
        if (session && session.type === 'java-format-practice') {
          let existing = studentId
            ? session.data.students.find((s) => s.id === studentId)
            : session.data.students.find((s) => s.name === socket.studentName && !s.id);

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
              stats: { total: 0, correct: 0, streak: 0, longestStreak: 0 },
            });
            closeDuplicateStudentSockets(socket);
          }
          await sessions.set(session.id, session);
          console.log(`Total students in session:`, session.data.students.length);
          // Broadcast updated student list to manager
          await broadcast('studentsUpdate', { students: session.data.students }, session.id);
          // Send the student ID back to the client
          socket.send(
            JSON.stringify({ type: 'studentId', payload: { studentId: socket.studentId } })
          );
        }
      })().catch((err) => console.error('Error in student join:', err));
    }

    socket.on('close', () => {
      if (socket.ignoreDisconnect) return;
      if (socket.sessionId && socket.studentId) {
        (async () => {
          const session = await sessions.get(socket.sessionId);
          if (session && session.type === 'java-format-practice') {
            const student = session.data.students.find((s) => s.id === socket.studentId);
            if (student) {
              student.connected = false;
              await sessions.set(session.id, session);
              await broadcast('studentsUpdate', { students: session.data.students }, session.id);
            }
          }
        })().catch((err) => console.error('Error in student disconnect:', err));
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

  // Create session
  app.post('/api/java-format-practice/create', async (req, res) => {
    const session = await createSession(sessions, { data: {} });
    session.type = 'java-format-practice';
    session.data.students = [];
    session.data.selectedDifficulty = 'beginner';
    session.data.selectedTheme = 'all';
    await sessions.set(session.id, session);
    ensureBroadcastSubscription(session.id);
    res.json({ id: session.id });
  });

  // Get session data
  app.get('/api/java-format-practice/:sessionId', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'java-format-practice') {
      return res.status(404).json({ error: 'invalid session' });
    }
    res.json({
      sessionId: session.id,
      type: session.type,
      selectedDifficulty: session.data.selectedDifficulty || 'beginner',
      selectedTheme: session.data.selectedTheme || 'all',
    });
  });

  // Update selected difficulty (teacher sets difficulty level for all students)
  app.post('/api/java-format-practice/:sessionId/difficulty', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'java-format-practice') {
      return res.status(404).json({ error: 'invalid session' });
    }

    const { difficulty: rawDifficulty } = req.body;
    const difficulty = validateDifficulty(rawDifficulty);

    console.log(`Updating difficulty for session ${session.id}:`, difficulty);
    session.data.selectedDifficulty = difficulty;
    await sessions.set(session.id, session);

    // Broadcast the update to all connected students
    await broadcast('difficultyUpdate', { difficulty }, session.id);

    res.json({ success: true, difficulty });
  });

  // Update selected theme (teacher sets theme for all students)
  app.post('/api/java-format-practice/:sessionId/theme', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'java-format-practice') {
      return res.status(404).json({ error: 'invalid session' });
    }

    const { theme: rawTheme } = req.body;
    const theme = validateTheme(rawTheme);

    console.log(`Updating theme for session ${session.id}:`, theme);
    session.data.selectedTheme = theme;
    await sessions.set(session.id, session);

    // Broadcast the update to all connected students
    await broadcast('themeUpdate', { theme }, session.id);

    res.json({ success: true, theme });
  });

  // Submit student stats
  app.post('/api/java-format-practice/:sessionId/stats', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'java-format-practice') {
      return res.status(404).json({ error: 'invalid session' });
    }

    const { studentId, stats: rawStats } = req.body;

    const stats = validateStats(rawStats);
    if (!stats) {
      return res.status(400).json({ error: 'valid stats object required' });
    }

    // Find student by ID
    const student = session.data.students.find((s) => s.id === studentId);

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
  app.get('/api/java-format-practice/:sessionId/students', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'java-format-practice') {
      return res.status(404).json({ error: 'invalid session' });
    }

    res.json({ students: session.data.students || [] });
  });
}
