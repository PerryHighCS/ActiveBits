import { createSession } from 'activebits-server/core/sessions.js';
import { createBroadcastSubscriptionHelper } from 'activebits-server/core/broadcastUtils.js';
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js';
import crypto from 'crypto';

// Register session normalizer to ensure data integrity
registerSessionNormalizer('traveling-salesman', (session) => {
  const data = session.data;
  data.problem = data.problem || {};
  data.students = Array.isArray(data.students) ? data.students : [];
  data.algorithms = data.algorithms || { bruteForce: {}, heuristic: {} };
  data.sharedState = data.sharedState || { phase: 'setup' };
  data.instructor = data.instructor || null;
  data.broadcasts = Array.isArray(data.broadcasts) ? data.broadcasts : [];
});

/**
 * Generate unique student ID
 */
function generateStudentId(name, sessionId) {
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
function closeDuplicateStudentSockets(ws, currentSocket) {
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

/**
 * Setup routes for traveling-salesman activity
 */
export default function setupTravelingSalesmanRoutes(app, sessions, ws) {
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

  const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
  const isRouteArray = (route) => Array.isArray(route) && route.every(id => typeof id === 'string');
  const isCitiesArray = (cities) => Array.isArray(cities) && cities.every(city => (
    city
    && typeof city.id === 'string'
    && typeof city.name === 'string'
    && isFiniteNumber(city.x)
    && isFiniteNumber(city.y)
  ));
  const isDistanceMatrix = (matrix, size) => {
    if (!Array.isArray(matrix) || (typeof size === 'number' && matrix.length !== size)) return false;
    return matrix.every(row =>
      Array.isArray(row)
      && (typeof size !== 'number' || row.length === size)
      && row.every(value => isFiniteNumber(value))
    );
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
            const newId = generateStudentId(studentName, socket.sessionId);
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
  });

  // Create session
  app.post('/api/traveling-salesman/create', async (req, res) => {
    const session = await createSession(sessions, { data: {} });
    session.type = 'traveling-salesman';
    session.data.problem = {};
    session.data.students = [];
    session.data.algorithms = { bruteForce: {}, heuristic: {} };
    if (session.data.instructor) {
      session.data.instructor.routeStartTime = null;
      session.data.instructor.timeToComplete = null;
    }
    session.data.instructor = null;
    session.data.broadcasts = [];
    session.data.sharedState = { phase: 'setup' };
    await sessions.set(session.id, session);
    res.json({ id: session.id });
  });

  // Get session state
  app.get('/api/traveling-salesman/:sessionId/session', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'traveling-salesman') {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session.data);
  });

  // Set problem (map generation)
  app.post('/api/traveling-salesman/:sessionId/set-problem', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'traveling-salesman') {
      return res.status(404).json({ error: 'Session not found' });
    }

    const { cities, distanceMatrix, seed } = req.body;
    if (!isCitiesArray(cities)) {
      return res.status(400).json({ error: 'Invalid cities payload' });
    }
    if (!isDistanceMatrix(distanceMatrix, cities.length)) {
      return res.status(400).json({ error: 'Invalid distance matrix' });
    }
    if (!isFiniteNumber(seed)) {
      return res.status(400).json({ error: 'Invalid seed' });
    }
    session.data.problem = {
      numCities: cities.length,
      cities,
      distanceMatrix,
      seed,
      generated: Date.now()
    };

    // Reset algorithms when new problem is generated
    session.data.algorithms = { bruteForce: {}, heuristic: {} };
    session.data.instructor = null;
    session.data.broadcasts = [];

    // Reset student routes
    session.data.students.forEach(student => {
      student.currentRoute = [];
      student.routeDistance = 0;
      student.complete = false;
      student.routeStartTime = null;
      student.routeCompleteTime = null;
      student.timeToComplete = null;
    });

    await sessions.set(session.id, session);

    // Broadcast to all students
    await broadcast('problemUpdate', { cities, distanceMatrix, seed }, session.id);
    await broadcast('broadcastUpdate', { routes: [] }, session.id);
    await broadcast('clearBroadcast', { cleared: true }, session.id);

    res.json({ success: true });
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
    if (!isFiniteNumber(distance)) {
      return res.status(400).json({ error: 'Invalid distance' });
    }
    if (timeToComplete != null && !Number.isFinite(timeToComplete)) {
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

    await sessions.set(session.id, session);
    await broadcast('studentsUpdate', { students: session.data.students }, session.id);

    res.json({ success: true });
  });

  // Update instructor route (for persistence across reloads)
  app.post('/api/traveling-salesman/:sessionId/update-instructor-route', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'traveling-salesman') {
      return res.status(404).json({ error: 'Session not found' });
    }

    const { route, distance, complete, timeToComplete } = req.body;
    if (!isRouteArray(route)) {
      return res.status(400).json({ error: 'Route required' });
    }
    if (distance !== undefined && distance !== null && !isFiniteNumber(distance)) {
      return res.status(400).json({ error: 'Invalid distance' });
    }
    if (complete !== undefined && complete !== null && typeof complete !== 'boolean') {
      return res.status(400).json({ error: 'Invalid complete flag' });
    }
    if (timeToComplete != null && !Number.isFinite(timeToComplete)) {
      return res.status(400).json({ error: 'Invalid timeToComplete' });
    }

    if (route.length === 0) {
      session.data.instructor = null;
    } else {
      const progressTotal = session.data.problem?.numCities ?? route.length;
      const progressCurrent = route.length;
      const existingStartTime = session.data.instructor?.routeStartTime;
      const routeStartTime = existingStartTime ?? Date.now();
      const computedTimeToComplete = complete && timeToComplete == null
        ? Math.floor((Date.now() - routeStartTime) / 1000)
        : timeToComplete;

      session.data.instructor = {
        id: 'instructor',
        name: 'Instructor',
        route,
        distance: distance ?? 0,
        type: 'instructor',
        timeToComplete: computedTimeToComplete ?? session.data.instructor?.timeToComplete ?? null,
        progressCurrent,
        progressTotal,
        complete: Boolean(complete),
        routeStartTime
      };
    }

    await sessions.set(session.id, session);
    res.json({ success: true });
  });

  // Reset instructor route (and remove instructor broadcast)
  app.post('/api/traveling-salesman/:sessionId/reset-instructor-route', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'traveling-salesman') {
      return res.status(404).json({ error: 'Session not found' });
    }

    session.data.instructor = null;
    session.data.broadcasts = (session.data.broadcasts || []).filter(id => id !== 'instructor');
    await sessions.set(session.id, session);

    const routes = buildBroadcastPayload(session);
    await broadcast('broadcastUpdate', { routes }, session.id);
    if (routes.length === 0) {
      await broadcast('clearBroadcast', { cleared: true }, session.id);
    }

    res.json({ success: true });
  });

  // Reset all routes/broadcasts
  app.post('/api/traveling-salesman/:sessionId/reset-routes', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'traveling-salesman') {
      return res.status(404).json({ error: 'Session not found' });
    }

    session.data.instructor = null;
    session.data.broadcasts = [];
    await sessions.set(session.id, session);

    await broadcast('broadcastUpdate', { routes: [] }, session.id);
    await broadcast('clearBroadcast', { cleared: true }, session.id);
    res.json({ success: true });
  });

  // Compute algorithms (receive results from client)
  app.post('/api/traveling-salesman/:sessionId/compute-algorithms', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'traveling-salesman') {
      return res.status(404).json({ error: 'Session not found' });
    }

    const { bruteForce, heuristic } = req.body;
    if (bruteForce) {
      if (bruteForce.route && !isRouteArray(bruteForce.route)) {
        return res.status(400).json({ error: 'Invalid bruteForce route' });
      }
      if (bruteForce.distance !== undefined && bruteForce.distance !== null && !isFiniteNumber(bruteForce.distance)) {
        return res.status(400).json({ error: 'Invalid bruteForce distance' });
      }
      if (bruteForce.computeTime !== undefined && bruteForce.computeTime !== null && !isFiniteNumber(bruteForce.computeTime)) {
        return res.status(400).json({ error: 'Invalid bruteForce computeTime' });
      }
      if (bruteForce.checked !== undefined && bruteForce.checked !== null && !isFiniteNumber(bruteForce.checked)) {
        return res.status(400).json({ error: 'Invalid bruteForce checked' });
      }
      if (bruteForce.totalChecks !== undefined && bruteForce.totalChecks !== null && !isFiniteNumber(bruteForce.totalChecks)) {
        return res.status(400).json({ error: 'Invalid bruteForce totalChecks' });
      }
      if (bruteForce.cancelled !== undefined && bruteForce.cancelled !== null && typeof bruteForce.cancelled !== 'boolean') {
        return res.status(400).json({ error: 'Invalid bruteForce cancelled flag' });
      }
    }
    if (heuristic) {
      if (heuristic.route && !isRouteArray(heuristic.route)) {
        return res.status(400).json({ error: 'Invalid heuristic route' });
      }
      if (heuristic.distance !== undefined && heuristic.distance !== null && !isFiniteNumber(heuristic.distance)) {
        return res.status(400).json({ error: 'Invalid heuristic distance' });
      }
      if (heuristic.computeTime !== undefined && heuristic.computeTime !== null && !isFiniteNumber(heuristic.computeTime)) {
        return res.status(400).json({ error: 'Invalid heuristic computeTime' });
      }
    }

    if (bruteForce) {
      session.data.algorithms.bruteForce = {
        route: bruteForce.route,
        distance: bruteForce.distance,
        computeTime: bruteForce.computeTime,
        computed: !bruteForce.cancelled,
        cancelled: Boolean(bruteForce.cancelled),
        progressCurrent: bruteForce.checked ?? null,
        progressTotal: bruteForce.totalChecks ?? null,
        status: bruteForce.cancelled ? 'cancelled' : 'complete',
        computedAt: Date.now()
      };
    }

    if (heuristic) {
      session.data.algorithms.heuristic = {
        route: heuristic.route,
        distance: heuristic.distance,
        computeTime: heuristic.computeTime,
        computed: true,
        status: 'complete',
        computedAt: Date.now()
      };
    }

    await sessions.set(session.id, session);

    // Broadcast algorithm results
    await broadcast('algorithmsComputed', { bruteForce, heuristic }, session.id);

    if ((session.data.broadcasts || []).length > 0) {
      const routes = buildBroadcastPayload(session);
      await broadcast('broadcastUpdate', { routes }, session.id);
    }

    res.json({ success: true });
  });

  // Update algorithm progress (for long-running computations)
  app.post('/api/traveling-salesman/:sessionId/algorithm-progress', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'traveling-salesman') {
      return res.status(404).json({ error: 'Session not found' });
    }

    const { bruteForce, heuristic } = req.body;
    if (bruteForce) {
      if (bruteForce.checked !== undefined && bruteForce.checked !== null && !isFiniteNumber(bruteForce.checked)) {
        return res.status(400).json({ error: 'Invalid bruteForce checked' });
      }
      if (bruteForce.totalChecks !== undefined && bruteForce.totalChecks !== null && !isFiniteNumber(bruteForce.totalChecks)) {
        return res.status(400).json({ error: 'Invalid bruteForce totalChecks' });
      }
      if (bruteForce.status !== undefined && bruteForce.status !== null && typeof bruteForce.status !== 'string') {
        return res.status(400).json({ error: 'Invalid bruteForce status' });
      }
    }
    if (heuristic) {
      if (heuristic.checked !== undefined && heuristic.checked !== null && !isFiniteNumber(heuristic.checked)) {
        return res.status(400).json({ error: 'Invalid heuristic checked' });
      }
      if (heuristic.totalChecks !== undefined && heuristic.totalChecks !== null && !isFiniteNumber(heuristic.totalChecks)) {
        return res.status(400).json({ error: 'Invalid heuristic totalChecks' });
      }
      if (heuristic.status !== undefined && heuristic.status !== null && typeof heuristic.status !== 'string') {
        return res.status(400).json({ error: 'Invalid heuristic status' });
      }
    }

    if (bruteForce) {
      session.data.algorithms.bruteForce = {
        ...session.data.algorithms.bruteForce,
        progressCurrent: bruteForce.checked ?? session.data.algorithms.bruteForce.progressCurrent ?? null,
        progressTotal: bruteForce.totalChecks ?? session.data.algorithms.bruteForce.progressTotal ?? null,
        status: bruteForce.status || session.data.algorithms.bruteForce.status || 'running'
      };
    }

    if (heuristic) {
      session.data.algorithms.heuristic = {
        ...session.data.algorithms.heuristic,
        progressCurrent: heuristic.checked ?? session.data.algorithms.heuristic.progressCurrent ?? null,
        progressTotal: heuristic.totalChecks ?? session.data.algorithms.heuristic.progressTotal ?? null,
        status: heuristic.status || session.data.algorithms.heuristic.status || 'running'
      };
    }

    await sessions.set(session.id, session);
    if ((session.data.broadcasts || []).includes('bruteforce')) {
      const routes = buildBroadcastPayload(session);
      await broadcast('broadcastUpdate', { routes }, session.id);
    }
    res.json({ success: true });
  });

  // Get leaderboard
  app.get('/api/traveling-salesman/:sessionId/leaderboard', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'traveling-salesman') {
      return res.status(404).json({ error: 'Session not found' });
    }

    const leaderboard = [];

    // Add student routes (including in-progress)
    session.data.students.forEach(student => {
      if (!student.currentRoute || student.currentRoute.length === 0) return;
      leaderboard.push({
        id: student.id,
        name: student.name,
        distance: student.routeDistance,
        timeToComplete: student.timeToComplete,
        progressCurrent: student.currentRoute.length,
        progressTotal: session.data.problem.numCities,
        type: 'student',
        connected: student.connected,
        complete: student.complete
      });
    });

    // Add instructor route (including in-progress)
    if (session.data.instructor?.route?.length) {
      leaderboard.push({
        id: 'instructor',
        name: session.data.instructor.name || 'Instructor',
        distance: session.data.instructor.distance ?? null,
        timeToComplete: session.data.instructor.timeToComplete ?? null,
        progressCurrent: session.data.instructor.progressCurrent ?? session.data.instructor.route.length,
        progressTotal: session.data.instructor.progressTotal ?? session.data.problem.numCities,
        type: 'instructor',
        complete: session.data.instructor.complete
      });
    }

    // Add brute force
    if (session.data.algorithms.bruteForce?.computed) {
      leaderboard.push({
        id: 'bruteforce',
        name: 'Brute Force (Optimal)',
        distance: session.data.algorithms.bruteForce.distance,
        timeToComplete: session.data.algorithms.bruteForce.computeTime,
        type: 'bruteforce',
        complete: true
      });
    } else if (session.data.algorithms.bruteForce?.status || session.data.algorithms.bruteForce?.progressTotal) {
      leaderboard.push({
        id: 'bruteforce',
        name: 'Brute Force (Optimal)',
        distance: session.data.algorithms.bruteForce.distance ?? null,
        timeToComplete: null,
        progressCurrent: session.data.algorithms.bruteForce.progressCurrent ?? null,
        progressTotal: session.data.algorithms.bruteForce.progressTotal ?? null,
        type: 'bruteforce',
        status: session.data.algorithms.bruteForce.status
      });
    } else {
      leaderboard.push({
        id: 'bruteforce',
        name: 'Brute Force (Optimal)',
        distance: null,
        timeToComplete: null,
        progressCurrent: null,
        progressTotal: null,
        type: 'bruteforce'
      });
    }

    // Add heuristic
    if (session.data.algorithms.heuristic?.computed) {
      leaderboard.push({
        id: 'heuristic',
        name: 'Nearest Neighbor',
        distance: session.data.algorithms.heuristic.distance,
        timeToComplete: session.data.algorithms.heuristic.computeTime,
        type: 'heuristic',
        complete: true
      });
    } else if (session.data.algorithms.heuristic?.status || session.data.algorithms.heuristic?.progressTotal) {
      leaderboard.push({
        id: 'heuristic',
        name: 'Nearest Neighbor',
        distance: session.data.algorithms.heuristic.distance ?? null,
        timeToComplete: null,
        progressCurrent: session.data.algorithms.heuristic.progressCurrent ?? null,
        progressTotal: session.data.algorithms.heuristic.progressTotal ?? null,
        type: 'heuristic',
        status: session.data.algorithms.heuristic.status
      });
    } else {
      leaderboard.push({
        id: 'heuristic',
        name: 'Nearest Neighbor',
        distance: null,
        timeToComplete: null,
        progressCurrent: null,
        progressTotal: null,
        type: 'heuristic'
      });
    }

    // Sort by completion first, then distance (ascending)
    leaderboard.sort((a, b) => {
      const aComplete = a.complete === true;
      const bComplete = b.complete === true;
      if (aComplete && !bComplete) return -1;
      if (!aComplete && bComplete) return 1;
      const aDistance = a.distance ?? Infinity;
      const bDistance = b.distance ?? Infinity;
      return aDistance - bDistance;
    });

    res.json({ leaderboard });
  });

  // Set broadcast overlays
  app.post('/api/traveling-salesman/:sessionId/set-broadcasts', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'traveling-salesman') {
      return res.status(404).json({ error: 'Session not found' });
    }

    const { broadcasts } = req.body;
    if (!Array.isArray(broadcasts) || !broadcasts.every(id => typeof id === 'string')) {
      return res.status(400).json({ error: 'Invalid broadcasts payload' });
    }
    session.data.broadcasts = Array.isArray(broadcasts) ? broadcasts : [];
    await sessions.set(session.id, session);

    const routes = buildBroadcastPayload(session);
    await broadcast('broadcastUpdate', { routes }, session.id);
    if (routes.length === 0) {
      await broadcast('clearBroadcast', { cleared: true }, session.id);
    }
    res.json({ success: true });
  });

  // Broadcast custom route (e.g., instructor live build)
  app.post('/api/traveling-salesman/:sessionId/broadcast-route', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'traveling-salesman') {
      return res.status(404).json({ error: 'Session not found' });
    }

    const { id, name, route, distance, type, timeToComplete } = req.body;
    if (!isRouteArray(route)) {
      return res.status(400).json({ error: 'Route required' });
    }
    if (distance !== undefined && distance !== null && !isFiniteNumber(distance)) {
      return res.status(400).json({ error: 'Invalid distance' });
    }
    if (timeToComplete != null && !Number.isFinite(timeToComplete)) {
      return res.status(400).json({ error: 'Invalid timeToComplete' });
    }
    if (id !== undefined && id !== null && typeof id !== 'string') {
      return res.status(400).json({ error: 'Invalid id' });
    }
    if (name !== undefined && name !== null && typeof name !== 'string') {
      return res.status(400).json({ error: 'Invalid name' });
    }
    if (type !== undefined && type !== null && typeof type !== 'string') {
      return res.status(400).json({ error: 'Invalid type' });
    }

    if (route.length === 0) {
      return res.status(400).json({ error: 'Route required' });
    }

    const progressTotal = session.data.problem?.numCities ?? route.length;
    const progressCurrent = route.length;
    const complete = progressCurrent === progressTotal;

    session.data.instructor = {
      id: id || 'instructor',
      name: name || 'Instructor',
      route,
      distance,
      type: type || 'instructor',
      timeToComplete: timeToComplete ?? null,
      progressCurrent,
      progressTotal,
      complete
    };

    await sessions.set(session.id, session);

    if ((session.data.broadcasts || []).includes('instructor')) {
      const routes = buildBroadcastPayload(session);
      await broadcast('broadcastUpdate', { routes }, session.id);
    }

    res.json({ success: true });
  });

  // Clear broadcasted solution
  app.post('/api/traveling-salesman/:sessionId/broadcast-clear', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'traveling-salesman') {
      return res.status(404).json({ error: 'Session not found' });
    }

    session.data.instructor = null;
    session.data.broadcasts = [];
    await sessions.set(session.id, session);

    await broadcast('broadcastUpdate', { routes: [] }, session.id);
    await broadcast('clearBroadcast', { cleared: true }, session.id);
    res.json({ success: true });
  });

  // Reset heuristic route
  app.post('/api/traveling-salesman/:sessionId/reset-heuristic', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'traveling-salesman') {
      return res.status(404).json({ error: 'Session not found' });
    }

    session.data.algorithms.heuristic = {};
    await sessions.set(session.id, session);

    const routes = buildBroadcastPayload(session);
    await broadcast('broadcastUpdate', { routes }, session.id);
    if (routes.length === 0) {
      await broadcast('clearBroadcast', { cleared: true }, session.id);
    }

    res.json({ success: true });
  });

  // Broadcast solution (legacy single-route)
  app.post('/api/traveling-salesman/:sessionId/broadcast-solution', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'traveling-salesman') {
      return res.status(404).json({ error: 'Session not found' });
    }

    const { solutionId } = req.body;
    if (typeof solutionId !== 'string' || !solutionId.trim()) {
      return res.status(400).json({ error: 'Invalid solutionId' });
    }

    let solution = null;

    // Find solution
    if (solutionId === 'bruteforce' && session.data.algorithms.bruteForce?.computed) {
      solution = {
        id: 'bruteforce',
        name: 'Brute Force (Optimal)',
        route: session.data.algorithms.bruteForce.route,
        distance: session.data.algorithms.bruteForce.distance,
        type: 'bruteforce',
        timeToComplete: session.data.algorithms.bruteForce.computeTime
      };
    } else if (solutionId === 'heuristic' && session.data.algorithms.heuristic?.computed) {
      solution = {
        id: 'heuristic',
        name: 'Nearest Neighbor',
        route: session.data.algorithms.heuristic.route,
        distance: session.data.algorithms.heuristic.distance,
        type: 'heuristic',
        timeToComplete: session.data.algorithms.heuristic.computeTime
      };
    } else {
      const student = session.data.students.find(s => s.id === solutionId);
      if (student) {
        solution = {
          id: student.id,
          name: student.name,
          route: student.currentRoute,
          distance: student.routeDistance,
          type: 'student',
          timeToComplete: student.timeToComplete
        };
      }
    }

    if (solution) {
      await broadcast('broadcastUpdate', {
        routes: [{
          ...solution,
          path: solution.route,
          route: undefined
        }]
      }, session.id);
    }

    res.json({ success: true });
  });
}
