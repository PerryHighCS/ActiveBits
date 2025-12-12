import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import setupGalleryWalkRoutes from '../activities/gallery-walk/server/routes.js';
import { createSessionStore } from 'activebits-server/core/sessions.js';
import { DEFAULT_NOTE_STYLE_ID, NOTE_STYLE_OPTIONS } from '../activities/gallery-walk/shared/noteStyles.js';

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
  assert.equal(feedbackBody.feedback.styleId, DEFAULT_NOTE_STYLE_ID);
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
});

test('updates session title metadata', async (t) => {
  const server = await startTestServer();
  t.after(server.close);

  const sessionId = await createSession(server.baseUrl);
  const titleRes = await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/title`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Showcase 2024' }),
  });
  const titleBody = await titleRes.json();
  assert.equal(titleBody.ok, true);
  assert.equal(titleBody.title, 'Showcase 2024');

  const snapshotRes = await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/feedback`);
  const snapshot = await snapshotRes.json();
  assert.equal(snapshot.config.title, 'Showcase 2024');

  const exportRes = await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/export`);
  const bundle = await exportRes.json();
  assert.equal(bundle.config.title, 'Showcase 2024');
});

test('allows reviewers to set sticky note styles', async (t) => {
  const server = await startTestServer();
  t.after(server.close);

  const sessionId = await createSession(server.baseUrl);

  await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/reviewee`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revieweeId: 'stu-3', name: 'Student Three' }),
  });

  await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/reviewer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewerId: 'rev-3', name: 'Reviewer Three' }),
  });

  const styleId = NOTE_STYLE_OPTIONS[1].id;
  const feedbackRes = await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revieweeId: 'stu-3', reviewerId: 'rev-3', message: 'Love the visuals', styleId }),
  });
  const body = await feedbackRes.json();
  assert.equal(body.feedback.styleId, styleId);
});

test('invalid note style falls back to default', async (t) => {
  const server = await startTestServer();
  t.after(server.close);

  const sessionId = await createSession(server.baseUrl);

  await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/reviewee`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revieweeId: 'stu-4', name: 'Student Four' }),
  });

  await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/reviewer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewerId: 'rev-4', name: 'Reviewer Four' }),
  });

  const feedbackRes = await fetch(`${server.baseUrl}/api/gallery-walk/${sessionId}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revieweeId: 'stu-4', reviewerId: 'rev-4', message: 'Great progress', styleId: 'invalid' }),
  });
  const body = await feedbackRes.json();
  assert.equal(body.feedback.styleId, DEFAULT_NOTE_STYLE_ID);
});
