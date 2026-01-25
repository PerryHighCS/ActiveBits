import { isFiniteNumber, isRouteArray } from '../validation.js';
import { createBroadcastHelpers, closeDuplicateStudentSockets, generateStudentId } from './shared.js';

export default function registerStudentRoutes(app, sessions, ws) {
  const { ensureBroadcastSubscription, broadcast, buildBroadcastPayload, updateStudentStatus } = createBroadcastHelpers(sessions, ws);

  // WebSocket namespace
  ws.register('/ws/traveling-salesman', (socket, qp) => {
    socket.sessionId = qp.get('sessionId') || null;
    ensureBroadcastSubscription(socket.sessionId);
    const studentName = qp.get('studentName') || null;
    const studentId = qp.get('studentId') || null;

    if (socket.sessionId && studentName) {
      (async () => {
        const session = await sessions.get(socket.sessionId);
        if (session && session.type === 'traveling-salesman') {
          let student = studentId
            ? session.data.students.find(s => s.id === studentId)
            : session.data.students.find(s => s.name === studentName);

          if (!student) {
            // New student
            const newId = generateStudentId(studentName);
            socket.studentId = newId;
            session.data.students.push({
              id: newId,
              name: studentName,
              connected: true,
              joined: Date.now(),
              lastSeen: Date.now(),
              currentRoute: [],
              routeDistance: 0,
              complete: false,
              attempts: 0,
              routeStartTime: null,
              routeCompleteTime: null,
              timeToComplete: null
            });
          } else {
            // Reconnection
            socket.studentId = student.id;
            student.connected = true;
            student.lastSeen = Date.now();
            closeDuplicateStudentSockets(ws, socket);
          }

          await sessions.set(session.id, session);
          socket.send(JSON.stringify({
            type: 'studentId',
            payload: { studentId: socket.studentId }
          }));

          // Send current problem if it exists
          if (session.data.problem && session.data.problem.cities) {
            socket.send(JSON.stringify({
              type: 'problemUpdate',
              payload: {
                cities: session.data.problem.cities,
                distanceMatrix: session.data.problem.distanceMatrix,
                seed: session.data.problem.seed
              }
            }));
          }

          if ((session.data.broadcasts || []).length > 0) {
            const routes = buildBroadcastPayload(session);
            socket.send(JSON.stringify({
              type: 'broadcastUpdate',
              payload: { routes }
            }));
          }

          await broadcast('studentsUpdate', { students: session.data.students }, session.id);
        }
      })().catch((err) => {
        console.error('Failed to initialize traveling salesman session', err);
        try {
          socket.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Failed to initialize session. Please refresh the page.' }
          }));
        } catch (sendErr) {
          console.error('Failed to notify socket about initialization error', sendErr);
        }
      });
    }

    const handleDisconnect = async () => {
      if (!socket.sessionId || !socket.studentId) return;
      try {
        await updateStudentStatus(socket.sessionId, (session) => {
          const student = session.data.students.find(s => s.id === socket.studentId);
          if (!student) return false;
          student.connected = false;
          student.lastSeen = Date.now();
          return true;
        });
      } catch (err) {
        console.error('Failed to handle traveling salesman disconnect', err);
      }
    };

    socket.on('close', handleDisconnect);
    socket.on('error', handleDisconnect);
  });

  // Submit student route
  app.post('/api/traveling-salesman/:sessionId/submit-route', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'traveling-salesman') {
      return res.status(404).json({ error: 'Session not found' });
    }

    const { studentId, route, distance, timeToComplete } = req.body;
    if (typeof studentId !== 'string' || !studentId.trim()) {
      return res.status(400).json({ error: 'Invalid studentId' });
    }
    if (!isRouteArray(route)) {
      return res.status(400).json({ error: 'Invalid route' });
    }
    if (!isFiniteNumber(distance) || distance < 0) {
      return res.status(400).json({ error: 'Invalid distance' });
    }
    if (timeToComplete != null && (!Number.isFinite(timeToComplete) || timeToComplete < 0)) {
      return res.status(400).json({ error: 'Invalid timeToComplete' });
    }
    const student = session.data.students.find(s => s.id === studentId);

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    student.currentRoute = route;
    student.routeDistance = distance;
    student.complete = route.length === session.data.problem.numCities;
    if (student.complete) {
      student.routeCompleteTime = Date.now();
      student.timeToComplete = timeToComplete;
      student.attempts = (student.attempts || 0) + 1;
    } else {
      student.routeCompleteTime = null;
      student.timeToComplete = null;
    }

    await updateStudentStatus(session, () => true);

    res.json({ success: true });
  });
}
