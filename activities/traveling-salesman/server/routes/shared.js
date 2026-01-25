import crypto from 'crypto';
import { createBroadcastSubscriptionHelper } from 'activebits-server/core/broadcastUtils.js';

/**
 * Generate unique student ID
 */
export function generateStudentId(name) {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(8).toString('hex');
  return `${timestamp}-${random}`;
}

/**
 * Close duplicate WebSocket connections for same student
 */
export function closeDuplicateStudentSockets(ws, currentSocket) {
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
        console.error('Failed to close duplicate socket:', err);
      }
    }
  }
}

export function createBroadcastHelpers(sessions, ws) {
  const ensureBroadcastSubscription = createBroadcastSubscriptionHelper(sessions, ws);

  const broadcast = async (type, payload, sessionId) => {
    const msg = JSON.stringify({ type, payload });
    if (sessions.publishBroadcast) {
      await sessions.publishBroadcast(`session:${sessionId}:broadcast`, { type, payload });
    }
    for (const s of ws.wss.clients) {
      if (s.readyState === 1 && s.sessionId === sessionId) {
        try {
          s.send(msg);
        } catch (err) {
          console.error('Broadcast error:', err);
        }
      }
    }
  };

  const buildBroadcastPayload = (session) => {
    const routes = [];
    const ids = session.data.broadcasts || [];

    if (ids.includes('instructor') && session.data.instructor?.route?.length) {
      routes.push({
        id: 'instructor',
        name: session.data.instructor.name || 'Instructor',
        path: session.data.instructor.route,
        distance: session.data.instructor.distance,
        type: 'instructor',
        timeToComplete: session.data.instructor.timeToComplete ?? null
      });
    }

    if (ids.includes('heuristic') && session.data.algorithms.heuristic?.computed) {
      routes.push({
        id: 'heuristic',
        name: 'Nearest Neighbor',
        path: session.data.algorithms.heuristic.route,
        distance: session.data.algorithms.heuristic.distance,
        type: 'heuristic',
        timeToComplete: session.data.algorithms.heuristic.computeTime
      });
    }

    if (ids.includes('bruteforce')) {
      if (session.data.algorithms.bruteForce?.computed) {
        routes.push({
          id: 'bruteforce',
          name: 'Brute Force (Optimal)',
          path: session.data.algorithms.bruteForce.route,
          distance: session.data.algorithms.bruteForce.distance,
          type: 'bruteforce',
          timeToComplete: session.data.algorithms.bruteForce.computeTime
        });
      } else if (session.data.algorithms.bruteForce?.status) {
        routes.push({
          id: 'bruteforce',
          name: 'Brute Force (Optimal)',
          distance: null,
          type: 'bruteforce',
          progressCurrent: session.data.algorithms.bruteForce.progressCurrent ?? null,
          progressTotal: session.data.algorithms.bruteForce.progressTotal ?? null,
          status: session.data.algorithms.bruteForce.status
        });
      }
    }

    // Student routes (by id)
    ids.forEach((id) => {
      if (id === 'instructor' || id === 'heuristic' || id === 'bruteforce') return;
      const student = session.data.students?.find(s => s.id === id);
      if (student && Array.isArray(student.currentRoute) && student.currentRoute.length > 0) {
        routes.push({
          id: student.id,
          name: student.name,
          path: student.currentRoute,
          distance: student.routeDistance,
          type: 'student',
          timeToComplete: student.timeToComplete
        });
      }
    });

    return routes;
  };

  const broadcastRoutesUpdate = async (session) => {
    const routes = buildBroadcastPayload(session);
    await broadcast('broadcastUpdate', { routes }, session.id);
    if (routes.length === 0) {
      await broadcast('clearBroadcast', { cleared: true }, session.id);
    }
  };

  const updateStudentStatus = async (sessionOrId, updater) => {
    const session = typeof sessionOrId === 'string'
      ? await sessions.get(sessionOrId)
      : sessionOrId;
    if (!session || session.type !== 'traveling-salesman') return null;
    const updated = await updater(session);
    if (!updated) return session;
    await sessions.set(session.id, session);
    await broadcast('studentsUpdate', { students: session.data.students }, session.id);
    return session;
  };

  return {
    ensureBroadcastSubscription,
    broadcast,
    buildBroadcastPayload,
    broadcastRoutesUpdate,
    updateStudentStatus
  };
}
