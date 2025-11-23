import { createSession } from '../../../server/core/sessions.js';

const VALID_QUESTION_TYPES = new Set([
  'all',
  'index-get',
  'index-set',
  'len',
  'append',
  'remove',
  'insert',
  'pop',
  'for-range',
  'range-len',
  'for-each',
]);

function sanitizeQuestionTypes(types) {
  if (!Array.isArray(types)) {
    return ['all'];
  }

  const cleaned = types
    .filter((t) => typeof t === 'string' && VALID_QUESTION_TYPES.has(t))
    .slice(0, VALID_QUESTION_TYPES.size);

  if (cleaned.length === 0) {
    return ['all'];
  }

  if (cleaned.length > 1 && cleaned.includes('all')) {
    return ['all'];
  }

  return cleaned;
}

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

function validateStudentId(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 80);
  if (!trimmed) return null;
  if (!/^[a-zA-Z0-9._:/-]+$/.test(trimmed)) return null;
  return trimmed;
}

export default function setupPythonListPracticeRoutes(app, sessions, ws) {
  const attachStudent = (session, name, studentId) => {
    // Defensive: sessions restored without data/students should still work
    if (!session.data || typeof session.data !== 'object') {
      session.data = {};
    }
    if (!Array.isArray(session.data.students)) {
      session.data.students = [];
    }

    let student = null;
    if (studentId) {
      student = session.data.students.find((s) => s.id === studentId);
    }
    if (!student && name) {
      student = session.data.students.find((s) => s.name === name && !s.id);
    }
    if (!student) {
      student = {
        id: studentId || `${name || 'student'}-${Date.now().toString(36)}`,
        name: name || 'Student',
        stats: { total: 0, correct: 0, streak: 0, longestStreak: 0 },
        connected: true,
      };
      session.data.students.push(student);
    } else {
      student.connected = true;
      if (name) {
        student.name = name;
      }
      if (!student.stats) {
        student.stats = { total: 0, correct: 0, streak: 0, longestStreak: 0 };
      }
    }
    return student;
  };

  const broadcast = (session, type, payload) => {
    const msg = JSON.stringify({ type, payload });
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
    session.data.selectedQuestionTypes = ['all'];
    res.json({ id: session.id });
  });

  app.get('/api/python-list-practice/:sessionId', (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session || session.type !== 'python-list-practice') {
      return res.status(404).json({ error: 'invalid session' });
    }
    res.json({
      students: session.data.students || [],
      selectedQuestionTypes: session.data.selectedQuestionTypes || ['all'],
    });
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
    const studentId = validateStudentId(req.body.studentId);
    const stats = validateStats(req.body.stats);
    if ((!studentName && !studentId) || !stats) {
      return res.status(400).json({ error: 'invalid payload' });
    }

    const student = attachStudent(session, studentName, studentId);
    student.stats = stats;
    student.lastSeen = Date.now();

    broadcast(session, 'studentsUpdate', { students: session.data.students });

    res.json({ ok: true });
  });

  app.post('/api/python-list-practice/:sessionId/question-types', (req, res) => {
    const session = sessions[req.params.sessionId];
    if (!session || session.type !== 'python-list-practice') {
      return res.status(404).json({ error: 'invalid session' });
    }

    const questionTypes = sanitizeQuestionTypes(req.body?.types);
    session.data.selectedQuestionTypes = questionTypes;
    broadcast(session, 'questionTypesUpdate', { selectedQuestionTypes: questionTypes });

    res.json({ ok: true, selectedQuestionTypes: questionTypes });
  });

  // Minimal WebSocket namespace for connection tracking
  ws.register('/ws/python-list-practice', (socket, qp) => {
    socket.sessionId = qp.get('sessionId') || null;
    socket.studentName = validateName(qp.get('studentName') || '');
    socket.studentId = validateStudentId(qp.get('studentId') || '');
    const sendQuestionTypesSnapshot = () => {
      if (!socket.sessionId) return;
      const session = sessions[socket.sessionId];
      if (session && session.type === 'python-list-practice') {
        const payload = {
          selectedQuestionTypes: session.data.selectedQuestionTypes || ['all'],
        };
        try {
          socket.send(JSON.stringify({ type: 'questionTypesUpdate', payload }));
        } catch (err) {
          console.error('WS send failed', err);
        }
      }
    };

    if (socket.sessionId) {
      sendQuestionTypesSnapshot();
    }

    if (socket.sessionId && socket.studentName) {
      const session = sessions[socket.sessionId];
      if (session && session.type === 'python-list-practice') {
        const student = attachStudent(session, socket.studentName, socket.studentId);
        broadcast(session, 'studentsUpdate', { students: session.data.students });
        sendQuestionTypesSnapshot();
        socket.on('close', () => {
          student.connected = false;
          broadcast(session, 'studentsUpdate', { students: session.data.students });
        });
      }
    }
  });
}
