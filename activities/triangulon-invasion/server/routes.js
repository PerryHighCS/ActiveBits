import { createSession } from 'activebits-server/core/sessions.js';
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js';

registerSessionNormalizer('triangulon-invasion', (session) => {
  const data = session.data || {};
  data.stage = typeof data.stage === 'string' ? data.stage : 'training';
  data.events = Array.isArray(data.events) ? data.events : [];
  data.map = Array.isArray(data.map) ? data.map : []; // optional: holds triangle state
  session.data = data;
});

export default function setupTriangulonRoutes(app, sessions, ws = null) {
  app.post('/api/triangulon-invasion/create', async (req, res) => {
    const session = await createSession(sessions, { data: {} });
    session.type = 'triangulon-invasion';
    session.data.stage = 'training';
    session.data.events = [];
    await sessions.set(session.id, session);
    res.json({ id: session.id });
  });

  app.get('/api/triangulon-invasion/:sessionId/state', async (req, res) => {
    const session = await sessions.get(req.params.sessionId);
    if (!session || session.type !== 'triangulon-invasion') {
      return res.status(404).json({ error: 'invalid session' });
    }
    res.json({ stage: session.data.stage, events: session.data.events });
  });

  if (ws && typeof ws.register === 'function') {
    const peers = new Map(); // sessionId -> Set<WebSocket>

    const sendSafe = (socket, payload) => {
      if (socket.readyState === 1) {
        socket.send(payload);
      }
    };

    const broadcast = (sessionId, message) => {
      const set = peers.get(sessionId);
      if (!set || set.size === 0) return;
      const payload = typeof message === 'string' ? message : JSON.stringify(message);
      const stale = [];
      for (const sock of set) {
        if (sock.readyState === 1) {
          sock.send(payload);
        } else {
          stale.push(sock);
        }
      }
      if (stale.length) {
        stale.forEach(sock => set.delete(sock));
        if (set.size === 0) peers.delete(sessionId);
      }
    };

    const sendSnapshot = async (socket, sessionId) => {
      const session = await sessions.get(sessionId);
      if (!session || session.type !== 'triangulon-invasion') {
        socket.close(1008, 'Invalid session');
        return false;
      }
      const snapshot = {
        type: 'state',
        stage: session.data.stage,
        events: session.data.events,
        map: session.data.map,
      };
      sendSafe(socket, JSON.stringify(snapshot));
      return true;
    };

    ws.register('/ws/triangulon-invasion', (socket, qp) => {
      const sessionId = qp.get('sessionId');
      if (!sessionId) {
        socket.close(1008, 'Missing sessionId');
        return;
      }

      socket.sessionId = sessionId;

      // Track peers for broadcast
      let set = peers.get(sessionId);
      if (!set) {
        set = new Set();
        peers.set(sessionId, set);
      }
      set.add(socket);

      (async () => {
        const ok = await sendSnapshot(socket, sessionId);
        if (!ok) return;
        sendSafe(socket, JSON.stringify({ type: 'connected' }));
      })().catch((err) => {
        console.error('[triangulon-invasion] failed to send snapshot', err);
        socket.close(1011, 'Snapshot failed');
      });

      socket.on('message', async (data) => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          return; // ignore non-JSON
        }

        const session = await sessions.get(sessionId);
        if (!session || session.type !== 'triangulon-invasion') return;

        // Basic protocol scaffold
        switch (parsed.type) {
          case 'advance-stage': {
            const stage = typeof parsed.stage === 'string' ? parsed.stage : null;
            if (!stage) return;
            session.data.stage = stage;
            session.data.events.push({ t: Date.now(), type: 'stage', stage });
            await sessions.set(session.id, session);
            broadcast(sessionId, { type: 'state', stage: session.data.stage, events: session.data.events, map: session.data.map });
            break;
          }
          case 'subdivide': {
            // Minimal stub: record the path and timestamp; real implementation can mutate map tree
            const path = Array.isArray(parsed.path) ? parsed.path.slice(0, 12) : [];
            const evt = { t: Date.now(), type: 'subdivide', path };
            session.data.events.push(evt);
            await sessions.set(session.id, session);
            broadcast(sessionId, { type: 'events', events: [evt] });
            break;
          }
          case 'manager-action': {
            // Generic manager action envelope
            const action = typeof parsed.action === 'string' ? parsed.action : null;
            if (!action) return;
            const evt = { t: Date.now(), type: 'manager', action, payload: parsed.payload || null };
            session.data.events.push(evt);
            await sessions.set(session.id, session);
            broadcast(sessionId, { type: 'events', events: [evt] });
            break;
          }
          case 'event': {
            // Generic event envelope for now
            const evt = { t: Date.now(), ...parsed.event };
            session.data.events.push(evt);
            await sessions.set(session.id, session);
            broadcast(sessionId, { type: 'events', events: [evt] });
            break;
          }
          default:
            break;
        }
      });

      const cleanup = () => {
        const set = peers.get(sessionId);
        if (!set) return;
        set.delete(socket);
        if (set.size === 0) peers.delete(sessionId);
      };

      socket.on('close', cleanup);
      socket.on('error', cleanup);
    });
  }
}
