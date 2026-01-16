import { createSession } from 'activebits-server/core/sessions.js';
import { createBroadcastSubscriptionHelper } from 'activebits-server/core/broadcastUtils.js';
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js';

/**
 * Register session normalizer for algorithm-demo
 * Ensures loaded sessions have required data structures
 */
registerSessionNormalizer('algorithm-demo', (session) => {
  const data = session.data;
  data.algorithmId = typeof data.algorithmId === 'string' ? data.algorithmId : null;
  data.algorithmState = data.algorithmState && typeof data.algorithmState === 'object' ? data.algorithmState : {};
  data.history = Array.isArray(data.history) ? data.history : [];
});

export default function setupAlgorithmDemoRoutes(app, sessions, ws) {
  const ensureBroadcastSubscription = createBroadcastSubscriptionHelper(sessions, ws);

  // WebSocket namespace
  ws.register('/ws/algorithm-demo', (socket, qp) => {
    socket.sessionId = qp.get('sessionId') || null;
    if (socket.sessionId) {
      ensureBroadcastSubscription(socket.sessionId);
    }
  });

  /**
   * Broadcast helper
   */
  async function broadcast(type, payload, sessionId, metadata = {}) {
    const msgObj = { type, payload, timestamp: Date.now(), ...metadata };
    const msg = JSON.stringify(msgObj);
    if (sessions.publishBroadcast) {
      await sessions.publishBroadcast(`session:${sessionId}:broadcast`, msgObj);
    }
    // Local WS broadcast
    for (const s of ws.wss.clients) {
      if (s.readyState === 1 && s.sessionId === sessionId) {
        try {
          s.send(msg);
        } catch {
          // ignore send errors
        }
      }
    }
  }

  /**
   * POST /api/algorithm-demo/create
   * Create a new demo session
   */
  app.post('/api/algorithm-demo/create', async (req, res) => {
    try {
      const session = await createSession(sessions, { data: {} });
      session.type = 'algorithm-demo';
      session.data.algorithmId = null;
      session.data.algorithmState = {};
      session.data.history = [];
      await sessions.set(session.id, session);
      res.json({ id: session.id });
    } catch (err) {
      console.error('Error creating algorithm-demo session:', err);
      res.status(500).json({ error: 'Failed to create session' });
    }
  });

  /**
   * GET /api/algorithm-demo/:sessionId/session
   * Get current session state
   */
  app.get('/api/algorithm-demo/:sessionId/session', async (req, res) => {
    try {
      const session = await sessions.get(req.params.sessionId);
      if (!session || session.type !== 'algorithm-demo') {
        return res.status(404).json({ error: 'Session not found' });
      }
      res.json(session);
    } catch (err) {
      console.error('Error fetching session:', err);
      res.status(500).json({ error: 'Failed to fetch session' });
    }
  });

  /**
   * POST /api/algorithm-demo/:sessionId/select
   * Select an algorithm (manager only)
   */
  app.post('/api/algorithm-demo/:sessionId/select', async (req, res) => {
    try {
      const session = await sessions.get(req.params.sessionId);
      if (!session || session.type !== 'algorithm-demo') {
        return res.status(404).json({ error: 'Session not found' });
      }

      const { algorithmId, algorithmState } = req.body;
      session.data.algorithmId = algorithmId;
      session.data.algorithmState = algorithmState || {};
      session.data.history.push({
        action: 'algorithm-selected',
        algorithmId,
        timestamp: Date.now(),
      });

      await sessions.set(session.id, session);

      // Broadcast to all students with algorithmId
      await broadcast('algorithm-selected', algorithmState, session.id, {
        algorithmId,
      });

      res.json({ success: true });
    } catch (err) {
      console.error('Error selecting algorithm:', err);
      res.status(500).json({ error: 'Failed to select algorithm' });
    }
  });

  /**
   * POST /api/algorithm-demo/:sessionId/state
   * Update algorithm state (manager broadcasts to students)
   */
  app.post('/api/algorithm-demo/:sessionId/state', async (req, res) => {
    try {
      const session = await sessions.get(req.params.sessionId);
      if (!session || session.type !== 'algorithm-demo') {
        return res.status(404).json({ error: 'Session not found' });
      }

      const { algorithmState } = req.body;
      session.data.algorithmState = algorithmState;
      session.data.history.push({
        action: 'state-update',
        timestamp: Date.now(),
        stateKeys: Object.keys(algorithmState || {}),
      });

      await sessions.set(session.id, session);

      // Broadcast state-sync to all students
      await broadcast('state-sync', algorithmState, session.id);

      res.json({ success: true });
    } catch (err) {
      console.error('Error updating state:', err);
      res.status(500).json({ error: 'Failed to update state' });
    }
  });

  /**
   * POST /api/algorithm-demo/:sessionId/event
   * Send an event (for future use)
   */
  app.post('/api/algorithm-demo/:sessionId/event', async (req, res) => {
    try {
      const session = await sessions.get(req.params.sessionId);
      if (!session || session.type !== 'algorithm-demo') {
        return res.status(404).json({ error: 'Session not found' });
      }

      const { eventType, payload } = req.body;
      session.data.history.push({
        action: 'event',
        eventType,
        timestamp: Date.now(),
      });

      await sessions.set(session.id, session);

      // Broadcast event
      await broadcast('event', { type: eventType, payload }, session.id);

      res.json({ success: true });
    } catch (err) {
      console.error('Error publishing event:', err);
      res.status(500).json({ error: 'Failed to publish event' });
    }
  });
}
