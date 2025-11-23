import { createSession } from '../../../server/core/sessions.js';

function validateName(name) {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim().slice(0, 50);
  if (!trimmed) return null;
  const ok = /^[a-zA-Z0-9\s\-'.]+$/.test(trimmed);
  return ok ? trimmed : null;
}

function validateStats(stats) {
  if (!stats || typeof stats !== 'object') return null;
  const clampInt = (val, max = 100000) => {
    const n = parseInt(val, 10);
    if (Number.isNaN(n) || n < 0 || n > max) return 0;
    return n;
  };
  const sanitized = {
    total: clampInt(stats.total),
    correct: clampInt(stats.correct),
    streak: clampInt(stats.streak, 10000),
    longestStreak: clampInt(stats.longestStreak, 10000),
  };
  if (sanitized.correct > sanitized.total) sanitized.correct = sanitized.total;
  if (sanitized.longestStreak < sanitized.streak) sanitized.longestStreak = sanitized.streak;
  return sanitized;
}

export default function setupPythonListPracticeRoutes(app, sessions, ws) {
  const broadcastStudents = (session) => {
    const msg = JSON.stringify({ type: 'studentsUpdate', payload: { students: session.data.students } });
    for (const s of ws.wss.clients) {
      if (s.readyState === 1 && s.sessionId === session.id) {
        try { s.send(msg); } catch (err) { console.error('WS send failed', err); }
      }
    }
  };

  app.post('/api/python-list-practice/create', (req, res) => {
    const session = createSession(sessions, { data: {} });
    session.type = 'python-list-practice';
    session.data.students = [];
    res.json({ id: session.id });
  });

  app.get('/api/python-list-practice/:sessionId/students', (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session || session.type !== 'python-list-practice') {
      return res.status(404).json({ error: 'invalid session' });
    }
    res.json({ students: session.data.students || [] });
  });

  app.post('/api/python-list-practice/:sessionId/stats', (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session || session.type !== 'python-list-practice') {
      return res.status(404).json({ error: 'invalid session' });
    }
    const studentName = validateName(req.body.studentName);
    const stats = validateStats(req.body.stats);
    if (!studentName || !stats) {
      return res.status(400).json({ error: 'invalid payload' });
    }

    let student = session.data.students.find((s) => s.name === studentName);
    if (!student) {
      student = { id: `${studentName}-${Date.now().toString(36)}`, name: studentName, connected: true, stats };
      session.data.students.push(student);
    } else {
      student.stats = stats;
      student.connected = true;
      student.lastSeen = Date.now();
    }

    broadcastStudents(session);

    res.json({ ok: true });
  });

  // Minimal WebSocket namespace for connection tracking
  ws.register('/ws/python-list-practice', (socket, qp) => {
    socket.sessionId = qp.get('sessionId') || null;
    socket.studentName = validateName(qp.get('studentName') || '');
    if (socket.sessionId && socket.studentName) {
      const session = sessions[socket.sessionId];
      if (session && session.type === 'python-list-practice') {
        let student = session.data.students.find((s) => s.name === socket.studentName);
        if (!student) {
          student = { id: `${socket.studentName}-${Date.now().toString(36)}`, name: socket.studentName, stats: { total: 0, correct: 0, streak: 0, longestStreak: 0 }, connected: true };
          session.data.students.push(student);
        } else {
          student.connected = true;
        }
        broadcastStudents(session);
        socket.on('close', () => {
          student.connected = false;
          broadcastStudents(session);
        });
      }
    }
  });
}
