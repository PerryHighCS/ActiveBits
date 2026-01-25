import { isFiniteNumber, isRouteArray } from '../validation.js';
import { createBroadcastHelpers } from './shared.js';

export default function registerAlgorithmRoutes(app, sessions, ws) {
  const { broadcast, broadcastRoutesUpdate } = createBroadcastHelpers(sessions, ws);

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
      if (bruteForce.distance !== undefined && bruteForce.distance !== null
        && (!isFiniteNumber(bruteForce.distance) || bruteForce.distance < 0)) {
        return res.status(400).json({ error: 'Invalid bruteForce distance' });
      }
      if (bruteForce.computeTime !== undefined && bruteForce.computeTime !== null
        && (!isFiniteNumber(bruteForce.computeTime) || bruteForce.computeTime < 0)) {
        return res.status(400).json({ error: 'Invalid bruteForce computeTime' });
      }
      if (bruteForce.checked !== undefined && bruteForce.checked !== null
        && (!isFiniteNumber(bruteForce.checked) || bruteForce.checked < 0)) {
        return res.status(400).json({ error: 'Invalid bruteForce checked' });
      }
      if (bruteForce.totalChecks !== undefined && bruteForce.totalChecks !== null
        && (!isFiniteNumber(bruteForce.totalChecks) || bruteForce.totalChecks < 0)) {
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
      if (heuristic.distance !== undefined && heuristic.distance !== null
        && (!isFiniteNumber(heuristic.distance) || heuristic.distance < 0)) {
        return res.status(400).json({ error: 'Invalid heuristic distance' });
      }
      if (heuristic.computeTime !== undefined && heuristic.computeTime !== null
        && (!isFiniteNumber(heuristic.computeTime) || heuristic.computeTime < 0)) {
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
      await broadcastRoutesUpdate(session);
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
      if (bruteForce.checked !== undefined && bruteForce.checked !== null
        && (!isFiniteNumber(bruteForce.checked) || bruteForce.checked < 0)) {
        return res.status(400).json({ error: 'Invalid bruteForce checked' });
      }
      if (bruteForce.totalChecks !== undefined && bruteForce.totalChecks !== null
        && (!isFiniteNumber(bruteForce.totalChecks) || bruteForce.totalChecks < 0)) {
        return res.status(400).json({ error: 'Invalid bruteForce totalChecks' });
      }
      if (bruteForce.status !== undefined && bruteForce.status !== null && typeof bruteForce.status !== 'string') {
        return res.status(400).json({ error: 'Invalid bruteForce status' });
      }
    }
    if (heuristic) {
      if (heuristic.checked !== undefined && heuristic.checked !== null
        && (!isFiniteNumber(heuristic.checked) || heuristic.checked < 0)) {
        return res.status(400).json({ error: 'Invalid heuristic checked' });
      }
      if (heuristic.totalChecks !== undefined && heuristic.totalChecks !== null
        && (!isFiniteNumber(heuristic.totalChecks) || heuristic.totalChecks < 0)) {
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
      await broadcastRoutesUpdate(session);
    }
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

    await broadcastRoutesUpdate(session);
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
          id: solution.id,
          name: solution.name,
          path: solution.route,
          distance: solution.distance,
          type: solution.type,
          timeToComplete: solution.timeToComplete ?? null
        }]
      }, session.id);
    }

    res.json({ success: true });
  });
}
