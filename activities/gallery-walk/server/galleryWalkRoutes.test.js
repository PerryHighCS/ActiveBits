import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import setupGalleryWalkRoutes from './routes.js';
import { createSessionStore } from 'activebits-server/core/sessions.js';

function createWsStub() {
  return {
    register() {},
    wss: {
      clients: new Set(),
    },
  };
}

async function startTestServer() {
  const app = express();
  app.use(express.json());
  const sessions = createSessionStore(null, 60 * 1000);
  const ws = createWsStub();
  setupGalleryWalkRoutes(app, sessions, ws);

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine test server address');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function close() {
    await new Promise((resolve) => server.close(resolve));
    await sessions.close?.();
  }

  return { app, sessions, ws, baseUrl, close };
}

async function createSession(baseUrl) {
  const res = await fetch(`${baseUrl}/api/gallery-walk/create`, {
    method: 'POST',
  });
  const body = await res.json();
  return body.id || body.sessionId;
}

test('creates gallery-walk sessions with defaults', async (t) => {
  const server = await startTestServer();
  t.after(server.close);

  const sessionId = await createSession(server.baseUrl);
  const session = await server.sessions.get(sessionId);
  assert.equal(session.type, 'gallery-walk');
  assert.equal(session.data.stage, 'gallery');
  assert.deepEqual(session.data.feedback, []);
  assert.deepEqual(session.data.reviewees, {});
  assert.deepEqual(session.data.reviewers, {});
  assert.deepEqual(session.data.stats.reviewees, {});
  assert.deepEqual(session.data.stats.reviewers, {});
});

test('submits feedback and tracks stats', async (t) => {
  const server = await startTestServer();
  t.after(server.close);

  const sessionId = await createSession(server.baseUrl);

  await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/reviewee`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revieweeId: 'stu-1', name: 'Student One' }),
  });

  await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/reviewer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewerId: 'rev-1', name: 'Reviewer One' }),
  });

  const feedbackRes = await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revieweeId: 'stu-1', reviewerId: 'rev-1', message: 'Great project!' }),
  });
  const feedbackBody = await feedbackRes.json();

  assert.equal(feedbackBody.ok, true);
  assert.equal(feedbackBody.feedback.to, 'stu-1');
  assert.equal(feedbackBody.feedback.fromNameSnapshot, 'Reviewer One');
  assert.equal(feedbackBody.stats.reviewees['stu-1'], 1);
  assert.equal(feedbackBody.stats.reviewers['rev-1'], 1);

  const session = await server.sessions.get(sessionId);
  assert.equal(session.data.feedback.length, 1);
});

test('exports and imports gallery walk data', async (t) => {
  const server = await startTestServer();
  t.after(server.close);

  const sessionId = await createSession(server.baseUrl);

  // Seed data
  await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/reviewee`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revieweeId: 'stu-2', name: 'Student Two', projectTitle: 'Project' }),
  });
  await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/reviewer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewerId: 'rev-2', name: 'Reviewer Two' }),
  });
  await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revieweeId: 'stu-2', reviewerId: 'rev-2', message: 'Nice job' }),
  });

  const exportRes = await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/export`);
  const bundle = await exportRes.json();
  assert.equal(bundle.version, 1);
  assert.equal(bundle.feedback.length, 1);

  // Clear session data then import
  const session = await server.sessions.get(sessionId);
  session.data.reviewees = {};
  session.data.reviewers = {};
  session.data.feedback = [];
  session.data.stats.reviewees = {};
  session.data.stats.reviewers = {};
  await server.sessions.set(session.id, session);

  const importRes = await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bundle),
  });
  const importBody = await importRes.json();
  assert.equal(importBody.ok, true);
  assert.equal(importBody.counts.feedback, 1);

  const importedSession = await server.sessions.get(sessionId);
  assert.equal(Object.keys(importedSession.data.reviewees).length, 1);
  assert.equal(importedSession.data.feedback.length, 1);
  assert.equal(importedSession.data.feedback[0].message, 'Nice job');
});
