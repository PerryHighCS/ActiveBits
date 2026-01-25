import { isFiniteNumber, isRouteArray } from '../validation.js';
import { createBroadcastHelpers } from './shared.js';

export default function registerInstructorRoutes(app, sessions, ws) {
  const { broadcastRoutesUpdate } = createBroadcastHelpers(sessions, ws);

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
    if (distance !== undefined && distance !== null && (!isFiniteNumber(distance) || distance < 0)) {
      return res.status(400).json({ error: 'Invalid distance' });
    }
    if (complete !== undefined && complete !== null && typeof complete !== 'boolean') {
      return res.status(400).json({ error: 'Invalid complete flag' });
    }
    if (timeToComplete != null && (!Number.isFinite(timeToComplete) || timeToComplete < 0)) {
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

    await broadcastRoutesUpdate(session);
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
    if (distance !== undefined && distance !== null && (!isFiniteNumber(distance) || distance < 0)) {
      return res.status(400).json({ error: 'Invalid distance' });
    }
    if (timeToComplete != null && (!Number.isFinite(timeToComplete) || timeToComplete < 0)) {
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
      await broadcastRoutesUpdate(session);
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

    await broadcastRoutesUpdate(session);
    res.json({ success: true });
  });
}
