import { createSession } from 'activebits-server/core/sessions.js';
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js';
import { isCitiesArray, isDistanceMatrix, isFiniteNumber } from '../validation.js';
import { createBroadcastHelpers } from './shared.js';

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

export default function registerSessionRoutes(app, sessions, ws) {
  const { broadcast, broadcastRoutesUpdate } = createBroadcastHelpers(sessions, ws);

  // Create session
  app.post('/api/traveling-salesman/create', async (req, res) => {
    const session = await createSession(sessions, { data: {} });
    session.type = 'traveling-salesman';
    session.data.problem = {};
    session.data.students = [];
    session.data.algorithms = { bruteForce: {}, heuristic: {} };
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
    await broadcastRoutesUpdate(session);

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

    await broadcastRoutesUpdate(session);
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

    await broadcastRoutesUpdate(session);
    res.json({ success: true });
  });
}
