import { createSession } from 'activebits-server/core/sessions.js';
import { createBroadcastSubscriptionHelper } from 'activebits-server/core/broadcastUtils.js';
import { registerSessionNormalizer } from 'activebits-server/core/sessionNormalization.js';

const DEFAULT_STAGE = 'gallery';

function ensurePlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeStage(stage) {
  return stage === 'review' ? 'review' : DEFAULT_STAGE;
}

function createId() {
  const alphabet = 'BCDFGHJKLMNPQRSTVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return out;
}

function sanitizeName(value, fallback = '') {
  if (!value || typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

registerSessionNormalizer('gallery-walk', (session) => {
  const data = session.data;
  data.stage = normalizeStage(data.stage);
  data.config = ensurePlainObject(data.config);
  data.reviewees = ensurePlainObject(data.reviewees);
  data.reviewers = ensurePlainObject(data.reviewers);
  data.feedback = Array.isArray(data.feedback) ? data.feedback : [];
  data.stats = ensurePlainObject(data.stats);
  data.stats.reviewees = ensurePlainObject(data.stats.reviewees);
  data.stats.reviewers = ensurePlainObject(data.stats.reviewers);
});

export default function setupGalleryWalkRoutes(app, sessions, ws) {
  const ensureBroadcastSubscription = createBroadcastSubscriptionHelper(sessions, ws);

  async function broadcast(type, payload, sessionId) {
    const message = JSON.stringify({ type, payload });
    if (sessions.publishBroadcast) {
      try {
        await sessions.publishBroadcast(`session:${sessionId}:broadcast`, { type, payload });
      } catch (err) {
        console.error('Failed to publish gallery-walk broadcast', err);
      }
    }

    const clients = ws?.wss?.clients || new Set();
    for (const socket of clients) {
      if (socket.readyState === 1 && socket.sessionId === sessionId) {
        try {
          socket.send(message);
        } catch (err) {
          console.error('Failed to send gallery-walk broadcast', err);
        }
      }
    }
  }

  function ensureGalleryWalkSession(session) {
    if (!session || session.type !== 'gallery-walk') {
      return null;
    }
    return session;
  }

  ws?.register?.('/ws/gallery-walk', (socket, qp) => {
    socket.sessionId = qp.get('sessionId') || null;
    ensureBroadcastSubscription(socket.sessionId);
  });

  app.post('/api/gallery-walk/create', async (req, res) => {
    const session = await createSession(sessions, { data: {} });
    session.type = 'gallery-walk';
    session.data.stage = DEFAULT_STAGE;
    await sessions.set(session.id, session);
    ensureBroadcastSubscription(session.id);
    res.json({ id: session.id, sessionId: session.id });
  });

  app.post('/api/gallery-walk/:sessionId/stage', async (req, res) => {
    const session = ensureGalleryWalkSession(await sessions.get(req.params.sessionId));
    if (!session) return res.status(404).json({ error: 'invalid session' });

    const requestedStage = normalizeStage(req.body?.stage);
    session.data.stage = requestedStage;
    await sessions.set(session.id, session);
    await broadcast('stage-changed', { stage: requestedStage }, session.id);

    res.json({ ok: true, stage: requestedStage });
  });

  app.post('/api/gallery-walk/:sessionId/reviewee', async (req, res) => {
    const session = ensureGalleryWalkSession(await sessions.get(req.params.sessionId));
    if (!session) return res.status(404).json({ error: 'invalid session' });

    const providedId = typeof req.body?.revieweeId === 'string' ? req.body.revieweeId.trim() : '';
    let revieweeId = providedId || createId();
    const name = sanitizeName(req.body?.name);
    const projectTitle = sanitizeName(req.body?.projectTitle || '', null);

    if (!revieweeId || !name) {
      return res.status(400).json({ error: 'revieweeId and name are required' });
    }

    if (session.data.reviewees[revieweeId]) {
      // De-duplicate by generating a fresh ID server-side
      revieweeId = createId();
      if (session.data.reviewees[revieweeId]) {
        return res.status(409).json({ error: 'revieweeId already exists' });
      }
    }

    session.data.reviewees[revieweeId] = projectTitle ? { name, projectTitle } : { name };
    await sessions.set(session.id, session);
    await broadcast('reviewees-updated', { reviewees: session.data.reviewees }, session.id);

    res.json({ ok: true, revieweeId, reviewees: session.data.reviewees });
  });

  app.post('/api/gallery-walk/:sessionId/reviewer', async (req, res) => {
    const session = ensureGalleryWalkSession(await sessions.get(req.params.sessionId));
    if (!session) return res.status(404).json({ error: 'invalid session' });

    const reviewerId = sanitizeName(req.body?.reviewerId || '');
    const name = sanitizeName(req.body?.name);
    if (!reviewerId || !name) {
      return res.status(400).json({ error: 'reviewerId and name are required' });
    }

    session.data.reviewers[reviewerId] = { name };
    await sessions.set(session.id, session);
    res.json({ ok: true });
  });

  app.post('/api/gallery-walk/:sessionId/feedback', async (req, res) => {
    const session = ensureGalleryWalkSession(await sessions.get(req.params.sessionId));
    if (!session) return res.status(404).json({ error: 'invalid session' });

    const revieweeId = sanitizeName(req.body?.revieweeId || '');
    const reviewerId = sanitizeName(req.body?.reviewerId || '');
    const message = sanitizeName(req.body?.message);

    if (!revieweeId || !reviewerId || !message) {
      return res.status(400).json({ error: 'revieweeId, reviewerId, and message are required' });
    }

    const reviewer = session.data.reviewers[reviewerId];
    const feedbackEntry = {
      id: createId(),
      to: revieweeId,
      from: reviewerId,
      fromNameSnapshot: reviewer?.name || 'Anonymous Reviewer',
      message,
      createdAt: Date.now(),
    };

    session.data.feedback.push(feedbackEntry);
    session.data.stats.reviewees[revieweeId] = (session.data.stats.reviewees[revieweeId] || 0) + 1;
    session.data.stats.reviewers[reviewerId] = (session.data.stats.reviewers[reviewerId] || 0) + 1;

    await sessions.set(session.id, session);
    await broadcast('feedback-added', { feedback: feedbackEntry }, session.id);

    res.json({ ok: true, feedback: feedbackEntry, stats: session.data.stats });
  });

  app.get('/api/gallery-walk/:sessionId/feedback', async (req, res) => {
    const session = ensureGalleryWalkSession(await sessions.get(req.params.sessionId));
    if (!session) return res.status(404).json({ error: 'invalid session' });

    res.json({
      feedback: session.data.feedback,
      reviewees: session.data.reviewees,
      reviewers: session.data.reviewers,
      stats: session.data.stats,
      stage: session.data.stage,
    });
  });

  app.get('/api/gallery-walk/:sessionId/feedback/:revieweeId', async (req, res) => {
    const session = ensureGalleryWalkSession(await sessions.get(req.params.sessionId));
    if (!session) return res.status(404).json({ error: 'invalid session' });

    const revieweeId = req.params.revieweeId;
    const filtered = session.data.feedback.filter((entry) => entry.to === revieweeId);
    res.json({
      feedback: filtered,
      reviewee: session.data.reviewees[revieweeId] || null,
      reviewers: session.data.reviewers,
      stage: session.data.stage,
    });
  });

  app.get('/api/gallery-walk/:sessionId/export', async (req, res) => {
    const session = ensureGalleryWalkSession(await sessions.get(req.params.sessionId));
    if (!session) return res.status(404).json({ error: 'invalid session' });

    const bundle = {
      version: 1,
      exportedAt: Date.now(),
      sessionId: session.id,
      reviewees: session.data.reviewees,
      reviewers: session.data.reviewers,
      feedback: session.data.feedback,
      stats: session.data.stats,
      stage: session.data.stage,
    };

    res.json(bundle);
  });

  app.post('/api/gallery-walk/:sessionId/import', async (req, res) => {
    const session = ensureGalleryWalkSession(await sessions.get(req.params.sessionId));
    if (!session) return res.status(404).json({ error: 'invalid session' });

    const payload = req.body?.data && typeof req.body.data === 'object' ? req.body.data : req.body;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'invalid import payload' });
    }

    session.data.reviewees = ensurePlainObject(payload.reviewees);
    session.data.reviewers = ensurePlainObject(payload.reviewers);
    session.data.feedback = Array.isArray(payload.feedback) ? payload.feedback : [];
    session.data.stats = ensurePlainObject(payload.stats);
    session.data.stats.reviewees = ensurePlainObject(session.data.stats.reviewees);
    session.data.stats.reviewers = ensurePlainObject(session.data.stats.reviewers);
    if (payload.stage) {
      session.data.stage = normalizeStage(payload.stage);
    }

    await sessions.set(session.id, session);
    res.json({
      ok: true,
      counts: {
        feedback: session.data.feedback.length,
        reviewees: Object.keys(session.data.reviewees).length,
        reviewers: Object.keys(session.data.reviewers).length,
      },
    });
  });
}
